import { readFileSync } from 'node:fs';
import { adapters, runImport } from '../adapters/index.js';
import { diffVersions, rowsForSingleVersion } from '../diff/lines.js';
import {
  describeSkill,
  installedSkills,
  runInstall,
  runUninstall,
  skillNames,
} from '../install/install.js';
import { normalizedLines } from '../locks/anchor.js';
import { lockedLineMap } from '../locks/manage.js';
import { renderSkeleton } from '../locks/markers.js';
import { capture, LockViolationError } from '../protocol/capture.js';
import { carriedOver, presentResume } from '../protocol/present.js';
import { buildAnnotation, grantUnlock, submitFeedback } from '../protocol/submit.js';
import { bold, cyan, dim, green, red, yellow } from '../render/ansi.js';
import { renderDocument, renderStatLine, renderUnified, type RenderMode } from '../render/diff.js';
import { executeClean, planClean } from '../store/clean.js';
import {
  configKeys,
  getConfigValue,
  readConfig,
  setConfigValue,
  writeConfig,
} from '../store/config.js';
import { paths } from '../store/paths.js';
import {
  ensureStore,
  latestVersion,
  listPlans,
  listTrash,
  purgePlan,
  readLocks,
  readMeta,
  readVersions,
  readVersionText,
  rebuildIndex,
  renamePlan,
  resolvePlanRef,
  resolveVersionRef,
  restorePlan,
} from '../store/plans.js';
import { listFeedback } from '../store/feedback.js';
import { brandTitle, frameBlock } from '../tui/frame.js';
import { clearScreen, isInteractive, runPicker, runReview } from '../tui/run.js';
import { all, has, one, parseDuration, type ParsedArgs } from './args.js';

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

