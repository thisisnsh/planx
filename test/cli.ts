import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const ENTRY = join(ROOT, 'dist', 'cli.js');

/**
 * Build only when `dist` is older than `src`.
 *
 * The protocol tests drive the real binary as real subprocesses, which is the
 * point — the handshake is the thing most likely to break, and mocking the
 * process boundary would mock away the only part under test (PLAN §17).
 */
export function ensureBuilt(): void {
  if (existsSync(ENTRY) && newest(join(ROOT, 'src')) <= statSync(ENTRY).mtimeMs) return;
  execFileSync('npx', ['tsc', '-p', 'tsconfig.build.json'], { cwd: ROOT, stdio: 'pipe' });
}

function newest(dir: string): number {
  let latest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    latest = Math.max(latest, entry.isDirectory() ? newest(full) : statSync(full).mtimeMs);
  }
  return latest;
}

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export class Cli {
  readonly dir: string;

  constructor() {
    this.dir = mkdtempSync(join(tmpdir(), 'planx-cli-'));
  }

  cleanup(): void {
    rmSync(this.dir, { recursive: true, force: true });
  }

  /** Run planx to completion, collecting output. Never throws on a non-zero exit. */
  run(args: string[], input?: string): Promise<RunResult> {
    return collect(this.spawn(args, input));
  }

  /** Start planx without waiting — for `await`, which is supposed to block. */
  spawn(args: string[], input?: string): ChildProcess {
    const child = spawn('node', [ENTRY, '--dir', this.dir, '--no-color', ...args], {
      env: { ...process.env, NO_COLOR: '1', PLANX_NO_POSTINSTALL: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    if (input !== undefined) {
      child.stdin?.end(input);
    } else {
      child.stdin?.end();
    }
    return child;
  }
}

export function collect(child: ChildProcess): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (c: Buffer) => (stdout += c.toString('utf8')));
    child.stderr?.on('data', (c: Buffer) => (stderr += c.toString('utf8')));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 0, stdout, stderr }));
  });
}

export const PLAN_V1 = `# Guard the clock regression

## Context
The poller reads a snapshot every 15 seconds.

## Approach
Extend the snapshot-regression guard in poller.ts.

## Rollout
Deploy behind the \`ff_clock_guard\` flag, 10% then 50% then 100%.
`;

export const PLAN_V2 = PLAN_V1.replace(
  'Extend the snapshot-regression guard in poller.ts.',
  'Extend the guard in the R2 write path, not the poller.',
);
