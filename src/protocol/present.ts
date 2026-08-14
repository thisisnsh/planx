import type { EditRecord, Feedback } from '../store/types.js';

interface PresentOptions {
  planId: string;
  version: number;
  /** The stored version, verbatim — the text the next version is edited from. */
  text: string;
  feedback: Feedback[];
  /** Lines the reviewer rewrote in place, as the version records them. */
  edits?: readonly EditRecord[];
}

export interface ResumeOptions extends PresentOptions {
  /**
   * Comments from earlier versions whose quoted text still appears verbatim in
   * this one. See {@link carriedOver}.
   */
  carried: CarriedComment[];
  /**
   * The reader is about to build the plan, not revise it.
   *
   * Same feedback, same quotes, same carried-over section — a different closing
   * block. Executing a plan that still carries comments is supported, and
   * `Revise the plan addressing every comment. Then run planx capture` is the
   * wrong instruction for an agent that is about to build it. It is also the
   * last thing in the output, which is the worst place for a wrong one.
   */
  executing?: boolean;
}

export interface CarriedComment {
  version: number;
  id: string;
  quote: string;
  comment: string;
}

/**
 * What was asked of a plan, in one read.
 *
 * `await` used to deliver this by blocking until the reviewer submitted. The
 * reviewer now hands over a command instead, so the same payload is assembled
 * on demand.
 *
 * The plan comes with it, verbatim. It used to be left out — the agent that
 * wrote the plan already has it, and re-sending it costs more than the feedback
 * this exists to deliver. But an agent working from the copy in its context
 * retypes the plan into `capture`, and retyped prose comes back re-wrapped:
 * paragraphs nobody touched land in the reviewer's diff with their line breaks
 * moved. The diff is the product here, so a few thousand tokens a round is the
 * cheaper side of that trade. The quoted lines each comment is anchored to stay
 * as well — they are what makes a line number mean anything once a revision has
 * moved it.
 */
export function presentResume(opts: ResumeOptions): string {
  const edits = collapseEdits(opts.edits ?? []);
  // Submitting edits alone writes an empty feedback record, so the heading is
  // conditional on there being something under it rather than on the record.
  const asked = renderAnnotations(opts.feedback);

  const out: string[] = [`## planx — ${opts.planId} v${opts.version}`, '', ...planSection(opts)];

  // Above what was asked: this is the one part of the review that is already
  // settled, and reading it first is what stops the agent rewriting it.
  if (edits.length) out.push(...editedSection(edits, opts.version));

  if (asked.length) out.push('### What was asked', '', ...asked);

  // Even on a version nobody has opened. That is precisely the case where an
  // agent captured a new version, was told nobody has reviewed it yet, and
  // would otherwise never learn what the last one left behind.
  if (opts.carried.length) out.push(...carriedSection(opts.carried));

  out.push('---', ...closing(opts, reviewState(opts.feedback, edits, asked), asked.length > 0), '');
  return out.join('\n');
}

/**
 * What the reviewer has done to this version, as far as the closing cares.
 *
 * Three states, and the two empty ones stay apart because they are different
 * facts: `unreviewed` is nobody having looked, `empty` is somebody looking and
 * being happy. An edit is a review, so a hand-rewritten line keeps a version out
 * of both of them however few records sit beside it.
 */
type ReviewState = 'unreviewed' | 'empty' | 'asked';

function reviewState(
  feedback: readonly Feedback[],
  edits: readonly EditRecord[],
  asked: readonly string[],
): ReviewState {
  if (!feedback.length && !edits.length) return 'unreviewed';
  if (!asked.length && !edits.length) return 'empty';
  return 'asked';
}

/**
 * The last thing in the output: what to do with everything above it.
 *
 * Six blocks — three states by two commands — chosen here rather than by each
 * path remembering to consult `executing` on its way out. Every one of them is
 * reached with the plan, the quoted lines and the carried-over comments already
 * written, because what a state changes is the instruction, never the payload.
 *
 * Neither command ever refuses. `revise` with nothing to revise towards revises
 * from what the user asked for in the chat, and `execute` builds what is there.
 */
function closing(opts: ResumeOptions, state: ReviewState, asked: boolean): string[] {
  const capture = `  planx capture --plan-id ${opts.planId} --parent v${opts.version} --stdin`;

  if (state === 'unreviewed') {
    return opts.executing
      ? [
          `No review of v${opts.version} yet, so there is no feedback to work from. Build the plan`,
          'as it stands. Do not capture a new version.',
        ]
      : [
          `No review of v${opts.version} yet, so there is no feedback to work from. Revise from`,
          'what the user asked for in the chat, then run:',
          capture,
        ];
  }

  if (state === 'empty') {
    return opts.executing
      ? [
          'Reviewed with nothing to change. Build the plan as written. Do not',
          'capture a new version.',
        ]
      : [
          `Reviewed with nothing to change — no feedback on v${opts.version}. Revise from what the`,
          'user asked for in the chat, then run:',
          capture,
        ];
  }

  if (opts.executing) {
    return [
      'Build the plan, addressing every comment as you go. Do not capture a new',
      'version: the plan is what was reviewed, and the comments are instructions on',
      'top of it for this build.',
    ];
  }

  // A version whose only review is a set of edits has no comment to address,
  // and telling the agent to address every comment there sends it looking for
  // one. What it has to do instead is carry the reviewer's words through.
  const lead = asked
    ? 'Revise the plan addressing every comment.'
    : 'Revise the plan, keeping every edited line exactly as it now reads.';
  return [`${lead} Then run:`, capture];
}

