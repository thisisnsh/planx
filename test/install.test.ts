import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runInstall, runUninstall, skillNames } from '../src/install/install.js';
import { tempStore } from './helpers.js';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const MARKER = '.planx-installed';

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'planx-home-'));
  mkdirSync(join(home, '.claude', 'skills'), { recursive: true });
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

function skillDir(name: string): string {
  return join(home, '.claude', 'skills', name);
}

/** A skill an older planx installed, marker and all. */
function seedInstalled(name: string): void {
  mkdirSync(skillDir(name), { recursive: true });
  writeFileSync(join(skillDir(name), 'SKILL.md'), 'old\n');
  writeFileSync(join(skillDir(name), MARKER), 'old\n');
}

describe('add-skills', () => {
  it('ships only the skills this version has', async () => {
    await runInstall({ home, noStore: true });
    expect(skillNames()).toEqual(['planx']);
    expect(existsSync(skillDir('planx'))).toBe(true);
  });

  it('copies the reference files the router branches into', async () => {
    await runInstall({ home, noStore: true });
    const references = join(skillDir('planx'), 'references');
    for (const name of ['revise.md', 'execute.md', 'diff.md']) {
      expect(existsSync(join(references, name))).toBe(true);
    }
  });

  /**
   * Skills are copied in by name, so merging three into one would otherwise
   * leave the other two installed and loadable, telling agents to run commands
   * that no longer exist.
   */
  it('removes skills an older version installed but this one dropped', async () => {
    seedInstalled('planx-diff');
    seedInstalled('planx-execute');

    const report = await runInstall({ home, noStore: true });

    expect(existsSync(skillDir('planx-diff'))).toBe(false);
    expect(existsSync(skillDir('planx-execute'))).toBe(false);
    expect(report.removed).toHaveLength(2);
  });

  it('leaves a hand-written skill alone, marker being the only licence to delete', async () => {
    mkdirSync(skillDir('planx-mine'), { recursive: true });
    writeFileSync(join(skillDir('planx-mine'), 'SKILL.md'), 'mine\n');

    const report = await runInstall({ home, noStore: true });

    expect(existsSync(skillDir('planx-mine'))).toBe(true);
    expect(readFileSync(join(skillDir('planx-mine'), 'SKILL.md'), 'utf8')).toBe('mine\n');
    expect(report.removed).toHaveLength(0);
  });

  it('is idempotent', async () => {
    await runInstall({ home, noStore: true });
    const second = await runInstall({ home, noStore: true });

    expect(second.removed).toHaveLength(0);
    expect(existsSync(join(skillDir('planx'), 'references', 'revise.md'))).toBe(true);
  });

  /**
   * `cpSync` overwrites what the source has and never removes what it does
   * not, so renaming a reference file used to leave the old one installed —
   * loadable, and telling an agent to run a command that no longer exists.
   */
  it('replaces an installed skill rather than copying over it', async () => {
    await runInstall({ home, noStore: true });
    const stale = join(skillDir('planx'), 'references', 'retired.md');
    writeFileSync(stale, 'run `planx retired`\n');

    await runInstall({ home, noStore: true });

    expect(existsSync(stale)).toBe(false);
    expect(existsSync(join(skillDir('planx'), 'SKILL.md'))).toBe(true);
  });

  it('leaves a hand-written skill directory of the same name untouched', async () => {
    mkdirSync(join(home, '.claude', 'skills', 'planx'), { recursive: true });
    writeFileSync(join(skillDir('planx'), 'SKILL.md'), 'mine\n');
    writeFileSync(join(skillDir('planx'), 'notes.md'), 'mine too\n');

    await runInstall({ home, noStore: true });

    // No marker, so nothing was deleted: the copy landed on top, and what the
    // package does not ship survived.
    expect(readFileSync(join(skillDir('planx'), 'notes.md'), 'utf8')).toBe('mine too\n');
  });

  it('remove-skills removes what it wrote and keeps what it did not', async () => {
    mkdirSync(skillDir('planx-mine'), { recursive: true });
    writeFileSync(join(skillDir('planx-mine'), 'SKILL.md'), 'mine\n');
    await runInstall({ home, noStore: true });

    const report = await runUninstall({ home });

    expect(existsSync(skillDir('planx'))).toBe(false);
    expect(existsSync(skillDir('planx-mine'))).toBe(true);
    expect(report.kept).toHaveLength(1);
  });

  /**
   * The store is not a skill. `remove-skills` never deletes it on its own —
   * deleting every plan the user ever wrote is a question, asked on screen with
   * the path and the count in it, and a non-interactive run never even asks.
   */
  it('remove-skills leaves the store alone', async () => {
    const store = tempStore();
    await runInstall({ home });
    expect(existsSync(store.dir)).toBe(true);

    await runUninstall({ home });

    expect(existsSync(store.dir)).toBe(true);
    store.cleanup();
  });
});

