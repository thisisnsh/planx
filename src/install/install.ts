import { cpSync, existsSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureDir } from '../store/atomic.js';
import { ensureConfig } from '../store/config.js';
import { paths } from '../store/paths.js';
import { ensureStore } from '../store/plans.js';

/** Directories `planx add-skills` will write skills into, relative to $HOME. */
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

/**
 * One thing the command is doing, reported as it happens.
 *
 * The work is the same either way; this is how the screen learns about it. A
 * runner is handed the step before the work starts and the outcome after it
 * finishes, so a row can never say `written` about a file that is not on disk —
 * whatever pacing the screen adds happens on the near side of the work.
 */
export interface StepOutcome {
  note: string;
  /** Did the step do the thing? A skip is not a failure, but it is not green. */
  ok?: boolean;
}

export interface StepDescriptor {
  group: string;
  label?: string;
  path?: string;
}

export type StepRunner = (step: StepDescriptor, work: () => StepOutcome) => Promise<void>;

/** No screen: do the work, keep the outcome, waste no time on either. */
const RUN_NOW: StepRunner = async (_step, work) => {
  work();
};

export interface InstallOptions {
  /** Write into ./.claude/skills instead of $HOME, for a repo-local install. */
  local?: boolean;
  /** Only these agents; defaults to all of them. */
  agents?: string[];
  home?: string;
  cwd?: string;
  /** Write skills but leave `~/.planx` alone. */
  noStore?: boolean;
  /** Where the step-by-step screen hears about the work. */
  onStep?: StepRunner;
}

export interface InstallReport {
  wrote: string[];
  seeded: string[];
  skipped: string[];
  /** Skills an older version installed that this one no longer ships. */
  removed: string[];
  /** Agents that ended up with skills, for the closing line. */
  agents: string[];
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
 * leaves a marker so `remove-skills` removes only what it wrote. It *replaces*
 * rather than layers, so running it again genuinely upgrades a skill instead of
 * merging the new one over the old.
 *
 * npm runs it after every install, which is why the idempotence and the marker
 * matter: an upgrade has to leave the skills matching the CLI now on the PATH
 * without touching a `planx` skill somebody wrote by hand.
 */
export async function runInstall(opts: InstallOptions = {}): Promise<InstallReport> {
  const report: InstallReport = { wrote: [], seeded: [], skipped: [], removed: [], agents: [] };
  const step = opts.onStep ?? RUN_NOW;
  const source = skillsSource();
  const names = skillNames();

  const chosen: Array<{ agent: string; base: string }> = [];
  for (const target of TARGETS) {
    if (opts.agents?.length && !opts.agents.includes(target.agent)) continue;

    const base = opts.local
      ? join(opts.cwd ?? process.cwd(), target.dir)
      : join(opts.home ?? homedir(), target.dir);

    // Only install into an agent that is actually present, unless the user
    // asked for it by name. Creating ~/.codex on a machine with no Codex is
    // litter.
    const agentHome = dirname(base);
    await step({ group: 'Detecting agents', label: target.agent, path: agentHome }, () => {
      if (!opts.local && !opts.agents?.length && !existsSync(agentHome)) {
        report.skipped.push(`${target.agent} (${agentHome} does not exist)`);
        return { note: 'not installed', ok: false };
      }
      chosen.push({ agent: target.agent, base });
      return { note: 'found', ok: true };
    });
  }

  for (const { agent, base } of chosen) {
    for (const name of names) {
      const dest = join(base, name);
      await step({ group: 'Writing skills', label: name, path: base }, () => {
        // `cpSync` overwrites what the source still has and never removes what
        // it does not, so a renamed reference file would sit in every existing
        // install forever, loadable and pointing at a command that is gone.
        // That is the failure `retiredIn` prevents one directory up; this is
        // the same thing one level down, inside the skill.
        //
        // Gated on the marker, so a hand-written `planx` skill is never
        // destroyed — the protection `runUninstall` already gives it.
        if (existsSync(join(dest, MARKER))) rmSync(dest, { recursive: true, force: true });
        ensureDir(dest);
        cpSync(join(source, name), dest, { recursive: true });
        writeFileSync(join(dest, MARKER), `${new Date().toISOString()}\n`, 'utf8');
        report.wrote.push(dest);
        return { note: 'written', ok: true };
      });
    }

    for (const dir of retiredIn(base, names)) {
      await step({ group: 'Writing skills', label: basename(dir), path: base }, () => {
        rmSync(dir, { recursive: true, force: true });
        report.removed.push(dir);
        return { note: 'retired', ok: true };
      });
    }
    report.agents.push(agent);
  }

  if (!opts.noStore) {
    await step({ group: 'Seeding the store', path: paths.root() }, () => {
      ensureStore();
      ensureConfig();
      report.seeded.push(paths.root());
      return { note: 'ready', ok: true };
    });
  }

  return report;
}

/**
 * Skills a previous install wrote that this version no longer ships.
 *
 * Skills are copied in by name, so a renamed or merged one would otherwise sit
 * in the user's agent directory forever, still listed and still loadable — and
 * `planx-diff` telling an agent to run a command that no longer exists is worse
 * than it not being there at all. Only marker-bearing directories are listed:
 * anything the user wrote by hand keeps the same protection removal gives it.
 */
function retiredIn(base: string, shipped: readonly string[]): string[] {
  if (!existsSync(base)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(base, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith('planx')) continue;
    if (shipped.includes(entry.name)) continue;
    const dir = join(base, entry.name);
    if (!existsSync(join(dir, MARKER))) continue;
    out.push(dir);
  }
  return out;
}

export interface UninstallReport {
  removed: string[];
  kept: string[];
}

/**
 * Remove what `add-skills` wrote, and nothing else.
 *
 * A skill directory without the marker was put there by hand, so it is left
 * alone and reported. Deleting someone's own customisation because it shares a
 * name would be unforgivable for a removal step.
 *
 * The store is not its business: `~/.planx` is the user's plans, and what
 * happens to those is a question asked out loud — see `cmdRemoveSkills`.
 */
export async function runUninstall(opts: InstallOptions = {}): Promise<UninstallReport> {
  const report: UninstallReport = { removed: [], kept: [] };
  const step = opts.onStep ?? RUN_NOW;

  for (const target of TARGETS) {
    const base = opts.local
      ? join(opts.cwd ?? process.cwd(), target.dir)
      : join(opts.home ?? homedir(), target.dir);
    if (!existsSync(base)) continue;

    for (const entry of readdirSync(base, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.startsWith('planx')) continue;
      const dir = join(base, entry.name);
      await step({ group: 'Removing skills', label: entry.name, path: base }, () => {
        if (!existsSync(join(dir, MARKER))) {
          report.kept.push(dir);
          return { note: 'not ours — kept', ok: false };
        }
        rmSync(dir, { recursive: true, force: true });
        report.removed.push(dir);
        return { note: 'removed', ok: true };
      });
    }
  }

  return report;
}
