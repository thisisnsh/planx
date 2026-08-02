import { readFileSync } from 'node:fs';
import { adapters, runImport } from '../adapters/index.js';
import { diffVersions, rowsForSingleVersion } from '../diff/lines.js';
import { buildCommand, formatCommand, resolveAgent, runCommand } from '../exec/registry.js';
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
import {
  awaitFeedback,
  awaitUnlockDecision,
  pendingRequests,
  timeoutMessage,
} from '../protocol/await.js';
import { capture, LockViolationError } from '../protocol/capture.js';
import { presentFeedback, presentUnlockDecision } from '../protocol/present.js';
import { buildAnnotation, respondToUnlock, submitFeedback } from '../protocol/submit.js';
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
import { listFeedback } from '../store/queue.js';
import { isInteractive, runPicker, runReview } from '../tui/run.js';
import { all, has, one, parseDuration, splitArgs, type ParsedArgs } from './args.js';

export interface Ctx {
  args: ParsedArgs;
  json: boolean;
  mode: RenderMode;
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
async function resolvePlan(ref: string | undefined, prompt: string): Promise<string | null> {
  if (ref) return resolvePlanRef(ref);
  const plans = listPlans();
  if (!plans.length) throw new Error('planx: no plans stored yet.');
  if (!isInteractive()) {
    throw new Error('planx: name a plan. `planx list` shows what is stored.');
  }
  const [chosen] = await runPicker<string>({
    title: prompt,
    items: plans.map((p) => ({
      value: p.id,
      label: p.title,
      hint: `${p.id}  v${p.latest}${p.approved ? '  ✓' : ''}`,
      searchable: p.id,
    })),
  });
  return chosen ?? null;
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

/* --------------------------------------------------------------- await */

export async function cmdAwait(ctx: Ctx): Promise<number> {
  const id = resolvePlanRef(requirePositional(ctx, 0, 'planx await <id> [version]'));
  const version = resolveVersionRef(id, ctx.args.positionals[1]);
  const timeout =
    Number.parseInt(one(ctx.args, '--timeout') ?? '', 10) || readConfig().awaitTimeout;

  const outcome = await awaitFeedback({ planId: id, version, timeoutSec: timeout });

  if (outcome.kind === 'timeout') {
    ctx.out(timeoutMessage(outcome.waitedSec));
    return 0;
  }
  if (ctx.json) {
    ctx.out(JSON.stringify(outcome.value, null, 2));
    return 0;
  }
  ctx.out(
    presentFeedback({
      planId: id,
      version,
      feedback: outcome.value,
      locks: readLocks(id),
      docLines: normalizedLines(requireVersionText(id, version)),
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
 * a plan too, and the protocol can be tested end to end as real subprocesses
 * (PLAN §2, §17).
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
    requestId: pendingRequests(id).find((r) => r.kind === 'review')?.id ?? null,
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

export function cmdUnlockRespond(ctx: Ctx): number {
  const id = resolvePlanRef(
    requirePositional(ctx, 0, 'planx unlock-respond <id> <lock-id> --grant|--deny'),
  );
  const lockId = requirePositional(ctx, 1, 'planx unlock-respond <id> <lock-id> --grant|--deny');

  const grant = has(ctx.args, '--grant');
  const deny = has(ctx.args, '--deny');
  if (grant === deny) throw new Error('planx: pass exactly one of --grant or --deny.');

  const result = respondToUnlock({
    planId: id,
    version: latestVersion(id),
    lockId,
    granted: grant,
    note: one(ctx.args, '--note') ?? '',
    requestId: pendingRequests(id).find((r) => r.kind === 'unlock')?.id ?? null,
  });

  if (ctx.json) {
    ctx.out(JSON.stringify(result, null, 2));
    return 0;
  }
  ctx.out(
    grant
      ? `${green('✓')} granted ${lockId} — one capture may modify it`
      : `${red('✗')} denied ${lockId}`,
  );
  return 0;
}

export async function cmdUnlockRequest(ctx: Ctx): Promise<number> {
  const id = resolvePlanRef(
    requirePositional(ctx, 0, 'planx unlock-request <id> <lock-id> --reason "..."'),
  );
  const lockId = requirePositional(ctx, 1, 'planx unlock-request <id> <lock-id> --reason "..."');
  const reason = one(ctx.args, '--reason');
  if (!reason) throw new Error('planx: --reason is required. Say why the block needs to change.');

  const locks = readLocks(id);
  if (!locks.locks[lockId]) {
    const known = Object.keys(locks.locks).join(', ') || 'none';
    throw new Error(`planx: ${id} has no lock ${lockId}. Locks: ${known}.`);
  }

  const version = latestVersion(id);
  const timeout =
    Number.parseInt(one(ctx.args, '--timeout') ?? '', 10) || readConfig().awaitTimeout;

  const outcome = await awaitUnlockDecision({
    planId: id,
    version,
    lockId,
    reason,
    proposed: one(ctx.args, '--proposed') ?? '',
    timeoutSec: timeout,
  });

  if (outcome.kind === 'timeout') {
    ctx.out(timeoutMessage(outcome.waitedSec));
    return 0;
  }
  if (ctx.json) {
    ctx.out(JSON.stringify(outcome.value, null, 2));
    return 0;
  }
  ctx.out(presentUnlockDecision(id, lockId, outcome.value.granted, outcome.value.note));
  return outcome.value.granted ? 0 : 4;
}

/* ---------------------------------------------------------------- diff */

export async function cmdDiff(ctx: Ctx): Promise<number> {
  const id = await resolvePlan(ctx.args.positionals[0], 'Which plan?');
  if (!id) return 1;

  const latest = latestVersion(id);
  const [, refA, refB] = ctx.args.positionals;

  let versionA: number | null;
  let versionB: number;
  if (refA && refB) {
    versionA = resolveVersionRef(id, refA);
    versionB = resolveVersionRef(id, refB);
  } else if (refA) {
    versionB = resolveVersionRef(id, refA);
    versionA = versionB > 1 ? versionB - 1 : null;
  } else {
    versionB = latest;
    versionA = latest > 1 ? latest - 1 : null;
  }

  const printOnly = has(ctx.args, '--print') || !isInteractive();
  const newText = requireVersionText(id, versionB);
  const rows =
    versionA === null
      ? rowsForSingleVersion(newText)
      : diffVersions(requireVersionText(id, versionA), newText);

  if (has(ctx.args, '--stat')) {
    ctx.out(renderStatLine(rows));
    return 0;
  }

  if (printOnly) {
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

  return runInteractiveReview(ctx, id, versionA, versionB);
}

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
    mode: ctx.mode,
    pending: pendingRequests(id),
    previous: listFeedback(id).filter((f) => f.version === versionB),
  });

  if (result.action === 'quit') {
    ctx.out(dim('nothing submitted'));
    return 0;
  }

  if (result.action === 'unlock') {
    if (!result.unlock) return 0;
    respondToUnlock({
      planId: id,
      version: versionB,
      lockId: result.unlock.lockId,
      granted: result.unlock.granted,
      note: result.unlock.note,
      requestId: result.unlock.requestId,
    });
    ctx.out(
      result.unlock.granted
        ? `${green('✓')} granted ${result.unlock.lockId} — one capture may modify it`
        : `${red('✗')} denied ${result.unlock.lockId}`,
    );
    return 0;
  }

  const verdict = result.action === 'submit' ? 'revise' : result.action;
  const submitted = submitFeedback({
    planId: id,
    version: versionB,
    verdict,
    annotations: result.annotations,
    general: result.general,
    requestId: pendingRequests(id).find((r) => r.kind === 'review')?.id ?? null,
  });

  const comments = result.annotations.filter((a) => a.kind === 'comment').length;
  ctx.out(
    `${green('✓')} submitted ${comments} comment(s) on ${bold(id)} v${versionB} (${verdict})`,
  );
  if (submitted.locksCreated.length) {
    ctx.out(dim(`  locked: ${submitted.locksCreated.join(', ')}`));
  }
  if (submitted.locksRemoved.length) {
    ctx.out(dim(`  unlocked: ${submitted.locksRemoved.join(', ')}`));
  }

  if (verdict === 'approve') await afterApproval(ctx, id, versionB, submitted.sealedLocks.length);
  return 0;
}

/**
 * The approve → execute handoff.
 *
 * Same-window model switching is the one thing planx cannot do for you: no
 * agent CLI exposes a way for a running session to change its own model, so we
 * print the exact line to paste rather than shipping something that quietly
 * does not switch (PLAN §9).
 */
async function afterApproval(
  ctx: Ctx,
  id: string,
  version: number,
  sections: number,
): Promise<number> {
  ctx.out('');
  ctx.out(
    `${green('✓')} Approved & sealed — ${bold(id)} v${version} (${sections} sections locked)`,
  );

  if (!isInteractive()) return 0;

  const [where] = await runPicker<'here' | 'new' | 'later'>({
    title: 'Execute it?',
    items: [
      { value: 'here', label: 'same window', hint: 'keeps the research context this session has' },
      { value: 'new', label: 'new window', hint: 'clean context; model applied automatically' },
      { value: 'later', label: 'not now', hint: 'just tell me the id' },
    ],
  });
  if (!where || where === 'later') return 0;

  const config = readConfig();
  const { name: agentName, agent } = resolveAgent(config, one(ctx.args, '--agent'));
  const models = agent.models.length ? agent.models : [];
  const [model] = models.length
    ? await runPicker<string>({
        title: `Which model for ${agentName}?`,
        items: [
          { value: '', label: `(current default)`, hint: 'no --model flag' },
          ...models.map((m) => ({ value: m, label: m })),
        ],
      })
    : [''];

  if (where === 'here') {
    ctx.out('');
    if (model) {
      ctx.out('  Execute here with a different model? Paste this, then say "go":');
      ctx.out(yellow(`      ${agent.model_switch.replace('{model}', model)}`));
      ctx.out('');
    }
    ctx.out('  Or execute in a new window (model applied automatically):');
    ctx.out(
      yellow(
        `      planx execute ${id} v${version} --agent ${agentName}${model ? ` --model ${model}` : ''}`,
      ),
    );
    return 0;
  }

  return runExecute(ctx, id, version, agentName, model || null, [], false);
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
  for (const plan of plans) {
    const badge = plan.sealed ? green(' 🔒') : plan.approved ? green(' ✓') : '  ';
    ctx.out(
      `${badge} ${cyan(plan.id.padEnd(idWidth))}  ${dim(`v${plan.latest}`.padEnd(5))} ${dim(ago(plan.updated).padEnd(8))} ${plan.title}`,
    );
  }
  return 0;
}

export function cmdVersions(ctx: Ctx): number {
  const id = resolvePlanRef(requirePositional(ctx, 0, 'planx versions <id>'));
  const versions = readVersions(id).versions.sort((a, b) => a.n - b.n);

  if (ctx.json) {
    ctx.out(JSON.stringify(versions, null, 2));
    return 0;
  }
  for (const v of versions) {
    const stored = readVersionText(id, v.n) === null ? red(' (trimmed)') : '';
    ctx.out(
      `  ${cyan(`v${v.n}`.padEnd(5))} ${dim(v.sha256.slice(0, 8))} ${dim(ago(v.created).padEnd(8))} ${v.author}${v.agent ? `/${v.agent}` : ''}${v.note ? `  ${v.note}` : ''}${stored}`,
    );
  }
  return 0;
}

export function cmdLocks(ctx: Ctx): number {
  const id = resolvePlanRef(requirePositional(ctx, 0, 'planx locks <id>'));
  const locks = readLocks(id);

  if (ctx.json) {
    ctx.out(JSON.stringify(locks, null, 2));
    return 0;
  }
  if (locks.sealed_at) {
    ctx.out(green(`sealed at ${locks.sealed_at} (v${locks.sealed_version})`));
  }
  const entries = Object.values(locks.locks);
  if (!entries.length) {
    ctx.out(dim('no locks'));
    return 0;
  }
  for (const lock of entries) {
    const lines = lock.text.split('\n').length;
    ctx.out(
      `  🔒 ${cyan(lock.id.padEnd(5))} ${lock.section ?? dim('(preamble)')} ${dim(`— ${lines} lines, ${lock.origin}`)}`,
    );
  }
  const open = Object.values(locks.grants).filter((g) => g.used_at === null);
  for (const grant of open) {
    ctx.out(yellow(`  ⚑ grant open for ${grant.lock_id} — one capture may modify it`));
  }
  return 0;
}

/* ------------------------------------------------------------- execute */

export async function cmdExecute(ctx: Ctx): Promise<number> {
  const id = await resolvePlan(ctx.args.positionals[0], 'Execute which plan?');
  if (!id) return 1;
  const version = resolveVersionRef(id, ctx.args.positionals[1]);

  const config = readConfig();
  let agentName = one(ctx.args, '--agent') ?? null;
  if (!agentName && isInteractive()) {
    const [picked] = await runPicker<string>({
      title: 'Which agent?',
      items: Object.keys(config.agents).map((name) => ({
        value: name,
        label: name,
        hint: config.agents[name]!.cmd,
      })),
    });
    agentName = picked ?? null;
    if (!agentName) return 1;
  }

  const { name, agent } = resolveAgent(config, agentName);
  let model = one(ctx.args, '--model') ?? null;
  if (!model && agent.models.length && isInteractive()) {
    const [picked] = await runPicker<string>({
      title: `Which model for ${name}?`,
      items: [
        { value: '', label: '(current default)', hint: 'no --model flag' },
        ...agent.models.map((m) => ({ value: m, label: m })),
      ],
    });
    model = picked || null;
  }

  const extra = splitArgs(one(ctx.args, '--args') ?? '');
  return runExecute(ctx, id, version, name, model, extra, has(ctx.args, '--dry-run'));
}

async function runExecute(
  ctx: Ctx,
  id: string,
  version: number,
  agentName: string,
  model: string | null,
  extraArgs: string[],
  dryRun: boolean,
): Promise<number> {
  const config = readConfig();
  const { agent } = resolveAgent(config, agentName);
  const meta = readMeta(id);
  const built = buildCommand(agent, {
    planId: id,
    version,
    planPath: paths.versionFile(id, version),
    planText: requireVersionText(id, version),
    model,
    cwd: meta?.cwd || process.cwd(),
    extraArgs,
  });

  // Always show the argv before running it — a command that spawns another
  // agent with permissions attached should never be a surprise.
  ctx.out(dim(`  ${formatCommand(built)}`));
  if (dryRun) return 0;

  if (!meta?.approved_at) {
    ctx.err(yellow('  warning: this plan was never approved'));
  }
  return runCommand(built, meta?.cwd || process.cwd());
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

async function confirmDestructive(question: string): Promise<boolean> {
  if (!isInteractive()) {
    throw new Error('planx: not a terminal — pass --yes to confirm in a script.');
  }
  const [answer] = await runPicker<boolean>({
    title: question,
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

  ctx.out(`${bold('planx')} ${config.enabled ? green('on') : red('off')}`);
  ctx.out(`  store      ${paths.root()}`);
  ctx.out(`  plans      ${plans.length} (${plans.filter((p) => p.approved).length} approved)`);
  ctx.out(`  trash      ${listTrash().length}`);
  ctx.out(`  render     ${config.render}`);
  ctx.out(`  agent      ${config.defaultAgent}`);
  ctx.out(`  skills     ${skills.length ? '' : dim('none installed — run `planx install`')}`);
  for (const skill of skills) ctx.out(`             ${dim(skill)}`);
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
