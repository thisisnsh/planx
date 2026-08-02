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
 * block sitting underneath it.
 *
 * Feedback is rendered inline rather than in an overlay, so it has to be in the
 * same list the cursor walks — that is what lets you arrow down into a note and
 * delete it. Every row is exactly one terminal line, which keeps scrolling a
 * matter of slicing an array rather than measuring heights.
 */
export type ViewRow = DocRow | FeedbackRow;

export interface DocRow extends RenderedLine {
  kind: 'doc';
  /** Index of the block this row came from, for expanding gaps. */
  blockIndex: number;
}

export interface FeedbackRow {
  kind: 'feedback';
  /** Which annotation this belongs to, so `d` knows what to remove. */
  annotationId: string;
  /** Box edges are drawn whole; only `body` carries editable text. */
  part: 'top' | 'body' | 'bottom' | 'collapsed';
  text: string;
  /** The caret sits after the last body line while the note is being typed. */
  last: boolean;
  /** Columns the box occupies, so the closing edge lands in the same column. */
  boxWidth: number;
  /** Blank prefix aligning the box under the text column. */
  gutter: string;
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
  /** Columns before the text column, for anything drawing under it. */
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

  // The box hangs under the text column, so it reads as attached to the passage
  // rather than as a second gutter. Capped, because a note stretched across a
  // very wide terminal is harder to read, not easier.
  const boxWidth = Math.max(24, Math.min(MAX_BOX_WIDTH, opts.width - rendered.gutterWidth));
  const gutter = ' '.repeat(rendered.gutterWidth);

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
    rows.push({ ...line, kind: 'doc', blockIndex: line.gapIndex ?? blockIndex });
    withinBlock++;

    // A note belongs directly under the last line it refers to, so it reads as
    // a margin comment on that passage rather than a footnote.
    if (line.newLine === null) continue;
    for (const annotation of endingAt(opts.annotations, line.newLine)) {
      const text =
        opts.draft?.annotationId === annotation.id ? opts.draft.text : annotation.comment;
      const collapsed =
        Boolean(opts.hiddenFeedback) || Boolean(opts.collapsedFeedback?.has(annotation.id));
      rows.push(...feedbackRows(annotation.id, text, { blockIndex, boxWidth, gutter, collapsed }));
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
    gutterWidth: rendered.gutterWidth,
  };
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
const BOX_PADDING = 4;

interface BoxOptions {
  blockIndex: number;
  boxWidth: number;
  gutter: string;
  collapsed: boolean;
}

/**
 * A note as a closed box under the line it annotates.
 *
 * Closed on all four sides, in solid glyphs. The half-open dashed bracket it
 * replaced read as an unfinished panel rather than as a comment — a box you can
 * see the end of is a box you can trust you have read all of.
 */
function feedbackRows(id: string, comment: string, opts: BoxOptions): FeedbackRow[] {
  const { boxWidth, gutter, blockIndex } = opts;
  const base = {
    kind: 'feedback' as const,
    annotationId: id,
    newLine: null,
    gapIndex: null,
    blockIndex,
    boxWidth,
    gutter,
    last: false,
  };
  const rule = '─'.repeat(Math.max(0, boxWidth - 2));

  if (opts.collapsed) {
    // One row carrying its own title, so a collapsed note still says what it
    // is. The caret is the same one the cursor uses: it points at hidden text.
    const title = ` ▸ ${firstLine(comment)} `;
    const fill = Math.max(0, boxWidth - 3 - title.length);
    return [{ ...base, part: 'collapsed', text: `╭─${title}${'─'.repeat(fill)}╮`, last: true }];
  }

  const body = comment.length ? wrapComment(comment, boxWidth - BOX_PADDING) : [''];
  return [
    { ...base, part: 'top', text: `╭${rule}╮` },
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

/** Wrap on words so a long note does not run off the right edge. */
export function wrapComment(comment: string, width: number): string[] {
  const limit = Math.max(8, width);
  const out: string[] = [];
  for (const paragraph of comment.split('\n')) {
    let current = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if (current && `${current} ${word}`.length > limit) {
        out.push(current);
        current = word;
      } else {
        current = current ? `${current} ${word}` : word;
      }
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
