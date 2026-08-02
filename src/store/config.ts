import { ensureDir, readJson, writeJson } from './atomic.js';
import { paths } from './paths.js';
import { ConfigSchema, type Config } from './types.js';

/**
 * Seeded on first use.
 *
 * There is very little here. The agent registry this used to carry — argv
 * templates, model lists, a slash command to paste — existed only so planx
 * could spawn an agent for you. It does not any more: it prints the command
 * and you run it where you already are.
 */
export function defaultConfig(): Config {
  return ConfigSchema.parse({});
}

export function readConfig(): Config {
  return readJson(paths.config(), ConfigSchema, null) ?? defaultConfig();
}

export function writeConfig(config: Config): void {
  ensureDir(paths.root());
  writeJson(paths.config(), config);
}

/** Write the seed config only if there is nothing there — never clobber. */
export function ensureConfig(): Config {
  const existing = readJson(paths.config(), ConfigSchema, null);
  if (existing) return existing;
  const seeded = defaultConfig();
  writeConfig(seeded);
  return seeded;
}

const SCALAR_KEYS = ['enabled', 'defaultAgent', 'render', 'mouse'] as const;
export type ScalarKey = (typeof SCALAR_KEYS)[number];

export function isScalarKey(key: string): key is ScalarKey {
  return (SCALAR_KEYS as readonly string[]).includes(key);
}

export function configKeys(): readonly string[] {
  return SCALAR_KEYS;
}

/** Read a dotted config path: `render`, `agents.claude.cmd`, `agents`. */
export function getConfigValue(config: Config, key: string): unknown {
  let cursor: unknown = config;
  for (const part of key.split('.')) {
    if (cursor === null || typeof cursor !== 'object') return undefined;
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return cursor;
}

/**
 * Set a scalar config key from a CLI string, coercing to the schema's type and
 * re-validating the whole document so a typo cannot leave an unusable config on
 * disk. Nested agent fields are edited in config.json directly, by design —
 * a `config set agents.claude.args[2]` syntax would be worse than a text editor.
 */
export function setConfigValue(config: Config, key: string, raw: string): Config {
  if (!isScalarKey(key)) {
    throw new Error(
      `planx: "${key}" is not a settable key. Settable: ${SCALAR_KEYS.join(', ')}. ` +
        `Edit ${paths.config()} directly for agent definitions.`,
    );
  }
  const next: Record<string, unknown> = { ...config };
  if (key === 'enabled') {
    next[key] = raw === 'true' || raw === '1' || raw === 'yes';
  } else {
    next[key] = raw;
  }
  const parsed = ConfigSchema.safeParse(next);
  if (!parsed.success) {
    throw new Error(
      `planx: invalid value for ${key}: ${parsed.error.issues[0]?.message ?? 'rejected'}`,
    );
  }
  return parsed.data;
}
