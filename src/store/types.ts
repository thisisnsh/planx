import { z } from 'zod';

/**
 * On-disk format version for `~/.planx`.
 *
 * Versioned independently of the npm package (see RELEASING.md §3): a user can
 * roll back the CLI in seconds, but they cannot roll back their store, so every
 * bump here needs a migration note in the changelog.
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
   * instead of guessing (PLAN §20).
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
   * Feedback is open until a newer version exists — that is what "the agent
   * acted on it" means. Two concurrent `await`s therefore both see the same
   * open set, which is the documented concurrency guarantee.
   */
  addressed_by: z.number().int().nullable().default(null),
  /** Await request ids that have printed this feedback. Observability only. */
  delivered_to: z.array(z.string()).default([]),
});
export type Feedback = z.infer<typeof FeedbackSchema>;

/* ----------------------------------------------------------------- inbox */

export const AwaitRequestSchema = z.object({
  format_version: formatVersion,
  id: z.string(),
  kind: z.enum(['review', 'unlock']),
  plan_id: z.string(),
  version: z.number().int(),
  lock_id: z.string().nullable().default(null),
  reason: z.string().default(''),
  /** Proposed replacement text for an unlock request, shown side by side. */
  proposed: z.string().default(''),
  created: z.string(),
  pid: z.number().int().default(0),
  cwd: z.string().default(''),
  ttl_ms: z
    .number()
    .int()
    .default(24 * 60 * 60 * 1000),
});
export type AwaitRequest = z.infer<typeof AwaitRequestSchema>;

export const AwaitResponseSchema = z.object({
  format_version: formatVersion,
  id: z.string(),
  request_id: z.string().nullable().default(null),
  kind: z.enum(['review', 'unlock']),
  plan_id: z.string(),
  version: z.number().int(),
  created: z.string(),
  /** review: the feedback record this response points at. */
  feedback_id: z.string().nullable().default(null),
  /** unlock: the decision. */
  lock_id: z.string().nullable().default(null),
  granted: z.boolean().nullable().default(null),
  grant_id: z.string().nullable().default(null),
  note: z.string().default(''),
  consumed: z.boolean().default(false),
});
export type AwaitResponse = z.infer<typeof AwaitResponseSchema>;

/* ---------------------------------------------------------------- config */

export const AgentConfigSchema = z.object({
  cmd: z.string(),
  args: z.array(z.string()).default([]),
  models: z.array(z.string()).default([]),
  /** Slash command the user pastes to switch model in an existing session. */
  model_switch: z.string().default('/model {model}'),
  /** Where `planx install` writes this agent's skills, relative to $HOME. */
  skills_dir: z.string().default(''),
});
export type AgentConfig = z.infer<typeof AgentConfigSchema>;

export const ConfigSchema = z.object({
  format_version: formatVersion,
  /** `planx off` makes capture/await no-ops so the skills degrade quietly. */
  enabled: z.boolean().default(true),
  defaultAgent: z.string().default('claude'),
  render: z.enum(['rich', 'plain']).default('rich'),
  /** Default `await` slice, kept under Claude Code's 600s Bash ceiling. */
  awaitTimeout: z.number().int().default(480),
  agents: z.record(z.string(), AgentConfigSchema).default({}),
});
export type Config = z.infer<typeof ConfigSchema>;
