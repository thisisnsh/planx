import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { diffVersions, rowsForSingleVersion } from '../diff/lines.js';
import { runInstall, runUninstall } from '../install/install.js';
import { capture } from '../protocol/capture.js';
import { carriedOver, collapseEdits, presentResume } from '../protocol/present.js';
import { submitFeedback } from '../protocol/submit.js';
import { bold, cyan, dim, green, padEnd, red, yellow } from '../render/ansi.js';
import { renderDocument, renderStatLine, renderUnified, type RenderMode } from '../render/diff.js';
import { listFeedback } from '../store/feedback.js';
import { paths } from '../store/paths.js';
import {
  ensureStore,
  latestVersion,
  listPlans,
  purgePlan,
  purgeStore,
  readMeta,
  readVersions,
  readVersionText,
  rebuildIndex,
  removeVersions,
  resolvePlanRef,
  resolveVersionRef,
  rewriteVersion,
} from '../store/plans.js';
import type { VersionRecord } from '../store/types.js';
import { brandTitle, frameBlock } from '../tui/frame.js';
import type { PickerItem } from '../tui/Picker.js';
import { clearScreen, isInteractive, runPicker, runReview, runSteps } from '../tui/run.js';
import {
  fetchLatest,
  isNewer,
  PACKAGE_NAME,
  recordCheck,
  sourceCheckout,
} from '../update/check.js';
import { all, has, one, type ParsedArgs } from './args.js';

export interface Ctx {
  args: ParsedArgs;
  json: boolean;
  mode: RenderMode;
  /** planx's own version, shown in the review frame. */
  version: string;
  out: (text: string) => void;
  err: (text: string) => void;
}

/* ------------------------------------------------------------- helpers */

function readPlanText(args: ParsedArgs): string {
  const file = one(args, '--file');
  if (file) return readFileSync(file, 'utf8');
  if (has(args, '--stdin') || !process.stdin.isTTY) {
    const text = readFileSync(0, 'utf8');
    if (text.trim()) return text;
    throw new Error('planx: nothing on stdin. Pipe the plan in, or use --file.');
  }
  throw new Error('planx: no plan text. Use --stdin or --file <path>.');
}

/** A row of the picker: a plan, opening at its latest, or one of its versions. */
export interface PlanChoice {
  id: string;
  version: number;
  row: 'plan' | 'version';
}

/** Versions whose text is still on disk, newest first. */
function storedVersions(id: string): VersionRecord[] {
  return readVersions(id)
    .versions.filter((v) => readVersionText(id, v.n) !== null)
    .sort((a, b) => b.n - a.n);
}

/**
 * Every plan, each opening into its own versions.
 *
 * Time first in the grey column. The old order put the id first and the version
 * in the middle, so a narrow terminal truncated the version away — the one
 * thing on the row you could not get at any other way. The version numbers live
 * on the child rows now, where there is room for them.
 *
 * Rebuilt from the store rather than patched, so a delete can hand back a list
 * that is simply true.
 */
function planItems(): Array<PickerItem<PlanChoice>> {
  return listPlans().map((plan) => ({
    value: { id: plan.id, version: plan.latest, row: 'plan' },
    label: plan.title,
    hint: `${padEnd(ago(plan.updated), 9)}${plan.id}`,
    searchable: plan.id,
    deleteAs: plan.id,
    children: storedVersions(plan.id).map((v) => ({
      value: { id: plan.id, version: v.n, row: 'version' },
      label: `v${v.n}`,
      hint: ago(v.created),
      // The latest is the plan itself, so it never offers a delete.
      deleteAs: v.n === plan.latest ? undefined : `${plan.id} v${v.n}`,
    })),
  }));
}

/**
 * Choose a plan, or a version of one.
 *
 * `d` deletes what is highlighted and there is no trash behind it, so the red
 * confirmation the picker draws is the only thing between a keystroke and a
 * plan that is gone. That is the direct cost of dropping `clean` and `restore`,
 * and it is why the confirmation names its target in full.
 */
