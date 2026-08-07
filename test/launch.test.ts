/**
 * Starting an agent from the review.
 *
 * The argv each agent and each intent produces, the filter that keeps a
 * replayed launch line from colliding with the one being built, and the walk up
 * the process tree — against a stubbed `ps`, because a test that reads a real
 * process tree passes on the machine it was written on.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  agentProcess,
  launchFor,
  launchLine,
  replayableArgv,
  runAgent,
  splitCommandLine,
} from '../src/exec/launch.js';

const PID = process.ppid;

/** A `ps` that answers from a table of `pid → "<ppid> <command>"`. */
function ps(table: Record<number, string>) {
  return (pid: number) => table[pid] ?? null;
}

// The suite may itself be running inside Claude Code, which sets this.
beforeEach(() => {
  delete process.env.CLAUDE_PID;
});
afterEach(() => {
  delete process.env.CLAUDE_PID;
});

describe('the command each agent gets', () => {
  it('resumes the recorded session to revise, and opens a fresh one to execute', () => {
    const argv = ['--model', 'opus'];
    const prompt = '/planx revise guard-clock-a3f9';

    // The session that wrote the plan, carried on rather than forked.
    expect(
      launchFor({ agent: 'claude', intent: 'revise', argv, sessionId: 'sess-1', prompt }),
    ).toEqual({
      bin: 'claude',
      args: ['--model', 'opus', '--resume', 'sess-1', prompt],
    });

    // Codex takes `resume` as a subcommand, so its flags go in front of it.
    expect(
      launchFor({ agent: 'codex', intent: 'revise', argv, sessionId: 'sess-1', prompt }),
    ).toEqual({ bin: 'codex', args: ['--model', 'opus', 'resume', 'sess-1', prompt] });

    for (const agent of ['claude', 'codex'] as const) {
      expect(launchFor({ agent, intent: 'execute', argv, prompt })).toEqual({
        bin: agent,
        args: ['--model', 'opus', prompt],
      });
    }
  });

  /** A choice between one thing and nothing is not a choice: the caller prints. */
  it('declines to revise a version with no session recorded', () => {
    expect(
      launchFor({ agent: 'claude', intent: 'revise', sessionId: null, prompt: '/planx revise x' }),
    ).toBe(null);
  });

  it('prints the whole command, quoting the prompt', () => {
    const launch = launchFor({
      agent: 'claude',
      intent: 'execute',
      argv: ['--dangerously-skip-permissions'],
      prompt: '/planx execute guard-clock-a3f9 v3',
    })!;
    expect(launchLine(launch)).toBe(
      'claude --dangerously-skip-permissions "/planx execute guard-clock-a3f9 v3"',
    );
  });
});

describe('replaying the recorded launch line', () => {
  it('keeps the flags the tab was started with, values included', () => {
    expect(replayableArgv(['--dangerously-skip-permissions', '--add-dir', '../shared'])).toEqual([
      '--dangerously-skip-permissions',
      '--add-dir',
      '../shared',
    ]);
    expect(replayableArgv(['--model=opus'])).toEqual(['--model=opus']);
  });

  it('drops the session selectors, so they cannot collide with the resume', () => {
    expect(
      replayableArgv(['--resume', 'old-session', '--model', 'opus', '-c', '--fork-session']),
    ).toEqual(['--model', 'opus']);
    expect(replayableArgv(['--session-id=abc', '--continue'])).toEqual([]);
  });

  it('drops a trailing prompt, which the new one replaces', () => {
    expect(replayableArgv(['--model', 'opus', 'fix the flaky test'])).toEqual(['--model', 'opus']);
    // Codex's subcommands are bare positionals, and go the same way.
    expect(replayableArgv(['resume', '01J2', 'carry on'])).toEqual([]);
    expect(replayableArgv(['--sandbox', 'workspace-write', 'fork', '01J2'])).toEqual([
      '--sandbox',
      'workspace-write',
    ]);
  });
});

/**
 * The reviewer can rewrite the line before pressing enter, so what planx runs is
 * a string. `splitCommandLine` is what turns it back into argv.
 */
