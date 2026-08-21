import { spawn } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson, writeJson } from '../store/atomic.js';
import { paths } from '../store/paths.js';
import { UpdateFileSchema, type UpdateFile } from '../store/types.js';

export const PACKAGE_NAME = '@thisisnsh/planx';

/**
 * The dist-tags endpoint, not the `/latest` packument.
 *
 * It is 46 bytes against 2.6 kB, and it is the exact question being asked:
 * what does `npm install -g @thisisnsh/planx` resolve to right now.
 */
const DIST_TAGS = `https://registry.npmjs.org/-/package/${encodeURIComponent(PACKAGE_NAME)}/dist-tags`;

export const FETCH_TIMEOUT_MS = 5_000;

/** How long a cached answer stands before another check is worth a process. */
export const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

/* ------------------------------------------------------------- comparing */

interface Parsed {
  release: number[];
  /** `staging.3` in `0.5.0-staging.3`, or `''` for a plain release. */
  pre: string;
}

function parse(version: string): Parsed {
  const [core = '', ...rest] = version.trim().replace(/^v/, '').split('-');
  return {
    release: core.split('.').map((part) => Number.parseInt(part, 10) || 0),
    pre: rest.join('-'),
  };
}

/** `-1`, `0`, `1` over dot-separated identifiers, numbers compared as numbers. */
function comparePre(a: string, b: string): number {
  if (a === b) return 0;
  // A release outranks any prerelease of the same numbers: 0.5.0 beats
  // 0.5.0-staging.3, which is the whole reason the field exists.
  if (!a) return 1;
  if (!b) return -1;

  const left = a.split('.');
  const right = b.split('.');
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const x = left[i];
    const y = right[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const nx = Number(x);
    const ny = Number(y);
    const numeric = Number.isInteger(nx) && Number.isInteger(ny);
    if (numeric && nx !== ny) return nx < ny ? -1 : 1;
    if (!numeric && x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/**
 * Is `candidate` a version worth telling someone about, given they run `current`?
 *
 * Release numbers first, then the prerelease rule above — so a `-staging.N`
 * build is never told that the release it is ahead of is an update, and is told
 * about its own release when that lands.
 */
export function isNewer(candidate: string, current: string): boolean {
  const a = parse(candidate);
  const b = parse(current);
  const length = Math.max(a.release.length, b.release.length);
  for (let i = 0; i < length; i++) {
    const x = a.release[i] ?? 0;
    const y = b.release[i] ?? 0;
    if (x !== y) return x > y;
  }
  return comparePre(a.pre, b.pre) > 0;
}

/* ---------------------------------------------------------------- cache */

/**
 * The cache, or null for anything unreadable.
 *
 * Unlike the rest of the store this never throws. A plan that fails its schema
 * is a problem worth stopping for; a corrupt note about npm is not worth
 * failing `planx list` over.
 */
function readCache(): UpdateFile | null {
  try {
    return readJson(paths.update(), UpdateFileSchema, null);
  } catch {
    return null;
  }
}

function writeCache(latest: string | null): void {
  writeJson(paths.update(), {
    format_version: 1,
    latest,
    checked_at: new Date().toISOString(),
  } satisfies UpdateFile);
}

/** The version to tell the user about, or null when there is nothing to say. */
export function readUpdate(current: string): string | null {
  const cached = readCache();
  if (!cached?.latest) return null;
  return isNewer(cached.latest, current) ? cached.latest : null;
}

/* --------------------------------------------------------------- notice */

export interface UpdateNotice {
  /** `v0.5.0 is available · run planx update` */
  long: string;
  /** `v0.5.0 is available`, for a rule with no room for the rest. */
  short: string;
}

export function noticeFor(latest: string): UpdateNotice {
  return {
    long: `v${latest} is available · run planx update`,
    short: `v${latest} is available`,
  };
}

let notice: UpdateNotice | null = null;

/**
 * Set once by `main()`, read by `topRule`.
 *
 * Module state in the shape `setColorEnabled` and `setStoreRoot` already use.
 * "Every layout with a border shows it" is a property of the border, and
 * threading a prop through four components and every test that mounts one
 * would cost more than it explains.
 */
export function setUpdateNotice(value: UpdateNotice | null): void {
  notice = value;
}

export function updateNotice(): UpdateNotice | null {
  return notice;
}

/* -------------------------------------------------------------- checking */

/** Is a background check worth a process right now? */
export function shouldCheck(interactive: boolean): boolean {
  if (!interactive) return false;
  if (process.env.PLANX_NO_UPDATE_CHECK) return false;
  if (process.env.CI) return false;
  const cached = readCache();
  if (!cached) return true;
  const age = Date.now() - Date.parse(cached.checked_at);
  return !Number.isFinite(age) || age > CHECK_EVERY_MS;
}

/** This CLI's entry module — `dist/cli.js`, or `src/cli.ts` under the dev runner. */
function cliEntry(): string {
  const here = fileURLToPath(import.meta.url);
  return realpathSync(join(dirname(here), '..', `cli${extname(here)}`));
}

/**
 * Fire the check and forget it.
 *
 * Detached, output discarded, `unref`'d, so the command that spawned it exits
 * without waiting a millisecond. What it writes is read by the *next* run —
 * nothing on the startup path ever touches the network.
 *
 * `execArgv` is carried through because the dev entry needs
 * `--experimental-strip-types`, and `argv[1]` is deliberately not used: npm
 * exposes the binary through a symlink in `node_modules/.bin`.
 */
export function spawnUpdateCheck(interactive: boolean): void {
  if (!shouldCheck(interactive)) return;
  try {
    const child = spawn(process.execPath, [...process.execArgv, cliEntry(), '__update-check'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
  } catch {
    // A CLI that cannot check for updates is a CLI that does not mention them.
  }
}

/**
 * Ask npm what `latest` is. Null for offline, a timeout, or anything unexpected
 * on the wire — the caller decides what silence means.
 */
export async function fetchLatest(): Promise<string | null> {
  try {
    const response = await fetch(DIST_TAGS, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!response.ok) return null;
    const tags: unknown = await response.json();
    const value = (tags as Record<string, unknown> | null)?.latest;
    return typeof value === 'string' && value ? value : null;
  } catch {
    // Offline, DNS, a timeout, a registry outage.
    return null;
  }
}

/**
 * Write down what a check found.
 *
 * Always stamps `checked_at`, success or not, so an offline machine spawns one
 * process every six hours rather than one on every single run. A failed check
 * keeps whatever the last successful one found rather than forgetting it.
 */
export function recordCheck(latest: string | null): void {
  writeCache(latest ?? readCache()?.latest ?? null);
}

export async function runUpdateCheck(): Promise<void> {
  recordCheck(await fetchLatest());
}

/**
 * Confirm a cached answer against the registry before interrupting anyone with it.
 *
 * The cache is up to `CHECK_EVERY_MS` old, so the version it names can be a
 * release behind by the time it is read — and a prompt that stops you to offer
 * a version that is no longer the latest is worse than one that never asked.
 * This is the only place on the startup path that waits on the network, and it
 * only runs once the cache already says there is something to interrupt for:
 * you were about to be stopped anyway.
 *
 * Null means say nothing, including when the fresh answer is that the running
 * version is already current. A registry that cannot be reached falls back to
 * the cached answer rather than swallowing an update that is really there.
 */
export async function confirmUpdate(current: string): Promise<string | null> {
  const latest = await fetchLatest();
  recordCheck(latest);
  if (!latest) return readUpdate(current);
  return isNewer(latest, current) ? latest : null;
}

/**
 * The package root when planx is running from its own checkout, else null.
 *
 * `npm install -g` there would install a *different* planx than the one you
 * just ran, which is the kind of surprise an update command must not spring.
 */
export function sourceCheckout(): string | null {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  return existsSync(join(root, 'src', 'cli.ts')) ? root : null;
}
