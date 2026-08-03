import { cpSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureDir } from '../store/atomic.js';
import { ensureConfig } from '../store/config.js';
import { paths } from '../store/paths.js';
import { ensureStore } from '../store/plans.js';

/** Directories `planx install` will write skills into, relative to $HOME. */
const TARGETS: Array<{ agent: string; dir: string }> = [
  { agent: 'claude', dir: '.claude/skills' },
  { agent: 'codex', dir: '.codex/skills' },
];

const MARKER = '.planx-installed';

/** Locate the packaged `skills/` directory from wherever this file ended up. */
export function skillsSource(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // dist/install/install.js → package root, and src/install/install.ts likewise.
  const candidates = [
    resolve(here, '..', '..', 'skills'),
    resolve(here, '..', '..', '..', 'skills'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error('planx: cannot find the packaged skills directory');
}

export function skillNames(): string[] {
  return readdirSync(skillsSource(), { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.startsWith('planx'))
    .map((e) => e.name)
    .sort();
}

export interface InstallOptions {
  /** Write into ./.claude/skills instead of $HOME, for a repo-local install. */
  local?: boolean;
  /** Only these agents; defaults to all of them. */
  agents?: string[];
  home?: string;
  cwd?: string;
  postinstall?: boolean;
  skillsOnly?: boolean;
}

export interface InstallReport {
  wrote: string[];
  seeded: string[];
  skipped: string[];
  /** Skills an older version installed that this one no longer ships. */
  removed: string[];
}

/**
 * Install skills and seed the store.
 *
 * It writes skills and `~/.planx`, and touches **no agent settings files at
 * all**. With the ExitPlanMode hook dropped there is nothing planx needs from
 * `~/.claude/settings.json`, which removes the merge logic, the backup, and the
 * conflict handling that would otherwise be the riskiest thing in the package.
 *
 * Idempotent by construction: it copies the same files to the same paths and
 * leaves a marker so `uninstall` removes only what it wrote.
 */
export function runInstall(opts: InstallOptions = {}): InstallReport {
  const report: InstallReport = { wrote: [], seeded: [], skipped: [], removed: [] };
  const source = skillsSource();
  const names = skillNames();

  for (const target of TARGETS) {
    if (opts.agents?.length && !opts.agents.includes(target.agent)) continue;

    const base = opts.local
      ? join(opts.cwd ?? process.cwd(), target.dir)
      : join(opts.home ?? homedir(), target.dir);

    // Only install into an agent that is actually present, unless the user
    // asked for it by name. Creating ~/.codex on a machine with no Codex is
    // litter.
    const agentHome = dirname(base);
    if (!opts.local && !opts.agents?.length && !existsSync(agentHome)) {
      report.skipped.push(`${target.agent} (${agentHome} does not exist)`);
      continue;
    }

    for (const name of names) {
      const dest = join(base, name);
      ensureDir(dest);
      cpSync(join(source, name), dest, { recursive: true });
      writeFileSync(join(dest, MARKER), `${new Date().toISOString()}\n`, 'utf8');
      report.wrote.push(dest);
    }

    report.removed.push(...sweepRetired(base, names));
  }

  if (!opts.skillsOnly) {
    ensureStore();
    ensureConfig();
    report.seeded.push(paths.root());
  }

  return report;
}

/**
 * Delete skills a previous install wrote that this version no longer ships.
 *
 * Skills are copied in by name, so a renamed or merged one would otherwise sit
 * in the user's agent directory forever, still listed and still loadable — and
 * `planx-diff` telling an agent to run a command that no longer exists is worse
 * than it not being there at all. Only marker-bearing directories are touched:
 * anything the user wrote by hand keeps the same protection uninstall gives it.
 */
function sweepRetired(base: string, shipped: readonly string[]): string[] {
  if (!existsSync(base)) return [];
  const removed: string[] = [];
  for (const entry of readdirSync(base, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith('planx')) continue;
    if (shipped.includes(entry.name)) continue;
    const dir = join(base, entry.name);
    if (!existsSync(join(dir, MARKER))) continue;
    rmSync(dir, { recursive: true, force: true });
    removed.push(dir);
  }
  return removed;
}

export interface UninstallReport {
  removed: string[];
  kept: string[];
}

/**
 * Remove what install wrote, and nothing else.
 *
 * A skill directory without the marker was put there by hand, so it is left
 * alone and reported. Deleting someone's own customisation because it shares a
 * name would be unforgivable for an uninstall step.
 */
export function runUninstall(opts: InstallOptions = {}): UninstallReport {
  const report: UninstallReport = { removed: [], kept: [] };

  for (const target of TARGETS) {
    const base = opts.local
      ? join(opts.cwd ?? process.cwd(), target.dir)
      : join(opts.home ?? homedir(), target.dir);
    if (!existsSync(base)) continue;

    for (const entry of readdirSync(base, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.startsWith('planx')) continue;
      const dir = join(base, entry.name);
      if (existsSync(join(dir, MARKER))) {
        rmSync(dir, { recursive: true, force: true });
        report.removed.push(dir);
      } else {
        report.kept.push(dir);
      }
    }
  }

  return report;
}

/** Read a packaged skill's front matter description, for the install summary. */
export function describeSkill(name: string): string {
  try {
    const text = readFileSync(join(skillsSource(), name, 'SKILL.md'), 'utf8');
    const match = /^description:\s*(.+)$/m.exec(text);
    return match?.[1]?.trim() ?? '';
  } catch {
    return '';
  }
}
