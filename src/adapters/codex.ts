import { readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import type { Adapter, AdapterOptions, ImportedPlan } from './types.js';

interface PlanStep {
  step: string;
  status: string;
}

function sessionsDir(opts: AdapterOptions): string {
  return join(opts.home ?? homedir(), '.codex', 'sessions');
}

/**
 * Codex has no plan files. It emits `update_plan` function calls carrying a
 * structured step list, so the adapter takes the last one per session — the
 * final state of the checklist — plus the prose the agent wrote around it, and
 * normalizes that to a markdown checklist (PLAN §16).
 */
export const codexAdapter: Adapter = {
  name: 'codex',

  describe(opts) {
    return `${sessionsDir(opts)}/YYYY/MM/DD/rollout-*.jsonl`;
  },

  collect(opts) {
    const files = findRollouts(sessionsDir(opts));
    const cutoff = opts.since ? Date.now() - opts.since : 0;
    const out: ImportedPlan[] = [];

    for (const file of files) {
      let mtime: number;
      try {
        mtime = statSync(file).mtimeMs;
      } catch {
        continue;
      }
      if (mtime < cutoff) continue;

      const parsed = readSession(file);
      if (!parsed) continue;
      out.push(parsed);
    }

    return out.sort((a, b) => b.created.localeCompare(a.created)).slice(0, opts.limit ?? Infinity);
  },
};

function findRollouts(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, depth: number) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      // The layout is YYYY/MM/DD, so three levels is all that is ever needed.
      if (entry.isDirectory() && depth < 3) walk(full, depth + 1);
      else if (
        entry.isFile() &&
        entry.name.startsWith('rollout-') &&
        entry.name.endsWith('.jsonl')
      ) {
        out.push(full);
      }
    }
  };
  walk(root, 0);
  return out;
}

function readSession(file: string): ImportedPlan | null {
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    return null;
  }

  let lastPlan: { steps: PlanStep[]; explanation: string; timestamp: string } | null = null;
  const messages: string[] = [];

  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch {
      continue; // a rollout truncated mid-write is normal; skip the bad line
    }

    const plan = extractPlan(record);
    if (plan) {
      lastPlan = { ...plan, timestamp: timestampOf(record) };
      continue;
    }
    const message = extractAgentMessage(record);
    if (message) messages.push(message);
  }

  if (!lastPlan || lastPlan.steps.length === 0) return null;

  const title = pickTitle(lastPlan.explanation, lastPlan.steps[0]!.step);
  const prose = messages.slice(-2);

  const body: string[] = [`# ${title}`, ''];
  if (prose.length) {
    for (const paragraph of prose) body.push(paragraph.trim(), '');
  }
  body.push('## Plan', '');
  for (const step of lastPlan.steps) body.push(renderStep(step));
  body.push('');

  return {
    title,
    text: body.join('\n'),
    created: lastPlan.timestamp,
    source: 'codex',
    sessionId: sessionIdOf(file),
    origin: file,
  };
}

const TITLE_MAX = 72;

/**
 * `explanation` is often a good title, but on the last `update_plan` of a
 * session it is just as often a completion summary — "All requested changes are
 * complete except…" — which makes a terrible plan id. A long or past-tense
 * explanation loses to the first step, which is always phrased as work to do.
 */
function pickTitle(explanation: string, firstStep: string): string {
  const clean = explanation.replace(/\s+/g, ' ').trim();
  const summaryish =
    /^(all |the issue |everything |done[.,: ]|完了)|(\bis (now )?(complete|implemented|fixed|done)\b)/i;
  if (clean && clean.length <= TITLE_MAX && !summaryish.test(clean)) return clean;
  return firstStep.replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX);
}

function renderStep(step: PlanStep): string {
  const done = step.status === 'completed';
  const suffix = step.status === 'in_progress' ? ' _(in progress)_' : '';
  return `- [${done ? 'x' : ' '}] ${step.step}${suffix}`;
}

/**
 * The record shapes are read defensively rather than against a schema. These
 * are another tool's private logs: they can change without warning, and an
 * import that skips a record it does not recognise is much better than one that
 * throws halfway through a backfill.
 */
function extractPlan(record: unknown): { steps: PlanStep[]; explanation: string } | null {
  const payload = pick(record, 'payload') ?? record;
  if (pick(payload, 'name') !== 'update_plan') return null;

  const args = pick(payload, 'arguments');
  let parsed: unknown = args;
  if (typeof args === 'string') {
    try {
      parsed = JSON.parse(args);
    } catch {
      return null;
    }
  }

  const rawSteps = pick(parsed, 'plan');
  if (!Array.isArray(rawSteps)) return null;

  const steps: PlanStep[] = [];
  for (const item of rawSteps) {
    const step = pick(item, 'step');
    if (typeof step !== 'string' || !step.trim()) continue;
    const status = pick(item, 'status');
    steps.push({ step: step.trim(), status: typeof status === 'string' ? status : 'pending' });
  }

  const explanation = pick(parsed, 'explanation');
  return { steps, explanation: typeof explanation === 'string' ? explanation : '' };
}

function extractAgentMessage(record: unknown): string | null {
  const payload = pick(record, 'payload');
  if (pick(payload, 'type') !== 'agent_message') return null;
  const message = pick(payload, 'message');
  return typeof message === 'string' && message.trim() ? message : null;
}

function timestampOf(record: unknown): string {
  const ts = pick(record, 'timestamp');
  if (typeof ts === 'string' && !Number.isNaN(Date.parse(ts))) return ts;
  return new Date().toISOString();
}

/** `rollout-2026-04-20T21-44-18-<uuid>.jsonl` → the uuid. */
function sessionIdOf(file: string): string | null {
  const match = /rollout-.*?-([0-9a-f]{8}-[0-9a-f-]+)\.jsonl$/i.exec(basename(file));
  return match?.[1] ?? null;
}

function pick(value: unknown, key: string): unknown {
  if (value === null || typeof value !== 'object') return undefined;
  return (value as Record<string, unknown>)[key];
}
