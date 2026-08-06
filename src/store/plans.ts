import { readdirSync, rmSync } from 'node:fs';
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
import { normalizedLines } from './text.js';
import {
  IndexFileSchema,
  PlanMetaSchema,
  VersionsFileSchema,
  type EditRecord,
  type IndexEntry,
  type IndexFile,
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
    super(
      `planx: ${id} has no version "${ref}". Open \`planx ${id}\` and press → for its versions.`,
    );
    this.name = 'VersionNotFoundError';
  }
}

export function ensureStore(): void {
  ensureDir(paths.root());
  ensureDir(paths.plansDir());
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

function indexEntryFor(meta: PlanMeta, versions: VersionsFile): IndexEntry {
  return {
    title: meta.title,
    cwd: meta.cwd,
    created: meta.created,
    updated: meta.updated,
    latest: latestVersionNumber(versions),
    executed: meta.executed?.version ?? null,
  };
}

/** Recompute one plan's index row from its own files — the plan dir is truth. */
export function reindex(id: string): void {
  const meta = readMeta(id);
  if (!meta) return;
  const entry = indexEntryFor(meta, readVersions(id));
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
    plans[id] = indexEntryFor(meta, readVersions(id));
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
    id = derived;
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
  return meta;
}

/**
 * The content hash already keeps distinct plans apart; this only matters for
 * `--name`, where the user picked the string and two plans can legitimately
 * collide.
 */
function uniqueId(base: string): string {
  if (!planExists(base)) return base;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base}-${i}`;
    if (!planExists(candidate)) return candidate;
  }
  throw new Error(`planx: could not allocate an id for "${base}"`);
}

export interface AddVersionOptions {
  author?: VersionRecord['author'];
  agent?: string | null;
  parent?: number | null;
  note?: string | null;
  /** The agent session that wrote this version, so planx can fork it later. */
  sessionId?: string | null;
  /** That session's own command line, so a fork lands in the same state. */
  agentArgv?: readonly string[];
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
    edits: [],
    session_id: opts.sessionId ?? null,
    agent_argv: [...(opts.agentArgv ?? [])],
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

/* ------------------------------------------------------ editing in place */

export interface LineEdit {
  /** 1-based, in the version being rewritten. */
  line: number;
  /** The line as the reviewer left it. */
  text: string;
}

export interface RewriteResult {
  /** What was recorded. A line typed back to what it said is dropped on the way in. */
  edits: EditRecord[];
  sha256: string;
}

/**
 * Rewrite lines of a stored version in place — the only way a reviewer's edit
 * reaches disk.
 *
 * No version is minted. The reviewer rewrote a line of the version on screen,
 * and what they submitted is what they meant; a v4 whose only change is the
 * wording a human already settled is a round trip through an agent that has
 * nothing to decide.
 *
 * It refuses the one thing that would make an edit mean something other than it
 * says: an older version is the text a newer one was built from, so rewriting
 * it would change what a later version was revised away from. That rule is the
 * same one the TUI applies before it will open a line, enforced again where the
 * writing happens rather than only in the UI that happens to be driving it.
 */
export function rewriteVersion(id: string, n: number, lines: readonly LineEdit[]): RewriteResult {
  const versions = readVersions(id);
  const latest = latestVersionNumber(versions);
  const record = versions.versions.find((v) => v.n === n);
  if (!record || n !== latest) {
    throw new Error(`planx: only v${latest} of ${id} can be edited — v${n} is not the latest.`);
  }

  const text = readVersionText(id, n);
  if (text === null) throw new Error(`planx: ${id} has no stored v${n}.`);

  const docLines = normalizedLines(text);
  const at = new Date().toISOString();
  const edits: EditRecord[] = [];
  for (const edit of lines) {
    const index = edit.line - 1;
    if (index < 0 || index >= docLines.length) {
      throw new Error(`planx: ${id} v${n} has no line ${edit.line} to edit.`);
    }
    if (docLines[index] === edit.text) continue;
    edits.push({ line: edit.line, before: docLines[index]!, after: edit.text, at });
    docLines[index] = edit.text;
  }
  if (!edits.length) return { edits: [], sha256: record.sha256 };

  const body = normalize(docLines.join('\n')).replace(/\n*$/, '\n');
  writeAtomic(paths.versionFile(id, n), body);

  record.sha256 = contentHash(body);
  record.edits = [...record.edits, ...edits];
  writeVersions(id, versions);

  const meta = readMeta(id);
  if (meta) {
    meta.updated = at;
    writeMeta(meta);
  }
  reindex(id);

  return { edits, sha256: record.sha256 };
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
 * Resolve a user-typed plan reference: the exact id, and nothing else.
 *
 * It used to try a prefix and then a substring of the id or the title, which
 * meant `planx gu` opened `guard-clock-a3f9` while it happened to be the only
 * plan starting with `gu` — and opened something else the week a second one
 * landed. A reference that resolves to a different plan depending on what else
 * is in the store is worse than one that refuses, because the refusal is
 * visible and the wrong plan is not.
 *
 * One rule for the whole CLI: `planx <id>`, `diff`, `show`, `revise` and
 * `capture --plan-id` all come through here, so there is no command where a
 * partial word resolves to a whole plan. Nothing can be ambiguous any more, so
 * the ambiguity error went with the guessing.
 */
export function resolvePlanRef(ref: string): string {
  if (planExists(ref)) return ref;
  throw new PlanNotFoundError(ref);
}

/* ---------------------------------------------------------------- listing */

export interface PlanSummary extends IndexEntry {
  id: string;
}

export interface ListFilter {
  /** Only plans captured in the current working directory. */
  here?: boolean;
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
      executed: meta.executed?.version ?? null,
    });
  }

  if (filter.here) {
    const cwd = process.cwd();
    rows = rows.filter((r) => r.cwd === cwd);
  }
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

/* ------------------------------------------------------------- deletion */

/**
 * Delete a plan and everything under it, permanently.
 *
 * There is no trash. Deleting used to be two steps — `clean` moved a plan to
 * `~/.planx/.trash` and `clean --empty-trash` destroyed it — but nobody ever
 * ran the second one, and a soft delete you never empty is a directory of
 * plans you have already decided you do not want. The red confirmation in the
 * picker is what stands in its place.
 */
export function purgePlan(id: string): void {
  rmSync(paths.plan(id), { recursive: true, force: true });
  updateIndex((index) => {
    delete index.plans[id];
  });
}

/**
 * Delete the whole store — every plan and every version of one.
 *
 * Only `remove-skills` calls this, and only after asking out loud with the path
 * and the plan count on screen. There is nothing behind it.
 */
export function purgeStore(): void {
  rmSync(paths.root(), { recursive: true, force: true });
}

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
