import { splitLines } from '../diff/lines.js';
import {
  addVersion,
  createPlan,
  latestVersion,
  readMeta,
  reindex,
  resolvePlanRef,
  resolveVersionRef,
  writeMeta,
} from '../store/plans.js';
import { markFeedbackAddressed } from '../store/feedback.js';

export interface CaptureOptions {
  text: string;
  /** Existing plan to append to. Omitted for the first capture of a new plan. */
  planId?: string | null;
  title?: string | null;
  /** Version this revises. Defaults to the latest. */
  parent?: string | null;
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
 * Write a version of a plan.
 *
 * Capturing content byte-identical to the current latest is a no-op that
 * returns that version, so a skill can call this defensively without forking a
 * duplicate into the history.
 */
export function capture(opts: CaptureOptions): CaptureResult {
  const isNewPlan = !opts.planId;
  const title = opts.title?.trim() || deriveTitle(opts.text);

  let planId: string;
  if (opts.planId) {
    planId = resolvePlanRef(opts.planId);
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

  const added = addVersion(planId, opts.text, {
    author: opts.author ?? 'agent',
    agent: opts.agent ?? null,
    parent: resolveParent(planId, opts.parent),
    note: opts.note ?? null,
  });

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
    closedFeedback,
  };
}

function resolveParent(planId: string, parent: string | null | undefined): number | null {
  const latest = latestVersion(planId);
  if (latest === 0) return null;
  if (!parent) return latest;
  return resolveVersionRef(planId, parent);
}