/** Resolve a plan reference, falling back to a picker when one is not given. */
async function resolvePlan(
  ctx: Ctx,
  ref: string | undefined,
  prompt: string,
  subtitle: string,
): Promise<string | null> {
  if (ref) return resolvePlanRef(ref);
  const plans = listPlans();
  if (!plans.length) throw new Error('planx: no plans stored yet.');
  if (!isInteractive()) {
    throw new Error('planx: name a plan. `planx list` shows what is stored.');
  }
  const [chosen] = await runPicker<string>({
    title: prompt,
    subtitle,
    version: ctx.version,
    items: plans.map((p) => ({
      value: p.id,
      label: p.title,
      hint: `${p.id}  v${p.latest}  ${ago(p.updated)}${p.approved ? '  ✓' : ''}`,
      searchable: p.id,
    })),
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

function requireVersionText(id: string, version: number): string {
  const text = readVersionText(id, version);
  if (text === null) {
    throw new Error(
      `planx: ${id} v${version} is not stored — its file may have been trimmed by \`planx clean\`.`,
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
      ? `${green('✓')} captured ${bold(result.planId)} v${result.version}`
      : `${dim('=')} ${result.planId} v${result.version} unchanged — nothing written`,
  );
  if (result.expandedLocks.length) {
    ctx.out(dim(`  expanded ${result.expandedLocks.length} locked block(s) from markers`));
  }
  if (result.literalMarkersInFence.length) {
    ctx.err(
      yellow(
        `  note: marker(s) on line ${result.literalMarkersInFence.join(', ')} are inside a code fence and were left literal`,
      ),
    );
  }
  for (const id of result.droppedLocks) {
    ctx.err(
      yellow(`  warning: lock ${id} could not be re-anchored in the new version and was dropped`),
    );
  }
  if (result.closedFeedback) {
    ctx.out(dim(`  closed ${result.closedFeedback} feedback record(s)`));
  }
  return 0;
}

/* -------------------------------------------------------------- resume */

/**
 * Pick a plan back up: what it says now, what was asked of it, what is locked.
 *
 * This is what replaced `await`. The reviewer hands over a command instead of
 * the agent blocking on a queue, so everything the agent needs is assembled
 * from the store on demand — one read, no waiting, safe to run twice.
 */
export function cmdResume(ctx: Ctx): number {
  const id = resolvePlanRef(requirePositional(ctx, 0, 'planx resume <id> [version]'));
  const version = resolveVersionRef(id, ctx.args.positionals[1]);
  const text = requireVersionText(id, version);

  const history = listFeedback(id);
  // Feedback on this version is what is actionable. Anything older was retired
  // by the capture that produced a newer version.
  const feedback = history.filter((f) => f.version === version);
  const carried = carriedOver(history, version, text);

  if (ctx.json) {
    ctx.out(
      JSON.stringify({ plan_id: id, version, feedback, carried, locks: readLocks(id) }, null, 2),
    );
    return 0;
  }

  ctx.out(
    presentResume({
      planId: id,
      version,
      feedback,
      carried,
      skeleton: renderSkeleton(text, readLocks(id)),
      locks: readLocks(id),
      docLines: normalizedLines(text),
    }),
  );
  return 0;
}

/* -------------------------------------------------------------- submit */

const RANGE = /^(\d+)(?:\s*-\s*(\d+))?$/;

function parseRange(spec: string, flag: string): { start: number; end: number } {
  const match = RANGE.exec(spec.trim());
  if (!match) {
    throw new Error(`planx: ${flag} takes a line range like 42-47 or 42, not "${spec}".`);
  }
  const start = Number.parseInt(match[1]!, 10);
  const end = match[2] ? Number.parseInt(match[2], 10) : start;
  if (end < start) throw new Error(`planx: ${flag} range ${spec} ends before it starts.`);
  return { start, end };
}

/**
 * Submit feedback from a script.
 *
 * This exists because the wire format is the product's real interface: the TUI
 * writes exactly this payload, so anything that can spawn a process can review
 * a plan too, and the protocol can be tested end to end as real subprocesses.
 */
export function cmdSubmit(ctx: Ctx): number {
  const id = resolvePlanRef(requirePositional(ctx, 0, 'planx submit <id> [version]'));
  const version = resolveVersionRef(id, ctx.args.positionals[1]);
  const docLines = normalizedLines(requireVersionText(id, version));

  if (has(ctx.args, '--stdin')) {
    const payload = JSON.parse(readFileSync(0, 'utf8')) as {
      verdict?: 'revise' | 'approve' | 'reject';
      annotations?: Array<{
        kind?: 'comment' | 'lock' | 'unlock';
        anchor?: { start_line?: number; end_line?: number };
        comment?: string;
      }>;
      general?: string;
    };
    const annotations = (payload.annotations ?? []).map((a, i) =>
      buildAnnotation(
        docLines,
        a.kind ?? 'comment',
        a.anchor?.start_line ?? 1,
        a.anchor?.end_line ?? a.anchor?.start_line ?? 1,
        a.comment ?? '',
        `a${i + 1}`,
      ),
    );
    return finishSubmit(
      ctx,
      id,
      version,
      payload.verdict ?? 'revise',
      annotations,
      payload.general ?? '',
    );
  }

  const annotations = [];
  let counter = 0;

  for (const spec of all(ctx.args, '--comment')) {
    const split = spec.indexOf(':');
    if (split === -1) {
      throw new Error(`planx: --comment takes "START-END:text", not "${spec}".`);
    }
    const range = parseRange(spec.slice(0, split), '--comment');
    annotations.push(
      buildAnnotation(
        docLines,
        'comment',
        range.start,
        range.end,
        spec.slice(split + 1).trim(),
        `a${++counter}`,
      ),
    );
  }
  for (const spec of all(ctx.args, '--lock')) {
    const range = parseRange(spec, '--lock');
    annotations.push(
      buildAnnotation(docLines, 'lock', range.start, range.end, '', `L${++counter}`),
    );
  }
  for (const spec of all(ctx.args, '--unlock')) {
    const range = parseRange(spec, '--unlock');
    annotations.push(
      buildAnnotation(docLines, 'unlock', range.start, range.end, '', `u${++counter}`),
    );
  }

  const verdict = has(ctx.args, '--approve')
    ? 'approve'
    : has(ctx.args, '--reject')
      ? 'reject'
      : 'revise';

  if (!annotations.length && !one(ctx.args, '--general') && verdict === 'revise') {
    throw new Error(
      'planx: nothing to submit. Add --comment, --lock, --unlock, --general, --approve or --reject.',
    );
  }

  return finishSubmit(ctx, id, version, verdict, annotations, one(ctx.args, '--general') ?? '');
}

function finishSubmit(
  ctx: Ctx,
  id: string,
  version: number,
  verdict: 'revise' | 'approve' | 'reject',
  annotations: ReturnType<typeof buildAnnotation>[],
  general: string,
): number {
  const result = submitFeedback({
    planId: id,
    version,
    verdict,
    annotations,
    general,
  });

  if (ctx.json) {
    ctx.out(JSON.stringify(result, null, 2));
    return 0;
  }
  ctx.out(`${green('✓')} submitted on ${bold(id)} v${version} (${verdict})`);
  if (result.locksCreated.length) ctx.out(dim(`  locked: ${result.locksCreated.join(', ')}`));
  if (result.locksRemoved.length) ctx.out(dim(`  unlocked: ${result.locksRemoved.join(', ')}`));
  if (result.sealedLocks.length) {
    ctx.out(`${green('✓')} sealed — ${result.sealedLocks.length} sections locked`);
  }
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
  ctx.out(`${green('✓')} unlocked ${lockId} for one capture`);
  ctx.out(dim(`  recorded: ${reason}`));
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

  const id = await resolvePlan(ctx, named, 'Which plan?', 'Pick one to review, or type to filter.');
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
  let opened = named;
  let returning = false;
  for (;;) {
    if (!opened) {
      // The review is still on screen on the way back, and the list has to be
      // the whole screen rather than something drawn over a plan.
      if (returning) clearScreen();
      opened = await resolvePlan(
        ctx,
        undefined,
        'Which plan?',
        'Pick one to review, or type to filter.',
      );
      if (!opened) return 0;
    }

    const [, refA, refB] = ctx.args.positionals;
    // A version named on the command line applies to the plan it was named
    // with, not to whatever you pick after coming back to the list.
    const explicit = opened === named;
    const versionB =
      explicit && refA ? resolveVersionRef(opened, refB ?? refA) : latestVersion(opened);
    const versionA =
      explicit && refA && refB
        ? resolveVersionRef(opened, refA)
        : previousStoredVersion(opened, versionB);

    // A version with a predecessor opens against it. You open v4 because v4 is
    // new, and what is new about it is the diff — opening flat and making you
    // press `d` had it backwards for the common case. v1 has nothing to diff
    // against and opens as itself; `d` toggles either way.
    const code = await runInteractiveReview(ctx, opened, versionA, versionB);
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
    ctx.out(dim('nothing submitted'));
    handOff(ctx, 'terminal', `planx ${id} v${result.version}`);
    return 0;
  }

  const verdict = result.action === 'submit' ? 'revise' : result.action;

  // A note belongs to the version it was written on, so a session that walked
  // back through the history leaves one submission per version it wrote on.
  const batches = [...result.batches];
  if (!batches.some((b) => b.version === result.version)) {
    batches.push({ version: result.version, annotations: [] });
  }

  let sealed = 0;
  for (const batch of batches) {
    const current = batch.version === result.version;
    const submitted = submitFeedback({
      planId: id,
      version: batch.version,
      verdict: current ? verdict : 'revise',
      annotations: batch.annotations,
      general: current ? result.general : '',
    });

    const comments = batch.annotations.filter((a) => a.kind === 'comment').length;
    ctx.out(
      `${green('✓')} submitted ${comments} comment(s) on ${bold(id)} v${batch.version} (${
        current ? verdict : 'revise'
      })`,
    );
    if (submitted.locksCreated.length) {
      ctx.out(dim(`  locked: ${submitted.locksCreated.join(', ')}`));
    }
    if (submitted.locksRemoved.length) {
      ctx.out(dim(`  unlocked: ${submitted.locksRemoved.join(', ')}`));
    }
    sealed += submitted.sealedLocks.length;
  }

  if (verdict === 'approve') {
    afterApproval(ctx, id, result.version, sealed);
    handOff(ctx, 'agent', `/planx execute ${id} v${result.version}`);
  } else {
    handOff(ctx, 'agent', `/planx resume ${id}`);
  }
  return 0;
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
  return `  ${lead}  ${yellow(command)}`;
}

function handOff(ctx: Ctx, to: 'agent' | 'terminal', command: string): void {
  ctx.out('');
  ctx.out(handOffLine(to, command));
}

/** The approve → seal summary. The command to build it follows separately. */
function afterApproval(ctx: Ctx, id: string, version: number, sections: number): void {
  ctx.out('');
  ctx.out(
    `${green('✓')} Approved & sealed — ${bold(id)} v${version} (${sections} sections locked)`,
  );
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
    ctx.out(dim('no plans stored'));
    return 0;
  }

  const idWidth = Math.min(38, Math.max(...plans.map((p) => p.id.length)));
  framed(
    ctx,
    plans.map((plan) => {
      const badge = plan.sealed ? green(' 🔒') : plan.approved ? green(' ✓') : '  ';
      return `${badge} ${cyan(plan.id.padEnd(idWidth))}  ${dim(`v${plan.latest}`.padEnd(5))} ${dim(ago(plan.updated).padEnd(8))} ${plan.title}`;
    }),
  );
  return 0;
}

export function cmdVersions(ctx: Ctx): number {
  const id = resolvePlanRef(requirePositional(ctx, 0, 'planx versions <id>'));
  const versions = readVersions(id).versions.sort((a, b) => a.n - b.n);

  if (ctx.json) {
    ctx.out(JSON.stringify(versions, null, 2));
    return 0;
  }
  framed(
    ctx,
    versions.map((v) => {
      const stored = readVersionText(id, v.n) === null ? red(' (trimmed)') : '';
      return `  ${cyan(`v${v.n}`.padEnd(5))} ${dim(v.sha256.slice(0, 8))} ${dim(ago(v.created).padEnd(8))} ${v.author}${v.agent ? `/${v.agent}` : ''}${v.note ? `  ${v.note}` : ''}${stored}`;
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
  const out: string[] = [];
  if (locks.sealed_at) {
    out.push(green(`sealed at ${locks.sealed_at} (v${locks.sealed_version})`));
  }
  const entries = Object.values(locks.locks);
  if (!entries.length) {
    out.push(dim('no locks'));
  }
  for (const lock of entries) {
    const lines = lock.text.split('\n').length;
    out.push(
      `  🔒 ${cyan(lock.id.padEnd(5))} ${lock.section ?? dim('(preamble)')} ${dim(`— ${lines} lines, ${lock.origin}`)}`,
    );
  }
  for (const grant of Object.values(locks.grants).filter((g) => g.used_at === null)) {
    out.push(yellow(`  ⚑ grant open for ${grant.lock_id} — one capture may modify it`));
  }
  framed(ctx, out);
  return 0;
}

/* --------------------------------------------------------------- import */

export function cmdImport(ctx: Ctx): number {
  ensureStore();
  const from = one(ctx.args, '--from');
  if (!from) {
    throw new Error(`planx: --from is required. Available: ${Object.keys(adapters).join(', ')}.`);
  }

  const since = one(ctx.args, '--since');
  const result = runImport(from, {
    home: one(ctx.args, '--home'),
    since: since ? parseDuration(since) : undefined,
    latestOnly: has(ctx.args, '--latest'),
  });

  if (ctx.json) {
    ctx.out(JSON.stringify(result, null, 2));
    return 0;
  }
  if (!result.imported.length) {
    ctx.out(
      dim(`nothing to import from ${adapters[from]?.describe({ home: one(ctx.args, '--home') })}`),
    );
    return 0;
  }
  for (const plan of result.imported) {
    ctx.out(`${green('✓')} ${cyan(plan.planId)}  ${plan.title}`);
  }
  if (result.skipped) ctx.out(dim(`  ${result.skipped} skipped`));
  return 0;
}

/* ---------------------------------------------------------------- clean */

export async function cmdClean(ctx: Ctx): Promise<number> {
  if (has(ctx.args, '--empty-trash')) return emptyTrash(ctx);

  const older = one(ctx.args, '--older-than');
  const beyond = one(ctx.args, '--versions-beyond');
  const ids = all(ctx.args, '--id');
  const hasFilter =
    Boolean(older) || Boolean(beyond) || ids.length > 0 || has(ctx.args, '--unapproved');

  let target;
  if (hasFilter) {
    target = planClean(
      {
        olderThanMs: older ? parseDuration(older) : undefined,
        unapproved: has(ctx.args, '--unapproved'),
        here: has(ctx.args, '--here'),
        ids: ids.length ? ids.map((ref) => resolvePlanRef(ref)) : undefined,
      },
      beyond ? Number.parseInt(beyond, 10) : undefined,
    );
  } else {
    if (!isInteractive())
      throw new Error('planx: give a filter, or run `planx clean` in a terminal.');
    const plans = listPlans({ here: has(ctx.args, '--here') });
    const chosen = await runPicker<string>({
      title: 'Remove which plans?',
      subtitle: 'Space marks a plan; they go to the trash, not away.',
      version: ctx.version,
      multi: true,
      items: plans.map((p) => ({
        value: p.id,
        label: p.title,
        hint: `${p.id}  v${p.latest}  ${ago(p.updated)}${p.approved ? '  ✓' : ''}`,
        searchable: p.id,
      })),
    });
    if (!chosen.length) {
      ctx.out(dim('nothing selected'));
      return 0;
    }
    target = planClean({ ids: chosen });
  }

  if (!target.plans.length && !target.trims.length) {
    ctx.out(dim('nothing matched'));
    return 0;
  }

  const purge = has(ctx.args, '--purge');
  for (const plan of target.plans) {
    ctx.out(`  ${purge ? red('destroy') : 'trash'}  ${cyan(plan.id)}  ${plan.title}`);
  }
  for (const trim of target.trims) {
    ctx.out(`  trim    ${cyan(trim.id)}  versions ${trim.versions.join(', ')}`);
  }

  if (!has(ctx.args, '--yes')) {
    const confirmed = await confirmDestructive(
      purge
        ? `Permanently destroy ${target.plans.length} plan(s)? This cannot be undone.`
        : `Move ${target.plans.length} plan(s) to the trash?`,
      ctx.version,
    );
    if (!confirmed) {
      ctx.out(dim('cancelled'));
      return 0;
    }
  }

  const outcome = executeClean(target, purge);
  ctx.out(
    `${green('✓')} ${outcome.trashed.length} trashed, ${outcome.purged.length} destroyed, ${outcome.trimmed.length} trimmed`,
  );
  if (outcome.trashed.length) {
    ctx.out(dim(`  restore with: planx restore ${outcome.trashed[0]}`));
  }
  return 0;
}

async function emptyTrash(ctx: Ctx): Promise<number> {
  const older = one(ctx.args, '--older-than');
  const cutoff = older ? Date.now() - parseDuration(older) : Number.POSITIVE_INFINITY;
  const doomed = listTrash().filter((t) => Date.parse(t.deleted_at) < cutoff);

  if (!doomed.length) {
    ctx.out(dim('trash is empty'));
    return 0;
  }
  for (const item of doomed) ctx.out(`  ${red('destroy')}  ${cyan(item.id)}  ${item.title}`);

  if (!has(ctx.args, '--yes')) {
    const confirmed = await confirmDestructive(
      `Permanently destroy ${doomed.length} trashed plan(s)? This cannot be undone.`,
      ctx.version,
    );
    if (!confirmed) {
      ctx.out(dim('cancelled'));
      return 0;
    }
  }
  for (const item of doomed) purgePlan(item.id);
  ctx.out(`${green('✓')} destroyed ${doomed.length}`);
  return 0;
}

async function confirmDestructive(question: string, version?: string): Promise<boolean> {
  if (!isInteractive()) {
    throw new Error('planx: not a terminal — pass --yes to confirm in a script.');
  }
  const [answer] = await runPicker<boolean>({
    title: question,
    version,
    items: [
      { value: false, label: 'cancel' },
      { value: true, label: 'yes, go ahead' },
    ],
  });
  return answer === true;
}

export function cmdRestore(ctx: Ctx): number {
  const id = requirePositional(ctx, 0, 'planx restore <id>');
  restorePlan(id);
  ctx.out(`${green('✓')} restored ${bold(id)}`);
  return 0;
}

export function cmdRename(ctx: Ctx): number {
  const id = resolvePlanRef(requirePositional(ctx, 0, 'planx rename <id> <new>'));
  const next = requirePositional(ctx, 1, 'planx rename <id> <new>');
  const renamed = renamePlan(id, next);
  ctx.out(`${green('✓')} ${id} → ${bold(renamed)}`);
  return 0;
}

/* --------------------------------------------------------------- config */

export function cmdToggle(ctx: Ctx, enabled: boolean): number {
  ensureStore();
  const config = readConfig();
  config.enabled = enabled;
  writeConfig(config);
  ctx.out(`${green('✓')} planx ${enabled ? 'on' : 'off'}`);
  return 0;
}

export function cmdStatus(ctx: Ctx): number {
  const config = readConfig();
  const plans = listPlans();
  const skills = installedSkills();

  if (ctx.json) {
    ctx.out(
      JSON.stringify(
        { enabled: config.enabled, store: paths.root(), plans: plans.length, skills, config },
        null,
        2,
      ),
    );
    return 0;
  }

  framed(ctx, [
    `${bold('planx')} ${config.enabled ? green('on') : red('off')}`,
    `  store      ${paths.root()}`,
    `  plans      ${plans.length} (${plans.filter((p) => p.approved).length} approved)`,
    `  trash      ${listTrash().length}`,
    `  render     ${config.render}`,
    `  mouse      ${config.mouse}`,
    `  skills     ${skills.length ? '' : dim('none installed — run `planx install`')}`,
    ...skills.map((skill) => `             ${dim(skill)}`),
  ]);
  return 0;
}

export function cmdConfig(ctx: Ctx): number {
  ensureStore();
  const [action, key, ...rest] = ctx.args.positionals;
  const config = readConfig();

  if (!action || action === 'get') {
    if (!key) {
      ctx.out(JSON.stringify(config, null, 2));
      return 0;
    }
    const value = getConfigValue(config, key);
    ctx.out(typeof value === 'string' ? value : JSON.stringify(value, null, 2));
    return 0;
  }

  if (action === 'set') {
    if (!key) throw new Error(`planx: which key? Settable: ${configKeys().join(', ')}.`);
    const value = rest.join(' ');
    if (!value) throw new Error(`planx: config set ${key} needs a value.`);
    writeConfig(setConfigValue(config, key, value));
    ctx.out(`${green('✓')} ${key} = ${value}`);
    return 0;
  }

  throw new Error('planx: config takes `get` or `set`.');
}

/* -------------------------------------------------------------- install */

export function cmdInstall(ctx: Ctx): number {
  const report = runInstall({
    local: has(ctx.args, '--local'),
    skillsOnly: has(ctx.args, '--skills'),
    agents: all(ctx.args, '--agent'),
  });

  if (ctx.json) {
    ctx.out(JSON.stringify(report, null, 2));
    return 0;
  }

  for (const name of skillNames()) {
    const description = describeSkill(name);
    ctx.out(`  ${cyan(`/${name}`)}  ${dim(description.slice(0, 70))}`);
  }
  for (const dir of report.wrote) ctx.out(`${green('✓')} ${dir}`);
  for (const dir of report.removed) ctx.out(`${yellow('−')} removed retired skill ${dir}`);
  for (const dir of report.seeded) ctx.out(`${green('✓')} seeded ${dir}`);
  for (const skipped of report.skipped) ctx.out(dim(`  skipped ${skipped}`));
  ctx.out(dim('  no agent settings files were modified'));
  return 0;
}

export function cmdUninstall(ctx: Ctx): number {
  const report = runUninstall({ local: has(ctx.args, '--local') });
  for (const dir of report.removed) ctx.out(`${green('✓')} removed ${dir}`);
  for (const dir of report.kept) {
    ctx.out(yellow(`  kept ${dir} — planx did not write it`));
  }
  if (!report.removed.length && !report.kept.length) ctx.out(dim('nothing installed'));
  ctx.out(dim(`  ${paths.root()} was left alone — delete it yourself if you want the plans gone`));
  return 0;
}

/* --------------------------------------------------------------- doctor */

export function cmdDoctor(ctx: Ctx): number {
  ensureStore();
  const problems: string[] = [];
  const plans = listPlans();

  for (const plan of plans) {
    const versions = readVersions(plan.id).versions;
    if (!versions.length) problems.push(`${plan.id}: no versions recorded`);
    for (const v of versions) {
      if (readVersionText(plan.id, v.n) === null) {
        problems.push(`${plan.id}: v${v.n} is in versions.json but its file is missing`);
      }
    }
    const locks = readLocks(plan.id);
    const latest = readVersionText(plan.id, latestVersion(plan.id));
    if (latest !== null) {
      const map = lockedLineMap(normalizedLines(latest), locks);
      for (const lock of Object.values(locks.locks)) {
        if (![...map.values()].includes(lock.id)) {
          problems.push(`${plan.id}: lock ${lock.id} cannot be located in the latest version`);
        }
      }
    }
  }

  const count = rebuildIndex();
  ctx.out(`${green('✓')} reindexed ${count} plan(s)`);
  if (!problems.length) {
    ctx.out(`${green('✓')} no problems found`);
    return 0;
  }
  for (const problem of problems) ctx.out(yellow(`  ! ${problem}`));
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
