import { readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { ensureDir, readJson, writeJson } from './atomic.js';
import { paths } from './paths.js';
import { FeedbackSchema, type Annotation, type Feedback } from './types.js';

/**
 * Review records on disk, one file per version.
 *
 * This was a queue while `await` existed, with delivery tracking and an open
 * set, because an agent blocked on it and had to be told what it had not seen
 * yet. Nothing blocks now: the reviewer hands over a command and the agent
 * reads. What is left is storage.
 *
 * It was then one file per *submit*, which stopped working the moment the
 * review started loading feedback back in: opening v3, changing one comment and
 * submitting again would have appended a second record saying almost the same
 * thing. Feedback belongs to a version, so the file does too — rewritten in
 * place with exactly what the review holds, deletions included.
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

/** `v3-01J….json` — what an older planx wrote, one per submit. */
function legacyFiles(dir: string, version: number): string[] {
  return listJson(dir, `v${version}-`);
}

/**
 * Write a version's feedback, replacing whatever was there.
 *
 * The legacy files for that version go with it, so a store written by an
 * earlier planx collapses to the new shape the first time you submit on it —
 * and cannot then resurrect a comment the reviewer just deleted.
 */
export function writeFeedback(feedback: Feedback): void {
  const dir = paths.feedbackDir(feedback.plan_id);
  ensureDir(dir);
  writeJson(paths.feedbackFile(feedback.plan_id, feedback.version), feedback);
  for (const file of legacyFiles(dir, feedback.version)) {
    rmSync(join(dir, file), { force: true });
  }
}

/** The id already on this version's record, so a rewrite keeps it. */
export function feedbackIdFor(id: string, version: number): string | null {
  return listFeedback(id).find((f) => f.version === version)?.id ?? null;
}

/**
 * Every version's feedback, oldest first, both file shapes read.
 *
 * A version left with several legacy records merges into one: annotations are
 * keyed by id so a later submit's edit replaces the earlier text rather than
 * doubling it, and the last verdict is the reviewer's current position. The
 * note survives from whichever submit last carried one — an old record's note
 * is not evidence that a later empty one deleted it, because deleting a note
 * was not something the old shape could express.
 */
export function listFeedback(id: string): Feedback[] {
  const dir = paths.feedbackDir(id);
  const records: Feedback[] = [];
  for (const file of listJson(dir, 'v')) {
    const record = readJson(join(dir, file), FeedbackSchema, null);
    if (record) records.push(record);
  }
  // Ids are monotonic ULIDs, so they break a same-millisecond tie in creation
  // order rather than arbitrarily. "The reviewer's latest verdict" depends on
  // this being a total order.
  records.sort((a, b) => a.created.localeCompare(b.created) || a.id.localeCompare(b.id));

  const merged = new Map<number, Feedback>();
  for (const record of records) {
    const earlier = merged.get(record.version);
    if (!earlier) {
      merged.set(record.version, { ...record, annotations: [...record.annotations] });
      continue;
    }
    const byId = new Map<string, Annotation>(earlier.annotations.map((a) => [a.id, a]));
    for (const annotation of record.annotations) byId.set(annotation.id, annotation);
    merged.set(record.version, {
      ...earlier,
      annotations: [...byId.values()],
      verdict: record.verdict,
      general: record.general.trim() ? record.general : earlier.general,
      created: record.created,
      addressed_by: record.addressed_by ?? earlier.addressed_by,
    });
  }

  return [...merged.values()].sort((a, b) => a.version - b.version);
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
