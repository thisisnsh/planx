import { contentHash, ulid } from '../store/ids.js';
import type { GrantRecord, LocksFile, LockRecord } from '../store/types.js';
import {
  contextSha,
  findOccurrences,
  locateLock,
  normalizedLines,
  rangeText,
  type LineRange,
} from './anchor.js';
import { splitSections } from './sections.js';

export function nextLockId(locks: LocksFile): string {
  const id = `L${locks.next_seq}`;
  locks.next_seq += 1;
  return id;
}

export interface CreateLockInput {
  docLines: string[];
  range: LineRange;
  origin: LockRecord['origin'];
  version: number;
  section?: string | null;
  id?: string;
}

export function buildLock(locks: LocksFile, input: CreateLockInput): LockRecord {
  const text = rangeText(input.docLines, input.range);
  return {
    id: input.id ?? nextLockId(locks),
    created: new Date().toISOString(),
    origin: input.origin,
    section: input.section ?? null,
    sha256: contentHash(text),
    context_sha: contextSha(input.docLines, input.range),
    text,
    first_locked_version: input.version,
    still_present_in: input.version,
    consumed_grant: null,
  };
}

export function addLock(locks: LocksFile, input: CreateLockInput): LockRecord {
  const lock = buildLock(locks, input);
  locks.locks[lock.id] = lock;
  return lock;
}

/**
 * Approval locks every line of the version, as one lock per `##` section plus
 * one for the preamble.
 *
 * Per-section rather than one document-wide lock because it reuses machinery
 * that already exists: the unlock handshake names a lock, the gutter shows
 * locks individually, and `--skeleton` collapses them one at a time. A single
 * monolithic lock would need a special case in all three.
 */
export function sealPlan(locks: LocksFile, docLines: string[], version: number): LockRecord[] {
  const created: LockRecord[] = [];

  for (const section of splitSections(docLines)) {
    const range = { start: section.start, end: section.end };
    if (!rangeText(docLines, range).trim()) continue; // blank lines are not worth a lock

    // Lines already locked by hand stay as they are — re-locking them would
    // renumber them and orphan any grant the user already issued, and laying a
    // section lock over the top would leave the line covered twice.
    for (const run of uncoveredRuns(locks, docLines, range)) {
      if (!rangeText(docLines, run).trim()) continue;
      created.push(
        addLock(locks, { docLines, range: run, origin: 'seal', version, section: section.heading }),
      );
    }
  }

  locks.sealed_at = new Date().toISOString();
  locks.sealed_version = version;
  return created;
}

/**
 * The parts of `range` no lock covers yet, as contiguous runs.
 *
 * Locks are disjoint by construction: locking a span that is already half
 * locked adds records only for the other half. Two overlapping requests used to
 * become two whole-span records, so a line was covered twice — `planx locks`
 * listed it in two blocks with duplicated text, the gutter and `--json` picked
 * an arbitrary one of the covering ids, and an unlock had to split both. The
 * lock *state* was always right, because a line is locked if any record covers
 * it, but the bookkeeping under it was not.
 */
export function uncoveredRuns(locks: LocksFile, docLines: string[], range: LineRange): LineRange[] {
  const covered = new Set<number>();
  for (const lock of Object.values(locks.locks)) {
    const found = locateLock(docLines, lock);
    if (!found.ok) continue;
    for (let i = found.range.start; i <= found.range.end; i++) covered.add(i);
  }

  const runs: LineRange[] = [];
  let start: number | null = null;
  for (let i = range.start; i <= range.end; i++) {
    if (covered.has(i)) {
      if (start !== null) runs.push({ start, end: i - 1 });
      start = null;
    } else if (start === null) {
      start = i;
    }
  }
  if (start !== null) runs.push({ start, end: range.end });
  return runs;
}

export interface UnlockResult {
  removed: string[];
  created: LockRecord[];
  kept: string[];
}

/**
 * Lift a lock over `range`, splitting any lock that is only partly covered.
 *
 * Refusing partial unlocks would force you to unfreeze a whole section to
 * change one line, so splitting is the supported behaviour. The
 * leading fragment keeps the original id so an outstanding grant against it
 * still means something; the trailing fragment gets a fresh one.
 */
