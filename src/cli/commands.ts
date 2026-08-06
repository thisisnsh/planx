import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { diffVersions, rowsForSingleVersion } from '../diff/lines.js';
import { runInstall, runUninstall } from '../install/install.js';
import { normalizedLines } from '../locks/anchor.js';
import { lockedLineMap } from '../locks/manage.js';
import { renderSkeleton } from '../locks/markers.js';
import { capture, LockViolationError } from '../protocol/capture.js';
import { carriedOver, collapseEdits, presentResume } from '../protocol/present.js';
import { grantUnlock, submitFeedback } from '../protocol/submit.js';
import { bold, cyan, dim, green, padEnd, red, yellow } from '../render/ansi.js';
import { renderDocument, renderStatLine, renderUnified, type RenderMode } from '../render/diff.js';
import { protectedFor } from '../store/clean.js';
import { listFeedback } from '../store/feedback.js';
import { paths } from '../store/paths.js';
import {
  ensureStore,
  latestVersion,
  listPlans,
  purgePlan,
  purgeStore,
  readLocks,
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
 * on the child rows now, where there is room for them, and approval is the
 * title's colour rather than a tick fighting for the last column.
 *
 * Rebuilt from the store rather than patched, so `d` can hand back a list that
 * is simply true.
 */
function planItems(): Array<PickerItem<PlanChoice>> {
  return listPlans().map((plan) => {
    // A version a lock was cut from is the source `--splice` re-reads, and the
    // latest is the plan itself. Neither can go, so neither offers `d`.
    const pinned = protectedFor(plan.id);
    return {
      value: { id: plan.id, version: plan.latest, row: 'plan' },
      label: plan.title,
      approved: plan.approved,
      hint: `${padEnd(ago(plan.updated), 9)}${plan.id}`,
      searchable: plan.id,
      deleteAs: plan.id,
      children: storedVersions(plan.id).map((v) => ({
        value: { id: plan.id, version: v.n, row: 'version' },
        label: `v${v.n}`,
        hint: ago(v.created),
        deleteAs: v.n === plan.latest || pinned.has(v.n) ? undefined : `${plan.id} v${v.n}`,
      })),
    };
  });
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

  let result;
  try {
    result = capture({
      text,
      planId: one(ctx.args, '--plan-id') ?? null,
      title: one(ctx.args, '--title') ?? null,
      name: one(ctx.args, '--name') ?? null,
      parent: one(ctx.args, '--parent') ?? null,
      splice: has(ctx.args, '--splice'),
      source: one(ctx.args, '--source') ?? 'unknown',
      note: one(ctx.args, '--note') ?? null,
      agent: one(ctx.args, '--agent') ?? null,
    });
  } catch (err) {
    if (err instanceof LockViolationError) {
      ctx.err(err.message);
      return 3;
    }
    throw err;
  }

  if (ctx.json) {
    ctx.out(JSON.stringify(result, null, 2));
    return 0;
  }

  ctx.out(
    result.created
      ? green(`Captured ${bold(result.planId)} v${result.version}.`)
      : dim(`${result.planId} v${result.version} unchanged — nothing written.`),
  );
  if (result.expandedLocks.length) {
    ctx.out(dim(`Expanded ${result.expandedLocks.length} locked block(s) from markers.`));
  }
  if (result.literalMarkersInFence.length) {
    ctx.err(
      yellow(
        `Note: marker(s) on line ${result.literalMarkersInFence.join(', ')} are inside a code fence and were left literal.`,
      ),
    );
  }
  for (const id of result.droppedLocks) {
    ctx.err(
      yellow(`Warning: lock ${id} could not be re-anchored in the new version and was dropped.`),
    );
  }
  if (result.closedFeedback) {
    ctx.out(dim(`Closed ${result.closedFeedback} feedback record(s).`));
  }
  return 0;
}

/* -------------------------------------------------------------- revise */

/**
 * Pick a plan back up: what it says now, what was asked of it, what is locked.
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
    ctx.out(
      JSON.stringify(
        { plan_id: id, version, feedback, carried, edits, locks: readLocks(id) },
        null,
        2,
      ),
    );
    return 0;
  }

  ctx.out(
    presentResume({
      planId: id,
      version,
      feedback,
      carried,
      edits,
      locks: readLocks(id),
      docLines: normalizedLines(text),
    }),
  );
  return 0;
}

/**
 * Open one locked block for a single capture.
 *
 * Run by the agent once it has explained the change and the user has agreed, so
 * the reason it records is the only thing that makes the decision reviewable
 * afterwards. There is no matching deny: nothing is blocked waiting, so a
 * refusal is this command simply never being run.
 */
export function cmdUnlock(ctx: Ctx): number {
  const usage = 'planx unlock <id> <lock-id> --reason "..."';
  const id = resolvePlanRef(requirePositional(ctx, 0, usage));
  const lockId = requirePositional(ctx, 1, usage);
  const reason = one(ctx.args, '--reason');
  if (!reason) {
    throw new Error('planx: --reason is required. Say why the block has to change.');
  }

  const { grantId } = grantUnlock({ planId: id, lockId, reason });

  if (ctx.json) {
    ctx.out(JSON.stringify({ plan_id: id, lock_id: lockId, grant_id: grantId, reason }, null, 2));
    return 0;
  }
  ctx.out(green(`Unlocked ${lockId} for one capture.`));
  ctx.out(dim(`Recorded: ${stop(reason)}`));
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
    for (const line of closingBlock('quit', id, result.version)) ctx.out(line);
    return 0;
  }

  const verdict = result.action === 'submit' ? 'revise' : result.action;

  // The edits first, so the locks seal against the text the reviewer settled on
  // and every comment re-anchors to it rather than to the line it replaced.
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
  for (const batch of result.batches) {
    const current = batch.version === result.version;
    const submitted = submitFeedback({
      planId: id,
      version: batch.version,
      verdict: current ? verdict : 'revise',
      annotations: batch.annotations,
      general: batch.general,
    });

    const comments = batch.annotations.filter((a) => a.kind === 'comment').length;
    ctx.out(green(`Submitted ${countFeedback(comments)} on ${bold(id)} v${batch.version}.`));
    if (submitted.locksCreated.length) {
      ctx.out(dim(`Locked: ${submitted.locksCreated.join(', ')}.`));
    }
    if (submitted.locksRemoved.length) {
      ctx.out(dim(`Unlocked: ${submitted.locksRemoved.join(', ')}.`));
    }
  }

  for (const line of closingBlock(verdict, id, result.version)) ctx.out(line);
  return 0;
}

