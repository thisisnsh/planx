import {
  listPlans,
  purgePlan,
  readLocks,
  readVersions,
  removeVersions,
  trashPlan,
} from './plans.js';
import type { PlanSummary } from './plans.js';

export interface CleanFilters {
  olderThanMs?: number;
  unapproved?: boolean;
  here?: boolean;
  ids?: string[];
}

export interface CleanPlan {
  /** Plans that would be removed entirely. */
  plans: PlanSummary[];
  /** Plans whose history would be trimmed, and which versions would go. */
  trims: Array<{ id: string; versions: number[] }>;
}

export function planClean(filters: CleanFilters, versionsBeyond?: number): CleanPlan {
  const matched = listPlans({
    olderThanMs: filters.olderThanMs,
    unapproved: filters.unapproved,
    here: filters.here,
    ids: filters.ids,
  });

  if (versionsBeyond === undefined) return { plans: matched, trims: [] };

  // `--versions-beyond` trims history rather than deleting plans, so the two
  // are alternatives, not a combination.
  const trims = matched
    .map((plan) => ({ id: plan.id, versions: doomedVersions(plan.id, versionsBeyond) }))
    .filter((t) => t.versions.length > 0);
  return { plans: [], trims };
}

/**
 * Versions a trim would remove, honouring the constraint that a version a lock
 * still points at must survive.
 *
 * Splice reads its source text out of stored versions, so trimming one that a
 * lock still references would break the marker path. Hence the constraint.
 */
export function doomedVersions(id: string, keep: number): number[] {
  const all = readVersions(id)
    .versions.map((v) => v.n)
    .sort((a, b) => a - b);
  const protectedVersions = protectedFor(id);
  const candidates = all.slice(0, Math.max(0, all.length - keep));
  return candidates.filter((n) => !protectedVersions.has(n));
}

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

export interface CleanOutcome {
  trashed: string[];
  purged: string[];
  trimmed: Array<{ id: string; versions: number[] }>;
}

/**
 * Carry out a clean.
 *
 * Deletion is soft by default: plans move to `.trash/` and `planx restore`
 * brings them back. Losing a plan you spent an hour reviewing to an off-by-one
 * in a date filter is the one unrecoverable failure in this system, so it takes
 * two deliberate steps.
 */
export function executeClean(target: CleanPlan, purge: boolean): CleanOutcome {
  const outcome: CleanOutcome = { trashed: [], purged: [], trimmed: [] };

  for (const plan of target.plans) {
    if (purge) {
      purgePlan(plan.id);
      outcome.purged.push(plan.id);
    } else {
      trashPlan(plan.id);
      outcome.trashed.push(plan.id);
    }
  }

  for (const trim of target.trims) {
    const removed = removeVersions(trim.id, trim.versions);
    if (removed.length) outcome.trimmed.push({ id: trim.id, versions: removed });
  }

  return outcome;
}
