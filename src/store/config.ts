import { ensureDir, readJson, writeJson } from './atomic.js';
import { paths } from './paths.js';
import { ConfigSchema, type Config } from './types.js';

/**
 * Seeded on first use.
 *
 * There is very little here. The agent registry this used to carry — argv
 * templates, model lists, a slash command to paste — existed only so planx
 * could spawn an agent for you. It does not any more: it prints the command and
 * you run it where you already are. What is left is `render` and the `defaults`
 * block, which `planx defaults` writes through `src/store/defaults.ts`.
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
