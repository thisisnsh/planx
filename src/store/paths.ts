import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

let override: string | null = null;

/**
 * Point every subsequent path lookup at a different store. Set once by the CLI
 * from `--dir`, and used by the test suite to keep a developer's real `~/.planx`
 * out of harm's way.
 */
export function setStoreRoot(dir: string | null): void {
  override = dir ? resolve(dir) : null;
}

export function storeRoot(): string {
  if (override) return override;
  const fromEnv = process.env.PLANX_DIR;
  if (fromEnv && fromEnv.trim()) return resolve(fromEnv.trim());
  return join(homedir(), '.planx');
}

export const paths = {
  root: () => storeRoot(),
  config: () => join(storeRoot(), 'config.json'),
  index: () => join(storeRoot(), 'index.json'),
  plansDir: () => join(storeRoot(), 'plans'),
  logsDir: () => join(storeRoot(), 'logs'),

  plan: (id: string) => join(storeRoot(), 'plans', id),
  meta: (id: string) => join(storeRoot(), 'plans', id, 'meta.json'),
  versions: (id: string) => join(storeRoot(), 'plans', id, 'versions.json'),
  locks: (id: string) => join(storeRoot(), 'plans', id, 'locks.json'),
  versionFile: (id: string, n: number) => join(storeRoot(), 'plans', id, `v${n}.md`),
  feedbackDir: (id: string) => join(storeRoot(), 'plans', id, 'feedback'),
  /** One file per version: the review holds a version's feedback, whole. */
  feedbackFile: (id: string, version: number) =>
    join(storeRoot(), 'plans', id, 'feedback', `v${version}.json`),
  inboxDir: (id: string) => join(storeRoot(), 'plans', id, 'inbox'),
  requestFile: (id: string, rid: string) =>
    join(storeRoot(), 'plans', id, 'inbox', `req-${rid}.json`),
  responseFile: (id: string, rid: string) =>
    join(storeRoot(), 'plans', id, 'inbox', `resp-${rid}.json`),
};
