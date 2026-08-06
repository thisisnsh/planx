import { collapse } from '../diff/collapse.js';
import { diffVersions, rowsForSingleVersion } from '../diff/lines.js';
import type { Block } from '../diff/types.js';
import {
  hiddenLine,
  renderRichLines,
  type HiddenLineMetrics,
  type RenderedLine,
  type RenderMode,
} from '../render/diff.js';
import { readVersionText } from '../store/plans.js';
import { normalizedLines } from '../store/text.js';
import type { Annotation } from '../store/types.js';

/**
 * One drawn line, which is either part of the document or part of a feedback
 * block hanging off the rail beside it.
 *
 * Feedback is rendered inline rather than in an overlay, so it has to be in the
 * same list the body is sliced from. Every row is exactly one terminal line,
 * which keeps scrolling a matter of slicing an array rather than measuring
 * heights.
 */
export type ViewRow = DocRow | FeedbackRow;

export interface DocRow extends RenderedLine {
  kind: 'doc';
  /** Index of the block this row came from, for expanding gaps. */
  blockIndex: number;
  /** A note covers this line, so the rail runs down between number and text. */
  rail: boolean;
  /**
   * The heading line whose folded section this row stands in for, or null on
   * every real line of the document. Space on it unfolds that section.
   */
  fold: number | null;
}

export interface FeedbackRow {
  kind: 'feedback';
  /** Which annotation this belongs to, so `space` and `f` know what to fold. */
  annotationId: string;
  /** Box edges are drawn whole; only `body` carries editable text. */
  part: 'top' | 'body' | 'bottom' | 'collapsed';
  text: string;
  /**
   * The column the caret sits in on this row, or null when it is not on this
   * row. A wrapped note has one row that carries it and the rest that do not.
   */
  caret: number | null;
  /** Columns the box occupies, so the closing edge lands in the same column. */
  boxWidth: number;
  /**
   * Drawn, but not a row the cursor rests on. The whole box is one stop, taken
   * on its first line of text — see `walk` in ./selection.ts.
   */
  skip: boolean;
  /** Feedback rows annotate lines but do not occupy one, so they never
   *  contribute to a selection span. */
  newLine: null;
  gapIndex: null;
  blockIndex: number;
}

export interface ReviewModel {
  planId: string;
  versionA: number | null;
  versionB: number;
  /** The version under review, split into lines — the annotation coordinate space. */
  docLines: string[];
  blocks: Block[];
  rows: ViewRow[];
  /** Columns a note box occupies, rail column included. */
  boxWidth: number;
  /** The column the rail runs down, and the one a note box opens in. */
  railColumn: number;
  /** Columns before the text column — the gutter and the rail together. */
  gutterWidth: number;
}

export interface BuildModelOptions {
  planId: string;
  versionA: number | null;
  versionB: number;
  mode: RenderMode;
  expandedGaps: ReadonlySet<number>;
  /** Headings, by line number, whose sections are folded away. */
  foldedSections?: ReadonlySet<number>;
  annotations: readonly Annotation[];
  /** Columns available for gutter and text together. */
  width: number;
  /** Collapse every note to its title row. */
  hiddenFeedback?: boolean;
  /** Notes collapsed one at a time, by id. */
  collapsedFeedback?: ReadonlySet<string>;
  /** Lines the reviewer has rewritten and not yet submitted, by line number. */
  edits?: ReadonlyMap<number, string>;
  /** The note being typed right now, so the box grows under the cursor. */
  draft?: { annotationId: string; text: string; caret: number } | null;
}

/**
 * Compose the diff, the locks and the pending annotations into rows to draw.
 *
 * Rebuilt from scratch on every change rather than patched incrementally. Plans
 * are kilobytes; the simplicity of having exactly one path from stored state to
 * pixels is worth more than the redraw it saves.
 */