async function pickPlan(ctx: Ctx): Promise<PlanChoice | null> {
  const items = planItems();
  if (!items.length) throw new Error('planx: no plans stored yet.');
  if (!isInteractive()) {
    throw new Error('planx: name a plan. `planx list` shows what is stored.');
  }

  const [chosen] = await runPicker<PlanChoice>({
    title: 'Which plan?',
    subtitle: 'Pick one to review, → for its versions, or type to filter.',
    version: ctx.version,
    items,
    onDelete: (item) => {
      if (item.value.row === 'plan') purgePlan(item.value.id);
      else removeVersions(item.value.id, [item.value.version]);
      return planItems();
    },
  });
  return chosen ?? null;
}

/**
 * Print a block of lines inside the frame, when a person is going to read them.
 *
 * `--json` and a redirected stdout both mean the output is being consumed by
 * something that has no use for box-drawing characters — and `show`, `capture`
 * and `diff --print` never come through here at all, because those go straight
 * into an agent's context.
 */
function framed(ctx: Ctx, lines: string[]): void {
  if (ctx.json || !process.stdout.isTTY) {
    for (const line of lines) ctx.out(line);
    return;
  }
  ctx.out(frameBlock(lines, { title: brandTitle(ctx.version) }));
}

/**
 * Every line planx prints is a sentence: a leading capital and a closing stop.
 *
 * The exemption is mechanical, not stylistic — a line whose content *is* a path
 * or a plan id cannot be recased without breaking it, so those are left as they
 * are and take a stop only where one reads naturally. Prose wrapped around them
 * still follows the rule.
 *
 * This is for the tail end of a line that already carries user text or a shell
 * fragment, where a blind `${x}.` would double up an existing stop.
 */
function stop(text: string): string {
  return /[.!?…]$/.test(text.trimEnd()) ? text : `${text}.`;
}

function requireVersionText(id: string, version: number): string {
  const text = readVersionText(id, version);
  if (text === null) {
    throw new Error(
      `planx: ${id} v${version} is not stored — it may have been deleted from the picker.`,
    );
  }
  return text;
}

/* ------------------------------------------------------------- capture */

export function cmdCapture(ctx: Ctx): number {
  ensureStore();
  const text = readPlanText(ctx.args);

  const result = capture({
    text,
    planId: one(ctx.args, '--plan-id') ?? null,
    title: one(ctx.args, '--title') ?? null,
    name: one(ctx.args, '--name') ?? null,
    parent: one(ctx.args, '--parent') ?? null,
    source: one(ctx.args, '--source') ?? 'unknown',
    note: one(ctx.args, '--note') ?? null,
    agent: one(ctx.args, '--agent') ?? null,
  });

  if (ctx.json) {
    ctx.out(JSON.stringify(result, null, 2));
    return 0;
  }

  ctx.out(
    result.created
      ? green(`Captured ${bold(result.planId)} v${result.version}.`)
      : dim(`${result.planId} v${result.version} unchanged — nothing written.`),
  );
  if (result.closedFeedback) {
    ctx.out(dim(`Closed ${result.closedFeedback} feedback record(s).`));
  }
  return 0;
}

/* -------------------------------------------------------------- revise */

/**
 * Pick a plan back up: what was asked of it, and what the reviewer rewrote.
 *
 * This is what replaced `await`. The reviewer hands over a command instead of
 * the agent blocking on a queue, so everything the agent needs is assembled
 * from the store on demand — one read, no waiting, safe to run twice.
 */
export function cmdRevise(ctx: Ctx): number {
  const id = resolvePlanRef(requirePositional(ctx, 0, 'planx revise <id> [version]'));
  const version = resolveVersionRef(id, ctx.args.positionals[1]);
  const text = requireVersionText(id, version);

  const history = listFeedback(id);
  // Feedback on this version is what is actionable. Anything older was retired
  // by the capture that produced a newer version.
  const feedback = history.filter((f) => f.version === version);
  const carried = carriedOver(history, version, text);
  // What the reviewer rewrote by hand, one record per line — the same ones the
  // section below is rendered from.
  const edits = collapseEdits(readVersions(id).versions.find((v) => v.n === version)?.edits ?? []);

  if (ctx.json) {
    ctx.out(JSON.stringify({ plan_id: id, version, feedback, carried, edits }, null, 2));
    return 0;
  }

  ctx.out(presentResume({ planId: id, version, feedback, carried, edits }));
  return 0;
}

