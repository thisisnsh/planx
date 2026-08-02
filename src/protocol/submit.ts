import { normalizedLines } from '../locks/anchor.js';
import { addLock, issueGrant, sealPlan, unlockRange } from '../locks/manage.js';
import { sectionOf } from '../render/markdown.js';
import { ulid } from '../store/ids.js';
import { readMeta, readVersionText, reindex, updateLocks, writeMeta } from '../store/plans.js';
import { writeFeedback } from '../store/feedback.js';
import { FeedbackSchema, type Annotation, type Feedback } from '../store/types.js';

export interface SubmitInput {
  planId: string;
  version: number;
  verdict: Feedback['verdict'];
  annotations: Annotation[];
  general?: string;
}

export interface SubmitResult {
  feedback: Feedback;
  locksCreated: string[];
  locksRemoved: string[];
  sealedLocks: string[];
}

/**
 * Land everything the reviewer did in one shot: comments, locks, unlocks and
 * the verdict.
 *
 * One submit rather than a call per annotation is the point of the TUI — you
 * select three ranges, lock two sections, and it all arrives in the agent's
 * context together (PLAN §1).
 */
export function submitFeedback(input: SubmitInput): SubmitResult {
  const text = readVersionText(input.planId, input.version);
  if (text === null) {
    throw new Error(`planx: ${input.planId} has no stored v${input.version} to review.`);
  }
  const docLines = normalizedLines(text);

  const locksCreated: string[] = [];
  const locksRemoved: string[] = [];
  const sealedLocks: string[] = [];

  updateLocks(input.planId, (locks) => {
    // Unlocks first: locking and then unlocking the same lines in one submit
    // should leave them unlocked, which is the order the reviewer saw on screen.
    for (const annotation of input.annotations) {
      if (annotation.kind !== 'unlock') continue;
      const result = unlockRange(locks, docLines, toRange(annotation));
      locksRemoved.push(...result.removed);
      locksCreated.push(...result.created.map((l) => l.id));
    }

    for (const annotation of input.annotations) {
      if (annotation.kind !== 'lock') continue;
      const lock = addLock(locks, {
        docLines,
        range: toRange(annotation),
        origin: 'user',
        version: input.version,
        section: annotation.section ?? sectionOf(docLines, annotation.anchor.start_line - 1),
      });
      locksCreated.push(lock.id);
    }

    if (input.verdict === 'approve') {
      sealedLocks.push(...sealPlan(locks, docLines, input.version).map((l) => l.id));
    }
  });

  if (input.verdict === 'approve') {
    const meta = readMeta(input.planId);
    if (meta) {
      meta.approved_at = new Date().toISOString();
      meta.approved_version = input.version;
      writeMeta(meta);
    }
  }
  reindex(input.planId);

  const feedback = FeedbackSchema.parse({
    id: ulid(),
    plan_id: input.planId,
    version: input.version,
    verdict: input.verdict,
    annotations: input.annotations,
    general: input.general ?? '',
    created: new Date().toISOString(),
  });
  writeFeedback(feedback);

  return { feedback, locksCreated, locksRemoved, sealedLocks };
}

function toRange(annotation: Annotation): { start: number; end: number } {
  return {
    start: Math.max(0, annotation.anchor.start_line - 1),
    end: Math.max(0, annotation.anchor.end_line - 1),
  };
}

export interface GrantUnlockInput {
  planId: string;
  lockId: string;
  /** Why the block has to change. Kept on the record as the audit trail. */
  reason: string;
}

/**
 * Issue a single-use permission to modify one locked block.
 *
 * There is no matching "deny": nothing blocks on the answer any more, so a
 * refusal is simply this command never being run. The grant authorises exactly
 * one capture and then burns, and the lock re-arms on whatever that capture
 * wrote — unchanged from when a blocked `unlock-request` waited for it.
 *
 * The reason is recorded rather than merely printed. An agent issues this
 * itself after agreeing the change with the user, so the only thing making that
 * reviewable afterwards is the record it leaves behind.
 */
export function grantUnlock(input: GrantUnlockInput): { grantId: string } {
  const grantId = updateLocks(input.planId, (locks) => {
    if (!locks.locks[input.lockId]) {
      throw new Error(`planx: ${input.planId} has no lock ${input.lockId}.`);
    }
    return issueGrant(locks, input.lockId, input.reason).id;
  });
  return { grantId };
}

/** Build a comment annotation from a line selection, filling in quote and section. */
export function buildAnnotation(
  docLines: string[],
  kind: Annotation['kind'],
  startLine: number,
  endLine: number,
  comment: string,
  id: string,
  contextSha = '',
): Annotation {
  const start = Math.min(startLine, endLine);
  const end = Math.max(startLine, endLine);
  return {
    id,
    kind,
    anchor: { start_line: start, end_line: end, context_sha: contextSha },
    quote: docLines.slice(start - 1, end).join('\n'),
    comment,
    section: sectionOf(docLines, start - 1),
  };
}
