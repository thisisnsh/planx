import { normalizedLines } from '../locks/anchor.js';
import { addLock, issueGrant, sealPlan, unlockRange } from '../locks/manage.js';
import { sectionOf } from '../render/markdown.js';
import { ulid } from '../store/ids.js';
import { readMeta, readVersionText, reindex, updateLocks, writeMeta } from '../store/plans.js';
import { writeFeedback, writeResponse } from '../store/queue.js';
import {
  AwaitResponseSchema,
  FeedbackSchema,
  type Annotation,
  type Feedback,
} from '../store/types.js';

export interface SubmitInput {
  planId: string;
  version: number;
  verdict: Feedback['verdict'];
  annotations: Annotation[];
  general?: string;
  /** The await request this answers, when the TUI knows one is blocking. */
  requestId?: string | null;
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

  writeResponse(
    AwaitResponseSchema.parse({
      id: ulid(),
      request_id: input.requestId ?? null,
      kind: 'review',
      plan_id: input.planId,
      version: input.version,
      created: new Date().toISOString(),
      feedback_id: feedback.id,
    }),
  );

  return { feedback, locksCreated, locksRemoved, sealedLocks };
}

function toRange(annotation: Annotation): { start: number; end: number } {
  return {
    start: Math.max(0, annotation.anchor.start_line - 1),
    end: Math.max(0, annotation.anchor.end_line - 1),
  };
}

export interface UnlockResponseInput {
  planId: string;
  version: number;
  lockId: string;
  granted: boolean;
  /** The reviewer's note, and for a grant the text they agreed the block becomes. */
  note?: string;
  requestId?: string | null;
}

/** Answer an outstanding `unlock-request`, issuing a single-use grant if allowed. */
export function respondToUnlock(input: UnlockResponseInput): { grantId: string | null } {
  let grantId: string | null = null;

  if (input.granted) {
    grantId = updateLocks(input.planId, (locks) => {
      if (!locks.locks[input.lockId]) {
        throw new Error(`planx: ${input.planId} has no lock ${input.lockId}.`);
      }
      return issueGrant(locks, input.lockId, '', input.note ?? '').id;
    });
  }

  writeResponse(
    AwaitResponseSchema.parse({
      id: ulid(),
      request_id: input.requestId ?? null,
      kind: 'unlock',
      plan_id: input.planId,
      version: input.version,
      created: new Date().toISOString(),
      lock_id: input.lockId,
      granted: input.granted,
      grant_id: grantId,
      note: input.note ?? '',
    }),
  );

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
