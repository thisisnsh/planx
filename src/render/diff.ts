import { collapse, DEFAULT_CONTEXT } from '../diff/collapse.js';
import { splitLines, statOf } from '../diff/lines.js';
import type { Block, DiffRow, Segment } from '../diff/types.js';
import {
  bgGreen,
  bgRed,
  bold,
  cyan,
  dim,
  green,
  gray,
  padStart,
  red,
  signal,
  strikethrough,
} from './ansi.js';
import { highlightLine, highlightMarkdown, initialMarkdownState } from './markdown.js';

export type RenderMode = 'rich' | 'plain';

export interface DiffRenderOptions {
  mode: RenderMode;
  /** new-version line number → lock id, drawn in the gutter. */
  lockedLines?: ReadonlyMap<number, string>;
  context?: number;
  oldLabel?: string;
  newLabel?: string;
}

/**
 * A glyph, not the padlock emoji.
 *
 * Emoji are two cells wide in some terminals and one in others, which is fatal
 * for a fixed-width gutter: the text column moves depending on whether a line
 * happens to be locked. This is one cell everywhere.
 */
const LOCK_ICON = '⚿';
const GAP_MARKER = '⋯';

/* ------------------------------------------------------------------ rich */

export function lineNumberWidth(rows: DiffRow[]): number {
  const max = rows.reduce((m, r) => Math.max(m, r.newLine ?? 0, r.oldLine ?? 0), 0);
  return Math.max(2, String(max).length);
}

export interface GutterOptions {
  numberWidth: number;
  lockId?: string | undefined;
  /** Reserve the +/- column. Off when there is no diff to sign. */
  signs?: boolean;
  /** Light the number up, for the row under the cursor. */
  active?: boolean;
}

/** Columns a gutter built with these options occupies. */
export function gutterWidth(opts: { numberWidth: number; signs?: boolean }): number {
  return 2 + (opts.signs === false ? 0 : 1) + opts.numberWidth + 1;
}

/**
 * The fixed-width prefix: lock marker, change sign, number.
 *
 * Fixed width is what keeps the text column aligned, so a multi-line selection
 * reads as a block rather than a ragged stack. Every column here has to earn its
 * place — each one pushes the plan itself further right — so the sign column is
 * dropped entirely when nothing on screen is an addition or a deletion.
 *
 * The cursor arrow is deliberately *not* here: it moves on every keypress, and
 * baking it into this string would mean re-rendering the whole document to move
 * an arrow one row.
 */
export function renderGutter(row: DiffRow, opts: GutterOptions): string {
  const lock = opts.lockId ? signal(LOCK_ICON) : ' ';
  const sign =
    opts.signs === false
      ? ''
      : row.kind === 'add'
        ? green('+')
        : row.kind === 'del'
          ? red('-')
          : ' ';
  const number = row.newLine ?? row.oldLine;
  const num = padStart(number === null ? '' : String(number), opts.numberWidth);
  // The number carries the change as well as the sign does. A `+` is one glyph
  // wide in a column nobody reads; the number beside the text is already in
  // view. Under the cursor it goes yellow instead — finding where you are beats
  // knowing what changed on the one line you are looking at.
  const paint = opts.active ? signal : row.kind === 'add' ? green : row.kind === 'del' ? red : dim;
  // One space after the marker, so `⚿10` does not read as one token, and one
  // after the number. The second space the number used to get belongs to the
  // annotation rail, which sits between this and the text.
  return `${lock} ${sign}${paint(num)} `;
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
  /** The fixed-width prefix, styled. Shorter on a gap, which has no number. */
  gutter: string;
  /** The same prefix with the number lit, for the row under the cursor. */
  gutterActive: string;
  /** The row's own text, with no gutter on it. */
  text: string;
  /** The new-version line this row occupies, or null (deletions, gaps). */
  newLine: number | null;
  gapIndex: number | null;
  /** Whether a lock covers this line — the TUI refuses to comment on it. */
  locked: boolean;
}

export interface RichLines {
  lines: RenderedLine[];
  /** Columns every gutter takes, so callers can indent under the text column. */
  gutterWidth: number;
}

/**
 * Rich rendering of collapsed diff blocks. Returns structured lines so the TUI
 * can reuse the exact same output and only add selection on top of it.
 *
 * Gutter and text stay separate: the TUI restyles the gutter of the row under
 * the cursor and pads the text to the frame, and neither is possible once the
 * two have been concatenated into one escape-laden string.
 */
export function renderRichLines(blocks: Block[], opts: DiffRenderOptions): RichLines {
  const allRows = blocks.flatMap((b) => b.rows);
  const numberWidth = lineNumberWidth(allRows);
  // Nothing added or removed means nothing to sign, so the column comes back.
  const signs = allRows.some((r) => r.kind !== 'context');
  const width = gutterWidth({ numberWidth, signs });
  const state = initialMarkdownState();
  const lines: RenderedLine[] = [];

  blocks.forEach((block, index) => {
    if (block.kind === 'gap') {
      // Deleted lines never existed in the new document, so they must not
      // advance the fence tracker; hidden context lines must.
      for (const row of block.rows) if (row.kind !== 'del') highlightLine(row.text, state);
      // Padded to the line-number column, not the text column, so the `⋯` lands
      // where a line number would and the eye finds it on the same edge it is
      // already scanning down. Out at the text column it sat further right than
      // anything around it.
      const pad = ' '.repeat(width - numberWidth - 1);
      lines.push({
        gutter: pad,
        gutterActive: pad,
        text: dim(`${GAP_MARKER} ${block.count} unchanged lines (space to expand)`),
        newLine: null,
        gapIndex: index,
        locked: false,
      });
      return;
    }

    for (const row of block.rows) {
      const lockId = row.newLine === null ? undefined : opts.lockedLines?.get(row.newLine);
      // The lock id is not repeated after the text: the marker in the gutter
      // already says the line is frozen, and `planx locks` says by which lock.
      lines.push({
        gutter: renderGutter(row, { numberWidth, lockId, signs }),
        gutterActive: renderGutter(row, { numberWidth, lockId, signs, active: true }),
        text: renderRowText(row, state),
        newLine: row.newLine,
        gapIndex: null,
        locked: Boolean(lockId),
      });
    }
  });

  return { lines, gutterWidth: width };
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
    const marker = lockId ? signal(LOCK_ICON) : ' ';
    return `${marker} ${dim(padStart(String(i + 1), width))}  ${line}`;
  });
}

export function renderStatLine(rows: DiffRow[]): string {
  const stat = statOf(rows);
  return `${bold(String(stat.added + stat.removed))} changed  ${green(`+${stat.added}`)} ${red(`-${stat.removed}`)} ${gray(`${stat.unchanged} unchanged`)}`;
}
