import { readLocks } from './plans.js';

/**
 * Versions that must survive whatever else is deleted.
 *
 * A lock's markers are re-spliced from the version its text was first recorded
 * in, so dropping that version breaks the marker path and leaves the lock
 * pointing at nothing. The sealed version is kept for the same reason: it is
 * what the whole set of section locks was cut from.
 *
 * This is what stands between `d` in the picker and a plan whose locks can no
 * longer be resolved.
 */
export function protectedFor(id: string): Set<number> {
  const locks = readLocks(id);
  const kept = new Set<number>();
  for (const lock of Object.values(locks.locks)) {
    kept.add(lock.first_locked_version);
    kept.add(lock.still_present_in);
  }
  if (locks.sealed_version !== null) kept.add(locks.sealed_version);
  return kept;
}
