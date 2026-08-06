/**
 * The rows the review draws — src/tui/model.ts and src/render/diff.ts, ported.
 *
 * One drawn line is one row, which is what makes scrolling a matter of slicing
 * an array. Feedback is part of that array rather than an overlay: a note is a
 * box hanging off the rail that runs between the line number and the text, so
 * its words start on the same left edge as the words they are about.
 */

import {
  collapse,
  diffVersions,
  editSegments,
  rowsForSingleVersion,
  splitLines,
  type Block,
  type DiffRow,
  type Segment,
} from './diff.js';
import { highlightLine, initialMarkdownState, type MarkdownState } from './markdown.js';
import { p, spaces, type Line } from './text.js';

export interface Annotation {
  id: string;
  /** 1-based, inclusive, in the version under review. */
  start: number;
  end: number;
  comment: string;
}

export interface DocRow {
  kind: 'doc';
  gutter: Line;
  gutterActive: Line;
  text: Line;
  /** The same text unstyled, for the inverse a selection paints. */
  raw: string;
  newLine: number | null;
  gapIndex: number | null;
  /** A note covers this line, so the rail runs down beside it. */
  rail: boolean;
  /** The heading whose folded section this row stands in for. */
  fold: number | null;
  skip: false;
}

export interface FeedbackRow {
  kind: 'feedback';
  annotationId: string;
  part: 'top' | 'body' | 'bottom' | 'collapsed';
  text: string;
  /** The column the caret sits in on this row, or null when it is not here. */
  caret: number | null;
  boxWidth: number;
  /** Drawn, but not a row the cursor rests on — a box is one stop. */
  skip: boolean;
  newLine: null;
  gapIndex: null;
}

export type ViewRow = DocRow | FeedbackRow;

const GAP_MARKER = '⋯';
const MAX_BOX_WIDTH = 72;
/** `│ ` and ` │` — what the box costs the text inside it. */
export const BOX_PADDING = 4;
/** The rail's own column, and the space between it and the text. */
export const RAIL_WIDTH = 2;

export interface BuildOptions {
  /** The previous version's text when the diff is on, null when it is not. */
  oldText: string | null;
  newText: string;
  annotations: readonly Annotation[];
  /** Columns available for gutter, rail and text together. */
  width: number;
  expandedGaps: ReadonlySet<number>;
  foldedSections: ReadonlySet<number>;
  hiddenFeedback: boolean;
  collapsedFeedback: ReadonlySet<string>;
  edits: ReadonlyMap<number, string>;
  /** The note being typed, so its box grows under the cursor. */
  draft: { annotationId: string; text: string; caret: number } | null;
}

export interface ReviewModel {
  rows: ViewRow[];
  docLines: string[];
  blocks: Block[];
  boxWidth: number;
  /** The column the rail runs down, and the one a note box opens in. */
  railColumn: number;
  /** Columns before the text column — the gutter and the rail together. */
  gutterWidth: number;
}