/**
 * The newest version before `n` that can still be read.
 *
 * Not `n - 1`: history has holes. A version whose text was trimmed is listed in
 * `versions.json` but has no file, so subtracting one lands on something that
 * cannot be opened.
 */
export function previousStoredVersion(id: string, n: number): number | null {
  const earlier = readVersions(id)
    .versions.map((v) => v.n)
    .filter((v) => v < n && readVersionText(id, v) !== null);
  return earlier.length ? Math.max(...earlier) : null;
}

export async function cmdDiff(ctx: Ctx): Promise<number> {
  const named = ctx.args.positionals[0];
  const printOnly = has(ctx.args, '--print') || has(ctx.args, '--stat') || !isInteractive();

  // Non-interactive wants one plan and one answer, so it resolves once. The
  // interactive path is a loop and picks inside it.
  if (!printOnly) return reviewLoop(ctx, named ? resolvePlanRef(named) : null);

  const id = named ? resolvePlanRef(named) : ((await pickPlan(ctx))?.id ?? null);
  if (!id) return 1;

  const [, refA, refB] = ctx.args.positionals;
  const versionB = refA && refB ? resolveVersionRef(id, refB) : resolveVersionRef(id, refA);
  const versionA = refA && refB ? resolveVersionRef(id, refA) : previousStoredVersion(id, versionB);

  const newText = requireVersionText(id, versionB);
  const rows =
    versionA === null
      ? rowsForSingleVersion(newText)
      : diffVersions(requireVersionText(id, versionA), newText);

  if (has(ctx.args, '--stat')) {
    ctx.out(renderStatLine(rows));
    return 0;
  }
  if (ctx.json) {
    ctx.out(JSON.stringify({ plan_id: id, versionA, versionB, rows }, null, 2));
    return 0;
  }
  for (const line of renderUnified(rows, {
    mode: ctx.mode,
    oldLabel: versionA === null ? undefined : `${id} v${versionA}`,
    newLabel: `${id} v${versionB}`,
  })) {
    ctx.out(line);
  }
  return 0;
}

/**
 * The picker and the review, taking turns in one call.
 *
 * `esc` in the review means back to the list, and there has to be a list to go
 * back to even when the review was opened straight from `planx <id>` — so the
 * two loop rather than one calling the other once. Anything else the reviewer
 * does ends the loop, because it has printed a command to paste back.
 */
async function reviewLoop(ctx: Ctx, named: string | null): Promise<number> {
  const [, refA, refB] = ctx.args.positionals;

  // Versions named on the command line belong to the plan they were named with,
  // not to whatever you pick after coming back to the list.
  let opened = named
    ? { id: named, version: refA ? resolveVersionRef(named, refB ?? refA) : latestVersion(named) }
    : null;
  let pinnedA = named && refA && refB ? resolveVersionRef(named, refA) : null;
  let returning = false;

  for (;;) {
    if (!opened) {
      // The review is still on screen on the way back, and the list has to be
      // the whole screen rather than something drawn over a plan.
      if (returning) clearScreen();
      const chosen = await pickPlan(ctx);
      if (!chosen) return 0;
      opened = { id: chosen.id, version: chosen.version };
      pinnedA = null;
    }

    // A version with a predecessor opens against it. You open v4 because v4 is
    // new, and what is new about it is the diff — opening flat and making you
    // press `d` had it backwards for the common case. v1 has nothing to diff
    // against and opens as itself; `d` toggles either way.
    const versionA = pinnedA ?? previousStoredVersion(opened.id, opened.version);
    const code = await runInteractiveReview(ctx, opened.id, versionA, opened.version);
    if (code !== BACK) return code;
    opened = null;
    returning = true;
  }
}

/** Not an exit code: the review asking for the list again. */
const BACK = -1;