/** `no feedback`, `1 feedback`, `2 feedbacks` — the review's own word for it. */
function countFeedback(n: number): string {
  if (!n) return 'no feedback';
  return `${n} feedback${n === 1 ? '' : 's'}`;
}

/**
 * The one line the reviewer carries out of the review.
 *
 * The whole loop depends on the reviewer handing a command back, and after a
 * submit the review used to print none at all — which is where the round
 * dead-ended, one step short of continuing.
 *
 * A slash command is for your agent, a bare command is for your terminal.
 * Nothing else distinguished them before, which is most of why the old strings
 * read as noise: `planx execute <id>` looked like something to run in a shell,
 * and there has never been such a command. `/planx execute` is a branch of the
 * skill, and in slash form it is unmistakably something you paste into a chat.
 */
export function handOffLine(to: 'agent' | 'terminal', command: string): string {
  const lead = to === 'agent' ? 'Paste to your agent:' : 'Reopen it with:';
  return `${lead}  ${yellow(command)}`;
}

/**
 * How a review signs off: what happened, what to do next, how to get back.
 *
 * The blanks used to lead instead of trail — the summary, the paste line and
 * the reopen line each opened with one — so what should read as a block arrived
 * as three separate announcements. One line of air after the whole thing, and
 * none inside it.
 *
 * The reopen line is on every exit now. Only quitting printed it before, so a
 * review that ended *successfully* left no way back to what you had just been
 * looking at. It goes last: the agent command is the next step, and this is the
 * fallback.
 */
export function closingBlock(
  action: 'quit' | 'revise' | 'reject' | 'approve',
  planId: string,
  version: number,
): string[] {
  const lines: string[] = [];
  if (action === 'approve') {
    // Not how many sections it locked. Approving seals the plan whole, so the
    // count was a number that is always "all of them" dressed up as news.
    lines.push(green(`Approved & sealed — ${bold(planId)} v${version}.`));
  }
  if (action !== 'quit') {
    lines.push(
      handOffLine(
        'agent',
        action === 'approve' ? `/planx execute ${planId} v${version}` : `/planx revise ${planId}`,
      ),
    );
  }
  lines.push(handOffLine('terminal', `planx ${planId} v${version}`), '');
  return lines;
}

