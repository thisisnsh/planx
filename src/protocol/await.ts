import { watch, type FSWatcher } from 'node:fs';
import { ensureDir } from '../store/atomic.js';
import { ulid } from '../store/ids.js';
import { paths } from '../store/paths.js';
import {
  listRequests,
  markFeedbackDelivered,
  markResponseConsumed,
  openFeedback,
  pendingUnlockResponses,
  removeRequest,
  writeRequest,
} from '../store/queue.js';
import { AwaitRequestSchema, type AwaitRequest, type Feedback } from '../store/types.js';

/**
 * Poll interval backing up `fs.watch`.
 *
 * `fs.watch` is not dependable everywhere — it misses events on some network
 * filesystems and coalesces them oddly under macOS FSEvents. The watcher makes
 * the common case instant; the poll makes the uncommon case merely slow instead
 * of broken (PLAN §5).
 */
const POLL_MS = 500;

export type AwaitOutcome<T> = { kind: 'ready'; value: T } | { kind: 'timeout'; waitedSec: number };

/**
 * Block until `check` returns something, or the timeout slice elapses.
 *
 * The timeout is a *slice*, not a deadline: Claude Code caps a Bash call at
 * 600s, so `await` returns a resumable message rather than dying, and the skill
 * re-runs it. All state is on disk, so re-running costs nothing (PLAN §2).
 */
async function awaitOn<T>(
  planId: string,
  request: AwaitRequest,
  check: () => T | null,
  timeoutSec: number,
): Promise<AwaitOutcome<T>> {
  ensureDir(paths.inboxDir(planId));
  ensureDir(paths.feedbackDir(planId));

  // Check before announcing: feedback left before anyone was waiting should
  // return immediately rather than after a full poll interval.
  const early = check();
  if (early !== null) return { kind: 'ready', value: early };

  writeRequest(request);
  const started = Date.now();
  const deadline = started + timeoutSec * 1000;

  try {
    for (;;) {
      const value = check();
      if (value !== null) return { kind: 'ready', value };

      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        return { kind: 'timeout', waitedSec: Math.round((Date.now() - started) / 1000) };
      }
      await sleepUntilChange(
        [paths.inboxDir(planId), paths.feedbackDir(planId)],
        Math.min(POLL_MS, remaining),
      );
    }
  } finally {
    removeRequest(planId, request.id);
  }
}

/** Resolve on the first filesystem event in any directory, or after `ms`. */
function sleepUntilChange(dirs: string[], ms: number): Promise<void> {
  return new Promise((resolve) => {
    const watchers: FSWatcher[] = [];
    let done = false;

    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      for (const w of watchers) {
        try {
          w.close();
        } catch {
          /* already closed */
        }
      }
      resolve();
    };

    const timer = setTimeout(finish, ms);
    // Do not hold the event loop open on the timer alone; the caller's loop
    // decides when this process is finished.
    timer.unref?.();

    for (const dir of dirs) {
      try {
        const w = watch(dir, finish);
        w.on('error', finish);
        watchers.push(w);
      } catch {
        // Watching is the optimisation; the timeout is the guarantee.
      }
    }
  });
}

function baseRequest(planId: string, version: number, kind: AwaitRequest['kind']): AwaitRequest {
  return AwaitRequestSchema.parse({
    id: ulid(),
    kind,
    plan_id: planId,
    version,
    created: new Date().toISOString(),
    pid: process.pid,
    cwd: process.cwd(),
  });
}

export interface AwaitFeedbackOptions {
  planId: string;
  version: number;
  timeoutSec: number;
}

/**
 * Wait for review feedback on a version.
 *
 * Returns every open feedback record, not just one: you can leave three
 * separate rounds of notes before the agent next looks, and it should see all
 * of them.
 */
export async function awaitFeedback(opts: AwaitFeedbackOptions): Promise<AwaitOutcome<Feedback[]>> {
  const request = baseRequest(opts.planId, opts.version, 'review');

  const outcome = await awaitOn(
    opts.planId,
    request,
    () => {
      const open = openFeedback(opts.planId);
      return open.length ? open : null;
    },
    opts.timeoutSec,
  );

  if (outcome.kind === 'ready') {
    for (const record of outcome.value) {
      markFeedbackDelivered(opts.planId, record.id, request.id);
    }
  }
  return outcome;
}

export interface UnlockDecision {
  granted: boolean;
  grantId: string | null;
  note: string;
  lockId: string;
}

export interface AwaitUnlockOptions {
  planId: string;
  version: number;
  lockId: string;
  reason: string;
  proposed?: string;
  timeoutSec: number;
}

/** Raise an unlock request and block on the same machinery until it is decided. */
export async function awaitUnlockDecision(
  opts: AwaitUnlockOptions,
): Promise<AwaitOutcome<UnlockDecision>> {
  const request = baseRequest(opts.planId, opts.version, 'unlock');
  request.lock_id = opts.lockId;
  request.reason = opts.reason;
  request.proposed = opts.proposed ?? '';

  return awaitOn(
    opts.planId,
    request,
    () => {
      const [response] = pendingUnlockResponses(opts.planId, opts.lockId);
      if (!response) return null;
      markResponseConsumed(response);
      return {
        granted: response.granted === true,
        grantId: response.grant_id,
        note: response.note,
        lockId: opts.lockId,
      };
    },
    opts.timeoutSec,
  );
}

/** Requests currently blocking, for the TUI banner. */
export function pendingRequests(planId: string): AwaitRequest[] {
  return listRequests(planId);
}

export function timeoutMessage(waitedSec: number): string {
  return `PLANX: no feedback yet (waited ${waitedSec}s) — run the same command again to keep waiting`;
}