/**
 * The stored version, to edit from.
 *
 * Fenced and byte-exact, because the next version is this text with the asked-for
 * changes made to it — not this text rewritten from memory. The instruction above
 * the fence is about line breaks specifically: an agent re-emitting a paragraph
 * it did not touch will re-wrap it, and every moved break is a row the reviewer
 * has to read in a diff that promised to show them what changed.
 */
function planSection(opts: PresentOptions): string[] {
  return [
    `### The plan as it stands (v${opts.version})`,
    '',
    'Edit this text. Every line you are not changing comes through byte for byte —',
    'same words, same line breaks, same wrapping. Re-wrap only the paragraphs you',
    'actually rewrote.',
    '',
    ...fenced(opts.text, 'markdown'),
    '',
  ];
}

/**
 * A fenced block that survives its contents.
 *
 * Plans are full of ```ts blocks, so the fence has to be longer than the longest
 * backtick run inside — the same problem `code` solves for one line.
 */
function fenced(text: string, info: string): string[] {
  const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
  const fence = '`'.repeat(longest + 1);
  return [`${fence}${info}`, ...text.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n'), fence];
}

/**
 * One record per line the reviewer rewrote: the earliest `before` against the
 * latest `after`.
 *
 * Records are appended, never rewritten, so a version edited across two reviews
 * carries both rounds. Collapsing them is what makes a line edited twice read as
 * one change from what the agent wrote to what the reviewer settled on — and it
 * drops a line typed back to what it already said, which is not a change at all.
 */
export function collapseEdits(edits: readonly EditRecord[]): EditRecord[] {
  const byLine = new Map<number, EditRecord>();
  for (const edit of edits) {
    const first = byLine.get(edit.line);
    byLine.set(edit.line, first ? { ...first, after: edit.after, at: edit.at } : { ...edit });
  }
  return [...byLine.values()]
    .filter((edit) => edit.before !== edit.after)
    .sort((a, b) => a.line - b.line);
}

function editedSection(edits: readonly EditRecord[], version: number): string[] {
  const out = [
    '### Edited by the reviewer',
    '',
    `They rewrote these lines of v${version} themselves. This is settled text, not a request —`,
    'reproduce it exactly in the next version.',
    '',
  ];
  for (const edit of edits) {
    out.push(
      `- **line ${edit.line}**`,
      `  - was: ${code(edit.before)}`,
      `  - now: ${code(edit.after)}`,
    );
  }
  out.push('');
  return out;
}

/**
 * Inline code, fenced wide enough for whatever is inside it.
 *
 * A plan's lines are full of backticks, and wrapping one in a single pair
 * produces markdown that closes in the middle of the line it is quoting.
 */
function code(text: string): string {
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
  const fence = '`'.repeat(longest + 1);
  const pad = text.startsWith('`') || text.endsWith('`') ? ' ' : '';
  return `${fence}${pad}${text}${pad}${fence}`;
}

function carriedSection(carried: readonly CarriedComment[]): string[] {
  const out = [
    '### Still unaddressed from earlier versions',
    '',
    'These comments were left on an earlier version and the text they quote is',
    'still here word for word, so they were probably never acted on. Check each',
    'one before deciding it does not apply.',
    '',
  ];
  for (const item of carried) {
    out.push(`- **${item.id}** (v${item.version}) on \`${firstLine(item.quote)}\``);
    if (item.comment.trim()) out.push(`  — ${item.comment.trim()}`);
  }
  out.push('');
  return out;
}

/** The annotation and general-note body, shared by `resume` and `await`. */
function renderAnnotations(feedback: Feedback[]): string[] {
  const out: string[] = [];
  let index = 0;
  for (const record of feedback) {
    for (const annotation of record.annotations) {
      index++;
      const where = annotation.section ? ` under ${JSON.stringify(annotation.section)}` : '';
      const lines =
        annotation.anchor.start_line === annotation.anchor.end_line
          ? `line ${annotation.anchor.start_line}`
          : `lines ${annotation.anchor.start_line}–${annotation.anchor.end_line}`;
      out.push(`#### [${annotation.id || `a${index}`}]${where} (${lines})`);
      for (const line of annotation.quote.split('\n')) out.push(`> ${line}`);
      out.push('');
      if (annotation.comment.trim()) out.push(`**Feedback:** ${annotation.comment.trim()}`, '');
    }
    if (record.general.trim()) out.push('#### General', '', record.general.trim(), '');
  }
  return out;
}

/**
 * Comments from older versions whose quoted text survived into this one.
 *
 * Capturing a new version silently retires the previous version's feedback,
 * whether or not anything was done about it. Nothing records that distinction,
 * so it is inferred: if the exact lines a comment quoted are still present, the
 * comment was almost certainly not acted on. It is a heuristic and is reported
 * as one — a comment can be satisfied by changing something else entirely.
 */
export function carriedOver(
  feedback: readonly Feedback[],
  currentVersion: number,
  currentText: string,
): CarriedComment[] {
  const haystack = currentText.replace(/\r\n/g, '\n');
  const out: CarriedComment[] = [];
  const seen = new Set<string>();

  for (const record of feedback) {
    if (record.version >= currentVersion) continue;
    for (const annotation of record.annotations) {
      const quote = annotation.quote.replace(/\r\n/g, '\n').trim();
      if (!quote || !haystack.includes(quote)) continue;
      const key = `${quote} ${annotation.comment}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        version: record.version,
        id: annotation.id || 'a?',
        quote,
        comment: annotation.comment,
      });
    }
  }
  return out;
}

function firstLine(text: string): string {
  const [line = ''] = text.split('\n');
  return line.length > 60 ? `${line.slice(0, 57)}...` : line;
}
