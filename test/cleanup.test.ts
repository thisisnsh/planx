import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runCommand } from '../src/exec/registry.js';
import { ensureBuilt } from './cli.js';
import { awaitFeedback } from '../src/protocol/await.js';
import { capture } from '../src/protocol/capture.js';
import { paths } from '../src/store/paths.js';
import { listRequests, writeFeedback } from '../src/store/queue.js';
import { FeedbackSchema } from '../src/store/types.js';
import { SAMPLE_PLAN, tempStore } from './helpers.js';

// These two cases are about what a real process does when it is signalled, so
// they drive the built binary rather than the module under vitest.
const DIST = join(import.meta.dirname, '..', 'dist');
const CLI = join(DIST, 'cli.js');

let store: ReturnType<typeof tempStore>;

beforeAll(() => {
  ensureBuilt();
}, 120_000);

beforeEach(() => {
  store = tempStore();
});
afterEach(() => {
  store.cleanup();
});

/**
 * The bug: `await` watches two directories that are themselves written to while
 * it waits, resolved its sleep on the first event, and looped with no floor. A
 * steady trickle of writes turned a 500ms poll into a spin that held a core for
 * the whole timeout.
 */
describe('await does not spin under filesystem churn', () => {
  it('burns a small fraction of a core while its watched directory is written to', async () => {
    const { planId, version } = capture({ text: SAMPLE_PLAN, title: 'spin' });
    const inbox = paths.inboxDir(planId);
    mkdirSync(inbox, { recursive: true });

    // The churn has to come from another process, or its own cost lands in the
    // cpuUsage figure and swamps the thing being measured. It stands in for
    // what really writes here mid-await: a second planx process, the TUI
    // saving feedback, the temp+rename pair of every atomic write.
    const noise = spawn(
      process.execPath,
      [
        '-e',
        `const {writeFileSync,rmSync}=require('fs');const {join}=require('path');
         setInterval(()=>{const f=join(${JSON.stringify(inbox)},'n-'+process.hrtime.bigint()+'.tmp');
         try{writeFileSync(f,'x');rmSync(f,{force:true});}catch{}},1);`,
      ],
      { stdio: 'ignore' },
    );

    try {
      const before = process.cpuUsage();
      const started = Date.now();
      const outcome = await awaitFeedback({ planId, version, timeoutSec: 3 });
      const elapsedMs = Date.now() - started;

      const used = process.cpuUsage(before);
      const cpuMs = (used.user + used.system) / 1000;

      expect(outcome.kind).toBe('timeout');
      // Measured on this workload: ~16% of wall clock before the floor, ~3%
      // after. The bound sits between the two with room for a slow machine.
      expect(cpuMs).toBeLessThan(elapsedMs * 0.08);
    } finally {
      noise.kill('SIGKILL');
    }
  });

  it('still wakes promptly when real feedback lands', async () => {
    const { planId, version } = capture({ text: SAMPLE_PLAN, title: 'wake' });

    const timer = setTimeout(() => {
      writeFeedback(
        FeedbackSchema.parse({
          id: 'fb-wake',
          plan_id: planId,
          version,
          verdict: 'revise',
          general: 'one note',
          created: new Date().toISOString(),
        }),
      );
    }, 100);

    const started = Date.now();
    const outcome = await awaitFeedback({ planId, version, timeoutSec: 10 });
    clearTimeout(timer);

    expect(outcome.kind).toBe('ready');
    // The floor must slow a spin without turning a wake into a stall.
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('returns a resumable timeout in a real process when watches fail', async () => {
    const { planId, version } = capture({ text: SAMPLE_PLAN, title: 'nowatch' });

    // Has to be a standalone process: under vitest the runner's own handles
    // keep the event loop alive and hide the bug. With every `watch` call
    // throwing, the only pending handle is the sleep timer — and while that
    // timer was unref'd the loop drained and node exited mid-await, silently,
    // instead of printing the resumable message the skill re-runs on.
    const script = join(store.dir, 'nowatch.mjs');
    writeFileSync(
      script,
      `import { rmSync } from 'node:fs';
       import { awaitFeedback } from ${JSON.stringify(join(DIST, 'protocol', 'await.js'))};
       import { paths, setStoreRoot } from ${JSON.stringify(join(DIST, 'store', 'paths.js'))};
       setStoreRoot(${JSON.stringify(store.dir)});
       // Drop the directories after await creates them, so every watch throws.
       setTimeout(() => {
         rmSync(paths.inboxDir(${JSON.stringify(planId)}), { recursive: true, force: true });
         rmSync(paths.feedbackDir(${JSON.stringify(planId)}), { recursive: true, force: true });
       }, 50);
       const outcome = await awaitFeedback({ planId: ${JSON.stringify(planId)}, version: ${version}, timeoutSec: 2 });
       console.log(outcome.kind);`,
    );

    const { code, stdout } = await run(process.execPath, [script]);
    expect(code).toBe(0);
    expect(stdout.trim()).toBe('timeout');
  });
});

/**
 * `finally` retracts the inbox request on a normal return, but never runs when
 * the process is signalled — which is how a cancelled agent left the TUI
 * insisting someone was waiting for the full 24h request TTL.
 */
describe('await retracts its request when killed', () => {
  it('removes the inbox request on SIGTERM', async () => {
    const { planId, version } = capture({ text: SAMPLE_PLAN, title: 'sigterm' });

    const child = spawn(
      process.execPath,
      [CLI, '--dir', store.dir, 'await', planId, String(version), '--timeout', '120'],
      { stdio: 'ignore' },
    );
    const closed = new Promise<{ code: number | null; signal: string | null }>((r) =>
      child.on('close', (code, signal) => r({ code, signal })),
    );

    await waitFor(() => listRequests(planId).length === 1, 20_000);
    expect(listRequests(planId)).toHaveLength(1);

    child.kill('SIGTERM');
    const { code, signal } = await closed;

    expect(listRequests(planId)).toHaveLength(0);
    expect(code === 0 && signal === null).toBe(false);
  });
});

/**
 * A spawned agent that outlives planx reparents to init and keeps running with
 * nothing left to stop it. This is the orphan case from the bug report,
 * reproduced end to end: parent planx, child agent, parent killed.
 */
describe('runCommand does not orphan its child', () => {
  it('kills the child when the parent is signalled', async () => {
    const marker = join(store.dir, 'child.pid');
    const parentScript = join(store.dir, 'parent.mjs');

    // The child writes its pid and would then sit for 60s untouched.
    const childArgs = [
      '-e',
      `require('fs').writeFileSync(process.env.MARKER, String(process.pid)); setTimeout(() => {}, 60000)`,
    ];

    writeFileSync(
      parentScript,
      `import { runCommand } from ${JSON.stringify(join(DIST, 'exec', 'registry.js'))};
       await runCommand({ cmd: process.execPath, args: ${JSON.stringify(childArgs)}, promptFile: null }, process.cwd());`,
    );

    const parent = spawn(process.execPath, [parentScript], {
      env: { ...process.env, MARKER: marker },
      stdio: 'ignore',
    });
    const parentClosed = new Promise<void>((r) => parent.on('close', () => r()));

    await waitFor(() => existsSync(marker), 20_000);
    const childPid = Number(readMarker(marker));
    expect(childPid).toBeGreaterThan(0);
    expect(alive(childPid)).toBe(true);

    parent.kill('SIGTERM');
    await parentClosed;

    // The child must go with it, not reparent to init and keep running.
    await waitFor(() => !alive(childPid), 10_000);
    expect(alive(childPid)).toBe(false);
  });

  it('removes the temp prompt directory after the child exits', async () => {
    const dir = join(store.dir, 'prompt');
    mkdirSync(dir, { recursive: true });
    const promptFile = join(dir, 'p.md');
    writeFileSync(promptFile, 'prompt');

    await runCommand({ cmd: process.execPath, args: ['-e', '0'], promptFile }, store.dir);
    expect(existsSync(promptFile)).toBe(false);
  });
});

function readMarker(file: string): string {
  return existsSync(file) ? readFileSync(file, 'utf8').trim() : '';
}

/** Signal 0 tests for existence without delivering anything. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function run(cmd: string, args: string[]): Promise<{ code: number | null; stdout: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'inherit'] });
    let stdout = '';
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.on('close', (code) => resolve({ code, stdout }));
  });
}

async function waitFor(cond: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
}
