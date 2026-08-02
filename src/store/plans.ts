import { readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import {
  ensureDir,
  pathExists,
  readJson,
  readText,
  withFileLock,
  writeAtomic,
  writeJson,
} from './atomic.js';
import { ensureConfig } from './config.js';
import { contentHash, normalize, planId, slugify } from './ids.js';
import { paths } from './paths.js';
import {
  IndexFileSchema,
  LocksFileSchema,
  PlanMetaSchema,
  VersionsFileSchema,
  type IndexEntry,
  type IndexFile,
  type LocksFile,
  type PlanMeta,
  type VersionRecord,
  type VersionsFile,
} from './types.js';

export class PlanNotFoundError extends Error {
  constructor(readonly ref: string) {
    super(`planx: no plan matching "${ref}". Run \`planx list\` to see what is stored.`);
    this.name = 'PlanNotFoundError';
  }
}

export class VersionNotFoundError extends Error {
  constructor(
    readonly id: string,
    readonly ref: string,
  ) {
    super(`planx: ${id} has no version "${ref}". Run \`planx versions ${id}\`.`);
    this.name = 'VersionNotFoundError';
  }
}

export function ensureStore(): void {
  ensureDir(paths.root());
  ensureDir(paths.plansDir());
  ensureDir(paths.trashDir());
  ensureConfig();
}

/* ----------------------------------------------------------------- index */

export function readIndex(): IndexFile {
  return readJson(paths.index(), IndexFileSchema, null) ?? IndexFileSchema.parse({});
}

/** Read-modify-write `index.json` under an advisory lock. */
export function updateIndex(fn: (index: IndexFile) => void): void {
  ensureDir(paths.root());
  withFileLock(paths.index(), () => {
    const index = readIndex();
    fn(index);
    writeJson(paths.index(), index);
  });
}

function indexEntryFor(meta: PlanMeta, versions: VersionsFile, locks: LocksFile): IndexEntry {
  return {
    title: meta.title,
    cwd: meta.cwd,
    created: meta.created,
    updated: meta.updated,
    latest: latestVersionNumber(versions),
    approved: meta.approved_at !== null,
    sealed: locks.sealed_at !== null,
  };
}

/** Recompute one plan's index row from its own files — the plan dir is truth. */
export function reindex(id: string): void {
  const meta = readMeta(id);
  if (!meta) return;
  const entry = indexEntryFor(meta, readVersions(id), readLocks(id));
  updateIndex((index) => {
    index.plans[id] = entry;
  });
}

/** Rebuild `index.json` from scratch by walking `plans/`. Used by `doctor`. */
export function rebuildIndex(): number {
  const ids = listPlanDirs();
  const plans: Record<string, IndexEntry> = {};
  for (const id of ids) {
    const meta = readMeta(id);
    if (!meta) continue;
    plans[id] = indexEntryFor(meta, readVersions(id), readLocks(id));
  }
  ensureDir(paths.root());
  withFileLock(paths.index(), () => {
    writeJson(paths.index(), IndexFileSchema.parse({ plans }));
  });
  return ids.length;
}

function listPlanDirs(): string[] {
  try {
    return readdirSync(paths.plansDir(), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------ plan files */

export function planExists(id: string): boolean {
  return pathExists(paths.meta(id));
}

export function readMeta(id: string): PlanMeta | null {
  return readJson(paths.meta(id), PlanMetaSchema, null);
}

export function writeMeta(meta: PlanMeta): void {
  writeJson(paths.meta(meta.id), meta);
}

export function readVersions(id: string): VersionsFile {
  return readJson(paths.versions(id), VersionsFileSchema, null) ?? VersionsFileSchema.parse({});
}

export function writeVersions(id: string, versions: VersionsFile): void {
  writeJson(paths.versions(id), versions);
}

export function readLocks(id: string): LocksFile {
  return readJson(paths.locks(id), LocksFileSchema, null) ?? LocksFileSchema.parse({});
}

export function writeLocks(id: string, locks: LocksFile): void {
  writeJson(paths.locks(id), locks);
}

/** Read-modify-write a plan's `locks.json` under an advisory lock. */
export function updateLocks<T>(id: string, fn: (locks: LocksFile) => T): T {
  return withFileLock(paths.locks(id), () => {
    const locks = readLocks(id);
    const result = fn(locks);
    writeLocks(id, locks);
    return result;
  });
}

export function readVersionText(id: string, n: number): string | null {
  return readText(paths.versionFile(id, n));
}

export function latestVersionNumber(versions: VersionsFile): number {
  return versions.versions.reduce((max, v) => Math.max(max, v.n), 0);
}

export function latestVersion(id: string): number {
  return latestVersionNumber(readVersions(id));
}

/* -------------------------------------------------------- plan lifecycle */

export interface CreatePlanOptions {
  title: string;
  content: string;
  source?: string;
  cwd?: string;
  sessionId?: string | null;
  tags?: string[];
  /** Explicit id, from `--name`. Slugified but never hash-suffixed. */
  name?: string | null;
  created?: string;
}

/**
 * Allocate a plan directory and its metadata. Does not write a version — the
 * caller pairs this with `addVersion` so the two go through one code path.
 */
export function createPlan(opts: CreatePlanOptions): PlanMeta {
  ensureStore();
  const now = opts.created ?? new Date().toISOString();

  let id: string;
  if (opts.name) {
    // A name the user chose can legitimately collide with an unrelated plan.
    id = uniqueId(slugify(opts.name));
  } else {
    // A derived id encodes the title *and* the content, so an existing plan
    // under it is the same plan. Returning it makes re-import and defensive
    // re-capture idempotent; allocating `-2` would fork a duplicate every time.
    const derived = planId(opts.title, opts.content);
    const existing = readMeta(derived);
    if (existing) return existing;
    // A trashed plan still owns its directory name, so step around it rather
    // than resurrecting something the user deleted.
    id = pathExists(paths.trashed(derived)) ? uniqueId(derived) : derived;
  }

  const meta = PlanMetaSchema.parse({
    id,
    title: opts.title,
    created: now,
    updated: now,
    source: opts.source ?? 'unknown',
    cwd: opts.cwd ?? process.cwd(),
    session_id: opts.sessionId ?? null,
    tags: opts.tags ?? [],
  });

  ensureDir(paths.plan(id));
  ensureDir(paths.feedbackDir(id));
  ensureDir(paths.inboxDir(id));
  writeMeta(meta);
  writeVersions(id, VersionsFileSchema.parse({}));
  writeLocks(id, LocksFileSchema.parse({}));
  return meta;
}

/**
 * The content hash already keeps distinct plans apart; this only matters for
 * `--name`, where the user picked the string and two plans can legitimately
 * collide.
 */
function uniqueId(base: string): string {
  if (!planExists(base) && !pathExists(paths.trashed(base))) return base;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base}-${i}`;
    if (!planExists(candidate) && !pathExists(paths.trashed(candidate))) return candidate;
  }
  throw new Error(`planx: could not allocate an id for "${base}"`);
}

export interface AddVersionOptions {
  author?: VersionRecord['author'];
  agent?: string | null;
  parent?: number | null;
  note?: string | null;
}

export interface AddVersionResult {
  version: number;
  record: VersionRecord;
  /** False when the content matched the latest version and nothing was written. */
  created: boolean;
}

/**
 * Append a version. Versions are content-addressed: capturing content that is
 * byte-identical to the current latest is a no-op that returns that version, so
 * skills can call `capture` defensively without polluting history.
 *
 * Only the latest is compared. Matching some older version would mean rewinding
 * `latest`, which loses the versions in between — a revision that happens to
 * revert to v1 is still a new decision worth recording.
 */
export function addVersion(
  id: string,
  text: string,
  opts: AddVersionOptions = {},
): AddVersionResult {
  const body = normalize(text).replace(/\n*$/, '\n');
  const sha = contentHash(body);
  const versions = readVersions(id);
  const latest = latestVersionNumber(versions);
  const latestRecord = versions.versions.find((v) => v.n === latest);

  if (latestRecord && latestRecord.sha256 === sha) {
    return { version: latest, record: latestRecord, created: false };
  }

  const n = latest + 1;
  const record: VersionRecord = {
    n,
    sha256: sha,
    author: opts.author ?? 'agent',
    agent: opts.agent ?? null,
    created: new Date().toISOString(),
    parent: opts.parent ?? (latest > 0 ? latest : null),
    note: opts.note ?? null,
  };

  writeAtomic(paths.versionFile(id, n), body);
  versions.versions.push(record);
  writeVersions(id, versions);

  const meta = readMeta(id);
  if (meta) {
    meta.updated = record.created;
    writeMeta(meta);
  }
  reindex(id);

  return { version: n, record, created: true };
}

/* --------------------------------------------------------- version refs */

/**
 * Accepts `v2`, `2`, `latest`, `prev`, `~1`, or a sha256 prefix — the same
 * grammar everywhere a version can be named.
 */
export function resolveVersionRef(id: string, ref: string | undefined | null): number {
  const versions = readVersions(id);
  const latest = latestVersionNumber(versions);
  if (latest === 0) throw new VersionNotFoundError(id, ref ?? 'latest');

  const raw = (ref ?? 'latest').trim();
  if (raw === '' || raw === 'latest' || raw === 'head') return latest;
  if (raw === 'prev' || raw === 'previous') return requireVersion(id, versions, latest - 1, raw);
  if (raw === 'first') return requireVersion(id, versions, minVersion(versions), raw);

  const tilde = /^~(\d+)$/.exec(raw);
  if (tilde) return requireVersion(id, versions, latest - Number.parseInt(tilde[1]!, 10), raw);

  const numeric = /^v?(\d+)$/i.exec(raw);
  if (numeric) return requireVersion(id, versions, Number.parseInt(numeric[1]!, 10), raw);

  if (/^[0-9a-f]{4,64}$/i.test(raw)) {
    const matches = versions.versions.filter((v) => v.sha256.startsWith(raw.toLowerCase()));
    if (matches.length === 1) return matches[0]!.n;
    if (matches.length > 1) {
      throw new Error(
        `planx: sha prefix "${raw}" matches ${matches.length} versions of ${id}. Use more characters.`,
      );
    }
  }

  throw new VersionNotFoundError(id, raw);
}

function minVersion(versions: VersionsFile): number {
  return versions.versions.reduce((min, v) => Math.min(min, v.n), Number.POSITIVE_INFINITY);
}

function requireVersion(id: string, versions: VersionsFile, n: number, ref: string): number {
  if (!versions.versions.some((v) => v.n === n)) throw new VersionNotFoundError(id, ref);
  return n;
}

/* ------------------------------------------------------------- plan refs */

/**
 * Resolve a user-typed plan reference: exact id, unique id prefix, or unique
 * case-insensitive substring of the id or title.
 */
export function resolvePlanRef(ref: string): string {
  if (planExists(ref)) return ref;
  const index = readIndex();
  const ids = Object.keys(index.plans).length ? Object.keys(index.plans) : listPlanDirs();
  const needle = ref.toLowerCase();

  const prefix = ids.filter((id) => id.toLowerCase().startsWith(needle));
  if (prefix.length === 1) return prefix[0]!;

  const substring = ids.filter((id) => {
    const title = index.plans[id]?.title ?? '';
    return id.toLowerCase().includes(needle) || title.toLowerCase().includes(needle);
  });
  if (substring.length === 1) return substring[0]!;

  const ambiguous = prefix.length > 1 ? prefix : substring;
  if (ambiguous.length > 1) {
    throw new Error(
      `planx: "${ref}" matches ${ambiguous.length} plans:\n  ${ambiguous.slice(0, 10).join('\n  ')}`,
    );
  }
  throw new PlanNotFoundError(ref);
}

/* ---------------------------------------------------------------- listing */

export interface PlanSummary extends IndexEntry {
  id: string;
}

export interface ListFilter {
  /** Only plans captured in the current working directory. */
  here?: boolean;
  approved?: boolean;
  unapproved?: boolean;
  olderThanMs?: number;
  ids?: string[];
}

export function listPlans(filter: ListFilter = {}): PlanSummary[] {
  const index = readIndex();
  let rows: PlanSummary[] = Object.entries(index.plans).map(([id, entry]) => ({ id, ...entry }));

  // A plan dir that never made it into the index still exists and should list.
  const known = new Set(rows.map((r) => r.id));
  for (const id of listPlanDirs()) {
    if (known.has(id)) continue;
    const meta = readMeta(id);
    if (!meta) continue;
    rows.push({
      id,
      title: meta.title,
      cwd: meta.cwd,
      created: meta.created,
      updated: meta.updated,
      latest: latestVersion(id),
      approved: meta.approved_at !== null,
      sealed: readLocks(id).sealed_at !== null,
    });
  }

  if (filter.here) {
    const cwd = process.cwd();
    rows = rows.filter((r) => r.cwd === cwd);
  }
  if (filter.approved) rows = rows.filter((r) => r.approved);
  if (filter.unapproved) rows = rows.filter((r) => !r.approved);
  if (filter.olderThanMs !== undefined) {
    const cutoff = Date.now() - filter.olderThanMs;
    rows = rows.filter((r) => Date.parse(r.updated) < cutoff);
  }
  if (filter.ids?.length) {
    const wanted = new Set(filter.ids);
    rows = rows.filter((r) => wanted.has(r.id));
  }

  return rows.sort((a, b) => b.updated.localeCompare(a.updated));
}

/* -------------------------------------------------------- rename / trash */

export function renamePlan(id: string, newName: string): string {
  const meta = readMeta(id);
  if (!meta) throw new PlanNotFoundError(id);
  const target = uniqueId(slugify(newName));
  if (target === id) {
    meta.title = newName;
    writeMeta(meta);
    reindex(id);
    return id;
  }

  renameSync(paths.plan(id), paths.plan(target));
  meta.id = target;
  meta.title = newName;
  writeMeta(meta);
  updateIndex((index) => {
    delete index.plans[id];
  });
  reindex(target);
  return target;
}

export interface TrashedPlan {
  id: string;
  deleted_at: string;
  title: string;
}

/**
 * Soft delete. Losing a plan you spent an hour reviewing is the one
 * unrecoverable failure in this system, so removal takes two deliberate steps:
 * `clean` moves it here, `clean --empty-trash` or `--purge` destroys it.
 */
export function trashPlan(id: string): void {
  if (!planExists(id)) throw new PlanNotFoundError(id);
  ensureDir(paths.trashDir());
  const dest = paths.trashed(id);
  if (pathExists(dest)) rmSync(dest, { recursive: true, force: true });
  renameSync(paths.plan(id), dest);
  writeJson(join(dest, 'deleted.json'), { id, deleted_at: new Date().toISOString() });
  updateIndex((index) => {
    delete index.plans[id];
  });
}

export function restorePlan(id: string): void {
  const src = paths.trashed(id);
  if (!pathExists(src)) throw new PlanNotFoundError(id);
  if (planExists(id)) throw new Error(`planx: ${id} already exists — restore would overwrite it.`);
  ensureDir(paths.plansDir());
  renameSync(src, paths.plan(id));
  rmSync(join(paths.plan(id), 'deleted.json'), { force: true });
  reindex(id);
}

export function purgePlan(id: string): void {
  rmSync(paths.plan(id), { recursive: true, force: true });
  rmSync(paths.trashed(id), { recursive: true, force: true });
  updateIndex((index) => {
    delete index.plans[id];
  });
}

export function listTrash(): TrashedPlan[] {
  let entries: string[];
  try {
    entries = readdirSync(paths.trashDir(), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }
  return entries
    .map((id) => {
      const marker = readJson(join(paths.trashed(id), 'deleted.json'), DeletedMarkerSchema, null);
      const meta = readJson(join(paths.trashed(id), 'meta.json'), PlanMetaSchema, null);
      return {
        id,
        deleted_at: marker?.deleted_at ?? statSafe(paths.trashed(id)),
        title: meta?.title ?? id,
      };
    })
    .sort((a, b) => b.deleted_at.localeCompare(a.deleted_at));
}

function statSafe(p: string): string {
  try {
    return new Date(statSync(p).mtimeMs).toISOString();
  } catch {
    return new Date(0).toISOString();
  }
}

// Kept local: the trash marker is an implementation detail of soft delete, not
// part of the plan format other tools read.
const DeletedMarkerSchema = z.object({
  id: z.string().optional(),
  deleted_at: z.string(),
});

/**
 * Delete specific versions of a plan.
 *
 * The latest version is never removed whatever the caller asks: a plan with no
 * current text is not a plan, and every read path assumes one exists.
 */
export function removeVersions(id: string, versions: number[]): number[] {
  const file = readVersions(id);
  const latest = latestVersionNumber(file);
  const doomed = new Set(versions.filter((n) => n !== latest));
  if (doomed.size === 0) return [];

  for (const n of doomed) {
    rmSync(paths.versionFile(id, n), { force: true });
  }
  file.versions = file.versions.filter((v) => !doomed.has(v.n));
  writeVersions(id, file);
  reindex(id);
  return [...doomed].sort((a, b) => a - b);
}

/** Keep the `keep` most recent versions, preserving `protectedVersions`. */
export function trimVersions(id: string, keep: number, protectedVersions: Set<number>): number[] {
  const ordered = readVersions(id)
    .versions.map((v) => v.n)
    .sort((a, b) => a - b);
  const doomed = ordered
    .slice(0, Math.max(0, ordered.length - keep))
    .filter((n) => !protectedVersions.has(n));
  return removeVersions(id, doomed);
}
