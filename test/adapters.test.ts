import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { claudeAdapter } from '../src/adapters/claude.js';
import { codexAdapter } from '../src/adapters/codex.js';
import { getAdapter, runImport } from '../src/adapters/index.js';
import {
  buildCommand,
  executionPrompt,
  formatCommand,
  resolveAgent,
} from '../src/exec/registry.js';
import { defaultConfig } from '../src/store/config.js';
import { listPlans, readVersionText } from '../src/store/plans.js';
import { tempStore } from './helpers.js';

let store: ReturnType<typeof tempStore>;
let home: string;

beforeEach(() => {
  store = tempStore();
  home = mkdtempSync(join(tmpdir(), 'planx-home-'));
});
afterEach(() => {
  store.cleanup();
  rmSync(home, { recursive: true, force: true });
});

function writeClaudePlan(name: string, body: string): void {
  const dir = join(home, '.claude', 'plans');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), body, 'utf8');
}

/**
 * Fixtures copied in shape from this machine's real ~/.codex history, including
 * the nesting of `payload` and the fact that `arguments` is a JSON *string*.
 */
function writeCodexRollout(name: string, lines: object[]): void {
  const dir = join(home, '.codex', 'sessions', '2026', '04', '20');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), lines.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf8');
}

function updatePlanRecord(explanation: string, plan: Array<{ step: string; status: string }>) {
  return {
    timestamp: '2026-04-21T01:55:41.298Z',
    type: 'response_item',
    payload: {
      type: 'function_call',
      name: 'update_plan',
      arguments: JSON.stringify({ explanation, plan }),
      call_id: 'call_abc',
    },
  };
}

function agentMessage(message: string) {
  return {
    timestamp: '2026-04-21T01:46:22.953Z',
    type: 'event_msg',
    payload: { type: 'agent_message', message, phase: 'commentary' },
  };
}

describe('the claude adapter', () => {
  it('reads plan files, taking the title from the H1', () => {
    writeClaudePlan('one.md', '# Guard the clock regression\n\n## Context\nStuff.\n');
    const found = claudeAdapter.collect({ home });
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ title: 'Guard the clock regression', source: 'claude' });
  });

  it('skips empty files', () => {
    writeClaudePlan('empty.md', '   \n');
    writeClaudePlan('real.md', '# Real\n\nbody\n');
    expect(claudeAdapter.collect({ home })).toHaveLength(1);
  });

  it('honours --since against the file mtime', () => {
    writeClaudePlan('old.md', '# Old\n\nbody\n');
    writeClaudePlan('new.md', '# New\n\nbody\n');
    const old = new Date(Date.now() - 30 * 86_400_000);
    utimesSync(join(home, '.claude', 'plans', 'old.md'), old, old);

    expect(
      claudeAdapter
        .collect({ home })
        .map((p) => p.title)
        .sort(),
    ).toEqual(['New', 'Old']);
    expect(claudeAdapter.collect({ home, since: 7 * 86_400_000 }).map((p) => p.title)).toEqual([
      'New',
    ]);
  });

  it('returns nothing rather than throwing when the directory is absent', () => {
    expect(claudeAdapter.collect({ home: join(home, 'nope') })).toEqual([]);
  });
});

describe('the codex adapter', () => {
  it('turns the last update_plan into a markdown checklist', () => {
    writeCodexRollout('rollout-2026-04-20T21-44-18-019dadb5-b109-7cb0-959f-d621efee93ee.jsonl', [
      agentMessage('Tracing how update() drives layout before proposing a fix.'),
      updatePlanRecord('Superseded first pass', [{ step: 'Old step', status: 'pending' }]),
      updatePlanRecord('Optimise the PiP scroll path', [
        { step: 'Refactor the content view', status: 'completed' },
        { step: 'Update the render cadence', status: 'in_progress' },
        { step: 'Run a verification build', status: 'pending' },
      ]),
    ]);

    const [plan] = codexAdapter.collect({ home });
    expect(plan).toBeDefined();
    expect(plan!.title).toBe('Optimise the PiP scroll path');
    expect(plan!.sessionId).toBe('019dadb5-b109-7cb0-959f-d621efee93ee');
    expect(plan!.text).toContain('- [x] Refactor the content view');
    expect(plan!.text).toContain('- [ ] Update the render cadence _(in progress)_');
    expect(plan!.text).toContain('- [ ] Run a verification build');
    expect(plan!.text).toContain('Tracing how update() drives layout');
    expect(plan!.text).not.toContain('Old step');
  });

  it('prefers the first step when the explanation is a completion summary', () => {
    writeCodexRollout('rollout-2026-04-20T10-00-00-019dadb5-0000-7000-8000-000000000001.jsonl', [
      updatePlanRecord('All requested changes are complete except installing Homebrew itself', [
        { step: 'Inspect zsh PATH and startup files', status: 'completed' },
      ]),
    ]);
    expect(codexAdapter.collect({ home })[0]!.title).toBe('Inspect zsh PATH and startup files');
  });

  it('skips a session with no update_plan, and survives a truncated line', () => {
    const dir = join(home, '.codex', 'sessions', '2026', '04', '20');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'rollout-2026-04-20T11-00-00-019dadb5-0000-7000-8000-000000000002.jsonl'),
      `${JSON.stringify(agentMessage('chatter'))}\n{"timestamp":"2026-04-2\n`,
      'utf8',
    );
    expect(codexAdapter.collect({ home })).toEqual([]);
  });

  it('names where it looks, for the nothing-found message', () => {
    expect(codexAdapter.describe({ home })).toContain('rollout-*.jsonl');
  });
});

