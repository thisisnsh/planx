import { collapse } from '../diff/collapse.js';
import { diffVersions, rowsForSingleVersion } from '../diff/lines.js';
import type { Block } from '../diff/types.js';
import { normalizedLines } from '../locks/anchor.js';
import { lockedLineMap } from '../locks/manage.js';
import { renderRichLines, type RenderedLine, type RenderMode } from '../render/diff.js';
import { readLocks, readVersionText } from '../store/plans.js';
import type { Annotation, LocksFile } from '../store/types.js';

export interface ViewRow extends RenderedLine {
  /** Index of the block this row came from, for expanding gaps. */
  blockIndex: number;
}

export interface ReviewModel {
  planId: string;
  versionA: number | null;
  versionB: number;
  /** The version under review, split into lines — the annotation coordinate space. */
  docLines: string[];
  locks: LocksFile;
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

  const rendered = renderRichLines(shown, {
    mode: opts.mode,
    lockedLines: lockedLineMap(docLines, locks),
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
    rows.push({ ...line, blockIndex: line.gapIndex ?? blockIndex });
    withinBlock++;
  }

  return {
    planId: opts.planId,
    versionA: opts.versionA,
    versionB: opts.versionB,
    docLines,
    locks,
    blocks,
    rows,
  };
}

function visibleHeight(block: Block): number {
  return block.kind === 'gap' ? 1 : block.rows.length;
}

/** new-version line → the annotation ids sitting on it. */
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
