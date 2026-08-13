import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { basename } from 'node:path';

/**
 * Starting an agent from the review, and knowing enough about the one you are
 * in to start it the same way.
 *
 * The review already prints two commands you paste somewhere; this is what lets
 * planx run them itself. It knows which plan, which version, which session
 * captured it, and — because it walks its own process tree — how that session's
 * terminal was started.
 */

/** The agents planx can launch. Anything else is a shell in between. */
export const AGENTS = ['claude', 'codex'] as const;
export type AgentName = (typeof AGENTS)[number];

export function isAgent(name: string): name is AgentName {
  return (AGENTS as readonly string[]).includes(name);
}

/** What planx is running under: which agent, and its own command line. */
export interface AgentProcess {
  agent: AgentName | null;
  /** The agent's argv, with argv[0] dropped. Empty when nothing was found. */
  argv: string[];
}

const NO_AGENT: AgentProcess = { agent: null, argv: [] };

/** One line of `ps -o ppid=,args= -p <pid>`, or null when there is no answer. */
export type PsReader = (pid: number) => string | null;

/** A shell between planx and the agent is normal; five of them is a wrong tree. */
const MAX_HOPS = 5;

/**
 * A runtime that runs the agent rather than being it: `node .../claude` names
 * the agent in the second token, not the first.
 */
const RUNTIMES = /^(node|nodejs|node\d+|bun|deno|npx|tsx)$/;

function readPs(pid: number): string | null {
  try {
    const result = spawnSync('ps', ['-o', 'ppid=,args=', '-p', String(pid)], {
      encoding: 'utf8',
    });
    if (result.error || result.status !== 0) return null;
    return result.stdout.trim() || null;
  } catch {
    // Windows has no `ps`. Nothing is recorded, and the launcher runs the bare
    // command — which is the same thing it does for an agent it cannot name.
    return null;
  }
}

/**
 * Which agent planx is running inside, and how that agent was started.
 *
 * Resuming a session restores the conversation, not the terminal it was typed
 * into: a tab started with `--model opus --add-dir ../shared` comes back with
 * neither, which is a different agent with the same memory. So the launch line
 * is recorded alongside the session id and replayed verbatim.
 *
 * planx reads this itself rather than taking it as a flag — it is a fact about
 * planx's own process tree, not something the agent knows about itself.
 */
export function agentProcess(read: PsReader = readPs): AgentProcess {
  // Claude Code puts its own pid here, which skips the search entirely.
  const declared = Number.parseInt(process.env.CLAUDE_PID ?? '', 10);
  let pid = Number.isFinite(declared) && declared > 0 ? declared : process.ppid;

  for (let hop = 0; hop < MAX_HOPS && pid > 1; hop++) {
    const line = read(pid);
    if (!line) return NO_AGENT;

    const match = /^\s*(\d+)\s+(.*)$/.exec(line);
    if (!match) return NO_AGENT;

    const found = agentIn(match[2]!);
    if (found) return found;
    pid = Number.parseInt(match[1]!, 10);
  }
  return NO_AGENT;
}

/** The agent named by a command line, with the argv that followed it. */
function agentIn(command: string): AgentProcess | null {
  const tokens = command.split(/\s+/).filter(Boolean);
  for (let i = 0; i < Math.min(2, tokens.length); i++) {
    const name = basename(tokens[i]!).replace(/\.(js|cjs|mjs|exe|cmd)$/, '');
    if (isAgent(name)) return { agent: name, argv: tokens.slice(i + 1) };
    if (!RUNTIMES.test(name)) return null;
  }
  return null;
}

/**
 * Flags that name a session. Replaying one would collide with the selector the
 * launcher is adding, so both the flag and the value it takes are dropped.
 */
const SESSION_FLAGS = new Set([
  '--resume',
  '-r',
  '--continue',
  '-c',
  '--session-id',
  '--fork-session',
]);

/**
 * Flags whose next token is a value rather than a prompt.
 *
 * Everything bare is dropped — the trailing positional is the last prompt, and
 * the new one is the whole point of the launch — so a value that looks like a
 * word has to be recognised by the flag in front of it. An unlisted flag's
 * value is dropped, which fails loudly at the agent rather than quietly running
 * somebody's old prompt again.
 */
const VALUE_FLAGS = new Set([
  '--model',
  '--add-dir',
  '--agents',
  '--allowed-tools',
  '--allowedTools',
  '--append-system-prompt',
  '--cd',
  '--config',
  '--disallowed-tools',
  '--disallowedTools',
  '--image',
  '-i',
  '--mcp-config',
  '--permission-mode',
  '--permission-prompt-tool',
  '--profile',
  '--sandbox',
  '--setting-sources',
  '--settings',
  '--system-prompt',
]);

