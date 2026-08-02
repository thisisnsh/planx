import { randomBytes } from 'node:crypto';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import type { z } from 'zod';

export function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

/**
 * Write via a sibling temp file plus `rename`, which is atomic within a
 * filesystem. A reader either sees the whole old file or the whole new one —
 * never a half-written `locks.json`, which is the file that would hurt most.
 */
export function writeAtomic(file: string, data: string): void {
  ensureDir(dirname(file));
  const tmp = `${file}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`;
  try {
    writeFileSync(tmp, data, { encoding: 'utf8', mode: 0o600 });
    renameSync(tmp, file);
  } catch (err) {
    try {
      rmSync(tmp, { force: true });
    } catch {
      /* the rename already consumed it */
    }
    throw err;
  }
}

export function writeJson(file: string, value: unknown): void {
  writeAtomic(file, `${JSON.stringify(value, null, 2)}\n`);
}

export function readText(file: string): string | null {
  try {
    return readFileSync(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

export class StoreCorruptionError extends Error {
  constructor(
    readonly file: string,
    readonly detail: string,
  ) {
    super(`${file} is not valid planx data: ${detail}`);
    this.name = 'StoreCorruptionError';
  }
}

/**
 * Read and validate a JSON file, returning `fallback` when it does not exist.
 * A file that exists but fails its schema is an error, never a silent reset —
 * quietly replacing a plan's locks with defaults is exactly the kind of data
 * loss this store is supposed to make impossible.
 */
export function readJson<S extends z.ZodType>(
  file: string,
  schema: S,
  fallback: z.infer<S> | null = null,
): z.infer<S> | null {
  const raw = readText(file);
  if (raw === null) return fallback;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new StoreCorruptionError(file, err instanceof Error ? err.message : String(err));
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new StoreCorruptionError(file, result.error.issues.map((i) => i.message).join('; '));
  }
  return result.data;
}

const LOCK_STALE_MS = 10_000;
const LOCK_POLL_MS = 25;
const LOCK_WAIT_MS = 5_000;

/**
 * Advisory lock over a single file, used for the two files that more than one
 * process writes: `index.json` and a plan's `locks.json`.
 *
 * `O_EXCL` on a lockfile is the portable primitive here — `flock` is not
 * reliable across the network filesystems people keep dotfiles on. A holder
 * that dies leaves its lockfile behind, so anything older than 10s is stolen.
 */
export function withFileLock<T>(target: string, fn: () => T): T {
  const lockPath = `${target}.lock`;
  ensureDir(dirname(target));
  const deadline = Date.now() + LOCK_WAIT_MS;
  let fd: number | null = null;

  for (;;) {
    try {
      fd = openSync(lockPath, 'wx');
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      let age = 0;
      try {
        age = Date.now() - statSync(lockPath).mtimeMs;
      } catch {
        continue; // holder released between our open and our stat — retry
      }
      if (age > LOCK_STALE_MS) {
        try {
          unlinkSync(lockPath);
        } catch {
          /* someone else stole it first; that is fine */
        }
        continue;
      }
      if (Date.now() > deadline) {
        throw new Error(
          `planx: timed out waiting for ${lockPath}. If no other planx process is running, delete it.`,
        );
      }
      sleepSync(LOCK_POLL_MS);
    }
  }

  try {
    writeFileSync(fd, `${process.pid}\n`);
    return fn();
  } finally {
    if (fd !== null) closeSync(fd);
    try {
      unlinkSync(lockPath);
    } catch {
      /* stolen as stale while we held it — nothing useful to do */
    }
  }
}

/**
 * Block the thread briefly. Only ever used inside the lock-acquire spin, where
 * the whole point is that no other work may proceed.
 */
export function sleepSync(ms: number): void {
  const sab = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(sab), 0, 0, ms);
}

export function pathExists(p: string): boolean {
  return existsSync(p);
}

export function joinPath(...parts: string[]): string {
  return join(...parts);
}
