import { readConfig, writeConfig } from './config.js';
import type { Defaults } from './types.js';

/**
 * The user-level defaults, as one registry.
 *
 * The screen, the flags and the generated CLI reference all read this, which is
 * what keeps them from disagreeing about what a default is called or what it
 * does. Adding one later is a key on `DefaultsSchema` and an entry here; the
 * command, its flags, its screen and its docs row all follow.
 */
export interface DefaultField {
  /** The key under `defaults` in the config. */
  key: keyof Defaults;
  /** The row's name on the screen: `revise`, `execute`. */
  label: string;
  /** One line about what it does, under the highlighted row. */
  summary: string;
  /** The flag that sets it without the screen: `--revise`. */
  flag: string;
  /** The prompt planx appends, with `<id>` standing in for a real plan. */
  sample: string;
}

export const DEFAULT_FIELDS: readonly DefaultField[] = [
  {
    key: 'revise_command',
    label: 'revise',
    summary: 'Your own command for the revise hand-off.',
    flag: '--revise',
    sample: 'revise <id> v<n>',
  },
  {
    key: 'execute_command',
    label: 'execute',
    summary: 'Your own command for the execute hand-off.',
    flag: '--execute',
    sample: 'execute <id> v<n>',
  },
];

/** Which default a hand-off row came from, and which key a write lands on. */
export type DefaultKey = keyof Defaults;

export function readDefaults(): Defaults {
  return readConfig().defaults;
}

/**
 * Replace one default, leaving everything else in the config alone.
 *
 * A value that is blank after trimming is stored as `null`, so clearing a field
 * and emptying it are the same thing on disk rather than two states that print
 * differently.
 */
export function writeDefault(key: DefaultKey, value: string | null): Defaults {
  const config = readConfig();
  const trimmed = value === null ? null : value.trim();
  const defaults: Defaults = { ...config.defaults, [key]: trimmed ? trimmed : null };
  writeConfig({ ...config, defaults });
  return defaults;
}
