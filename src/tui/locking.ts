import { addLock, uncoveredRuns, unlockRange } from '../locks/manage.js';
import { sectionOf } from '../render/markdown.js';
import { updateLocks } from '../store/plans.js';
import type { LineSpan } from './selection.js';

/**
 * Locking from the review screen lands on disk immediately.
 *
 * It used to be queued as an annotation and applied at submit, which made `l`
 * a promise rather than an action: the marker never appeared in the gutter, the
 * toggle had nothing to read back so it could never unlock, and leaving without
 * submitting quietly threw the whole thing away. A lock is a decision about the
 * document, not a comment on it, so it is written when it is made.
 *
 * Line spans here are 1-based and inclusive, the coordinates the screen uses;
 * the lock store is 0-based, so every entry point converts once, here.
 */
function toRange(span: LineSpan): { start: number; end: number } {
  return { start: Math.max(0, span.start - 1), end: Math.max(0, span.end - 1) };
}

function toSpan(range: { start: number; end: number }): LineSpan {
  return { start: range.start + 1, end: range.end + 1 };
}

export interface LockResult {
  /** What was frozen by this press, and under which id. */
  locked: Array<LineSpan & { id: string }>;
  /** Parts of the span a lock already covered, left alone. */
  skipped: LineSpan[];
}

/**
 * Freeze the parts of a span that are not frozen already.
 *
 * Locking the whole span again would leave lines covered by two records for a
 * job that needs one. It reports both halves so the status line can say what
 * actually happened rather than claiming the whole span every time.
 */
export function lockLines(
  planId: string,
  docLines: string[],
  version: number,
  span: LineSpan,
): LockResult {
  const range = toRange(span);
  return updateLocks(planId, (locks) => {
    const runs = uncoveredRuns(locks, docLines, range);
    const locked = runs.map((run) => ({
      ...toSpan(run),
      id: addLock(locks, {
        docLines,
        range: run,
        origin: 'user',
        version,
        section: sectionOf(docLines, run.start),
      }).id,
    }));
    return { locked, skipped: gapsBetween(range, runs).map(toSpan) };
  });
}

/** The parts of `range` the runs do not account for — what was already locked. */
function gapsBetween(
  range: { start: number; end: number },
  runs: Array<{ start: number; end: number }>,
): Array<{ start: number; end: number }> {
  const gaps: Array<{ start: number; end: number }> = [];
  let cursor = range.start;
  for (const run of runs) {
    if (run.start > cursor) gaps.push({ start: cursor, end: run.start - 1 });
    cursor = run.end + 1;
  }
  if (cursor <= range.end) gaps.push({ start: cursor, end: range.end });
  return gaps;
}

/**
 * Lift the locks over a span, splitting any that only partly overlap it.
 *
 * A plan that was sealed and then partly unlocked is no longer sealed, so the
 * seal comes off with it — leaving the flag set would mean `planx list` calls a
 * plan approved while the reviewer is mid-way through reopening it.
 */
export function unlockLines(planId: string, docLines: string[], span: LineSpan): string[] {
  const range = toRange(span);
  return updateLocks(planId, (locks) => {
    const result = unlockRange(locks, docLines, range);
    if (result.removed.length && locks.sealed_at) {
      locks.sealed_at = null;
      locks.sealed_version = null;
    }
    return result.removed;
  });
}