/**
 * The recorded launch line, minus what the launcher is about to supply itself.
 *
 * Replay is otherwise verbatim, which means planx re-grants whatever the tab
 * was granted. That is visible rather than silent: the launcher prints the
 * whole command, flags included, before it runs anything.
 */
export function replayableArgv(argv: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    const name = token.includes('=') ? token.slice(0, token.indexOf('=')) : token;

    if (SESSION_FLAGS.has(name)) {
      // `--resume <id>`: the id goes with the flag. `--resume` alone is
      // followed by whatever came next, which is not its value.
      if (!token.includes('=') && argv[i + 1] !== undefined && !argv[i + 1]!.startsWith('-')) i++;
      continue;
    }
    if (!token.startsWith('-')) continue;

    out.push(token);
    if (!token.includes('=') && VALUE_FLAGS.has(name) && argv[i + 1] !== undefined) {
      out.push(argv[++i]!);
    }
  }
  return out;
}

/**
 * Which command planx is handing over, and how the agent gets there.
 *
 * `resume` is the picker's `ctrl+r` rather than the review's hand-off list: back
 * into the session that built a version, with nothing said to it.
 */
export type Intent = 'revise' | 'execute' | 'resume';

export interface LaunchOptions {
  agent: AgentName;
  intent: Intent;
  /** The launch line recorded on the version, replayed in front of everything. */
  argv?: readonly string[];
  /** The session to go back into. Required to revise and to resume, unused to execute. */
  sessionId?: string | null;
  /** The command planx would otherwise have printed for you to paste. Resume sends none. */
  prompt?: string;
}

export interface Launch {
  bin: string;
  args: string[];
}

/**
 * The command for one agent and one intent.
 *
 * Revising resumes the session that wrote the plan rather than forking it. A
 * fork carries the same messages under a new id, which leaves the plan's
 * history in a session nobody opens again and the revision in a session that
 * has no name — you asked for the one that wrote it, and this is it.
 *
 * Resuming an execution sends no prompt at all. You are going back into the
 * conversation that built the plan, and what happens next is yours to type —
 * re-sending `/planx execute` would have the agent re-read the plan and redo
 * work it has already done.
 *
 * Null when the launch cannot work: reviving a session planx was never told
 * about is not something to attempt with a guess.
 */
export function launchFor(opts: LaunchOptions): Launch | null {
  const argv = replayableArgv(opts.argv ?? []);
  const prompt = opts.prompt === undefined ? [] : [opts.prompt];

  if (opts.intent === 'resume') {
    if (!opts.sessionId) return null;
    // Codex takes `resume` as a subcommand, so its flags go in front of it.
    return opts.agent === 'codex'
      ? { bin: 'codex', args: [...argv, 'resume', opts.sessionId] }
      : { bin: 'claude', args: [...argv, '--resume', opts.sessionId] };
  }

  if (opts.intent === 'execute') return { bin: opts.agent, args: [...argv, ...prompt] };
  if (!opts.sessionId) return null;

  return opts.agent === 'codex'
    ? { bin: 'codex', args: [...argv, 'resume', opts.sessionId, ...prompt] }
    : { bin: 'claude', args: [...argv, '--resume', opts.sessionId, ...prompt] };
}

/** The whole command as one line, for the scrollback above the agent's frame. */
export function launchLine(launch: Launch): string {
  return [launch.bin, ...launch.args.map(quote)].join(' ');
}

