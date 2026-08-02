import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setStoreRoot } from '../src/store/paths.js';

/**
 * A throwaway `~/.planx` for one test file.
 *
 * Every test in this suite runs against one of these. Nothing here may ever
 * touch a developer's real store — a test that deletes plans is only safe if it
 * cannot possibly be pointed at the wrong directory.
 */
export function tempStore(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'planx-test-'));
  setStoreRoot(dir);
  return {
    dir,
    cleanup: () => {
      setStoreRoot(null);
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export const SAMPLE_PLAN = `# Guard the clock regression

## Context
The poller reads a snapshot every 15 seconds.
Clocks can jump backwards across a period boundary.

## Approach
Extend the existing snapshot-regression guard in \`poller.ts\`
to also reject a cross-period backward jump.

## Rollout
Deploy behind the \`ff_clock_guard\` flag, 10% then 50% then 100%.
`;
