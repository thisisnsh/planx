import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ensureDir, readJson, writeJson } from './atomic.js';
import { paths } from './paths.js';
import { FeedbackSchema, type Feedback } from './types.js';

/**
 * Review records on disk, one file per submit.
 *
 * This was a queue while `await` existed, with delivery tracking and an open
 * set, because an agent blocked on it and had to be told what it had not seen
 * yet. Nothing blocks now: the reviewer hands over a command and the agent
 * reads. What is left is storage.
 */

function listJson(dir: string, prefix: string): string[] {
  try {
    return readdirSync(dir)
      .filter((f) => f.startsWith(prefix) && f.endsWith('.json'))
      .sort();
  } catch {
    return [];
  }
}

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
  // Ids are monotonic ULIDs, so they break a same-millisecond tie in creation
  // order rather than arbitrarily. "The reviewer's latest verdict" depends on
  // this being a total order.
  return out.sort((a, b) => a.created.localeCompare(b.created) || a.id.localeCompare(b.id));
}

/** Close every open feedback record once a newer version lands. */
export function markFeedbackAddressed(id: string, byVersion: number): number {
  let closed = 0;
  for (const record of listFeedback(id)) {
    if (record.addressed_by !== null || record.version >= byVersion) continue;
    record.addressed_by = byVersion;
    writeFeedback(record);
    closed++;
  }
  return closed;
}