describe('the step-by-step report', () => {
  /**
   * Each step is handed over before its work runs and completed after, so a
   * screen pacing itself between the two can never say `written` about a file
   * that is not there yet.
   */
  it('reports each step, and the outcome only once the work is done', async () => {
    const seen: string[] = [];
    await runInstall({
      home,
      noStore: true,
      onStep: async (step, work) => {
        seen.push(`${step.group}/${step.label ?? step.path}: started`);
        const outcome = work();
        seen.push(`${step.group}/${step.label ?? step.path}: ${outcome.note}`);
      },
    });

    expect(seen[0]).toBe('Detecting agents/claude: started');
    expect(seen[1]).toBe('Detecting agents/claude: found');
    // ~/.codex was never created, so it is reported rather than conjured up.
    expect(seen).toContain('Detecting agents/codex: not installed');
    expect(seen).toContain('Writing skills/planx: written');
    expect(seen.some((line) => line.startsWith('Seeding the store'))).toBe(false);
  });

  it('seeds the store as its own step, unless --no-store', async () => {
    const store = tempStore();
    const groups: string[] = [];
    await runInstall({
      home,
      onStep: async (step, work) => void (groups.push(step.group), work()),
    });

    expect(groups).toContain('Seeding the store');
    expect(existsSync(store.dir)).toBe(true);
    store.cleanup();
  });
});

/**
 * The postinstall script, driven as npm drives it: a real process, with a real
 * `dist/` behind it. It is the one part of the package that runs on someone
 * else's machine without being asked, so what it does when things are wrong
 * matters more than what it does when they are right.
 */
describe('the postinstall script', () => {
  const SCRIPT = join(ROOT, 'scripts', 'postinstall.js');

  /**
   * A copy of the package with `dist/` in it and no `src/`, which is what npm
   * unpacks — the `src/cli.ts` guard would otherwise skip every run.
   */
  function packed(cli: string): string {
    const dir = mkdtempSync(join(tmpdir(), 'planx-pack-'));
    mkdirSync(join(dir, 'scripts'), { recursive: true });
    mkdirSync(join(dir, 'dist'), { recursive: true });
    cpSync(SCRIPT, join(dir, 'scripts', 'postinstall.js'));
    writeFileSync(join(dir, 'dist', 'cli.js'), cli, 'utf8');
    return dir;
  }

  function run(dir: string, env: NodeJS.ProcessEnv = {}): SpawnSyncReturns<string> {
    return spawnSync(process.execPath, [join(dir, 'scripts', 'postinstall.js')], {
      encoding: 'utf8',
      env: { ...process.env, PLANX_NO_POSTINSTALL: '', ...env },
    });
  }

  it('runs add-skills', () => {
    const dir = packed(`console.log('ran ' + process.argv.slice(2).join(' '));`);
    const result = run(dir);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('ran add-skills');
    rmSync(dir, { recursive: true, force: true });
  });

  /**
   * A skill that could not be written is worth saying out loud, and worth
   * nothing at all as a reason to fail `npm install -g`.
   */
  it('exits 0 even when add-skills fails', () => {
    const dir = packed(`console.error('no agent directory'); process.exit(1);`);
    const result = run(dir);

    expect(result.status).toBe(0);
    expect(result.stderr).toContain('no agent directory');
    rmSync(dir, { recursive: true, force: true });
  });

  it('says what to run when dist is missing, and still exits 0', () => {
    const dir = packed('unused');
    rmSync(join(dir, 'dist'), { recursive: true, force: true });
    const result = run(dir);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('planx add-skills');
    rmSync(dir, { recursive: true, force: true });
  });

  it('is silenced by PLANX_NO_POSTINSTALL', () => {
    const dir = packed(`console.log('ran');`);
    const result = run(dir, { PLANX_NO_POSTINSTALL: '1' });

    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
    rmSync(dir, { recursive: true, force: true });
  });

  /**
   * `npm install` in a checkout of planx itself is a dev install. Rewriting a
   * developer's real ~/.claude skills from their working tree, mid-branch, is
   * not something they asked for.
   */
  it('does nothing in a source checkout', () => {
    const dir = packed(`console.log('ran');`);
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'src', 'cli.ts'), '// a checkout\n', 'utf8');
    const result = run(dir);

    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');

    // Unless it is asked, which is how the script itself gets tested.
    expect(run(dir, { PLANX_FORCE_POSTINSTALL: '1' }).stdout).toContain('ran');
    rmSync(dir, { recursive: true, force: true });
  });
});