/* ---------------------------------------------------------------- show */

export function cmdShow(ctx: Ctx): number {
  const id = resolvePlanRef(requirePositional(ctx, 0, 'planx show <id> [version]'));
  const version = resolveVersionRef(id, ctx.args.positionals[1]);
  const text = requireVersionText(id, version);

  if (has(ctx.args, '--skeleton')) {
    ctx.out(renderSkeleton(text, readLocks(id)).trimEnd());
    return 0;
  }
  if (ctx.json) {
    ctx.out(JSON.stringify({ plan_id: id, version, text }, null, 2));
    return 0;
  }

  const locks =
    ctx.mode === 'rich' ? lockedLineMap(normalizedLines(text), readLocks(id)) : undefined;
  for (const line of renderDocument(text, ctx.mode, locks)) ctx.out(line);
  return 0;
}

/* -------------------------------------------------------------- listing */

export function cmdList(ctx: Ctx): number {
  const plans = listPlans({
    here: has(ctx.args, '--here'),
    approved: has(ctx.args, '--approved'),
    unapproved: has(ctx.args, '--unapproved'),
  });

  if (ctx.json) {
    ctx.out(JSON.stringify(plans, null, 2));
    return 0;
  }
  if (!plans.length) {
    ctx.out(dim('No plans stored.'));
    return 0;
  }

  // Approval is colour, here as in the picker. The `✓` and `🔒` badges spent a
  // column each saying what green already says, and the padlock was two cells
  // wide in some terminals and one in others, so the id column moved with it.
  const idWidth = Math.min(38, Math.max(...plans.map((p) => p.id.length)));
  framed(
    ctx,
    plans.map((plan) => {
      const title = plan.approved ? green(plan.title) : plan.title;
      return `  ${cyan(padEnd(plan.id, idWidth))}  ${dim(padEnd(`v${plan.latest}`, 5))} ${dim(padEnd(ago(plan.updated), 9))}${title}`;
    }),
  );
  return 0;
}

export function cmdLocks(ctx: Ctx): number {
  const id = resolvePlanRef(requirePositional(ctx, 0, 'planx locks <id>'));
  const locks = readLocks(id);

  if (ctx.json) {
    ctx.out(JSON.stringify(locks, null, 2));
    return 0;
  }
  // Two spaces on every row, because these are drawn inside the frame: that is
  // the frame's interior padding, not an indent hanging off the left margin.
  const out: string[] = [];
  if (locks.sealed_at) {
    out.push(green(`  Sealed at ${locks.sealed_at} (v${locks.sealed_version}).`));
  }
  const entries = Object.values(locks.locks);
  if (!entries.length) {
    out.push(dim('  No locks.'));
  }
  for (const lock of entries) {
    const lines = lock.text.split('\n').length;
    out.push(
      `  ${cyan(lock.id.padEnd(5))} ${lock.section ?? dim('(preamble)')} ${dim(`— ${lines} lines, ${lock.origin}`)}`,
    );
  }
  for (const grant of Object.values(locks.grants).filter((g) => g.used_at === null)) {
    out.push(yellow(`  Grant open for ${grant.lock_id} — one capture may modify it.`));
  }
  framed(ctx, out);
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
 * It walks every plan and reports three things: a plan with no versions
 * recorded, a version listed in `versions.json` whose `v<n>.md` is missing, and
 * a lock that can no longer be located in the latest version. Then it rebuilds
 * `index.json` from the plan directories on disk — the index is a derived cache
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
    const locks = readLocks(plan.id);
    const latest = readVersionText(plan.id, latestVersion(plan.id));
    if (latest !== null) {
      const map = lockedLineMap(normalizedLines(latest), locks);
      for (const lock of Object.values(locks.locks)) {
        if (![...map.values()].includes(lock.id)) {
          problems.push(`${plan.id}: lock ${lock.id} cannot be located in the latest version.`);
        }
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
