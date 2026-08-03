#!/usr/bin/env node
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ArgError, has, one, parseArgs, type CommandSpec } from './cli/args.js';
import {
  cmdAddSkills,
  cmdCapture,
  cmdDiff,
  cmdDoctor,
  cmdList,
  cmdLocks,
  cmdRemoveSkills,
  cmdRevise,
  cmdShow,
  cmdUnlock,
  type Ctx,
} from './cli/commands.js';
import { commandHelp, generateReference, topLevelHelp } from './cli/help.js';
import { findCommand, GLOBAL_FLAGS } from './cli/spec.js';
import { red } from './render/ansi.js';
import { setColorEnabled } from './render/ansi.js';
import { StoreCorruptionError } from './store/atomic.js';
import { readConfig } from './store/config.js';
import { setStoreRoot } from './store/paths.js';
import { PlanNotFoundError, resolvePlanRef, VersionNotFoundError } from './store/plans.js';

function packageVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    for (const candidate of [
      join(here, '..', 'package.json'),
      join(here, '..', '..', 'package.json'),
    ]) {
      try {
        return JSON.parse(readFileSync(candidate, 'utf8')).version as string;
      } catch {
        continue;
      }
    }
  } catch {
    /* fall through */
  }
  return '0.0.0';
}

async function dispatch(name: string, ctx: Ctx): Promise<number> {
  switch (name) {
    case 'capture':
      return cmdCapture(ctx);
    case 'revise':
      return cmdRevise(ctx);
    case 'unlock':
      return cmdUnlock(ctx);
    case 'diff':
      return cmdDiff(ctx);
    case 'show':
      return cmdShow(ctx);
    case 'list':
      return cmdList(ctx);
    case 'locks':
      return cmdLocks(ctx);
    case 'add-skills':
      return cmdAddSkills(ctx);
    case 'remove-skills':
      return cmdRemoveSkills(ctx);
    case 'doctor':
      return cmdDoctor(ctx);
    case '__gen-cli-docs':
      ctx.out(generateReference(packageVersion()));
      return 0;
    default:
      throw new Error(`planx: unknown command "${name}". Run \`planx --help\`.`);
  }
}

/**
 * Pull global flags written *before* the command name.
 *
 * `planx --dir /tmp/store list` is how anyone would type it, and treating
 * `--dir` as an unknown command there would be a silly way to fail. The hoisted
 * flags are appended to the command's own argv so there is still exactly one
 * parser.
 */
function hoistGlobalFlags(argv: readonly string[]): { command: string | null; rest: string[] } {
  const takesValue = new Set(
    GLOBAL_FLAGS.filter((f) => f.arg).flatMap((f) => [f.name, f.alias ?? f.name]),
  );
  const known = new Set(GLOBAL_FLAGS.flatMap((f) => [f.name, f.alias ?? f.name]));

  const hoisted: string[] = [];
  let i = 0;
  while (i < argv.length) {
    const token = argv[i]!;
    const name = token.includes('=') ? token.slice(0, token.indexOf('=')) : token;
    if (!known.has(name)) break;
    hoisted.push(token);
    if (takesValue.has(name) && !token.includes('=') && argv[i + 1] !== undefined) {
      hoisted.push(argv[++i]!);
    }
    i++;
  }

  const command = argv[i] ?? null;
  return { command, rest: [...argv.slice(i + 1), ...hoisted] };
}

export async function main(argv: readonly string[]): Promise<number> {
  const version = packageVersion();
  const { command: name, rest } = hoistGlobalFlags(argv);

  // `--help` is a global flag, so it hoists and leaves no command name behind.
  // Without this, `planx --help` would fall through to the bare-`planx` default
  // and print the help for `diff`.
  const bareHelp = name === null && rest.some((a) => a === '--help' || a === '-h');
  if (bareHelp || name === '--help' || name === '-h' || name === 'help') {
    process.stdout.write(`${topLevelHelp(version)}\n`);
    return 0;
  }
  if (name === '--version' || name === '-v') {
    process.stdout.write(`${version}\n`);
    return 0;
  }

  // Bare `planx` is the review: pick a plan, open it. Reviewing is the one
  // thing a person is here to do, so it should not need a subcommand — and a
  // wall of help text is not a useful answer to someone who just typed the
  // name. `planx --help` is still there for the wall.
  let command = name ?? 'diff';
  let commandArgv = rest;

  // A word planx does not recognise is a plan reference. The hand-off an agent
  // prints is a plan id, and `planx <that id>` is what anyone would type; there
  // is no reason for it to be an error while `planx diff <that id>` works.
  // Anything starting with a dash is never a plan, so a mistyped flag keeps the
  // error that names it as one.
  let planRef: string | null = null;
  let spec: CommandSpec | undefined = findCommand(command);
  if (!spec && !command.startsWith('-')) {
    planRef = command;
    command = 'diff';
    commandArgv = [planRef, ...rest];
    spec = findCommand('diff');
  }
  if (!spec) {
    process.stderr.write(red(`planx: unknown command "${command}". Run \`planx --help\`.\n`));
    return 2;
  }

  const args = parseArgs(commandArgv, spec, GLOBAL_FLAGS);

  if (has(args, '--help')) {
    process.stdout.write(`${commandHelp(spec, version)}\n`);
    return 0;
  }
  if (args.unknown.length) {
    process.stderr.write(
      red(`planx: unknown flag ${args.unknown.join(', ')} for \`planx ${command}\`.\n`),
    );
    process.stderr.write(`${commandHelp(spec, version)}\n`);
    return 2;
  }

  const dir = one(args, '--dir');
  if (dir) setStoreRoot(dir);
  if (has(args, '--no-color')) setColorEnabled(false);

  // After `--dir`, or the lookup would run against the wrong store. An
  // ambiguous reference keeps its own message — naming the candidates helps
  // more than being told the word was not a command.
  if (planRef !== null) {
    try {
      args.positionals[0] = resolvePlanRef(planRef);
    } catch (err) {
      if (!(err instanceof PlanNotFoundError)) throw err;
      process.stderr.write(
        red(
          `planx: "${planRef}" is not a command or a stored plan. ` +
            'Run `planx --help`, or `planx list` to see your plans.\n',
        ),
      );
      return 2;
    }
  }

  const mode = has(args, '--plain') ? 'plain' : has(args, '--rich') ? 'rich' : readConfig().render;

  const ctx: Ctx = {
    args,
    json: has(args, '--json'),
    mode,
    version,
    out: (text) => process.stdout.write(`${text}\n`),
    err: (text) => process.stderr.write(`${text}\n`),
  };

  return dispatch(command, ctx);
}

function report(err: unknown): number {
  if (
    err instanceof ArgError ||
    err instanceof PlanNotFoundError ||
    err instanceof VersionNotFoundError ||
    err instanceof StoreCorruptionError
  ) {
    process.stderr.write(`${red(err.message)}\n`);
    return 2;
  }
  if (err instanceof Error) {
    process.stderr.write(`${red(err.message)}\n`);
    if (process.env.PLANX_DEBUG) process.stderr.write(`${err.stack}\n`);
    return 1;
  }
  process.stderr.write(`${red(String(err))}\n`);
  return 1;
}

// npm exposes package binaries through a symlink in node_modules/.bin. Node
// resolves import.meta.url to the real file while leaving argv[1] as that
// symlink, so comparing the two paths literally makes an installed CLI exit
// successfully without ever running main().
let isEntry = false;
if (process.argv[1]) {
  try {
    isEntry = realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    // A missing argv path cannot be this module's executable entry point.
  }
}
if (isEntry) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err) => {
      process.exitCode = report(err);
    });
}
