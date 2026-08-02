#!/usr/bin/env node
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ArgError, has, one, parseArgs, type CommandSpec } from './cli/args.js';
import {
  cmdCapture,
  cmdClean,
  cmdConfig,
  cmdDiff,
  cmdDoctor,
  cmdImport,
  cmdInstall,
  cmdList,
  cmdLocks,
  cmdRename,
  cmdRestore,
  cmdResume,
  cmdShow,
  cmdStatus,
  cmdSubmit,
  cmdToggle,
  cmdUninstall,
  cmdUnlock,
  cmdVersions,
  type Ctx,
} from './cli/commands.js';
import { commandHelp, generateReference, topLevelHelp } from './cli/help.js';
import { findCommand, GLOBAL_FLAGS } from './cli/spec.js';
import { red } from './render/ansi.js';
import { setColorEnabled } from './render/ansi.js';
import { StoreCorruptionError } from './store/atomic.js';
import { readConfig } from './store/config.js';
import { setStoreRoot } from './store/paths.js';
import { PlanNotFoundError, VersionNotFoundError } from './store/plans.js';

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

/** Commands that run without a plan and must work with `planx off`. */
const ALWAYS_ON = new Set([
  'on',
  'off',
  'status',
  'config',
  'install',
  'uninstall',
  'doctor',
  '__gen-cli-docs',
]);

async function dispatch(name: string, ctx: Ctx): Promise<number> {
  switch (name) {
    case 'capture':
      return cmdCapture(ctx);
    case 'resume':
      return cmdResume(ctx);
    case 'submit':
      return cmdSubmit(ctx);
    case 'unlock':
      return cmdUnlock(ctx);
    case 'diff':
      return cmdDiff(ctx);
    case 'show':
      return cmdShow(ctx);
    case 'list':
      return cmdList(ctx);
    case 'versions':
      return cmdVersions(ctx);
    case 'locks':
      return cmdLocks(ctx);
    case 'import':
      return cmdImport(ctx);
    case 'clean':
      return cmdClean(ctx);
    case 'restore':
      return cmdRestore(ctx);
    case 'rename':
      return cmdRename(ctx);
    case 'on':
      return cmdToggle(ctx, true);
    case 'off':
      return cmdToggle(ctx, false);
    case 'status':
      return cmdStatus(ctx);
    case 'config':
      return cmdConfig(ctx);
    case 'install':
      return cmdInstall(ctx);
    case 'uninstall':
      return cmdUninstall(ctx);
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

  if (!name || name === '--help' || name === '-h' || name === 'help') {
    process.stdout.write(`${topLevelHelp(version)}\n`);
    return 0;
  }
  if (name === '--version' || name === '-v') {
    process.stdout.write(`${version}\n`);
    return 0;
  }

  const spec: CommandSpec | undefined = findCommand(name);
  if (!spec) {
    process.stderr.write(red(`planx: unknown command "${name}". Run \`planx --help\`.\n`));
    return 2;
  }

  const args = parseArgs(rest, spec, GLOBAL_FLAGS);

  if (has(args, '--help')) {
    process.stdout.write(`${commandHelp(spec)}\n`);
    return 0;
  }
  if (args.unknown.length) {
    process.stderr.write(
      red(`planx: unknown flag ${args.unknown.join(', ')} for \`planx ${name}\`.\n`),
    );
    process.stderr.write(`${commandHelp(spec)}\n`);
    return 2;
  }

  const dir = one(args, '--dir');
  if (dir) setStoreRoot(dir);
  if (has(args, '--no-color')) setColorEnabled(false);

  // `planx off` should make the skills degrade quietly rather than fail loudly,
  // so the write path reports it and returns success.
  if (!ALWAYS_ON.has(name) && !readConfig().enabled) {
    process.stdout.write('PLANX: disabled (`planx on` to re-enable) — skipping\n');
    return 0;
  }

  const mode = has(args, '--plain') ? 'plain' : has(args, '--rich') ? 'rich' : readConfig().render;

  const ctx: Ctx = {
    args,
    json: has(args, '--json'),
    mode,
    out: (text) => process.stdout.write(`${text}\n`),
    err: (text) => process.stderr.write(`${text}\n`),
  };

  return dispatch(name, ctx);
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