export function buildModel(opts: BuildOptions): ReviewModel {
  const rawRows =
    opts.oldText === null
      ? rowsForSingleVersion(opts.newText)
      : diffVersions(opts.oldText, opts.newText);
  const blocks = collapse(rawRows);
  const docLines = splitLines(opts.newText);

  const shown: Block[] = blocks.map((block, index) =>
    block.kind === 'gap' && opts.expandedGaps.has(index)
      ? { kind: 'rows', rows: block.rows }
      : block,
  );

  const numberWidth = Math.max(
    2,
    String(rawRows.reduce((m, r) => Math.max(m, r.newLine ?? 0, r.oldLine ?? 0), 0)).length,
  );
  const signs = rawRows.some((r) => r.kind !== 'context') || opts.edits.size > 0;
  const gutter = 2 + (signs ? 1 : 0) + numberWidth + 1;
  const boxWidth = Math.max(24, Math.min(MAX_BOX_WIDTH, opts.width - gutter));
  const railed = railedLines(opts.annotations);

  const rows: ViewRow[] = [];
  const folds = foldsIn(docLines, opts.foldedSections);
  const state = initialMarkdownState();
  let fold: OpenFold | null = null;

  const flat: Array<{ row: DiffRow | null; gapIndex: number | null; count: number }> = [];
  shown.forEach((block, index) => {
    if (block.kind === 'gap') flat.push({ row: null, gapIndex: index, count: block.count });
    else for (const row of block.rows) flat.push({ row, gapIndex: null, count: 0 });
  });

  for (const entry of flat) {
    if (entry.row === null) {
      // Deleted lines never existed in the new document, so they must not
      // advance the fence tracker; hidden context lines must.
      const block = shown[entry.gapIndex!];
      if (block?.kind === 'gap')
        for (const row of block.rows) if (row.kind !== 'del') highlightLine(row.text, state);
      if (fold) continue;
      rows.push({
        ...hiddenRow(`${entry.count} unchanged lines (space to expand)`, numberWidth, gutter),
        gapIndex: entry.gapIndex,
      });
      continue;
    }

    const row = entry.row;
    // A fold ends at the first document line past it. Anything with no line of
    // its own goes under with the section rather than ending it.
    if (fold && row.newLine !== null && row.newLine > fold.end) {
      rows.push(foldRow(fold, numberWidth, gutter));
      fold = null;
    }
    if (fold) {
      if (row.newLine !== null) {
        fold.lines++;
        fold.feedback += endingAt(opts.annotations, row.newLine).length;
      }
      // The hidden lines still have to advance the fence tracker.
      if (row.kind !== 'del') highlightLine(row.text, state);
      continue;
    }

    const rewritten = row.newLine === null ? undefined : opts.edits.get(row.newLine);
    const doc: DocRow = {
      kind: 'doc',
      gutter: renderGutter(row, {
        numberWidth,
        signs,
        edited: rewritten !== undefined,
        active: false,
      }),
      gutterActive: renderGutter(row, {
        numberWidth,
        signs,
        edited: rewritten !== undefined,
        active: true,
      }),
      text: rewritten === undefined ? rowText(row, state) : editedText(row, rewritten, state),
      raw: rewritten ?? row.text,
      newLine: row.newLine,
      gapIndex: null,
      rail: row.newLine !== null && railed.has(row.newLine),
      fold: null,
      skip: false,
    };
    rows.push(doc);

    if (row.newLine === null) continue;

    // A note belongs directly under the last line it refers to, so it reads as
    // a margin comment on that passage rather than a footnote.
    for (const annotation of endingAt(opts.annotations, row.newLine)) {
      const editing = opts.draft?.annotationId === annotation.id;
      const text = editing ? opts.draft!.text : annotation.comment;
      const collapsed = opts.hiddenFeedback || opts.collapsedFeedback.has(annotation.id);
      rows.push(
        ...feedbackRows(annotation.id, text, {
          boxWidth,
          collapsed,
          editing,
          caret: editing ? opts.draft!.caret : 0,
        }),
      );
    }

    // The heading itself stays, and its own notes with it. What it covers goes.
    const end = folds.get(row.newLine);
    if (end !== undefined) fold = { heading: doc, line: row.newLine, end, lines: 0, feedback: 0 };
  }
  if (fold) rows.push(foldRow(fold, numberWidth, gutter));

  return {
    rows,
    docLines,
    blocks,
    boxWidth,
    railColumn: gutter,
    gutterWidth: gutter + RAIL_WIDTH,
  };
}

/* ---------------------------------------------------------------- gutter */

interface GutterOptions {
  numberWidth: number;
  signs: boolean;
  edited: boolean;
  active: boolean;
}

/**
 * The fixed-width prefix: change sign, number.
 *
 * Fixed width is what keeps the text column aligned, so a multi-line selection
 * reads as a block rather than a ragged stack. The cursor arrow is deliberately
 * not here — it moves on every keypress.
 */
function renderGutter(row: DiffRow, opts: GutterOptions): Line {
  const sign = !opts.signs
    ? null
    : opts.edited
      ? p('~', 'warn')
      : row.kind === 'add'
        ? p('+', 'green')
        : row.kind === 'del'
          ? p('-', 'red')
          : p(' ');
  const number = row.newLine ?? row.oldLine;
  const text = (number === null ? '' : String(number)).padStart(opts.numberWidth, ' ');
  // Under the cursor the number goes yellow: finding where you are beats
  // knowing what changed on the one line you are looking at.
  const paint = opts.active
    ? 'sig'
    : row.kind === 'add'
      ? 'green'
      : row.kind === 'del'
        ? 'red'
        : 'dim';
  return [...(sign ? [sign] : []), p(text, paint), p(' ')];
}

function rowText(row: DiffRow, state: MarkdownState): Line {
  if (row.kind === 'del') {
    return row.segments ? segmentLine(row.segments, 'del') : [p(row.text, 'delline')];
  }
  if (row.segments) return segmentLine(row.segments, 'add');
  return highlightLine(row.text, state);
}