export function unlockRange(locks: LocksFile, docLines: string[], range: LineRange): UnlockResult {
  const result: UnlockResult = { removed: [], created: [], kept: [] };

  for (const lock of Object.values(locks.locks)) {
    const found = locateLock(docLines, lock);
    if (!found.ok) {
      result.kept.push(lock.id);
      continue;
    }
    const { start, end } = found.range;
    if (range.end < start || range.start > end) {
      result.kept.push(lock.id);
      continue;
    }

    delete locks.locks[lock.id];
    result.removed.push(lock.id);

    const head = { start, end: Math.min(end, range.start - 1) };
    const tail = { start: Math.max(start, range.end + 1), end };

    if (head.end >= head.start) {
      result.created.push(
        addLock(locks, {
          docLines,
          range: head,
          origin: lock.origin,
          version: lock.first_locked_version,
          section: lock.section,
          id: lock.id,
        }),
      );
    }
    if (tail.end >= tail.start) {
      const id = head.end >= head.start ? undefined : lock.id;
      result.created.push(
        addLock(locks, {
          docLines,
          range: tail,
          origin: lock.origin,
          version: lock.first_locked_version,
          section: lock.section,
          id,
        }),
      );
    }
  }

  return result;
}

/** 1-based line number → lock id, for the gutter and for `locks --json`. */
export function lockedLineMap(docLines: string[], locks: LocksFile): Map<number, string> {
  const map = new Map<number, string>();
  for (const lock of Object.values(locks.locks)) {
    const found = locateLock(docLines, lock);
    if (!found.ok) continue;
    for (let i = found.range.start; i <= found.range.end; i++) map.set(i + 1, lock.id);
  }
  return map;
}

/* ---------------------------------------------------------------- grants */

export function issueGrant(
  locks: LocksFile,
  lockId: string,
  reason: string,
  note = '',
): GrantRecord {
  const grant: GrantRecord = {
    id: `${lockId}-${ulid()}`,
    lock_id: lockId,
    granted_at: new Date().toISOString(),
    reason,
    note,
    used_at: null,
    used_by_version: null,
  };
  locks.grants[grant.id] = grant;
  return grant;
}

/**
 * The unused grant for a lock, if any.
 *
 * Approval is single-use and scoped to one lock: it authorises exactly one
 * capture that may modify that lock, then the lock re-arms against whatever
 * that capture wrote. No blanket unlocks, no drift.
 */
export function activeGrant(locks: LocksFile, lockId: string): GrantRecord | null {
  return (
    Object.values(locks.grants).find((g) => g.lock_id === lockId && g.used_at === null) ?? null
  );
}

export function consumeGrant(locks: LocksFile, grant: GrantRecord, version: number): void {
  grant.used_at = new Date().toISOString();
  grant.used_by_version = version;
  locks.grants[grant.id] = grant;
}

/**
 * After a capture lands, re-anchor every lock against the new document.
 *
 * Unchanged locks just get `still_present_in` bumped and their `context_sha`
 * refreshed — surrounding lines move even when the locked text does not. A lock
 * whose grant was just consumed is re-armed on the text that replaced it,
 * located by its section heading, or by the grant's proposed text for a lock
 * that has no heading. If neither can be found the lock is dropped and named in
 * the returned `dropped` list, because silently re-arming on the wrong lines
 * would be worse than losing the lock loudly.
 */
export interface RearmResult {
  rearmed: string[];
  dropped: string[];
}

export function rearmLocks(
  locks: LocksFile,
  docLines: string[],
  version: number,
  proposedByLock: ReadonlyMap<string, string> = new Map(),
): RearmResult {
  const result: RearmResult = { rearmed: [], dropped: [] };

  for (const lock of Object.values(locks.locks)) {
    const found = locateLock(docLines, lock);
    if (found.ok) {
      lock.still_present_in = version;
      lock.context_sha = contextSha(docLines, found.range);
      locks.locks[lock.id] = lock;
      continue;
    }

    const replacement = relocateAfterGrant(docLines, lock, proposedByLock.get(lock.id));
    if (!replacement) {
      delete locks.locks[lock.id];
      result.dropped.push(lock.id);
      continue;
    }

    lock.text = rangeText(docLines, replacement);
    lock.sha256 = contentHash(lock.text);
    lock.context_sha = contextSha(docLines, replacement);
    lock.still_present_in = version;
    locks.locks[lock.id] = lock;
    result.rearmed.push(lock.id);
  }

  return result;
}

function relocateAfterGrant(
  docLines: string[],
  lock: LockRecord,
  proposed: string | undefined,
): LineRange | null {
  if (lock.section) {
    const section = splitSections(docLines).find((s) => s.heading === lock.section);
    if (section) return { start: section.start, end: section.end };
  }
  if (proposed?.trim()) {
    const hits = findOccurrences(docLines, normalizedLines(proposed));
    if (hits.length === 1) return hits[0]!;
  }
  return null;
}
