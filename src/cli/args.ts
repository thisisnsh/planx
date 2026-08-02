export interface FlagSpec {
  name: string;
  /** Placeholder for a flag that takes a value; omitted for a boolean flag. */
  arg?: string;
  summary: string;
  alias?: string;
}

export interface CommandSpec {
  name: string;
  usage: string;
  summary: string;
  description?: string;
  flags?: FlagSpec[];
  examples?: string[];
  /** Kept out of `--help` and the generated reference. */
  hidden?: boolean;
}

export interface ParsedArgs {
  positionals: string[];
  values: Map<string, string[]>;
  bools: Set<string>;
  unknown: string[];
}

export class ArgError extends Error {}

/**
 * Parse argv against a command's flags.
 *
 * Knowing up front which flags take a value is what makes `--reason "a b"` and
 * `--stdin` parse the same way without heuristics about what looks like a
 * value. An unrecognised flag is collected rather than ignored, so a typo gets
 * a message instead of silently doing nothing.
 */
export function parseArgs(
  argv: readonly string[],
  spec: CommandSpec,
  global: FlagSpec[] = [],
): ParsedArgs {
  const flags = new Map<string, FlagSpec>();
  for (const flag of [...(spec.flags ?? []), ...global]) {
    flags.set(flag.name, flag);
    if (flag.alias) flags.set(flag.alias, flag);
  }

  const result: ParsedArgs = {
    positionals: [],
    values: new Map(),
    bools: new Set(),
    unknown: [],
  };

  let literal = false;
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;

    if (literal || !token.startsWith('-') || token === '-') {
      result.positionals.push(token);
      continue;
    }
    if (token === '--') {
      literal = true;
      continue;
    }

    const eq = token.indexOf('=');
    const name = eq === -1 ? token : token.slice(0, eq);
    const inlineValue = eq === -1 ? null : token.slice(eq + 1);
    const flag = flags.get(name);

    if (!flag) {
      result.unknown.push(name);
      continue;
    }

    const canonical = flag.name;
    if (!flag.arg) {
      if (inlineValue !== null && /^(false|0|no)$/i.test(inlineValue)) continue;
      result.bools.add(canonical);
      continue;
    }

    const value = inlineValue ?? argv[++i];
    if (value === undefined) throw new ArgError(`planx: ${canonical} needs a value`);
    const existing = result.values.get(canonical);
    if (existing) existing.push(value);
    else result.values.set(canonical, [value]);
  }

  return result;
}

export function one(args: ParsedArgs, name: string): string | undefined {
  return args.values.get(name)?.[0];
}

export function all(args: ParsedArgs, name: string): string[] {
  return args.values.get(name) ?? [];
}

export function has(args: ParsedArgs, name: string): boolean {
  return args.bools.has(name);
}

const DURATION = /^(\d+(?:\.\d+)?)\s*(s|m|h|d|w|mo|y)$/i;

const UNIT_MS: Record<string, number> = {
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
  mo: 2_592_000_000,
  y: 31_536_000_000,
};

/** `90d`, `7d`, `36h`, `2w` → milliseconds. */
export function parseDuration(input: string): number {
  const match = DURATION.exec(input.trim());
  if (!match) {
    throw new ArgError(`planx: "${input}" is not a duration. Use forms like 90d, 36h, 2w.`);
  }
  return Number.parseFloat(match[1]!) * UNIT_MS[match[2]!.toLowerCase()]!;
}

/**
 * Split `--args "a b c"` into argv the way a shell would, honouring quotes.
 * Used only for the passthrough args on `planx execute`.
 */
export function splitArgs(input: string): string[] {
  const out: string[] = [];
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  for (let m = pattern.exec(input); m !== null; m = pattern.exec(input)) {
    out.push(m[1] ?? m[2] ?? m[3] ?? '');
  }
  return out;
}
