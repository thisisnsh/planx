import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runCommand } from '../src/exec/registry.js';
import { ensureBuilt } from './cli.js';
import { tempStore } from './helpers.js';

// This is about what a real process does when it is signalled, so it drives the
// built binary rather than the module under vitest.
const DIST = join(import.meta.dirname, '..', 'dist');

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

async function waitFor(cond: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
}
