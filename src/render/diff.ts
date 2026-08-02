import { collapse, DEFAULT_CONTEXT } from '../diff/collapse.js';
import { splitLines, statOf } from '../diff/lines.js';
import type { Block, DiffRow, Segment } from '../diff/types.js';
import {
  bgGreen,
  bgRed,
  blue,
  bold,
  cyan,
  dim,
  green,
  gray,
  padStart,
  red,
  strikethrough,
} from './ansi.js';
import { highlightLine, highlightMarkdown, initialMarkdownState } from './markdown.js';

export type RenderMode = 'rich' | 'plain';

export interface DiffRenderOptions {
  mode: RenderMode;
  /** new-version line number → lock id, drawn in the gutter. */
  lockedLines?: ReadonlyMap<number, string>;
  /** new-version line number → annotation ids, drawn at end of line. */
  annotated?: ReadonlyMap<number, string[]>;
  context?: number;
  oldLabel?: string;
  newLabel?: string;
}

const LOCK_ICON = '🔒';
const GAP_MARKER = '⋯';
/** Left edge drawn beside lines carrying feedback. Dotted, so it reads as a
 *  margin note rather than another kind of diff marker. */
const ANNOTATED_EDGE = '╎';

/* ------------------------------------------------------------------ rich */

export function lineNumberWidth(rows: DiffRow[]): number {
  const max = rows.reduce((m, r) => Math.max(m, r.newLine ?? 0, r.oldLine ?? 0), 0);
  return Math.max(2, String(max).length);
}

/**
 * The fixed-width prefix: lock marker, annotation edge, change sign, number.
 *
 * Fixed width is what keeps the text column aligned, so a multi-line selection
 * reads as a block rather than a ragged stack. The cursor is deliberately *not*
 * here: it moves on every keypress, and baking it into this string would mean
 * re-rendering every line in the document to move an arrow one row.
 */
export function renderGutter(
  row: DiffRow,
  opts: { numberWidth: number; lockId?: string | undefined; annotated?: boolean },
): string {
  const lock = opts.lockId ? LOCK_ICON : '  ';
  const edge = opts.annotated ? blue(ANNOTATED_EDGE) : ' ';
  const sign = row.kind === 'add' ? green('+') : row.kind === 'del' ? red('-') : ' ';
  const number = row.newLine ?? row.oldLine;
  const num = padStart(number === null ? '' : String(number), opts.numberWidth);
  return `${lock}${edge} ${sign} ${dim(num)}  `;
}

/**
 * Render a row's text.
 *
 * Rows carrying a word diff are rendered by the word diff and *not* markdown
 * highlighted: on a line that changed by two words, knowing which two words
 * changed beats knowing that one of them was in backticks, and layering both
 * sets of escapes produces mud.
 */
export function renderRowText(row: DiffRow, state = initialMarkdownState()): string {
  if (row.kind === 'del') {
    return row.segments ? renderSegments(row.segments, 'del') : red(strikethrough(row.text));
  }
  if (row.segments) return renderSegments(row.segments, 'add');
  return highlightLine(row.text, state);
}

function renderSegments(segments: Segment[], kind: 'add' | 'del'): string {
  return segments
    .map((seg) => {
      if (!seg.changed) return kind === 'del' ? dim(seg.text) : seg.text;
      return kind === 'del' ? bgRed(strikethrough(seg.text)) : bgGreen(seg.text);
    })
    .join('');
}

export interface RenderedLine {
  text: string;
  /** The new-version line this row occupies, or null (deletions, gaps). */
  newLine: number | null;
  gapIndex: number | null;
}

/**
 * Rich rendering of collapsed diff blocks. Returns structured lines so the TUI
 * can reuse the exact same output and only add selection on top of it.
 */
export function renderRichLines(blocks: Block[], opts: DiffRenderOptions): RenderedLine[] {
  const allRows = blocks.flatMap((b) => b.rows);
  const numberWidth = lineNumberWidth(allRows);
  const state = initialMarkdownState();
  const out: RenderedLine[] = [];

  blocks.forEach((block, index) => {
    if (block.kind === 'gap') {
      // Deleted lines never existed in the new document, so they must not
      // advance the fence tracker; hidden context lines must.
      for (const row of block.rows) if (row.kind !== 'del') highlightLine(row.text, state);
      const pad = ' '.repeat(numberWidth + 6);
      out.push({
        text: `${pad}${dim(`${GAP_MARKER} ${block.count} unchanged lines (space to expand)`)}`,
        newLine: null,
        gapIndex: index,
      });
      return;
    }

    for (const row of block.rows) {
      const lockId = row.newLine === null ? undefined : opts.lockedLines?.get(row.newLine);
      const marks = row.newLine === null ? undefined : opts.annotated?.get(row.newLine);
      const gutter = renderGutter(row, { numberWidth, lockId, annotated: Boolean(marks?.length) });
      let text = renderRowText(row, state);
      if (lockId) text += dim(`   [${lockId}]`);
      out.push({ text: `${gutter}${text}`, newLine: row.newLine, gapIndex: null });
    }
  });

  return out;
}

/* ----------------------------------------------------------------- plain */

/**
 * A real unified diff — hunk headers and all.
 *
 * `planx diff` pipes this into an agent's context, and an agent already knows
 * how to read `@@ -42,6 +42,8 @@`. Inventing a prettier plain format would mean
 * teaching it something it already knows, worse.
 */
export function renderUnified(rows: DiffRow[], opts: DiffRenderOptions): string[] {
  const stat = statOf(rows);
  const out: string[] = [];
  if (opts.oldLabel) out.push(dim(`--- ${opts.oldLabel}`));
  if (opts.newLabel) out.push(dim(`+++ ${opts.newLabel}`));
  if (stat.added === 0 && stat.removed === 0) return out;

  const blocks = collapse(rows, opts.context ?? DEFAULT_CONTEXT);
  for (const block of blocks) {
    if (block.kind === 'gap') continue;
    if (!block.rows.some((r) => r.kind !== 'context')) continue;

    const oldStart = block.rows.find((r) => r.oldLine !== null)?.oldLine ?? 0;
    const newStart = block.rows.find((r) => r.newLine !== null)?.newLine ?? 0;
    const oldCount = block.rows.filter((r) => r.oldLine !== null).length;
    const newCount = block.rows.filter((r) => r.newLine !== null).length;
    out.push(cyan(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`));

    for (const row of block.rows) {
      if (row.kind === 'add') out.push(green(`+${row.text}`));
      else if (row.kind === 'del') out.push(red(`-${row.text}`));
      else out.push(` ${row.text}`);
    }
  }
  return out;
}

/* ------------------------------------------------------------- documents */

/** `planx show` — the plan itself, not a diff. */
export function renderDocument(
  text: string,
  mode: RenderMode,
  lockedLines?: ReadonlyMap<number, string>,
): string[] {
  const lines = splitLines(text);
  if (mode === 'plain') return lines;

  const highlighted = highlightMarkdown(lines);
  if (!lockedLines?.size) return highlighted;

  const width = Math.max(2, String(lines.length).length);
  return highlighted.map((line, i) => {
    const lockId = lockedLines.get(i + 1);
    const marker = lockId ? LOCK_ICON : '  ';
    return `${marker} ${dim(padStart(String(i + 1), width))}  ${line}`;
  });
}

export function renderStatLine(rows: DiffRow[]): string {
  const stat = statOf(rows);
  return `${bold(String(stat.added + stat.removed))} changed  ${green(`+${stat.added}`)} ${red(`-${stat.removed}`)} ${gray(`${stat.unchanged} unchanged`)}`;
}