export function buildModel(opts: BuildModelOptions): ReviewModel {
  const newText = readVersionText(opts.planId, opts.versionB);
  if (newText === null) {
    throw new Error(`planx: ${opts.planId} has no stored v${opts.versionB}.`);
  }
  const oldText = opts.versionA === null ? null : readVersionText(opts.planId, opts.versionA);

  const rawRows = oldText === null ? rowsForSingleVersion(newText) : diffVersions(oldText, newText);
  const blocks = collapse(rawRows);

  const docLines = normalizedLines(newText);

  const shown = blocks.map((block, index) =>
    block.kind === 'gap' && opts.expandedGaps.has(index)
      ? ({ kind: 'rows', rows: block.rows } as Block)
      : block,
  );

  const rendered = renderRichLines(shown, { mode: opts.mode, edits: opts.edits });

  // The rail runs between the line number and the text, so the box opens off it
  // in the same column and its text starts on the same left edge the plan's
  // does. Hanging it out in the left margin instead is what made a note and the
  // passage it is about share no edge at all. Still capped, because a note
  // stretched across a very wide terminal is harder to read.
  const boxWidth = boxWidthFor(opts.width - rendered.gutterWidth);
  const railed = railedLines(opts.annotations);

  // renderRichLines emits one line per row and one per collapsed gap, in block
  // order, so walking the blocks in parallel recovers which block each came from.
  const rows: ViewRow[] = [];
  const folds = foldsIn(docLines, opts.foldedSections);
  const metrics = { numberWidth: rendered.numberWidth, gutterWidth: rendered.gutterWidth };
  let blockIndex = 0;
  let withinBlock = 0;
  /** The section being folded away right now, gathering what it hides. */
  let fold: OpenFold | null = null;

  for (const line of rendered.lines) {
    while (blockIndex < shown.length && withinBlock >= visibleHeight(shown[blockIndex]!)) {
      blockIndex++;
      withinBlock = 0;
    }
    withinBlock++;

    // A fold ends at the first document line past it. Anything with no line of
    // its own — a deletion, a collapsed run — belongs to whatever is around it,
    // so it goes under with the section rather than ending it.
    if (fold && line.newLine !== null && line.newLine > fold.end) {
      rows.push(foldRow(fold, metrics));
      fold = null;
    }
    if (fold) {
      if (line.newLine !== null) {
        fold.lines++;
        fold.feedback += endingAt(opts.annotations, line.newLine).length;
      }
      continue;
    }

    const row: DocRow = {
      ...line,
      kind: 'doc',
      blockIndex: line.gapIndex ?? blockIndex,
      rail: line.newLine !== null && railed.has(line.newLine),
      fold: null,
    };
    rows.push(row);

    if (line.newLine === null) continue;

    // A note belongs directly under the last line it refers to, so it reads as
    // a margin comment on that passage rather than a footnote.
    for (const annotation of endingAt(opts.annotations, line.newLine)) {
      const editing = opts.draft?.annotationId === annotation.id;
      const text = editing ? opts.draft!.text : annotation.comment;
      const collapsed =
        Boolean(opts.hiddenFeedback) || Boolean(opts.collapsedFeedback?.has(annotation.id));
      rows.push(
        ...feedbackRows(annotation.id, text, {
          blockIndex,
          boxWidth,
          collapsed,
          editing,
          caret: editing ? opts.draft!.caret : 0,
        }),
      );
    }

    // The heading itself stays, and its own notes with it. What it covers goes.
    const end = folds.get(line.newLine);
    if (end !== undefined) {
      fold = { heading: row, line: line.newLine, blockIndex, end, lines: 0, feedback: 0 };
    }
  }
  if (fold) rows.push(foldRow(fold, metrics));

  return {
    planId: opts.planId,
    versionA: opts.versionA,
    versionB: opts.versionB,
    docLines,
    blocks,
    rows,
    boxWidth,
    railColumn: rendered.gutterWidth,
    gutterWidth: rendered.gutterWidth + RAIL_WIDTH,
  };
}

/* --------------------------------------------------------------- folding */

/**
 * Heading detection, beside the rows it folds.
 *
 * `sectionOf` in ../render/markdown.ts answers a different question — which
 * heading a line sits *under* — and answers it for one line at a time. This
 * needs every heading with its level, to work out where a section ends. Both
 * track fenced code the same way, so a `# comment` inside a fence is not a
 * heading in either.
 */
interface Heading {
  /** 1-based, in the version under review. */
  line: number;
  level: number;
}