/**
 * A line the reviewer rewrote, drawn as the words they changed against the ones
 * they kept. The markdown state is still advanced over the stored text, because
 * that is what the rest of the document is highlighted against.
 */
function editedText(row: DiffRow, after: string, state: MarkdownState): Line {
  rowText(row, state);
  const segments = editSegments(row.text, after);
  return segments ? segmentLine(segments, 'add') : [p(after)];
}

function segmentLine(segments: readonly Segment[], kind: 'add' | 'del'): Line {
  return segments.map((seg) =>
    seg.changed
      ? p(seg.text, kind === 'del' ? 'bgdel' : 'bgadd')
      : p(seg.text, kind === 'del' ? 'dim' : undefined),
  );
}

/**
 * The dim row that stands in for lines which are not on screen.
 *
 * Padded to the line-number column, so the `⋯` lands where a line number would
 * and the eye finds it on the edge it is already scanning down.
 */
function hiddenRow(text: string, numberWidth: number, gutterWidth: number): DocRow {
  return {
    kind: 'doc',
    gutter: [spaces(gutterWidth - numberWidth - 1)],
    gutterActive: [spaces(gutterWidth - numberWidth - 1)],
    text: [p(`${GAP_MARKER} ${text}`, 'dim')],
    raw: `${GAP_MARKER} ${text}`,
    newLine: null,
    gapIndex: null,
    rail: false,
    fold: null,
    skip: false,
  };
}

/* --------------------------------------------------------------- folding */

interface Heading {
  line: number;
  level: number;
}

