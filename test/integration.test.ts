import { mkdirSync, symlinkSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildAnnotation, submitFeedback } from '../src/protocol/submit.js';
import { setStoreRoot } from '../src/store/paths.js';
import { readMeta, readVersions, readVersionText, rewriteVersion } from '../src/store/plans.js';
import { normalizedLines } from '../src/store/text.js';
import { Cli, collect, ensureBuilt, PLAN_V1, PLAN_V2 } from './cli.js';

let cli: Cli;

beforeAll(() => ensureBuilt(), 120_000);
beforeEach(() => {
  cli = new Cli();
});
afterEach(() => cli.cleanup());

/** Read part of the store the subprocesses are writing to. */
function inStore<T>(fn: () => T): T {
  setStoreRoot(cli.dir);
  try {
    return fn();
  } finally {
    setStoreRoot(null);
  }
}

interface Review {
  comments?: Array<[number, number, string]>;
  general?: string;
}

/**
 * Review a version the way the TUI does: the same wire payload, written
 * straight into the store the subprocesses are using.
 *
 * `planx submit` used to do this from a shell and went with the rest of the
 * surface nobody typed. What these tests are about survives it — the payload
 * still crosses a process boundary, written here and read back by a `planx
 * revise` running somewhere else.
 */
function review(id: string, version: number, opts: Review) {
  return inStore(() => {
    const doc = normalizedLines(readVersionText(id, version)!);
    let n = 0;
    const annotations = (opts.comments ?? []).map(([from, to, text]) =>
      buildAnnotation(doc, from, to, text, `a${++n}`),
    );
    return submitFeedback({
      planId: id,
      version,
      annotations,
      general: opts.general ?? '',
    });
  });
}

/** Which versions a plan has on the books. */
function versionsOf(id: string): number[] {
  return inStore(() => readVersions(id).versions.map((v) => v.n));
}

