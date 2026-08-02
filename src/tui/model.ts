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
  /** Box edges carry no text; only `body` is editable. */
  part: 'top' | 'body' | 'bottom';
  text: string;
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
}

export interface BuildModelOptions {
  planId: string;
  versionA: number | null;
  versionB: number;
  mode: RenderMode;
  expandedGaps: ReadonlySet<number>;
  annotations: readonly Annotation[];
  /** Collapse the note bodies, keeping the dotted edge on the lines. */
  hiddenFeedback?: boolean;
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
  const rendered = renderRichLines(shown, {
    mode: opts.mode,
    lockedLines,
    annotated: annotationMap(opts.annotations),
  });

  // renderRichLines emits one line per row and one per collapsed gap, in block
  // order, so walking the blocks in parallel recovers which block each came from.
  const rows: ViewRow[] = [];
  let blockIndex = 0;
  let withinBlock = 0;
  for (const line of rendered) {
    while (blockIndex < shown.length && withinBlock >= visibleHeight(shown[blockIndex]!)) {
      blockIndex++;
      withinBlock = 0;
    }
    rows.push({ ...line, kind: 'doc', blockIndex: line.gapIndex ?? blockIndex });
    withinBlock++;

    // A note belongs directly under the last line it refers to, so it reads as
    // a margin comment on that passage rather than a footnote.
    if (line.newLine !== null && !opts.hiddenFeedback) {
      for (const annotation of endingAt(opts.annotations, line.newLine)) {
        rows.push(...feedbackRows(annotation, blockIndex));
      }
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
  };
}

function visibleHeight(block: Block): number {
  return block.kind === 'gap' ? 1 : block.rows.length;
}

/** Comment annotations whose last line is `line`. */
function endingAt(annotations: readonly Annotation[], line: number): Annotation[] {
  return annotations.filter((a) => a.kind === 'comment' && a.anchor.end_line === line);
}

const BOX_WIDTH = 58;

function feedbackRows(annotation: Annotation, blockIndex: number): FeedbackRow[] {
  const base = { annotationId: annotation.id, newLine: null, gapIndex: null, blockIndex } as const;
  const body = annotation.comment.length ? wrapComment(annotation.comment) : [''];
  // Dashed, and deliberately not the glyphs the screen frame uses: a note has
  // to read as pinned to the passage above it, not as another panel.
  return [
    { ...base, kind: 'feedback', part: 'top', text: `╭${'╌'.repeat(BOX_WIDTH)}` },
    ...body.map((text) => ({ ...base, kind: 'feedback' as const, part: 'body' as const, text })),
    { ...base, kind: 'feedback', part: 'bottom', text: `╰${'╌'.repeat(BOX_WIDTH)}` },
  ];
}

/** Wrap on words so a long note does not run off the right edge. */
function wrapComment(comment: string): string[] {
  const out: string[] = [];
  for (const paragraph of comment.split('\n')) {
    let current = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if (current && `${current} ${word}`.length > BOX_WIDTH - 2) {
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

/** new-version line → the annotation ids sitting on it, for the dotted edge. */
export function annotationMap(annotations: readonly Annotation[]): Map<number, string[]> {
  const map = new Map<number, string[]>();
  for (const annotation of annotations) {
    if (annotation.kind !== 'comment') continue;
    for (let line = annotation.anchor.start_line; line <= annotation.anchor.end_line; line++) {
      const existing = map.get(line);
      if (existing) existing.push(annotation.id);
      else map.set(line, [annotation.id]);
    }
  }
  return map;
}

/** The first row showing a given new-version line, for jumping to an annotation. */
export function rowForLine(rows: readonly ViewRow[], line: number): number {
  const index = rows.findIndex((row) => row.newLine === line);
  return index === -1 ? 0 : index;
}
