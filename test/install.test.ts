import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runInstall, runUninstall, skillNames } from '../src/install/install.js';
import { tempStore } from './helpers.js';

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
