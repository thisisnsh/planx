import { splitLines } from '../diff/lines.js';
import { normalizedLines } from '../locks/anchor.js';
import { consumeGrant, rearmLocks } from '../locks/manage.js';
import { splice } from '../locks/markers.js';
import { formatViolations, verifyLocks, type Violation } from '../locks/verify.js';
import {
  addVersion,
  createPlan,
  latestVersion,
  planExists,
  readLocks,
  readMeta,
  readVersionText,
  reindex,
  resolvePlanRef,
  resolveVersionRef,
  updateLocks,
  writeMeta,
} from '../store/plans.js';
import { markFeedbackAddressed } from '../store/feedback.js';

export class LockViolationError extends Error {
  constructor(
    readonly planId: string,
    readonly violations: Violation[],
  ) {
    super(formatViolations(planId, violations));
    this.name = 'LockViolationError';
  }
}

export interface CaptureOptions {
  text: string;
  /** Existing plan to append to. Omitted for the first capture of a new plan. */
  planId?: string | null;
  title?: string | null;
  /** Version the agent revised from — used to explain a lock violation. */
  parent?: string | null;
  splice?: boolean;
  source?: string;
  note?: string | null;
  name?: string | null;
  agent?: string | null;
  sessionId?: string | null;
  author?: 'agent' | 'human' | 'import';
  cwd?: string;
  tags?: string[];
  created?: string;
}

export interface CaptureResult {
  planId: string;
  title: string;
  version: number;
  /** False when the content matched the latest version and nothing was written. */
  created: boolean;
  isNewPlan: boolean;
  expandedLocks: string[];
  literalMarkersInFence: number[];
  consumedGrants: string[];
  droppedLocks: string[];
  closedFeedback: number;
}

const UNTITLED = 'Untitled plan';

/**
 * Derive a title from the plan itself.
 *
 * An H1 is what an agent writing markdown produces without being asked, so
 * requiring `--title` on every capture would be friction for nothing.
 */
export function deriveTitle(text: string): string {
  for (const line of splitLines(text)) {
    const h1 = /^#\s+(.+?)\s*$/.exec(line);
    if (h1) return h1[1]!.trim();
    if (line.trim())
      return line
        .trim()
        .replace(/^#+\s*/, '')
        .slice(0, 120);
  }
  return UNTITLED;
}

/**
 * Write a version of a plan, refusing if it would mutate a locked region.
 *
 * Order matters and is fixed: splice, then verify, then write. Splicing first
 * makes the marker path the frictionless one, so hand-retyping a locked block
 * is what trips the guard rather than the other way round. Verifying
 * before writing is what makes the rejection safe to hit — nothing lands, so
 * the agent can fix and re-run.
 */
export function capture(opts: CaptureOptions): CaptureResult {
  const isNewPlan = !opts.planId;
  const title = opts.title?.trim() || deriveTitle(opts.text);

  let planId: string;
  if (opts.planId) {
    planId = planExists(opts.planId) ? opts.planId : resolvePlanRef(opts.planId);
  } else {
    planId = createPlan({
      title,
      content: opts.text,
      source: opts.source ?? 'unknown',
      cwd: opts.cwd ?? process.cwd(),
      sessionId: opts.sessionId ?? null,
      tags: opts.tags ?? [],
      name: opts.name ?? null,
      created: opts.created,
    }).id;
  }

  const locks = readLocks(planId);

  let text = opts.text;
  let expandedLocks: string[] = [];
  let literalMarkersInFence: number[] = [];
  if (opts.splice) {
    const result = splice(text, {
      locks,
      versionText: (n) => readVersionText(planId, n),
    });
    text = result.text;
    expandedLocks = result.expandedLocks;
    literalMarkersInFence = result.literalInFence;
  }

  const parentVersion = resolveParent(planId, opts.parent);
  const previousText = parentVersion === null ? null : readVersionText(planId, parentVersion);

  const verdict = verifyLocks({ locks, previousText, nextText: text });
  if (verdict.violations.length) {
    throw new LockViolationError(planId, verdict.violations);
  }

  const added = addVersion(planId, text, {
    author: opts.author ?? 'agent',
    agent: opts.agent ?? null,
    parent: parentVersion,
    note: opts.note ?? null,
  });

  const consumedGrants: string[] = [];
  let droppedLocks: string[] = [];
  if (added.created) {
    droppedLocks = updateLocks(planId, (current) => {
      for (const grant of verdict.grantsToConsume) {
        const live = current.grants[grant.id];
        if (!live || live.used_at !== null) continue;
        consumeGrant(current, live, added.version);
        const lock = current.locks[live.lock_id];
        if (lock) lock.consumed_grant = live.id;
        consumedGrants.push(live.id);
      }
      return rearmLocks(current, normalizedLines(text), added.version, verdict.proposedByLock)
        .dropped;
    });
  }

  // Feedback is answered by the existence of a newer version, so closing it
  // here is what ends the review loop rather than any acknowledgement message.
  const closedFeedback = added.created ? markFeedbackAddressed(planId, added.version) : 0;

  if (opts.title?.trim()) {
    const meta = readMeta(planId);
    if (meta && meta.title !== opts.title.trim()) {
      meta.title = opts.title.trim();
      writeMeta(meta);
      reindex(planId);
    }
  }

  return {
    planId,
    title: readMeta(planId)?.title ?? title,
    version: added.version,
    created: added.created,
    isNewPlan,
    expandedLocks,
    literalMarkersInFence,
    consumedGrants,
    droppedLocks,
    closedFeedback,
  };
}

function resolveParent(planId: string, parent: string | null | undefined): number | null {
  const latest = latestVersion(planId);
  if (latest === 0) return null;
  if (!parent) return latest;
  return resolveVersionRef(planId, parent);
}
