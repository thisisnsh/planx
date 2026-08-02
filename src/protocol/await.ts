import { watch, type FSWatcher } from 'node:fs';
import { cleanupOnSignals } from '../signals.js';
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

/**
 * Floor on how long one wait may take, however early the watcher fires.
 *
 * `fs.watch` reports *activity*, not "your answer arrived", and the directories
 * we watch are busy: every atomic write lands as a temp file plus a rename, a
 * second `await` on the same plan writes and deletes its own request, and the
 * TUI writes feedback while we are sitting here. Without a floor each of those
 * events returns from the wait instantly, the loop re-checks and re-arms with
 * no delay, and a 500ms poll becomes a spin that pins a core for the whole
 * timeout. The floor also coalesces the temp+rename pair into a single wake.
 */
const MIN_WAIT_MS = 50;

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

  // An await that is cancelled — ctrl-c, a closed terminal, a harness giving up
  // on the call — must still retract its request. Left behind, it sits in the
  // inbox for its full 24h TTL and the TUI keeps insisting an agent is waiting
  // on a process that died hours ago.
  const detach = cleanupOnSignals(() => removeRequest(planId, request.id));

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
    detach();
    removeRequest(planId, request.id);
  }
}

/**
 * Resolve on the first filesystem event in any directory, or after `ms` —
 * but never sooner than `minMs`, so an event storm cannot turn the caller's
 * loop into a spin.
 */
function sleepUntilChange(dirs: string[], ms: number, minMs = MIN_WAIT_MS): Promise<void> {
  const floor = Math.min(minMs, ms);

  return new Promise((resolve) => {
    const watchers: FSWatcher[] = [];
    const started = Date.now();
    let done = false;
    let floorTimer: ReturnType<typeof setTimeout> | undefined;

    const closeWatchers = () => {
      for (const w of watchers) {
        try {
          w.close();
        } catch {
          /* already closed */
        }
      }
      watchers.length = 0;
    };

    const settle = () => {
      clearTimeout(timer);
      clearTimeout(floorTimer);
      closeWatchers();
      resolve();
    };

    const finish = () => {
      if (done) return;
      done = true;
      // Stop listening before serving out the floor, so a burst of further
      // events cannot queue up callbacks behind us.
      closeWatchers();
      const remaining = floor - (Date.now() - started);
      if (remaining <= 0) return settle();
      floorTimer = setTimeout(settle, remaining);
    };

    // Deliberately not unref'd. This timer is the only thing guaranteed to be
    // pending when every `watch` below fails — on a missing directory, or at
    // the EMFILE ceiling — and unref'ing it there drains the event loop and
    // exits the process mid-await, silently, instead of returning the
    // resumable timeout the caller is written to expect.
    const timer = setTimeout(finish, ms);

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