async function seed(): Promise<string> {
  const result = await cli.run(['capture', '--stdin', '--source', 'test'], PLAN_V1);
  const id = /Captured (\S+) v1\./.exec(result.stdout)?.[1];
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

    // `resume` was renamed with no alias, so it leaves the vocabulary the same
    // way any other word planx does not know does.
    const renamed = await cli.run(['resume']);
    expect(renamed.code).toBe(2);
    expect(renamed.stderr).toContain('"resume" is not a command or a stored plan');

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

    // A version positional lands where it would after `diff`.
    const versioned = await cli.run([id, 'v1', '--print', '--plain']);
    expect(versioned.code).toBe(0);
    expect(versioned.stdout).toContain('v1');
  });

  // `planx gu` used to open guard-clock-a3f9 while it was the only plan
  // starting with `gu`, and something else the week a second one landed.
  it('refuses a prefix rather than resolving it to a whole plan', async () => {
    const id = await seed();

    const result = await cli.run([id.slice(0, 8), '--print', '--plain']);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('is not a command or a stored plan');
    expect(result.stderr).toContain('planx list');
  });

  it('keeps box-drawing characters out of piped output', async () => {
    await seed();
    for (const args of [['--help'], ['list'], ['doctor']]) {
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

  it('records the session on every version, not only the first', async () => {
    const id = await seed();
    await cli.run(
      ['capture', '--plan-id', id, '--stdin', '--source', 'claude', '--session-id', 'sess-9'],
      PLAN_V2,
    );

    const versions = inStore(() => readVersions(id).versions);
    expect(versions.find((v) => v.n === 2)).toMatchObject({
      session_id: 'sess-9',
      agent: 'claude',
    });
  });

  it('marks a version executed, and says which one', async () => {
    const id = await seed();
    const marked = await cli.run(['executed', id, 'v1']);
    expect(marked.code).toBe(0);
    expect(marked.stdout).toContain(`Marked ${id} v1 as executed.`);
    expect(inStore(() => readMeta(id))?.executed).toMatchObject({ version: 1 });
  });

  it('is a no-op when the same content is captured twice', async () => {
    const id = await seed();
    const again = await cli.run(['capture', '--plan-id', id, '--stdin'], PLAN_V1);
    expect(again.stdout).toContain('unchanged — nothing written');
    expect(versionsOf(id)).toEqual([1]);
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

    review(id, 1, {
      comments: [[7, 7, 'Wrong layer. Guard belongs in the R2 write path.']],
      general: 'Direction is fine.',
    });

    const result = await cli.run(['revise', id, 'v1']);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain(`## planx — ${id} v1`);
    expect(result.stdout).toContain('Wrong layer. Guard belongs in the R2 write path.');
    expect(result.stdout).toContain('> Extend the snapshot-regression guard in poller.ts.');
    expect(result.stdout).toContain(`planx capture --plan-id ${id} --parent v1 --stdin`);
  });

  it('carries the feedback and the lines it quotes, but not the plan', async () => {
    const id = await seed();
    review(id, 1, { comments: [[3, 3, 'Say more here.']] });

    const result = await cli.run(['revise', id, 'v1']);
    expect(result.stdout).toContain('Say more here.');
    expect(result.stdout).toContain('> ## Context');
    expect(result.stdout).not.toContain('The plan as it stands');
    // A session that genuinely does not have the plan asks for it.
    expect((await cli.run(['show', id, 'v1', '--plain'])).stdout).toContain('## Rollout');
  });

  it('says there is nothing to revise towards before any review', async () => {
    const id = await seed();
    const result = await cli.run(['revise', id, 'v1']);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('No review of v1 yet');
  });

  /**
   * The other half of the hand-off: what the reviewer rewrote themselves. The
   * agent is told the words, not asked for them, and the comment beside them
   * quotes the line as it now reads rather than as it was written.
   */
  it('hands over a line the reviewer rewrote, and re-quotes the comment on it', async () => {
    const id = await seed();

    inStore(() =>
      rewriteVersion(id, 1, [{ line: 7, text: 'Extend the guard on the R2 write path.' }]),
    );
    review(id, 1, { comments: [[7, 7, 'Name the flag too.']] });

    const result = await cli.run(['revise', id, 'v1']);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('### Edited by the reviewer');
    expect(result.stdout).toContain('  - now: `Extend the guard on the R2 write path.`');
    // The quote follows the text on disk, which is the edited line.
    expect(result.stdout).toContain('> Extend the guard on the R2 write path.');
    expect(versionsOf(id)).toEqual([1]);

    const json = JSON.parse((await cli.run(['revise', id, 'v1', '--json'])).stdout);
    expect(json.edits).toHaveLength(1);
    expect(json.edits[0]).toMatchObject({ line: 7 });
  });

  it('stops re-delivering feedback once the next version lands', async () => {
    const id = await seed();
    review(id, 1, { comments: [[7, 7, 'Rework this.']] });
    expect((await cli.run(['revise', id, 'v1'])).stdout).toContain('Rework this.');

    await cli.run(['capture', '--plan-id', id, '--parent', 'v1', '--stdin'], PLAN_V2);
    const after = await cli.run(['revise', id, 'v2']);
    expect(after.stdout).toContain('No review of v2 yet');
  });
});

/**
 * A line whose content *is* a path or a plan id, which cannot be recased
 * without breaking it. Everything else planx prints is a sentence.
 */
const MECHANICAL = [
  /^(Store\s+)?[/~]/, //      `/Users/…/skills/planx`, `Store  ~/.planx`
  /^[a-z0-9-]+\s{2,}[/~]/, // a step row: what it acted on, then where
  /^[a-z0-9-]+ v\d+\b/, //    `guard-clock v3 unchanged — …`
  /^[a-z0-9-]+: /, //         a doctor problem, leading with the plan it is about
];

/** Assert the rule over everything a command printed, on both streams. */
function expectSentences({ stdout, stderr }: { stdout: string; stderr: string }): void {
  const lines = `${stdout}\n${stderr}`
    .split('\n')
    .map((line) => line.trim())
    // A glyph in the margin is punctuation, not the start of the sentence.
    .map((line) => line.replace(/^[✓=−!⚑]\s*/u, ''))
    .filter((line) => line.length > 0 && !MECHANICAL.some((exempt) => exempt.test(line)));

  expect(lines.length).toBeGreaterThan(0);
  for (const line of lines) {
    expect(line, line).toMatch(/^[A-Z]/);
    expect(line, line).toMatch(/[.?]$/);
  }
}

describe('every line planx prints is a sentence', () => {
  it('holds through capture, doctor, add-skills and remove-skills', async () => {
    const id = await seed();
    expectSentences(await cli.run(['capture', '--plan-id', id, '--stdin'], PLAN_V2));
    expectSentences(await cli.run(['doctor']));

    // `--local`, and the harness runs planx in the temp store's directory, so
    // these write nowhere near the checkout or the real ~/.claude.
    expectSentences(await cli.run(['add-skills', '--local']));
    expectSentences(await cli.run(['remove-skills', '--local']));
    expectSentences(await cli.run(['remove-skills', '--local']));
  });
});

describe('the generated reference', () => {
  it('documents every non-hidden command', async () => {
    const docs = await cli.run(['__gen-cli-docs']);
    expect(docs.code).toBe(0);
    for (const command of [
      'capture',
      'revise',
      'executed',
      'diff',
      'show',
      'list',
      'update',
      'doctor',
    ]) {
      expect(docs.stdout).toContain(`## \`planx ${command}\``);
    }
    expect(docs.stdout).toContain('Do not edit by hand');
    // The generator names itself in the header, but hidden commands get no section.
    expect(docs.stdout).not.toContain('## `planx __gen-cli-docs`');
    expect(docs.stdout).not.toContain('## `planx __update-check`');

    // Ten sections — twelve commands, two of them hidden — and the ones that
    // were cut are not among them.
    expect(docs.stdout.match(/^## `planx /gm)).toHaveLength(10);
    for (const gone of ['submit', 'versions', 'restore', 'clean', 'rename', 'import', 'config']) {
      expect(docs.stdout, gone).not.toContain(`## \`planx ${gone}\``);
    }
  });
});
