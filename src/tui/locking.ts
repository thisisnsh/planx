import { addLock, unlockRange } from '../locks/manage.js';
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

/** Freeze a span. Returns the id of the lock now covering it. */
export function lockLines(
  planId: string,
  docLines: string[],
  version: number,
  span: LineSpan,
): string {
  const range = toRange(span);
  return updateLocks(planId, (locks) => {
    return addLock(locks, {
      docLines,
      range,
      origin: 'user',
      version,
      section: sectionOf(docLines, range.start),
    }).id;
  });
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