const FENCE = /^\s*(`{3,}|~{3,})/;
const HEADING = /^(#{1,6})\s+\S/;
/** `#####` and deeper do not fold: a section that size is a paragraph. */
const MAX_FOLD_LEVEL = 4;

function headingsIn(lines: readonly string[]): Heading[] {
  const out: Heading[] = [];
  let inFence = false;
  lines.forEach((text, i) => {
    if (FENCE.test(text)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;
    const match = HEADING.exec(text);
    if (match) out.push({ line: i + 1, level: match[1]!.length });
  });
  return out;
}

/** The last line a fold rooted at `line` hides, or null when there is nothing. */
export function foldEnd(lines: readonly string[], line: number): number | null {
  const all = headingsIn(lines);
  const index = all.findIndex((h) => h.line === line);
  const heading = all[index];
  if (!heading || heading.level > MAX_FOLD_LEVEL) return null;
  const next = all.slice(index + 1).find((h) => h.level <= heading.level);
  const end = next ? next.line - 1 : lines.length;
  return end > heading.line ? end : null;
}

/**
 * The heading a line sits under — the nearest one at or above it that has
 * something to hide, skipping the ones `foldEnd` declines.
 */
export function enclosingHeading(lines: readonly string[], line: number): number | null {
  const all = headingsIn(lines);
  for (let i = all.length - 1; i >= 0; i--) {
    const heading = all[i]!;
    if (heading.line > line) continue;
    if (foldEnd(lines, heading.line) !== null) return heading.line;
  }
  return null;
}

function foldsIn(lines: readonly string[], folded: ReadonlySet<number>): Map<number, number> {
  const out = new Map<number, number>();
  for (const line of folded) {
    const end = foldEnd(lines, line);
    if (end !== null) out.set(line, end);
  }
  return out;
}

interface OpenFold {
  heading: DocRow;
  line: number;
  end: number;
  lines: number;
  feedback: number;
}

/**
 * A row of its own for what the fold hid, under the heading — the same dim
 * stand-in a collapsed run gets, because it is the same promise. The count of
 * feedback comes with it: feedback folded out of sight is feedback you will not
 * answer, and the rail stays on the heading to say it is there.
 */
function foldRow(fold: OpenFold, numberWidth: number, gutterWidth: number): DocRow {
  const lines = `${fold.lines} line${fold.lines === 1 ? '' : 's'}`;
  const feedback = fold.feedback ? ` · ${fold.feedback} feedback` : '';
  if (fold.feedback) fold.heading.rail = true;
  return {
    ...hiddenRow(`${lines}${feedback} (space to expand)`, numberWidth, gutterWidth),
    fold: fold.line,
  };
}

/* ------------------------------------------------------------------ notes */

function railedLines(annotations: readonly Annotation[]): Set<number> {
  const lines = new Set<number>();
  for (const annotation of annotations) {
    for (let i = annotation.start; i <= annotation.end; i++) lines.add(i);
  }
  return lines;
}

function endingAt(annotations: readonly Annotation[], line: number): Annotation[] {
  return annotations.filter((a) => a.end === line);
}

interface BoxOptions {
  boxWidth: number;
  collapsed: boolean;
  /** The note being typed: draw a caret in it. */
  editing: boolean;
  /** Where the caret sits, as an offset into the note's text. */
  caret?: number;
}

/**
 * A note as a closed box hanging off the rail that marks the lines it covers.
 *
 * The top edge opens with `├` rather than `╭`: a corner under a rail reads as
 * two objects that happen to be adjacent, a tee reads as the rail continuing
 * and a box opening off it.
 */
export function feedbackRows(id: string, comment: string, opts: BoxOptions): FeedbackRow[] {
  const { boxWidth } = opts;
  const base = {
    kind: 'feedback' as const,
    annotationId: id,
    newLine: null,
    gapIndex: null,
    boxWidth,
    caret: null,
  };
  const rule = '─'.repeat(Math.max(0, boxWidth - 2));

  if (opts.collapsed) {
    const title = ` ▸ ${firstLine(comment)} `;
    const fill = Math.max(0, boxWidth - 2 - title.length);
    return [{ ...base, part: 'collapsed', text: `├─${title}${'─'.repeat(fill)}`, skip: false }];
  }

  // The full width, whether or not it is being typed into. The column that used
  // to be reserved here was for a caret that sat past the last character — so
  // the text wrapped early while you typed and re-wrapped a column wider the
  // moment you pressed enter, visibly shifting into a better alignment. The
  // caret lives inside the text now, and needs no column of its own.
  const width = boxWidth - BOX_PADDING;
  const wrapped = comment.length ? wrapLines(comment, width) : [{ text: '', start: 0 }];
  const at = opts.editing ? caretAt(wrapped, opts.caret ?? 0) : null;
  // The first line of the note is the row the cursor stops on; the edges and
  // the wrapped rows are passed over — every one of them was a press.
  return [
    { ...base, part: 'top', text: `├${rule}╮`, skip: true },
    ...wrapped.map((line, i) => ({
      ...base,
      part: 'body' as const,
      text: line.text,
      caret: at !== null && at.row === i ? at.column : null,
      skip: i > 0,
    })),
    { ...base, part: 'bottom', text: `╰${rule}╯`, skip: true },
  ];
}

/** Which wrapped row the caret falls on, and which column of it. */
function caretAt(wrapped: readonly WrappedLine[], caret: number): { row: number; column: number } {
  for (let i = wrapped.length - 1; i >= 0; i--) {
    const line = wrapped[i]!;
    if (line.start > caret) continue;
    return { row: i, column: Math.min(caret - line.start, line.text.length) };
  }
  return { row: 0, column: 0 };
}

function firstLine(comment: string): string {
  const text = comment.split('\n')[0]?.trim() ?? '';
  if (!text) return 'empty note';
  return text.length > 40 ? `${text.slice(0, 39)}…` : text;
}

/**
 * Wrap a note to the box, one character behind whoever is typing it.
 *
 * Every space you typed is a space you get back: the text is tokenised into
 * words and runs of whitespace, both preserved, so pressing space never appears
 * to do nothing and a pasted snippet keeps its indent.
 */
export function wrapComment(comment: string, width: number): string[] {
  return wrapLines(comment, width).map((line) => line.text);
}

/** One wrapped row, and where its text begins in the note it came from. */
export interface WrappedLine {
  text: string;
  start: number;
}

/** The same wrap, with each row's offset in the source carried along. */
export function wrapLines(comment: string, width: number): WrappedLine[] {
  const limit = Math.max(8, width);
  const out: WrappedLine[] = [];
  let consumed = 0;

  for (const paragraph of comment.split('\n')) {
    let current = '';
    let start = consumed;
    const push = () => {
      out.push({ text: current, start });
      consumed += current.length;
      start = consumed;
      current = '';
    };
    for (const token of paragraph.match(/\s+|\S+/g) ?? []) {
      let rest = token;
      while (current.length + rest.length > limit) {
        const room = limit - current.length;
        if (room <= 0 || (/\S/.test(rest) && (rest.length <= limit || current.trim()))) {
          push();
          continue;
        }
        current += rest.slice(0, room);
        rest = rest.slice(room);
        push();
      }
      current += rest;
    }
    push();
    // The newline that ended this paragraph is consumed, not drawn.
    consumed += 1;
  }
  return out.length ? out : [{ text: '', start: 0 }];
}
