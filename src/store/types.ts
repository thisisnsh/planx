import { z } from 'zod';

/**
 * On-disk format version for `~/.planx`.
 *
 * Versioned independently of the npm package (see RELEASING.md §4): a user can
 * roll back the CLI in seconds, but they cannot roll back their store, so every
 * bump here must be called out in the GitHub Release notes.
 */
export const FORMAT_VERSION = 1;

const formatVersion = z.number().int().default(FORMAT_VERSION);

/* ------------------------------------------------------------------ meta */

export const PlanMetaSchema = z.object({
  format_version: formatVersion,
  id: z.string(),
  title: z.string(),
  created: z.string(),
  updated: z.string(),
  /** Which agent/adapter first produced this plan: claude, codex, import, stdin… */
  source: z.string().default('unknown'),
  /** Recorded as metadata and filterable (`list --here`), never as a boundary. */
  cwd: z.string().default(''),
  session_id: z.string().nullable().default(null),
  tags: z.array(z.string()).default([]),
  approved_at: z.string().nullable().default(null),
  approved_version: z.number().int().nullable().default(null),
});
export type PlanMeta = z.infer<typeof PlanMetaSchema>;

/* -------------------------------------------------------------- versions */

export const VersionRecordSchema = z.object({
  n: z.number().int(),
  sha256: z.string(),
  author: z.enum(['agent', 'human', 'import']).default('agent'),
  agent: z.string().nullable().default(null),
  created: z.string(),
  parent: z.number().int().nullable().default(null),
  note: z.string().nullable().default(null),
});
export type VersionRecord = z.infer<typeof VersionRecordSchema>;

export const VersionsFileSchema = z.object({
  format_version: formatVersion,
  versions: z.array(VersionRecordSchema).default([]),
});
export type VersionsFile = z.infer<typeof VersionsFileSchema>;

/* ----------------------------------------------------------------- locks */

export const LockRecordSchema = z.object({
  id: z.string(),
  created: z.string(),
  /** "user" — locked by hand in the TUI. "seal" — created by approving a version. */
  origin: z.enum(['user', 'seal']),
  section: z.string().nullable().default(null),
  /** sha256 of the normalized locked text. */
  sha256: z.string(),
  /**
   * sha256 of the lines immediately surrounding the lock. Only consulted when
   * the locked text appears more than once, to pick the right occurrence
   * instead of guessing.
   */
  context_sha: z.string().default(''),
  /** Verbatim locked text, so it can be re-spliced into a later version. */
  text: z.string(),
  first_locked_version: z.number().int(),
  still_present_in: z.number().int(),
  /** Grant id consumed by the capture that last legitimately modified this lock. */
  consumed_grant: z.string().nullable().default(null),
});
export type LockRecord = z.infer<typeof LockRecordSchema>;

/**
 * A single-use permission to modify exactly one lock, issued by the human in
 * response to an `unlock-request`. It authorises one capture and then burns.
 */
export const GrantRecordSchema = z.object({
  id: z.string(),
  lock_id: z.string(),
  granted_at: z.string(),
  reason: z.string().default(''),
  note: z.string().default(''),
  used_at: z.string().nullable().default(null),
  used_by_version: z.number().int().nullable().default(null),
});
export type GrantRecord = z.infer<typeof GrantRecordSchema>;

export const LocksFileSchema = z.object({
  format_version: formatVersion,
  /** Set when a version is approved; null before. */
  sealed_at: z.string().nullable().default(null),
  sealed_version: z.number().int().nullable().default(null),
  next_seq: z.number().int().default(1),
  locks: z.record(z.string(), LockRecordSchema).default({}),
  grants: z.record(z.string(), GrantRecordSchema).default({}),
});
export type LocksFile = z.infer<typeof LocksFileSchema>;

/* ----------------------------------------------------------------- index */

export const IndexEntrySchema = z.object({
  title: z.string(),
  cwd: z.string().default(''),
  created: z.string(),
  updated: z.string(),
  latest: z.number().int(),
  approved: z.boolean().default(false),
  sealed: z.boolean().default(false),
});
export type IndexEntry = z.infer<typeof IndexEntrySchema>;

export const IndexFileSchema = z.object({
  format_version: formatVersion,
  plans: z.record(z.string(), IndexEntrySchema).default({}),
});
export type IndexFile = z.infer<typeof IndexFileSchema>;

/* -------------------------------------------------------------- feedback */

export const AnchorSchema = z.object({
  start_line: z.number().int(),
  end_line: z.number().int(),
  /** Hash of the surrounding lines — disambiguates a quote that appears twice. */
  context_sha: z.string().default(''),
});
export type Anchor = z.infer<typeof AnchorSchema>;

export const AnnotationSchema = z.object({
  id: z.string(),
  kind: z.enum(['comment', 'lock', 'unlock']),
  anchor: AnchorSchema,
  /**
   * The verbatim text of the anchored lines. Anchoring is quote-first: line
   * numbers rot the instant the plan is rewritten, the quote survives.
   */
  quote: z.string(),
  comment: z.string().default(''),
  section: z.string().nullable().default(null),
});
export type Annotation = z.infer<typeof AnnotationSchema>;

export const FeedbackSchema = z.object({
  format_version: formatVersion,
  id: z.string(),
  plan_id: z.string(),
  version: z.number().int(),
  verdict: z.enum(['revise', 'approve', 'reject']),
  annotations: z.array(AnnotationSchema).default([]),
  general: z.string().default(''),
  created: z.string(),
  /**
   * Feedback is outstanding until a newer version exists. That is derived from
   * the version list rather than stored, so it cannot drift from the truth.
   */
  addressed_by: z.number().int().nullable().default(null),
});
export type Feedback = z.infer<typeof FeedbackSchema>;

/* ---------------------------------------------------------------- config */

export const ConfigSchema = z.object({
  format_version: formatVersion,
  /** `planx off` makes capture a no-op so the skills degrade quietly. */
  enabled: z.boolean().default(true),
  render: z.enum(['rich', 'plain']).default('rich'),
});
export type Config = z.infer<typeof ConfigSchema>;
