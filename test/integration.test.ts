import { mkdirSync, readdirSync, symlinkSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Cli, collect, ensureBuilt, PLAN_V1, PLAN_V2 } from './cli.js';

let cli: Cli;

beforeAll(() => ensureBuilt(), 120_000);
beforeEach(() => {
  cli = new Cli();
});
afterEach(() => cli.cleanup());

async function seed(): Promise<string> {
  const result = await cli.run(['capture', '--stdin', '--source', 'test'], PLAN_V1);
  const id = /captured (\S+) v1/.exec(result.stdout)?.[1];
  expect(id, result.stdout + result.stderr).toBeTruthy();
  return id!;
}

/** Wait for a condition to hold, polling — for the async handshake. */
async function until(check: () => Promise<boolean> | boolean, ms = 5000): Promise<void> {
  const deadline = Date.now() + ms;
  for (;;) {
    if (await check()) return;
    if (Date.now() > deadline) throw new Error('timed out waiting for condition');
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe('the CLI as a real process', () => {
  it('reports its version and help without a store', async () => {
    expect((await cli.run(['--version'])).stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
    const help = await cli.run(['--help']);
    expect(help.stdout).toContain('planx <command> [args]');
    expect(help.stdout).toContain('capture');
  });

  it('runs when invoked through an npm-style bin symlink', async () => {
    const binDir = join(cli.dir, 'node_modules', '.bin');
    const bin = join(binDir, 'planx');
    mkdirSync(binDir, { recursive: true });
    symlinkSync(join(process.cwd(), 'dist', 'cli.js'), bin);

    const result = await collect(spawn(bin, ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] }));

    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('rejects an unknown command and an unknown flag with usage', async () => {
    const unknown = await cli.run(['frobnicate']);
    expect(unknown.code).toBe(2);
    expect(unknown.stderr).toContain('unknown command');

    const badFlag = await cli.run(['list', '--nope']);
    expect(badFlag.code).toBe(2);
    expect(badFlag.stderr).toContain('unknown flag --nope');
  });

  it('accepts global flags before the command name', async () => {
    const result = await cli.run(['list']);
    expect(result.code).toBe(0);
  });

  it('captures from stdin and lists the plan', async () => {
    const id = await seed();
    const list = await cli.run(['list', '--json']);
    expect(JSON.parse(list.stdout)).toHaveLength(1);
    expect(JSON.parse(list.stdout)[0].id).toBe(id);
  });

  it('is a no-op when the same content is captured twice', async () => {
    const id = await seed();
    const again = await cli.run(['capture', '--plan-id', id, '--stdin'], PLAN_V1);
    expect(again.stdout).toContain('unchanged — nothing written');
    const versions = await cli.run(['versions', id, '--json']);
    expect(JSON.parse(versions.stdout)).toHaveLength(1);
  });

  it('prints a real unified diff for --print --plain', async () => {
    const id = await seed();
    await cli.run(['capture', '--plan-id', id, '--stdin'], PLAN_V2);
    const diff = await cli.run(['diff', id, '--print', '--plain']);
    expect(diff.stdout).toMatch(/^--- .*v1$/m);
    expect(diff.stdout).toMatch(/^@@ /m);
    expect(diff.stdout).toContain('-Extend the snapshot-regression guard in poller.ts.');
    expect(diff.stdout).toContain('+Extend the guard in the R2 write path, not the poller.');
  });
});

describe('the review handshake across two processes', () => {
  it('blocks in one process until another submits', async () => {
    const id = await seed();

    const waiting = cli.spawn(['await', id, 'v1', '--timeout', '20']);
    const output = collect(waiting);

    // The waiting process must announce itself on disk, or the TUI would have
    // nothing to show its "agent is waiting" banner from.
    await until(() => hasPendingRequest(id));

    const submitted = await cli.run([
      'submit',
      id,
      'v1',
      '--comment',
      '7-7:Wrong layer. Guard belongs in the R2 write path.',
      '--general',
      'Direction is fine.',
    ]);
    expect(submitted.code).toBe(0);

    const result = await output;
    expect(result.code).toBe(0);
    expect(result.stdout).toContain(`## planx feedback — ${id} v1 (verdict: revise)`);
    expect(result.stdout).toContain('Wrong layer. Guard belongs in the R2 write path.');
    expect(result.stdout).toContain('> Extend the snapshot-regression guard in poller.ts.');
    expect(result.stdout).toContain(`planx capture --plan-id ${id} --parent v1 --splice --stdin`);
  });

  function hasPendingRequest(id: string): boolean {
    try {
      return readdirSync(join(cli.dir, 'plans', id, 'inbox')).some((f) => f.startsWith('req-'));
    } catch {
      return false;
    }
  }

  it('delivers feedback left before anyone was waiting', async () => {
    const id = await seed();
    await cli.run(['submit', id, 'v1', '--comment', '3-3:Say more here.']);

    const result = await cli.run(['await', id, 'v1', '--timeout', '20']);
    expect(result.stdout).toContain('Say more here.');
  });

  it('returns a resumable message at the timeout instead of failing', async () => {
    const id = await seed();
    const result = await cli.run(['await', id, 'v1', '--timeout', '1']);
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/^PLANX: no feedback yet \(waited \d+s\) — run the same command/);
  });

  it('stops re-delivering feedback once the next version lands', async () => {
    const id = await seed();
    await cli.run(['submit', id, 'v1', '--comment', '7-7:Rework this.']);
    expect((await cli.run(['await', id, 'v1', '--timeout', '5'])).stdout).toContain('Rework this.');

    await cli.run(['capture', '--plan-id', id, '--parent', 'v1', '--stdin'], PLAN_V2);
    const after = await cli.run(['await', id, 'v2', '--timeout', '1']);
    expect(after.stdout).toContain('PLANX: no feedback yet');
  });
});

describe('lock enforcement through the binary', () => {
  it('refuses the write, exits non-zero, and leaves the store untouched', async () => {
    const id = await seed();
    await cli.run(['submit', id, 'v1', '--lock', '9-10']);

    const tampered = PLAN_V1.replace(
      'Deploy behind the `ff_clock_guard` flag, 10% then 50% then 100%.',
      'Deploy directly to 100%; the flag adds no value here.',
    );
    const rejected = await cli.run(['capture', '--plan-id', id, '--stdin'], tampered);

    expect(rejected.code).toBe(3);
    expect(rejected.stderr).toContain('was modified — version rejected');
    expect(rejected.stderr).toContain('- Deploy behind the `ff_clock_guard` flag');
    expect(rejected.stderr).toContain('+ Deploy directly to 100%');
    expect(rejected.stderr).toContain(`planx unlock-request ${id} L1 --reason`);
    expect(rejected.stderr).toContain('Nothing was written.');

    const versions = await cli.run(['versions', id, '--json']);
    expect(JSON.parse(versions.stdout)).toHaveLength(1);
  });

  it('accepts the same revision when the locked block arrives as a marker', async () => {
    const id = await seed();
    await cli.run(['submit', id, 'v1', '--lock', '9-10']);

    const skeleton = await cli.run(['show', id, '--skeleton']);
    expect(skeleton.stdout).toContain('[[planx:keep L1]]');
    expect(skeleton.stdout).not.toContain('ff_clock_guard');

    const revised = skeleton.stdout.replace(
      'Extend the snapshot-regression guard in poller.ts.',
      'Extend the guard in the R2 write path.',
    );
    const captured = await cli.run(
      ['capture', '--plan-id', id, '--parent', 'v1', '--splice', '--stdin'],
      revised,
    );
    expect(captured.code).toBe(0);
    expect(captured.stdout).toContain('v2');

    const shown = await cli.run(['show', id, '--plain']);
    expect(shown.stdout).toContain('Deploy behind the `ff_clock_guard` flag');
  });

  it('runs the unlock handshake between two processes and burns the grant', async () => {
    const id = await seed();
    await cli.run(['submit', id, 'v1', '--lock', '9-10']);

    const asking = cli.spawn([
      'unlock-request',
      id,
      'L1',
      '--reason',
      'the flag adds no value here',
      '--timeout',
      '20',
    ]);
    const output = collect(asking);
    await new Promise((r) => setTimeout(r, 400));

    const granted = await cli.run([
      'unlock-respond',
      id,
      'L1',
      '--grant',
      '--note',
      'agreed, drop it',
    ]);
    expect(granted.code).toBe(0);

    const decision = await output;
    expect(decision.stdout).toContain('granted (single use)');

    const edited = PLAN_V1.replace(
      'Deploy behind the `ff_clock_guard` flag, 10% then 50% then 100%.',
      'Deploy directly to 100%.',
    );
    expect((await cli.run(['capture', '--plan-id', id, '--stdin'], edited)).code).toBe(0);

    // Spent: the same block cannot be edited again without asking afresh.
    const second = await cli.run(
      ['capture', '--plan-id', id, '--stdin'],
      edited.replace('Deploy directly to 100%.', 'Actually roll it back.'),
    );
    expect(second.code).toBe(3);
  });

  it('reports a denial and keeps the lock', async () => {
    const id = await seed();
    await cli.run(['submit', id, 'v1', '--lock', '9-10']);

    const asking = cli.spawn(['unlock-request', id, 'L1', '--reason', 'x', '--timeout', '20']);
    const output = collect(asking);
    await new Promise((r) => setTimeout(r, 400));
    await cli.run(['unlock-respond', id, 'L1', '--deny', '--note', 'no, that was the point']);

    const decision = await output;
    expect(decision.code).toBe(4);
    expect(decision.stdout).toContain('stays locked');
  });
});

describe('approval and sealing', () => {
  it('seals every section and blocks further edits', async () => {
    const id = await seed();
    const approved = await cli.run(['submit', id, 'v1', '--approve']);
    expect(approved.stdout).toContain('sealed');

    const locks = JSON.parse((await cli.run(['locks', id, '--json'])).stdout);
    expect(locks.sealed_at).not.toBeNull();
    expect(Object.keys(locks.locks).length).toBeGreaterThanOrEqual(3);

    const blocked = await cli.run(['capture', '--plan-id', id, '--stdin'], PLAN_V2);
    expect(blocked.code).toBe(3);
  });

  it('lets the reviewer carve a hole in a sealed plan', async () => {
    const id = await seed();
    await cli.run(['submit', id, 'v1', '--approve']);
    await cli.run(['submit', id, 'v1', '--unlock', '6-7']);
    expect((await cli.run(['capture', '--plan-id', id, '--stdin'], PLAN_V2)).code).toBe(0);
  });
});

describe('retention', () => {
  it('soft deletes and restores', async () => {
    const id = await seed();
    const cleaned = await cli.run(['clean', '--id', id, '--yes']);
    expect(cleaned.stdout).toContain('1 trashed');
    expect(JSON.parse((await cli.run(['list', '--json'])).stdout)).toHaveLength(0);

    await cli.run(['restore', id]);
    expect(JSON.parse((await cli.run(['list', '--json'])).stdout)).toHaveLength(1);
    expect((await cli.run(['show', id, '--plain'])).stdout).toContain('## Approach');
  });

  it('refuses to act destructively without a terminal or --yes', async () => {
    const id = await seed();
    const result = await cli.run(['clean', '--id', id]);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('--yes');
  });

  it('keeps a version a lock still points at when trimming history', async () => {
    const id = await seed();
    await cli.run(['submit', id, 'v1', '--lock', '9-10']);
    for (const suffix of ['a', 'b', 'c']) {
      await cli.run(['capture', '--plan-id', id, '--stdin'], `${PLAN_V2}\n<!-- ${suffix} -->\n`);
    }

    await cli.run(['clean', '--id', id, '--versions-beyond', '1', '--yes']);
    const versions = JSON.parse((await cli.run(['versions', id, '--json'])).stdout);
    const kept = versions.map((v: { n: number }) => v.n);
    expect(kept).toContain(1); // the version the lock was first taken against
    expect(kept).toContain(4);
  });
});

describe('the disabled switch', () => {
  it('degrades quietly rather than failing', async () => {
    const id = await seed();
    await cli.run(['off']);

    const result = await cli.run(['capture', '--plan-id', id, '--stdin'], PLAN_V2);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('PLANX: disabled');

    // status and config keep working, or you could never turn it back on.
    expect((await cli.run(['status'])).code).toBe(0);
    await cli.run(['on']);
    expect((await cli.run(['capture', '--plan-id', id, '--stdin'], PLAN_V2)).code).toBe(0);
  });
});

describe('the generated reference', () => {
  it('documents every non-hidden command', async () => {
    const docs = await cli.run(['__gen-cli-docs']);
    expect(docs.code).toBe(0);
    for (const command of ['capture', 'await', 'submit', 'diff', 'locks', 'clean', 'execute']) {
      expect(docs.stdout).toContain(`## \`planx ${command}\``);
    }
    expect(docs.stdout).toContain('Do not edit by hand');
    // The generator names itself in the header, but hidden commands get no section.
    expect(docs.stdout).not.toContain('## `planx __gen-cli-docs`');
  });
});
