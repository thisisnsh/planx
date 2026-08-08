import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { diffVersions } from '../src/diff/lines.js';
import { setColorEnabled } from '../src/render/ansi.js';
import { renderUnified } from '../src/render/diff.js';
import { setStoreRoot } from '../src/store/paths.js';
import { readVersions, readVersionText, rewriteVersion } from '../src/store/plans.js';
import { Cli, ensureBuilt, PLAN_V1, PLAN_V2 } from './cli.js';

/**
 * `planx capture --patch`, driven as a real process against a real store.
 *
 * The point of the flag is what an agent has to emit, so the payload here is
 * written the way an agent would write it — including the ways it gets the hunk
 * header wrong.
 */

let cli: Cli;

beforeAll(() => ensureBuilt(), 120_000);
beforeEach(() => {
  cli = new Cli();
});
afterEach(() => cli.cleanup());

function inStore<T>(fn: () => T): T {
  setStoreRoot(cli.dir);
  try {
    return fn();
  } finally {
    setStoreRoot(null);
  }
}

async function seed(): Promise<string> {
  const result = await cli.run(['capture', '--stdin', '--source', 'test'], PLAN_V1);
  const id = /Captured (\S+) v1\./.exec(result.stdout)?.[1];
  expect(id, result.stdout + result.stderr).toBeTruthy();
  return id!;
}

const OLD_LINE = 'Extend the snapshot-regression guard in poller.ts.';
const NEW_LINE = 'Extend the guard in the R2 write path, not the poller.';

/** The hunk that turns PLAN_V1 into PLAN_V2, with whatever header is asked for. */
function hunk(header: string): string {
  return `${header}\n ## Approach\n-${OLD_LINE}\n+${NEW_LINE}\n`;
}

function versionsOf(id: string): number[] {
  return inStore(() => readVersions(id).versions.map((v) => v.n));
}

describe('capture --patch', () => {
  it('produces the intended version from a hunk with correct context', async () => {
    const id = await seed();

    const result = await cli.run(
      ['capture', '--plan-id', id, '--parent', 'v1', '--patch', '--stdin'],
      hunk('@@ -6,2 +6,2 @@'),
    );

    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain(`Captured ${id} v2.`);
    expect(result.stdout).toContain('Applied 1 hunk: +1 −1.');
    expect(inStore(() => readVersionText(id, 2))).toBe(PLAN_V2);
  });

  // Agents miscount line numbers constantly. jsdiff searches outward from the
  // offset in the header rather than trusting it, which absorbs that — and the
  // hunk still has to land on the line its context names, not near it.
  it('applies a hunk whose @@ offset is wrong to the right lines', async () => {
    const id = await seed();

    const result = await cli.run(
      ['capture', '--plan-id', id, '--parent', 'v1', '--patch', '--stdin'],
      hunk('@@ -1,2 +1,2 @@'),
    );

    expect(result.code, result.stderr).toBe(0);
    expect(inStore(() => readVersionText(id, 2))).toBe(PLAN_V2);
  });

  // The one failure mode this must never have is applying cleanly to the wrong
  // place, so a context line that is not there is a refusal, not a near miss.
  it('refuses a hunk whose context does not match, and writes no version', async () => {
    const id = await seed();

    const result = await cli.run(
      ['capture', '--plan-id', id, '--patch', '--stdin'],
      `@@ -6,2 +6,2 @@\n ## Approach\n-Extend the guard in the write path.\n+${NEW_LINE}\n`,
    );

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain(`hunk 1 does not match ${id} v1`);
    expect(result.stderr).toContain(`planx show ${id} v1 --plain`);
    expect(versionsOf(id)).toEqual([1]);
    expect(inStore(() => readVersionText(id, 1))).toBe(PLAN_V1);
  });

  it('names the first hunk that does not match, not the first hunk', async () => {
    const id = await seed();

    const result = await cli.run(
      ['capture', '--plan-id', id, '--patch', '--stdin'],
      `${hunk('@@ -6,2 +6,2 @@')}@@ -9,2 +9,2 @@\n ## Rollout\n-Ship it on a Friday.\n+Ship it on a Monday.\n`,
    );

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain(`hunk 2 does not match ${id} v1`);
    expect(versionsOf(id)).toEqual([1]);
  });

  it('rejects --patch without --plan-id', async () => {
    await seed();

    const result = await cli.run(['capture', '--patch', '--stdin'], hunk('@@ -6,2 +6,2 @@'));

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('--patch needs --plan-id');
  });

  it('says so rather than crashing when the payload is not a diff', async () => {
    const id = await seed();

    const result = await cli.run(
      ['capture', '--plan-id', id, '--patch', '--stdin'],
      '# Guard the clock regression\n\nJust the plan, not a patch.\n',
    );

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('planx:');
    expect(result.stderr).toContain(`planx show ${id} v1 --plain`);
    expect(versionsOf(id)).toEqual([1]);
  });

  // A patch is content-addressed like any other capture: what matters is the
  // document it produces, not that a diff was involved in producing it.
  it('hits the existing no-op when the patch reproduces the parent', async () => {
    const id = await seed();

    const result = await cli.run(
      ['capture', '--plan-id', id, '--patch', '--stdin'],
      `@@ -6,2 +6,2 @@\n ## Approach\n-${OLD_LINE}\n+${OLD_LINE}\n`,
    );

    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain(`${id} v1 unchanged — nothing written.`);
    expect(versionsOf(id)).toEqual([1]);
  });

  // `e` in the review rewrites the line inside the version file, so the base a
  // patch is built against already reads the way the reviewer settled it. An
  // agent that quotes what it originally wrote is quoting text that is gone.
  it('bases the patch on a reviewer-edited line as it now reads', async () => {
    const id = await seed();
    const settled = 'Extend the guard where the reviewer says, not the poller.';
    inStore(() => rewriteVersion(id, 1, [{ line: 7, text: settled }]));

    const stale = await cli.run(
      ['capture', '--plan-id', id, '--patch', '--stdin'],
      hunk('@@ -6,2 +6,2 @@'),
    );
    expect(stale.code).not.toBe(0);
    expect(stale.stderr).toContain(`hunk 1 does not match ${id} v1`);

    const current = await cli.run(
      ['capture', '--plan-id', id, '--patch', '--stdin'],
      `@@ -6,2 +6,2 @@\n ## Approach\n-${settled}\n+${NEW_LINE}\n`,
    );
    expect(current.code, current.stderr).toBe(0);
    expect(inStore(() => readVersionText(id, 2))).toBe(PLAN_V2);
  });

  // The read side of a revision colours its output, so a diff that went out
  // through a terminal and came back in has to parse.
  it('parses a coloured diff of its own making', async () => {
    const id = await seed();

    const result = await cli.run(
      ['capture', '--plan-id', id, '--parent', 'v1', '--patch', '--stdin'],
      coloredDiff(PLAN_V1, PLAN_V2, id),
    );

    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain(`Captured ${id} v2.`);
    expect(inStore(() => readVersionText(id, 2))).toBe(PLAN_V2);
  });
});

/** Exactly what `planx diff --plain` writes to a terminal that has colour. */
function coloredDiff(oldText: string, newText: string, id: string): string {
  setColorEnabled(true);
  try {
    const lines = renderUnified(diffVersions(oldText, newText), {
      mode: 'plain',
      oldLabel: `${id} v1`,
      newLabel: `${id} v2`,
    });
    // Escape sequences in the payload are the point of the case.
    expect(lines.join('')).toMatch(/\u001b\[/u);
    return `${lines.join('\n')}\n`;
  } finally {
    setColorEnabled(null);
  }
}