function quote(arg: string): string {
  return /[\s"'$`\\]/.test(arg) ? `"${arg.replace(/(["\\$`])/g, '\\$1')}"` : arg;
}

/* ----------------------------------------------------- your own commands */

/**
 * The agent a stored command runs, or null.
 *
 * The public half of `agentIn`: a command you wrote is a line to read an agent
 * out of, not a process to walk up to, and only the name matters here.
 */
export function agentInCommand(command: string): AgentName | null {
  return agentIn(command)?.agent ?? null;
}

/**
 * The prompt as the agent that command runs invokes a skill.
 *
 * `$planx` under Codex and `/planx` everywhere else — that is how each of them
 * spells it, and getting it wrong is a launch that starts an agent and then
 * says nothing to it. An unrecognised command gets the slash, which is what
 * every agent but Codex uses.
 */
export function promptFor(command: string, tail: string): string {
  return `${agentInCommand(command) === 'codex' ? '$' : '/'}planx ${tail}`;
}

/**
 * A stored command with the prompt appended as one argument.
 *
 * Quoted the way `launchLine` quotes, so the result goes through the same
 * `splitCommandLine` and the same `spawn` as a line planx built itself. A shell
 * operator inside a stored command is still text handed to the binary rather
 * than something a shell interprets — the same trade the editable command line
 * already makes.
 */
export function customLaunchLine(command: string, prompt: string): string {
  return `${command.trim()} ${quote(prompt)}`;
}

/**
 * One trailing planx prompt, quoted or bare, in either spelling.
 *
 * Anchored at the end, so a command that mentions `/planx` in a system prompt
 * of its own keeps it and gives up only the last one.
 */
const TRAILING_PROMPT =
  /\s+(?:"\\?[$/]planx[^"]*"|'\\?[$/]planx[^']*'|\\?[$/]planx(?:\s+\S+)*)\s*$/;

/**
 * `customLaunchLine` undone: the stored half of a line planx composed.
 *
 * It removes one trailing prompt and nothing else. A line the reviewer rewrote
 * past recognition comes back whole, so what is stored is what they will see
 * next time rather than a guess at which half of it was theirs.
 */
export function stripPrompt(line: string): string {
  return line.replace(TRAILING_PROMPT, '');
}

/**
 * A launch line back into argv — `launchLine`'s inverse.
 *
 * The reviewer can rewrite the line before pressing enter, so what planx runs is
 * a string rather than the argv it built. It is **split**, not handed to a
 * shell: planx spawns the binary directly, as it already does, so `&&`, `|` and
 * `$(…)` in an edited line reach the agent as text rather than being
 * interpreted. What is honoured is the quoting — `"`, `'` and `\` — because that
 * is what the line planx printed is quoted with.
 *
 * An unbalanced quote takes the rest of the line as one argument rather than
 * throwing. The reviewer is mid-edit, not writing a shell script.
 */
export function splitCommandLine(line: string): string[] {
  const out: string[] = [];
  let current = '';
  /** Whether anything at all has been read into `current` — `""` is an argument. */
  let started = false;
  let quoted: '"' | "'" | null = null;

  for (let i = 0; i < line.length; i++) {
    const char = line[i]!;

    if (quoted === "'") {
      // Single quotes are literal all the way through, backslash included.
      if (char === "'") quoted = null;
      else current += char;
      continue;
    }
    if (quoted === '"') {
      if (char === '"') {
        quoted = null;
        continue;
      }
      // Inside double quotes a backslash only escapes what it can: everything
      // else keeps it, the way a shell does.
      if (char === '\\' && /["\\$`]/.test(line[i + 1] ?? '')) current += line[++i]!;
      else current += char;
      continue;
    }

    if (char === '\\' && i + 1 < line.length) {
      current += line[++i]!;
      started = true;
      continue;
    }
    if (char === '"' || char === "'") {
      quoted = char;
      started = true;
      continue;
    }
    if (/\s/.test(char)) {
      if (started) out.push(current);
      current = '';
      started = false;
      continue;
    }
    current += char;
    started = true;
  }

  if (started) out.push(current);
  return out;
}

export interface RunOptions {
  /** The plan's recorded directory. Falls back to this process's own. */
  cwd?: string | null;
  /** Where the fallback notice goes when that directory no longer exists. */
  onFallback?: (cwd: string) => void;
  /** What to print when the binary is not on PATH, before the closing block. */
  onMissing?: (bin: string) => void;
}

/**
 * Hand the terminal to the agent. planx exits with the agent's exit code, and
 * the review tab becomes the agent tab.
 *
 * `ENOENT` is not an error to throw: a machine without that agent on its `PATH`
 * still has to end up with the command it was going to run, which is what the
 * caller prints once this comes back.
 */
export function runAgent(launch: Launch, opts: RunOptions = {}): Promise<number> {
  let cwd = opts.cwd ?? process.cwd();
  if (!existsSync(cwd)) {
    cwd = process.cwd();
    opts.onFallback?.(cwd);
  }

  return new Promise((resolve) => {
    const child = spawn(launch.bin, launch.args, {
      stdio: 'inherit',
      cwd,
      // A `.cmd` shim on Windows is not something Node will exec directly.
      shell: process.platform === 'win32',
    });
    child.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') opts.onMissing?.(launch.bin);
      resolve(127);
    });
    child.on('close', (code) => resolve(code ?? 1));
  });
}
