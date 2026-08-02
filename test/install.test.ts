import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runInstall, runUninstall, skillNames } from '../src/install/install.js';

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

describe('install', () => {
  it('ships only the skills this version has', () => {
    runInstall({ home, skillsOnly: true });
    expect(skillNames()).toEqual(['planx']);
    expect(existsSync(skillDir('planx'))).toBe(true);
  });

  it('copies the reference files the router branches into', () => {
    runInstall({ home, skillsOnly: true });
    const references = join(skillDir('planx'), 'references');
    for (const name of ['resume.md', 'execute.md', 'diff.md']) {
      expect(existsSync(join(references, name))).toBe(true);
    }
  });

  /**
   * Skills are copied in by name, so merging three into one would otherwise
   * leave the other two installed and loadable, telling agents to run commands
   * that no longer exist.
   */
  it('removes skills an older version installed but this one dropped', () => {
    seedInstalled('planx-diff');
    seedInstalled('planx-execute');

    const report = runInstall({ home, skillsOnly: true });

    expect(existsSync(skillDir('planx-diff'))).toBe(false);
    expect(existsSync(skillDir('planx-execute'))).toBe(false);
    expect(report.removed).toHaveLength(2);
  });

  it('leaves a hand-written skill alone, marker being the only licence to delete', () => {
    mkdirSync(skillDir('planx-mine'), { recursive: true });
    writeFileSync(join(skillDir('planx-mine'), 'SKILL.md'), 'mine\n');

    const report = runInstall({ home, skillsOnly: true });

    expect(existsSync(skillDir('planx-mine'))).toBe(true);
    expect(readFileSync(join(skillDir('planx-mine'), 'SKILL.md'), 'utf8')).toBe('mine\n');
    expect(report.removed).toHaveLength(0);
  });

  it('is idempotent', () => {
    runInstall({ home, skillsOnly: true });
    const second = runInstall({ home, skillsOnly: true });

    expect(second.removed).toHaveLength(0);
    expect(existsSync(join(skillDir('planx'), 'references', 'resume.md'))).toBe(true);
  });

  it('uninstall removes what it wrote and keeps what it did not', () => {
    mkdirSync(skillDir('planx-mine'), { recursive: true });
    writeFileSync(join(skillDir('planx-mine'), 'SKILL.md'), 'mine\n');
    runInstall({ home, skillsOnly: true });

    const report = runUninstall({ home });

    expect(existsSync(skillDir('planx'))).toBe(false);
    expect(existsSync(skillDir('planx-mine'))).toBe(true);
    expect(report.kept).toHaveLength(1);
  });
});
