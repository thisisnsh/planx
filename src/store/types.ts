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
  /**
   * The version that was actually built, and when.
   *
   * Written by `planx executed`, which the execute skill runs before its first
   * edit — so it is true whichever route reached the build: the agent planx
   * launched, a command pasted somewhere by hand, or `/planx execute` typed
   * from scratch.
   */
  executed: z
    .object({ version: z.number().int(), at: z.string(), agent: z.string().nullable() })
    .nullable()
    .default(null),
  tags: z.array(z.string()).default([]),
});
export type PlanMeta = z.infer<typeof PlanMetaSchema>;

/* -------------------------------------------------------------- versions */

/**
 * One line the reviewer rewrote in place, in the version they rewrote it on.
 *
 * Appended and never rewritten, so a version edited across two reviews keeps
 * both rounds. `planx revise` collapses them per line before reporting them —
 * the agent is told what its line became, not how the reviewer got there.
 */
export const EditRecordSchema = z.object({
  /** 1-based, in the version being edited. Editing never changes the count. */
  line: z.number().int(),
  before: z.string(),
  after: z.string(),
  at: z.string(),
});
export type EditRecord = z.infer<typeof EditRecordSchema>;

export const VersionRecordSchema = z.object({
  n: z.number().int(),
  sha256: z.string(),
  author: z.enum(['agent', 'human', 'import']).default('agent'),
  agent: z.string().nullable().default(null),
  created: z.string(),
  parent: z.number().int().nullable().default(null),
  note: z.string().nullable().default(null),
  /**
   * Optional with a default, so a store written by this CLI still parses under
   * an older one. That is why it is not a `FORMAT_VERSION` bump: nothing older
   * breaks on it, and it goes in the release notes instead.
   */
  edits: z.array(EditRecordSchema).default([]),
  /** The agent session that captured this version, for forking. */
  session_id: z.string().nullable().default(null),
  /** How that session was started, so the fork lands in the same state. */
  agent_argv: z.array(z.string()).default([]),
});
export type VersionRecord = z.infer<typeof VersionRecordSchema>;

export const VersionsFileSchema = z.object({
  format_version: formatVersion,
  versions: z.array(VersionRecordSchema).default([]),
});
export type VersionsFile = z.infer<typeof VersionsFileSchema>;

/* ----------------------------------------------------------------- index */

export const IndexEntrySchema = z.object({
  title: z.string(),
  cwd: z.string().default(''),
  created: z.string(),
  updated: z.string(),
  latest: z.number().int(),
  /**
   * The version that was built, or null. Just the number: the picker draws
   * every plan in the store on every keystroke, and opening each `meta.json` to
   * colour a row would be a read per plan per frame.
   */
  executed: z.number().int().nullable().default(null),
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
  kind: z.enum(['comment']),
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

/**
 * A version's review, whole.
 *
 * `verdict` went with approve. Zod strips unknown keys, so a record written by
 * an older planx still loads — the field is simply ignored rather than needing
 * a format bump.
 */
export const FeedbackSchema = z.object({
  format_version: formatVersion,
  id: z.string(),
  plan_id: z.string(),
  version: z.number().int(),
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

/**
 * What is left of configuration: how to render, and nothing else.
 *
 * `enabled` went with `planx on`/`off` — enabling planx is the skill's business
 * now, not a flag in the store. `mouse` went with wheel scrolling: an
 * append-only render cannot host a moving cursor, boxes that grow as you type,
 * or folds, so there was nothing on the other side of the trade it offered.
 */
export const ConfigSchema = z.object({
  format_version: formatVersion,
  render: z.enum(['rich', 'plain']).default('rich'),
});
export type Config = z.infer<typeof ConfigSchema>;

/* ---------------------------------------------------------------- update */

/**
 * What the last registry check found. A cache, not configuration.
 *
 * `checked_at` is stamped whether or not the check succeeded, so a machine with
 * no network spends one spawn every six hours rather than one per run, and
 * `latest` is simply absent until a check has managed to answer.
 */
export const UpdateFileSchema = z.object({
  format_version: formatVersion,
  latest: z.string().nullable().default(null),
  checked_at: z.string(),
});
export type UpdateFile = z.infer<typeof UpdateFileSchema>;