const FENCE = /^\s*(`{3,}|~{3,})/;
const HEADING = /^(#{1,6})\s+\S/;

function headingsIn(lines: readonly string[]): Heading[] {
  const out: Heading[] = [];
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i]!;
    if (FENCE.test(text)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const match = HEADING.exec(text);
    if (match) out.push({ line: i + 1, level: match[1]!.length });
  }
  return out;
}

/**
 * The last line a fold rooted at `line` would hide, or null when there is
 * nothing to fold there.
 *
 * A section runs to the next heading of the same or a higher level, so folding
 * a `##` takes its `###` and `####` subsections with it. `#####` and `######`
 * do not fold at all: at that depth a section is a paragraph, and a fold that
 * hides three lines is a keystroke that costs more than it saves.
 */
const MAX_FOLD_LEVEL = 4;

export function foldEnd(lines: readonly string[], line: number): number | null {
  const all = headingsIn(lines);
  const index = all.findIndex((h) => h.line === line);
  const heading = all[index];
  if (!heading || heading.level > MAX_FOLD_LEVEL) return null;

  const next = all.slice(index + 1).find((h) => h.level <= heading.level);
  const end = next ? next.line - 1 : lines.length;
  // A heading with nothing under it folds to itself, which is a keypress that
  // appears to do nothing. Better that it is never offered.
  return end > heading.line ? end : null;
}

/** heading line → last line hidden, for the sections currently folded. */
function foldsIn(lines: readonly string[], folded?: ReadonlySet<number>): Map<number, number> {
  const out = new Map<number, number>();
  if (!folded?.size) return out;
  for (const line of folded) {
    const end = foldEnd(lines, line);
    if (end !== null) out.set(line, end);
  }
  return out;
}

interface OpenFold {
  heading: DocRow;
  /** The heading's own line, which is what unfolding is keyed on. */
  line: number;
  blockIndex: number;
  end: number;
  lines: number;
  feedback: number;
}

/**
 * A row of its own for what the fold hid, under the heading.
 *
 * The same dim stand-in a collapsed run of unchanged lines gets, because it is
 * the same promise: there is more here, space brings it back. Hung off the end
 * of the heading instead — where it used to be — it read as part of the title,
 * so the one row you could press space on was the row that looked least like a
 * control, and a long heading pushed the count off the right edge.
 *
 * A folded section that says nothing about itself is indistinguishable from a
 * plan that is simply short, and feedback folded out of sight is feedback you
 * will not answer — so the count comes with it, and the rail stays on the
 * heading, which is what makes a folded section carrying comments identifiable
 * at a glance.
 */
function foldRow(fold: OpenFold, metrics: HiddenLineMetrics): DocRow {
  const lines = `${fold.lines} line${fold.lines === 1 ? '' : 's'}`;
  const feedback = fold.feedback ? ` · ${fold.feedback} feedback` : '';
  if (fold.feedback) fold.heading.rail = true;
  return {
    ...hiddenLine(`${lines}${feedback} (space to expand)`, metrics),
    kind: 'doc',
    blockIndex: fold.blockIndex,
    rail: false,
    fold: fold.line,
  };
}

/** Every line a note covers, which is every line the rail runs down. */
function railedLines(annotations: readonly Annotation[]): Set<number> {
  const lines = new Set<number>();
  for (const annotation of annotations) {
    for (let i = annotation.anchor.start_line; i <= annotation.anchor.end_line; i++) lines.add(i);
  }
  return lines;
}

export function boxWidthFor(width: number): number {
  return Math.max(24, Math.min(MAX_BOX_WIDTH, width));
}

function visibleHeight(block: Block): number {
  return block.kind === 'gap' ? 1 : block.rows.length;
}

/** Comment annotations whose last line is `line`. */
function endingAt(annotations: readonly Annotation[], line: number): Annotation[] {
  return annotations.filter((a) => a.anchor.end_line === line);
}

const MAX_BOX_WIDTH = 72;
/** `│ ` and ` │` — what the frame costs the text inside it. */
export const BOX_PADDING = 4;
/** The rail's own column, and the space between it and the text. */
export const RAIL_WIDTH = 2;

export interface BoxOptions {
  blockIndex: number;
  boxWidth: number;
  collapsed: boolean;
  /** The note being typed: reserve the caret a column, and draw one in it. */
  editing?: boolean;
  /** Where the caret sits, as an offset into the note's text. */
  caret?: number;
}

/**
 * A note as a closed box hanging off the rail that marks the lines it covers.
 *
 * The top edge opens with `├` rather than `╭` because that is the glyph that
 * joins the two: a corner under a rail reads as two objects that happen to be
 * adjacent, a tee reads as the rail continuing and a box opening off it. Body
 * rows and the closing `╰` then sit in the rail column for free.
 */
export function feedbackRows(id: string, comment: string, opts: BoxOptions): FeedbackRow[] {
  const { boxWidth, blockIndex } = opts;
  const base = {
    kind: 'feedback' as const,
    annotationId: id,
    newLine: null,
    gapIndex: null,
    blockIndex,
    boxWidth,
    caret: null,
  };
  const rule = '─'.repeat(Math.max(0, boxWidth - 2));

  if (opts.collapsed) {
    // The rail carrying the note's own title: folding reads as the box
    // flattening into the line it was already attached to, so there is no
    // closing corner to suggest anything was hidden sideways.
    const title = ` ▸ ${firstLine(comment)} `;
    const fill = Math.max(0, boxWidth - 2 - title.length);
    return [{ ...base, part: 'collapsed', text: `├─${title}${'─'.repeat(fill)}`, skip: false }];
  }

  // The caret needs a column of its own on the last line. Wrapping a column
  // early gives it one; truncating the line to make room is what used to hold
  // an over-long word on one line until the next space was typed.
  const width = boxWidth - BOX_PADDING - (opts.editing ? 1 : 0);
  const wrapped = comment.length ? wrapLines(comment, width) : [{ text: '', start: 0 }];
  const at = opts.editing ? caretAt(wrapped, opts.caret ?? 0) : null;
  // The first line of the note is the row the cursor stops on; the edges and
  // the lines the text wrapped onto are passed over. They say nothing a cursor
  // resting on them would add, and every one of them was a press.
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

/**
 * Which wrapped row the caret falls on, and which column of it.
 *
 * The last row whose text starts at or before the offset. On a wrap boundary
 * that is the row the character *after* the caret is on, which is where a caret
 * belongs and what keeps it inside the box rather than one column past its edge.
 */
function caretAt(
  wrapped: readonly WrappedLine[],
  caret: number,
): { row: number; column: number } | null {
  for (let i = wrapped.length - 1; i >= 0; i--) {
    const line = wrapped[i]!;
    if (line.start > caret) continue;
    return { row: i, column: Math.min(caret - line.start, line.text.length) };
  }
  return { row: 0, column: 0 };
}

/** The note reduced to a title: enough to recognise it, never enough to wrap. */
function firstLine(comment: string): string {
  const text = comment.split('\n')[0]?.trim() ?? '';
  if (!text) return 'empty note';
  return text.length > 40 ? `${text.slice(0, 39)}…` : text;
}

/**
 * Wrap a note to the box, one character behind whoever is typing it.
 *
 * Every space you typed is a space you get back. The obvious word wrap splits
 * on `/\s+/`, which throws the runs away: `"hello "` and `"hello"` render
 * identically so pressing space appears to do nothing, two spaces between
 * sentences become one, and a pasted snippet loses the indent that was the
 * reason for pasting it. A note is usually prose, but it is sometimes a
 * snippet, and prose survives having its own spacing respected.
 *
 * So the text is tokenised into words and runs of whitespace, both preserved,
 * and the wrap works on tokens:
 *
 * - A word that would fit on a line of its own waits for the next line rather
 *   than being cut.
 * - A word wider than the box is broken at the edge. Wrapping only between
 *   words leaves a 90-character token on one line, where the renderer cuts it
 *   with an ellipsis until the next space arrives and it jumps down — which is
 *   the "delay" it looks like.
 */
export function wrapComment(comment: string, width: number): string[] {
  return wrapLines(comment, width).map((line) => line.text);
}

/** One wrapped row, and where its text begins in the note it came from. */
export interface WrappedLine {
  text: string;
  /** 0-based offset into the source, which is what maps a caret onto a row. */
  start: number;
}

/**
 * The same wrap, with each row's offset in the source carried along.
 *
 * Every character of the source lands in exactly one row — words and whitespace
 * runs are both preserved, and a newline is the one character consumed rather
 * than emitted — so the offsets are just a running count of what has been laid
 * out, and a caret offset maps onto a row and a column without re-deriving the
 * wrap.
 */
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
        // The line is full; or the word fits on one of its own; or it is wider
        // than the box and there is already something here, so it takes a fresh
        // line rather than being cut in the middle of this one.
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

/** The first row showing a given new-version line, for jumping to an annotation. */
export function rowForLine(rows: readonly ViewRow[], line: number): number {
  const index = rows.findIndex((row) => row.newLine === line);
  return index === -1 ? 0 : index;
}