describe('splitting a launch line back into arguments', () => {
  it('round-trips everything launchLine quotes', () => {
    for (const args of [
      ['/planx execute guard-clock-a3f9 v3'],
      ['--add-dir', '../a shared dir', 'say "hello"'],
      ['a\\backslash', "it's", '$HOME', '`tick`'],
      ['--model=opus'],
    ]) {
      expect(splitCommandLine(launchLine({ bin: 'claude', args }))).toEqual(['claude', ...args]);
    }
  });

  it('honours single quotes, and the escapes inside double ones', () => {
    expect(splitCommandLine(`claude --model 'gpt 5' "a \\"quoted\\" word"`)).toEqual([
      'claude',
      '--model',
      'gpt 5',
      'a "quoted" word',
    ]);
    // Single quotes are literal all the way through, backslash included.
    expect(splitCommandLine(`claude 'a\\b'`)).toEqual(['claude', 'a\\b']);
  });

  /**
   * Split, not shelled: planx spawns the binary directly, so an operator in an
   * edited line reaches the agent as text rather than being interpreted.
   */
  it('passes shell operators through as arguments', () => {
    expect(splitCommandLine('claude "/planx execute x" && rm -rf /')).toEqual([
      'claude',
      '/planx execute x',
      '&&',
      'rm',
      '-rf',
      '/',
    ]);
  });

  it('takes the rest of the line as one argument on an unbalanced quote', () => {
    // The reviewer is mid-edit, not writing a shell script.
    expect(splitCommandLine('claude "/planx revise guard')).toEqual([
      'claude',
      '/planx revise guard',
    ]);
    expect(splitCommandLine('   ')).toEqual([]);
  });
});

describe('finding the agent planx is running under', () => {
  it('takes CLAUDE_PID as the answer rather than searching', () => {
    process.env.CLAUDE_PID = '900';
    expect(agentProcess(ps({ 900: '1 claude --model opus' }))).toEqual({
      agent: 'claude',
      argv: ['--model', 'opus'],
    });
  });

  it('walks up past the shell in between', () => {
    const tree = {
      [PID]: '400 /bin/zsh -i',
      400: '300 npm exec planx',
      300: '1 /usr/local/bin/codex --sandbox workspace-write',
    };
    expect(agentProcess(ps(tree))).toEqual({
      agent: 'codex',
      argv: ['--sandbox', 'workspace-write'],
    });
  });

  it('names the agent behind the runtime that is running it', () => {
    expect(agentProcess(ps({ [PID]: '1 node /opt/bin/claude.js --add-dir ..' }))).toEqual({
      agent: 'claude',
      argv: ['--add-dir', '..'],
    });
  });

  it('records nothing when there is no agent, and nothing when there is no ps', () => {
    expect(agentProcess(ps({ [PID]: '1 /bin/zsh -i' }))).toEqual({ agent: null, argv: [] });
    expect(agentProcess(() => null)).toEqual({ agent: null, argv: [] });
  });

  /** Five shells deep is a wrong tree, not a deeply nested right one. */
  it('gives up rather than walking forever', () => {
    const tree: Record<number, string> = { [PID]: '2 /bin/zsh' };
    for (let pid = 2; pid < 40; pid++) tree[pid] = `${pid + 1} /bin/zsh`;
    tree[40] = '1 claude';
    expect(agentProcess(ps(tree)).agent).toBe(null);
  });
});

describe('running it', () => {
  it('reports the missing binary instead of throwing', async () => {
    const missing: string[] = [];
    const code = await runAgent(
      { bin: 'planx-no-such-agent', args: [] },
      { onMissing: (bin) => missing.push(bin) },
    );
    expect(missing).toEqual(['planx-no-such-agent']);
    expect(code).not.toBe(0);
  });

  it('falls back to this directory when the plan’s is gone, and says so', async () => {
    const fallbacks: string[] = [];
    await runAgent(
      { bin: 'planx-no-such-agent', args: [] },
      { cwd: '/nowhere/that/exists', onFallback: (cwd) => fallbacks.push(cwd) },
    );
    expect(fallbacks).toEqual([process.cwd()]);
  });
});
