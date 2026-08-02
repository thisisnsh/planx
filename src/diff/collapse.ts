import type { Block, DiffRow } from './types.js';

export const DEFAULT_CONTEXT = 3;

/**
 * Group rows into displayed runs and collapsed gaps of unchanged lines.
 *
 * A gap is only worth making when it hides more than it costs — collapsing four
 * lines behind a one-line "⋯ 4 unchanged lines" marker saves three lines and
 * costs the reader a keystroke, which is a bad trade.
 */
export function collapse(rows: DiffRow[], context = DEFAULT_CONTEXT, minGap = 4): Block[] {
  const keep = new Set<number>();
  rows.forEach((row, i) => {
    if (row.kind === 'context') return;
    for (let j = Math.max(0, i - context); j <= Math.min(rows.length - 1, i + context); j++) {
      keep.add(j);
    }
  });

  // No changes at all: show everything rather than collapsing the entire file
  // into a single unhelpful "⋯ 412 unchanged lines".
  if (keep.size === 0) return [{ kind: 'rows', rows }];

  const blocks: Block[] = [];
  let i = 0;
  while (i < rows.length) {
    if (keep.has(i)) {
      const start = i;
      while (i < rows.length && keep.has(i)) i++;
      blocks.push({ kind: 'rows', rows: rows.slice(start, i) });
    } else {
      const start = i;
      while (i < rows.length && !keep.has(i)) i++;
      const hidden = rows.slice(start, i);
      if (hidden.length >= minGap) {
        blocks.push({ kind: 'gap', count: hidden.length, rows: hidden });
      } else {
        blocks.push({ kind: 'rows', rows: hidden });
      }
    }
  }
  return blocks;
}

/**
 * Flatten blocks back to rows, expanding the gaps whose index is in `expanded`.
 * The TUI keeps a set of expanded gap indices and re-flattens on every toggle;
 * plan documents are small enough that this is cheaper than incremental state.
 */
export function flatten(
  blocks: Block[],
  expanded: ReadonlySet<number> = new Set(),
): Array<{ row: DiffRow; gapIndex: null } | { row: null; gapIndex: number; count: number }> {
  const out: Array<
    { row: DiffRow; gapIndex: null } | { row: null; gapIndex: number; count: number }
  > = [];
  blocks.forEach((block, index) => {
    if (block.kind === 'rows' || expanded.has(index)) {
      for (const row of block.rows) out.push({ row, gapIndex: null });
    } else {
      out.push({ row: null, gapIndex: index, count: block.count });
    }
  });
  return out;
}
