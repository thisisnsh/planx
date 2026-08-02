import { readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { ensureDir, readJson, writeJson } from './atomic.js';
import { paths } from './paths.js';
import {
  AwaitRequestSchema,
  AwaitResponseSchema,
  FeedbackSchema,
  type AwaitRequest,
  type AwaitResponse,
  type Feedback,
} from './types.js';

function listJson(dir: string, prefix: string): string[] {
  try {
    return readdirSync(dir)
      .filter((f) => f.startsWith(prefix) && f.endsWith('.json'))
      .sort();
  } catch {
    return [];
  }
}

/* -------------------------------------------------------------- feedback */

export function writeFeedback(feedback: Feedback): void {
  ensureDir(paths.feedbackDir(feedback.plan_id));
  writeJson(paths.feedbackFile(feedback.plan_id, feedback.version, feedback.id), feedback);
}

export function listFeedback(id: string): Feedback[] {
  const dir = paths.feedbackDir(id);
  const out: Feedback[] = [];
  for (const file of listJson(dir, 'v')) {
    const record = readJson(join(dir, file), FeedbackSchema, null);
    if (record) out.push(record);
  }
  return out.sort((a, b) => a.created.localeCompare(b.created));
}

/**
 * Feedback the agent has not acted on yet.
 *
 * "Acted on" means a newer version exists, not "was printed once" — which is
 * what lets two concurrent `await`s on the same version both receive the same
 * feedback, and what lets feedback left an hour before any agent was waiting
 * still reach the next `await` (PLAN §5).
 */
export function openFeedback(id: string): Feedback[] {
  return listFeedback(id).filter((f) => f.addressed_by === null);
}

export function markFeedbackDelivered(id: string, feedbackId: string, requestId: string): void {
  const record = findFeedback(id, feedbackId);
  if (!record) return;
  if (record.delivered_to.includes(requestId)) return;
  record.delivered_to.push(requestId);
  writeFeedback(record);
}

/** Close every open feedback record once a newer version lands. */
export function markFeedbackAddressed(id: string, byVersion: number): number {
  let closed = 0;
  for (const record of openFeedback(id)) {
    if (record.version >= byVersion) continue;
    record.addressed_by = byVersion;
    writeFeedback(record);
    closed++;
  }
  return closed;
}

function findFeedback(id: string, feedbackId: string): Feedback | null {
  return listFeedback(id).find((f) => f.id === feedbackId) ?? null;
}

/* ----------------------------------------------------------------- inbox */

export function writeRequest(request: AwaitRequest): void {
  ensureDir(paths.inboxDir(request.plan_id));
  writeJson(paths.requestFile(request.plan_id, request.id), request);
}

export function removeRequest(id: string, requestId: string): void {
  rmSync(paths.requestFile(id, requestId), { force: true });
}

/**
 * Pending await requests, newest last. Requests past their TTL are deleted on
 * read — an agent that was killed mid-await should not leave the TUI claiming
 * someone is waiting forever.
 */
export function listRequests(id: string): AwaitRequest[] {
  const dir = paths.inboxDir(id);
  const now = Date.now();
  const out: AwaitRequest[] = [];
  for (const file of listJson(dir, 'req-')) {
    const record = readJson(join(dir, file), AwaitRequestSchema, null);
    if (!record) continue;
    if (now - Date.parse(record.created) > record.ttl_ms) {
      rmSync(join(dir, file), { force: true });
      continue;
    }
    out.push(record);
  }
  return out.sort((a, b) => a.created.localeCompare(b.created));
}

export function writeResponse(response: AwaitResponse): void {
  ensureDir(paths.inboxDir(response.plan_id));
  writeJson(paths.responseFile(response.plan_id, response.id), response);
}

export function listResponses(id: string): AwaitResponse[] {
  const dir = paths.inboxDir(id);
  const out: AwaitResponse[] = [];
  for (const file of listJson(dir, 'resp-')) {
    const record = readJson(join(dir, file), AwaitResponseSchema, null);
    if (record) out.push(record);
  }
  return out.sort((a, b) => a.created.localeCompare(b.created));
}

export function markResponseConsumed(response: AwaitResponse): void {
  response.consumed = true;
  writeResponse(response);
}

/** Unlock decisions waiting to be picked up by the `unlock-request` that blocks. */
export function pendingUnlockResponses(id: string, lockId: string): AwaitResponse[] {
  return listResponses(id).filter(
    (r) => r.kind === 'unlock' && !r.consumed && r.lock_id === lockId,
  );
}
