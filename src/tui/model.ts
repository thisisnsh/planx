import { collapse } from '../diff/collapse.js';
import { diffVersions, rowsForSingleVersion } from '../diff/lines.js';
import type { Block } from '../diff/types.js';
import { normalizedLines } from '../locks/anchor.js';
import { lockedLineMap } from '../locks/manage.js';
import { renderRichLines, type RenderedLine, type RenderMode } from '../render/diff.js';
import { readLocks, readVersionText } from '../store/plans.js';
import type { Annotation, LocksFile } from '../store/types.js';

/**
 * One drawn line, which is either part of the document or part of a feedback
 * block hanging off the rail beside it.
 *
 * Feedback is rendered inline rather than in an overlay, so it has to be in the
 * same list the body is sliced from. Every row is exactly one terminal line,
 * which keeps scrolling a matter of slicing an array rather than measuring
 * heights. The cursor does not walk these rows — see `move` in ./selection.ts.
 */
export type ViewRow = DocRow | FeedbackRow;

export interface DocRow extends RenderedLine {
  kind: 'doc';
  /** Index of the block this row came from, for expanding gaps. */
  blockIndex: number;
  /** A note covers this line, so the rail runs down beside its number. */
  rail: boolean;
}

export interface FeedbackRow {
  kind: 'feedback';
  /** Which annotation this belongs to, so `space` and `f` know what to fold. */
  annotationId: string;
  /** Box edges are drawn whole; only `body` carries editable text. */
  part: 'top' | 'body' | 'bottom' | 'collapsed';
  text: string;
  /** The caret sits after the last body line while the note is being typed. */
  last: boolean;
  /** Columns the box occupies, so the closing edge lands in the same column. */
  boxWidth: number;
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
  locks: LocksFile;
  /** new-version line → the lock covering it, for the gutter and the l toggle. */
  lockedLines: ReadonlyMap<number, string>;
  blocks: Block[];
  rows: ViewRow[];
  /** Columns a note box occupies, rail column included. */
  boxWidth: number;
  /** Columns before the text column — the rail and the gutter together. */
  gutterWidth: number;
}

export interface BuildModelOptions {
  planId: string;
  versionA: number | null;
  versionB: number;
  mode: RenderMode;
  expandedGaps: ReadonlySet<number>;
  annotations: readonly Annotation[];
  /** Columns available for gutter and text together. */
  width: number;
  /** Collapse every note to its title row. */
  hiddenFeedback?: boolean;
  /** Notes collapsed one at a time, by id. */
  collapsedFeedback?: ReadonlySet<string>;
  /** The note being typed right now, so the box grows under the cursor. */
  draft?: { annotationId: string; text: string } | null;
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
  const locks = readLocks(opts.planId);

  const shown = blocks.map((block, index) =>
    block.kind === 'gap' && opts.expandedGaps.has(index)
      ? ({ kind: 'rows', rows: block.rows } as Block)
      : block,
  );

  const lockedLines = lockedLineMap(docLines, locks);
  const rendered = renderRichLines(shown, { mode: opts.mode, lockedLines });

  // The box hangs off the rail rather than under the text column: the indent is
  // what made a note float free of the passage it is about. Still capped,
  // because a note stretched across a very wide terminal is harder to read.
  const boxWidth = boxWidthFor(opts.width);
  const railed = railedLines(opts.annotations);

  // renderRichLines emits one line per row and one per collapsed gap, in block
  // order, so walking the blocks in parallel recovers which block each came from.
  const rows: ViewRow[] = [];
  let blockIndex = 0;
  let withinBlock = 0;
  for (const line of rendered.lines) {
    while (blockIndex < shown.length && withinBlock >= visibleHeight(shown[blockIndex]!)) {
      blockIndex++;
      withinBlock = 0;
    }
    rows.push({
      ...line,
      kind: 'doc',
      blockIndex: line.gapIndex ?? blockIndex,
      rail: line.newLine !== null && railed.has(line.newLine),
    });
    withinBlock++;

    // A note belongs directly under the last line it refers to, so it reads as
    // a margin comment on that passage rather than a footnote.
    if (line.newLine === null) continue;
    for (const annotation of endingAt(opts.annotations, line.newLine)) {
      const editing = opts.draft?.annotationId === annotation.id;
      const text = editing ? opts.draft!.text : annotation.comment;
      const collapsed =
        Boolean(opts.hiddenFeedback) || Boolean(opts.collapsedFeedback?.has(annotation.id));
      rows.push(...feedbackRows(annotation.id, text, { blockIndex, boxWidth, collapsed, editing }));
    }
  }

