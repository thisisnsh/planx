import { mkdirSync, symlinkSync } from 'node:fs';
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

  it('rejects an unknown word by naming both things it could have been', async () => {
    // A word that is not a command is looked up as a plan first, so the error
    // has to cover both possibilities rather than only the one it tried.
    const unknown = await cli.run(['frobnicate']);
    expect(unknown.code).toBe(2);
    expect(unknown.stderr).toContain('is not a command or a stored plan');

    // Anything starting with a dash is never a plan reference.
    const badFlag = await cli.run(['list', '--nope']);
    expect(badFlag.code).toBe(2);
    expect(badFlag.stderr).toContain('unknown flag --nope');

    const bareFlag = await cli.run(['--nope']);
    expect(bareFlag.code).toBe(2);
    expect(bareFlag.stderr).not.toContain('stored plan');
  });

  it('opens a plan named without the command in front of it', async () => {
    const id = await seed();
    await cli.run(['capture', '--plan-id', id, '--stdin'], PLAN_V2);

    const shorthand = await cli.run([id, '--print', '--plain']);
    const spelled = await cli.run(['diff', id, '--print', '--plain']);
    expect(shorthand.code).toBe(0);
    expect(shorthand.stdout).toBe(spelled.stdout);

    // A prefix resolves the same way it does everywhere else, and a version
    // positional lands where it would after `diff`.
    const prefix = await cli.run([id.slice(0, 8), 'v1', '--print', '--plain']);
    expect(prefix.code).toBe(0);
    expect(prefix.stdout).toContain('v1');
  });

  it('keeps box-drawing characters out of piped output', async () => {
    await seed();
    for (const args of [['--help'], ['list'], ['status']]) {
      const result = await cli.run(args);
      expect(result.stdout, args.join(' ')).not.toMatch(/[╭╮╰╯│]/);
    }
    const json = await cli.run(['list', '--json']);
    expect(() => JSON.parse(json.stdout)).not.toThrow();
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

describe('the review hand-off across two processes', () => {
  it('hands feedback from the reviewing process to the resuming one', async () => {
    const id = await seed();

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

    const result = await cli.run(['resume', id, 'v1']);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain(`## planx — ${id} v1 (verdict: revise)`);
    expect(result.stdout).toContain('Wrong layer. Guard belongs in the R2 write path.');
    expect(result.stdout).toContain('> Extend the snapshot-regression guard in poller.ts.');
    expect(result.stdout).toContain(`planx capture --plan-id ${id} --parent v1 --splice --stdin`);
  });

  it('carries the plan text, so a session that never saw it can revise', async () => {
    const id = await seed();
    await cli.run(['submit', id, 'v1', '--comment', '3-3:Say more here.']);

    const result = await cli.run(['resume', id, 'v1']);
    expect(result.stdout).toContain('The plan as it stands');
    expect(result.stdout).toContain('Say more here.');
  });

  it('says there is nothing to revise towards before any review', async () => {
    const id = await seed();
    const result = await cli.run(['resume', id, 'v1']);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('No review of v1 yet');
  });

  it('stops re-delivering feedback once the next version lands', async () => {
    const id = await seed();
    await cli.run(['submit', id, 'v1', '--comment', '7-7:Rework this.']);
    expect((await cli.run(['resume', id, 'v1'])).stdout).toContain('Rework this.');

    await cli.run(['capture', '--plan-id', id, '--parent', 'v1', '--stdin'], PLAN_V2);
    const after = await cli.run(['resume', id, 'v2']);
    expect(after.stdout).toContain('No review of v2 yet');
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
    expect(rejected.stderr).toContain(`planx unlock ${id} L1 --reason`);
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

  it('grants one capture through the binary, then burns', async () => {
    const id = await seed();
    await cli.run(['submit', id, 'v1', '--lock', '9-10']);

    const granted = await cli.run(['unlock', id, 'L1', '--reason', 'the flag adds no value here']);
    expect(granted.code).toBe(0);
    expect(granted.stdout).toContain('unlocked L1');
    expect(granted.stdout).toContain('the flag adds no value here');

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

  it('refuses without a reason, so the audit trail cannot be empty', async () => {
    const id = await seed();
    await cli.run(['submit', id, 'v1', '--lock', '9-10']);

    const result = await cli.run(['unlock', id, 'L1']);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('--reason is required');
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
    for (const command of ['capture', 'resume', 'submit', 'diff', 'locks', 'clean', 'doctor']) {
      expect(docs.stdout).toContain(`## \`planx ${command}\``);
    }
    expect(docs.stdout).toContain('Do not edit by hand');
    // The generator names itself in the header, but hidden commands get no section.
    expect(docs.stdout).not.toContain('## `planx __gen-cli-docs`');
  });
});