async function runInteractiveReview(
  ctx: Ctx,
  id: string,
  versionA: number | null,
  versionB: number,
): Promise<number> {
  const meta = readMeta(id);
  const result = await runReview({
    planId: id,
    title: meta?.title ?? id,
    versionA,
    versionB,
    // Only versions whose text survived `planx clean` can be opened.
    versions: readVersions(id)
      .versions.map((v) => v.n)
      .filter((n) => readVersionText(id, n) !== null)
      .sort((a, b) => a - b),
    mode: ctx.mode,
    version: ctx.version,
    previous: listFeedback(id),
  });

  if (result.action === 'back') return BACK;
  if (result.action === 'quit') {
    // No `nothing submitted` above it: you just quit, so you know. What follows
    // is the part that carries something you did not already have.
    for (const line of closingBlock(id, result.version)) ctx.out(line);
    return 0;
  }

  // The edits first, so every comment re-anchors to the text the reviewer
  // settled on rather than to the line it replaced.
  if (result.editedVersion !== null && result.edits.length) {
    const { edits } = rewriteVersion(id, result.editedVersion, result.edits);
    if (edits.length) {
      ctx.out(
        green(
          `Edited ${edits.length} line${edits.length === 1 ? '' : 's'} of ${bold(id)} v${result.editedVersion}.`,
        ),
      );
    }
  }

  // Every version the reviewer touched comes back, the one on screen included,
  // so there is no batch to invent here — and a version they emptied comes back
  // empty, which is what makes a deleted comment stay deleted.
  let carried = false;
  for (const batch of result.batches) {
    submitFeedback({
      planId: id,
      version: batch.version,
      annotations: batch.annotations,
      general: batch.general,
    });
    if (batch.annotations.length || batch.general.trim()) carried = true;

    ctx.out(
      green(
        `Submitted ${countFeedback(batch.annotations.length)} on ${bold(id)} v${batch.version}.`,
      ),
    );
  }

  for (const line of closingBlock(id, result.version, carried)) ctx.out(line);
  return 0;
}

/** `no feedback`, `1 feedback`, `2 feedbacks` — the review's own word for it. */
function countFeedback(n: number): string {
  if (!n) return 'no feedback';
  return `${n} feedback${n === 1 ? '' : 's'}`;
}

/**
 * One entry of the closing block: what it does, and where you type it.
 *
 * The label names both. A slash command and a bare command look alike enough
 * on a terminal that the old `Paste to your agent:` / `Reopen it with:` leads
 * were the only thing telling them apart, and a lead that carries that much has
 * to be read to be believed. `in your terminal` and `in your agent` say it
 * outright, on every line.
 *
 * The commands are not padded into a shared column. Alignment was there to tie
 * three adjacent lines together; with a blank line between each of them there is
 * nothing left to tie, and a ragged right edge of labels reads worse than a
 * ragged left edge of commands.
 */
export function handOffLine(label: string, command: string): string {
  return `${label}:  ${yellow(command)}`;
}

/**
 * How a review signs off: how to get back in, and what to do next.
 *
 * Reopening comes first, on every exit including a plain quit. It is the one
 * line that is true of every ending — a review that finished successfully
 * should not leave you without a way back to what you were just looking at.
 *
 * What follows depends on what the submit carried. Feedback has to be answered
 * before the plan can be built, so it takes two commands; a submit that carried
 * nothing is the reviewer saying the plan is fine, so it takes one. Quitting
 * passes nothing at all, and gets the reopen line every block already opens on.
 *
 * One blank line between every entry. They ran together as a wall before, and
 * each is a separate thing to do — which reads as one with air around it.
 */
export function closingBlock(planId: string, version: number, carried?: boolean): string[] {
  const lines = [handOffLine('Reopen it in your terminal', `planx ${planId} v${version}`)];

  if (carried === true) {
    lines.push(
      '',
      handOffLine('Revise this plan in your agent', `/planx revise ${planId}`),
      '',
      handOffLine(
        'Execute it in your agent, once the feedback is addressed',
        `/planx execute ${planId} v${version}`,
      ),
    );
  } else if (carried === false) {
    lines.push(
      '',
      handOffLine('Execute this plan in your agent', `/planx execute ${planId} v${version}`),
    );
  }

  lines.push('');
  return lines;
}

/* ---------------------------------------------------------------- show */

export function cmdShow(ctx: Ctx): number {
  const id = resolvePlanRef(requirePositional(ctx, 0, 'planx show <id> [version]'));
  const version = resolveVersionRef(id, ctx.args.positionals[1]);
  const text = requireVersionText(id, version);

  if (ctx.json) {
    ctx.out(JSON.stringify({ plan_id: id, version, text }, null, 2));
    return 0;
  }

  for (const line of renderDocument(text, ctx.mode)) ctx.out(line);
  return 0;
}