  return {
    planId: opts.planId,
    versionA: opts.versionA,
    versionB: opts.versionB,
    docLines,
    locks,
    lockedLines,
    blocks,
    rows,
    boxWidth,
    gutterWidth: RAIL_WIDTH + rendered.gutterWidth,
  };
}

/** Every line a note covers, which is every line the rail runs down. */
function railedLines(annotations: readonly Annotation[]): Set<number> {
  const lines = new Set<number>();
  for (const annotation of annotations) {
    if (annotation.kind !== 'comment') continue;
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
  return annotations.filter((a) => a.kind === 'comment' && a.anchor.end_line === line);
}

const MAX_BOX_WIDTH = 72;
/** `│ ` and ` │` — what the frame costs the text inside it. */
export const BOX_PADDING = 4;
/** The rail lives at the head of the gutter, in a column of its own. */
export const RAIL_WIDTH = 1;

export interface BoxOptions {
  blockIndex: number;
  boxWidth: number;
  collapsed: boolean;
  /** The note being typed: leave the caret a column, and it gets one. */
  editing?: boolean;
  /** A note hangs off the rail with `├`; the whole-plan note hangs off nothing. */
  attached?: boolean;
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
  const attached = opts.attached !== false;
  const base = {
    kind: 'feedback' as const,
    annotationId: id,
    newLine: null,
    gapIndex: null,
    blockIndex,
    boxWidth,
    last: false,
  };
  const rule = '─'.repeat(Math.max(0, boxWidth - 2));

  if (opts.collapsed) {
    // The rail carrying the note's own title: folding reads as the box
    // flattening into the line it was already attached to, so there is no
    // closing corner to suggest anything was hidden sideways.
    const title = ` ▸ ${firstLine(comment)} `;
    const fill = Math.max(0, boxWidth - 2 - title.length);
    return [{ ...base, part: 'collapsed', text: `├─${title}${'─'.repeat(fill)}`, last: true }];
  }

  // The caret needs a column of its own on the last line. Wrapping a column
  // early gives it one; truncating the line to make room is what used to hold
  // an over-long word on one line until the next space was typed.
  const width = boxWidth - BOX_PADDING - (opts.editing ? 1 : 0);
  const body = comment.length ? wrapComment(comment, width) : [''];
  return [
    { ...base, part: 'top', text: `${attached ? '├' : '╭'}${rule}╮` },
    ...body.map((text, i) => ({
      ...base,
      part: 'body' as const,
      text,
      last: i === body.length - 1,
    })),
    { ...base, part: 'bottom', text: `╰${rule}╯` },
  ];
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
 * Two things here are not the obvious word wrap, and both are the difference
 * between a box that grows as you type and one that lurches:
 *
 * - A trailing space survives. Splitting on whitespace throws it away, so
 *   `"hello "` and `"hello"` render identically and pressing space appears to
 *   do nothing at all. It counts against the width like any other character.
 * - A word wider than the box is broken at the edge. Wrapping only between
 *   words leaves a 90-character token on one line, where the renderer cuts it
 *   with an ellipsis until the next space arrives and it jumps down — which is
 *   the "delay" it looks like. Runs of spaces still collapse to one: a note is
 *   prose, and preserving five spaces would only make the box ragged.
 */
export function wrapComment(comment: string, width: number): string[] {
  const limit = Math.max(8, width);
  const out: string[] = [];

  for (const paragraph of comment.split('\n')) {
    let current = '';
    const push = () => {
      out.push(current);
      current = '';
    };

    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      let rest = word;
      while (rest.length > limit) {
        if (current) push();
        out.push(rest.slice(0, limit));
        rest = rest.slice(limit);
      }
      if (!rest) continue;
      if (current && `${current} ${rest}`.length > limit) push();
      current = current ? `${current} ${rest}` : rest;
    }

    if (/\s$/.test(paragraph)) {
      if (current.length + 1 > limit) push();
      current += ' ';
    }
    out.push(current);
  }

  return out.length ? out : [''];
}

/** The first row showing a given new-version line, for jumping to an annotation. */
export function rowForLine(rows: readonly ViewRow[], line: number): number {
  const index = rows.findIndex((row) => row.newLine === line);
  return index === -1 ? 0 : index;
}