describe('importing', () => {
  it('stores what it finds and is safe to run twice', () => {
    writeClaudePlan('one.md', '# First plan\n\n## Context\nA.\n');
    writeClaudePlan('two.md', '# Second plan\n\n## Context\nB.\n');

    const first = runImport('claude', { home });
    expect(first.imported).toHaveLength(2);
    expect(listPlans()).toHaveLength(2);

    const again = runImport('claude', { home });
    expect(again.imported).toHaveLength(2);
    // Content-addressed: the second run lands on the same ids, adding no versions.
    expect(listPlans()).toHaveLength(2);
    expect(listPlans().every((p) => p.latest === 1)).toBe(true);
  });

  it('imports only the newest with --latest', () => {
    writeClaudePlan('one.md', '# First\n\nbody\n');
    writeClaudePlan('two.md', '# Second\n\nbody two\n');
    expect(runImport('claude', { home, latestOnly: true }).imported).toHaveLength(1);
  });

  it('preserves the plan body verbatim', () => {
    writeClaudePlan('one.md', '# Title\n\n## Approach\nExact text.\n');
    const { planId } = runImport('claude', { home }).imported[0]!;
    expect(readVersionText(planId, 1)).toContain('## Approach\nExact text.');
  });

  it('names the alternatives when asked for an adapter that does not exist', () => {
    expect(() => getAdapter('emacs')).toThrow(/Available: claude, codex/);
  });
});

describe('building an execution command', () => {
  const ctx = {
    planId: 'guard-clock-a3f9',
    version: 3,
    planPath: '/store/plans/guard-clock-a3f9/v3.md',
    planText: '# Guard\n\n## Approach\nDo it.\n',
    cwd: '/work/repo',
    extraArgs: [] as string[],
  };

  it('substitutes every placeholder', () => {
    const config = defaultConfig();
    const { agent } = resolveAgent(config, 'claude');
    const built = buildCommand(agent, { ...ctx, model: 'opus' });

    expect(built.cmd).toBe('claude');
    expect(built.args).toContain('--model');
    expect(built.args).toContain('opus');
    expect(built.args.at(-1)).toContain('planx plan guard-clock-a3f9 v3');
    expect(built.args.at(-1)).toContain('## Approach');
  });

  it('drops the model flag entirely when no model was chosen', () => {
    const { agent } = resolveAgent(defaultConfig(), 'claude');
    const built = buildCommand(agent, { ...ctx, model: null });
    expect(built.args).not.toContain('--model');
    expect(built.args).not.toContain('');
  });

  it('writes a prompt file for an agent that takes one', () => {
    const { agent } = resolveAgent(defaultConfig(), 'aider');
    const built = buildCommand(agent, { ...ctx, model: null });
    expect(built.promptFile).toBeTruthy();
    expect(built.args).toContain(built.promptFile);
  });

  it('appends passthrough arguments last', () => {
    const { agent } = resolveAgent(defaultConfig(), 'codex');
    const built = buildCommand(agent, { ...ctx, model: 'gpt-5.6', extraArgs: ['--full-auto'] });
    expect(built.args.at(-1)).toBe('--full-auto');
  });

  it('names the known agents when asked for one that is not configured', () => {
    expect(() => resolveAgent(defaultConfig(), 'emacs')).toThrow(
      /Known agents: claude, codex, aider/,
    );
  });

  it('keeps the plan id and version in the prompt so transcripts trace back', () => {
    expect(executionPrompt('p-1', 7, '# T\n')).toContain('planx plan p-1 v7');
  });

  it('shortens a huge argument when showing the command', () => {
    const { agent } = resolveAgent(defaultConfig(), 'claude');
    const built = buildCommand(agent, { ...ctx, model: 'opus', planText: 'x'.repeat(5000) });
    expect(formatCommand(built).length).toBeLessThan(400);
  });
});