/* -------------------------------------------------------------- listing */

export function cmdList(ctx: Ctx): number {
  const plans = listPlans({ here: has(ctx.args, '--here') });

  if (ctx.json) {
    ctx.out(JSON.stringify(plans, null, 2));
    return 0;
  }
  if (!plans.length) {
    ctx.out(dim('No plans stored.'));
    return 0;
  }

  const idWidth = Math.min(38, Math.max(...plans.map((p) => p.id.length)));
  framed(
    ctx,
    plans.map(
      (plan) =>
        `  ${cyan(padEnd(plan.id, idWidth))}  ${dim(padEnd(`v${plan.latest}`, 5))} ${dim(padEnd(ago(plan.updated), 9))}${plan.title}`,
    ),
  );
  return 0;
}

/* -------------------------------------------------------------- install */

/**
 * Write the skills, drawn step by step.
 *
 * It is called `add-skills` rather than `install` because npm already owns that
 * word: `npm install -g @thisisnsh/planx` installs planx, and a second command
 * called install invited the reading that the first one had not finished. What
 * this does is add skills to your agents, which is what it is now called.
 */
export async function cmdAddSkills(ctx: Ctx): Promise<number> {
  const report = await runSteps(
    {
      command: 'add-skills',
      version: ctx.version,
      // `--json` asked for one document on stdout, so the steps are swallowed
      // rather than printed above it — the report says everything they would.
      out: ctx.json ? () => {} : ctx.out,
      plain: ctx.json || !isInteractive(),
    },
    async (screen) => {
      const result = await runInstall({
        local: has(ctx.args, '--local'),
        noStore: has(ctx.args, '--no-store'),
        agents: all(ctx.args, '--agent'),
        onStep: screen.onStep,
      });
      if (!ctx.json) await screen.close(closingFor(result.agents));
      return result;
    },
  );

  if (ctx.json) {
    ctx.out(JSON.stringify(report, null, 2));
    return 0;
  }
  for (const skipped of report.skipped) ctx.err(dim(`Skipped ${stop(skipped)}`));
  return 0;
}

/** What you are left with: the skill, and where you can now type it. */
function closingFor(agents: readonly string[]): string {
  if (!agents.length) return 'Nothing to write — no agent directory was found.';
  const where =
    agents.length === 1 ? agents[0]! : `${agents.slice(0, -1).join(', ')} and ${agents.at(-1)}`;
  return `Done. /planx is available in ${where}.`;
}

/**
 * Remove the skills, and offer to take the plans with them.
 *
 * The store is asked about rather than assumed either way. Deleting it silently
 * would destroy every plan the user ever wrote over a command about skills;
 * keeping it silently leaves a directory behind that nothing else will ever
 * mention again.
 */
export async function cmdRemoveSkills(ctx: Ctx): Promise<number> {
  const plain = ctx.json || !isInteractive();

  const report = await runSteps(
    {
      command: 'remove-skills',
      version: ctx.version,
      out: ctx.json ? () => {} : ctx.out,
      plain,
    },
    async (screen) => {
      const report = await runUninstall({
        local: has(ctx.args, '--local'),
        onStep: screen.onStep,
      });
      if (!report.removed.length && !report.kept.length) {
        await screen.close('Nothing to remove — no planx skills were installed.');
        return { ...report, storeDeleted: false };
      }

      // A non-interactive run never deletes and never asks: there is nobody
      // there to answer, and the answer this would assume is unrecoverable.
      const count = listPlans().length;
      const question = `Delete the store too? ${paths.root()} holds ${count} plan${
        count === 1 ? '' : 's'
      }. This cannot be undone.`;
      if (!plain && (await screen.confirm(question, 'delete'))) {
        purgeStore();
        await screen.close(`Done. ${paths.root()} is gone.`);
        return { ...report, storeDeleted: true };
      }
      await screen.close(`Done. ${paths.root()} was left alone — delete it yourself later.`);
      return { ...report, storeDeleted: false };
    },
  );

  if (ctx.json) ctx.out(JSON.stringify(report, null, 2));
  return 0;
}

/* --------------------------------------------------------------- update */

