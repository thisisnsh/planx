import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentConfig, Config } from '../store/types.js';

export interface ExecContext {
  planId: string;
  version: number;
  planPath: string;
  planText: string;
  model: string | null;
  cwd: string;
  extraArgs: string[];
}

export interface BuiltCommand {
  cmd: string;
  args: string[];
  /** Temp file holding the prompt, when the agent takes one. */
  promptFile: string | null;
}

/**
 * The header every execution prompt carries.
 *
 * Without it an execution transcript is just a wall of instructions with no
 * way back to the artifact that produced it (PLAN §10).
 */
export function executionPrompt(planId: string, version: number, planText: string): string {
  return [
    `You are executing planx plan ${planId} v${version}, which has been reviewed and approved.`,
    'Implement it as written. If something in it turns out to be wrong, stop and say so',
    'rather than quietly doing something else.',
    '',
    '---',
    '',
    planText.trimEnd(),
    '',
  ].join('\n');
}

/**
 * Substitute the placeholders in an agent's configured argv.
 *
 * Adding another agent CLI is a config entry, not a code change, which is the
 * whole reason this is a template rather than a switch statement (PLAN §10).
 */
export function buildCommand(agent: AgentConfig, ctx: ExecContext): BuiltCommand {
  const prompt = executionPrompt(ctx.planId, ctx.version, ctx.planText);
  let promptFile: string | null = null;

  const needsFile = agent.args.some((arg) => arg.includes('{prompt_file}'));
  if (needsFile) {
    promptFile = join(
      mkdtempSync(join(tmpdir(), 'planx-exec-')),
      `${ctx.planId}-v${ctx.version}.md`,
    );
    writeFileSync(promptFile, prompt, 'utf8');
  }

  const values: Record<string, string> = {
    '{prompt}': prompt,
    '{prompt_file}': promptFile ?? '',
    '{plan_path}': ctx.planPath,
    '{plan_id}': ctx.planId,
    '{version}': String(ctx.version),
    '{model}': ctx.model ?? '',
    '{cwd}': ctx.cwd,
  };

  const substituted = agent.args.map((arg) =>
    arg.replace(
      /\{(prompt|prompt_file|plan_path|plan_id|version|model|cwd)\}/g,
      (m) => values[m] ?? '',
    ),
  );

  const args = ctx.model ? substituted : dropModelFlag(agent.args, substituted);
  return { cmd: agent.cmd, args: [...args, ...ctx.extraArgs], promptFile };
}

/**
 * With no model chosen, `--model {model}` would become `--model ""` and most
 * CLIs reject that. Drop the placeholder and the flag introducing it, so "use
 * whatever the agent defaults to" actually works.
 */
function dropModelFlag(template: readonly string[], substituted: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < template.length; i++) {
    if (template[i] === '{model}') {
      if (out.length && template[i - 1]?.startsWith('-')) out.pop();
      continue;
    }
    out.push(substituted[i]!);
  }
  return out;
}

export function resolveAgent(
  config: Config,
  name?: string | null,
): { name: string; agent: AgentConfig } {
  const agentName = name ?? config.defaultAgent;
  const agent = config.agents[agentName];
  if (!agent) {
    const known = Object.keys(config.agents).join(', ') || 'none configured';
    throw new Error(`planx: no agent "${agentName}" in config. Known agents: ${known}.`);
  }
  return { name: agentName, agent };
}

/** Human-readable argv, for the `--dry-run` and the confirm step. */
export function formatCommand(built: BuiltCommand): string {
  const quote = (s: string) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);
  const args = built.args.map((arg) =>
    arg.length > 120 ? quote(`${arg.slice(0, 117)}...`) : quote(arg),
  );
  return [built.cmd, ...args].join(' ');
}

export function runCommand(built: BuiltCommand, cwd: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(built.cmd, built.args, { cwd, stdio: 'inherit' });
    child.on('error', (err) => {
      const e = err as NodeJS.ErrnoException;
      if (e.code === 'ENOENT') {
        reject(new Error(`planx: "${built.cmd}" is not on your PATH. Is that agent installed?`));
        return;
      }
      reject(err);
    });
    child.on('close', (code) => resolve(code ?? 0));
  });
}