/**
 * Install the latest planx, and let npm do the talking.
 *
 * The terminal is handed over rather than wrapped in a screen of our own:
 * npm's postinstall runs `add-skills`, and `--foreground-scripts` is what makes
 * those steps appear as they happen instead of being buffered and replayed. A
 * step screen here would swallow the one thing you ran this to watch.
 *
 * Always npm, never a guess at pnpm or bun. A wrong guess installs a second
 * copy under another prefix and leaves you looking at the old version wondering
 * why the update did nothing.
 */
export async function cmdUpdate(ctx: Ctx): Promise<number> {
  const checkout = sourceCheckout();
  if (checkout) {
    ctx.err(
      red(`planx: this is a checkout at ${checkout}, not an installed package.`) +
        `\n  ${dim('`npm install -g` would install a different planx than the one you just ran.')}`,
    );
    return 1;
  }

  // The one command where waiting on the network is the correct thing to do.
  const latest = await fetchLatest();
  recordCheck(latest);
  if (latest && !isNewer(latest, ctx.version)) {
    ctx.out(green(`Already on v${ctx.version}, the latest.`));
    return 0;
  }

  const args = ['install', '-g', `${PACKAGE_NAME}@latest`, '--foreground-scripts'];
  ctx.out(`${dim('Running')}  ${yellow(`npm ${args.join(' ')}`)}`);
  ctx.out('');
  return runNpm(args, ctx);
}

function runNpm(args: string[], ctx: Ctx): Promise<number> {
  return new Promise((resolve) => {
    // npm is a `.cmd` shim on Windows, which Node will not exec directly.
    const child = spawn('npm', args, {
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    child.on('error', (err: NodeJS.ErrnoException) => {
      ctx.err(
        red(
          err.code === 'ENOENT'
            ? 'planx: npm is not on your PATH, so there is nothing here to install with.'
            : `planx: could not run npm — ${err.message}`,
        ),
      );
      resolve(1);
    });
    // npm's exit code is ours, and npm's error text is left exactly as npm
    // wrote it. A failure here is a package-manager failure, and planx has
    // nothing to add to what npm already said about it.
    child.on('close', (code) => resolve(code ?? 1));
  });
}

/* --------------------------------------------------------------- doctor */

/**
 * The only repair path in the tool.
 *
 * It walks every plan and reports two things: a plan with no versions recorded,
 * and a version listed in `versions.json` whose `v<n>.md` is missing. Then it
 * rebuilds `index.json` from the plan directories on disk — the index is a
 * derived cache
 * that `list` and the picker read instead of opening every plan, so an
 * interrupted capture can leave it stale and nothing else puts it right.
 */
export function cmdDoctor(ctx: Ctx): number {
  ensureStore();
  const problems: string[] = [];
  const plans = listPlans();

  for (const plan of plans) {
    const versions = readVersions(plan.id).versions;
    if (!versions.length) problems.push(`${plan.id}: no versions recorded.`);
    for (const v of versions) {
      if (readVersionText(plan.id, v.n) === null) {
        problems.push(`${plan.id}: v${v.n} is in versions.json but its file is missing.`);
      }
    }
  }

  // The one line `status` was worth, absorbed: with `--dir` and `PLANX_DIR`
  // both in play, which store you are actually talking to is worth saying out
  // loud before anything else is reported about it.
  ctx.out(dim(`Store  ${paths.root()}`));
  const count = rebuildIndex();
  ctx.out(green(`Reindexed ${count} plan(s).`));
  if (!problems.length) {
    ctx.out(green('No problems found.'));
    return 0;
  }
  for (const problem of problems) ctx.out(yellow(problem));
  return 1;
}

/* -------------------------------------------------------------- helpers */

function requirePositional(ctx: Ctx, index: number, usage: string): string {
  const value = ctx.args.positionals[index];
  if (!value) throw new Error(`planx: missing argument.\n  usage: ${usage}`);
  return value;
}

export function ago(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  const units: Array<[number, string]> = [
    [86_400_000 * 365, 'y'],
    [86_400_000 * 30, 'mo'],
    [86_400_000, 'd'],
    [3_600_000, 'h'],
    [60_000, 'm'],
  ];
  for (const [size, label] of units) {
    if (ms >= size) return `${Math.floor(ms / size)}${label} ago`;
  }
  return 'just now';
}
