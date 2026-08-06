import type { EditRecord, Feedback } from '../store/types.js';

interface PresentOptions {
  planId: string;
  version: number;
  feedback: Feedback[];
  /** Lines the reviewer rewrote in place, as the version records them. */
  edits?: readonly EditRecord[];
}

/**
 * One verdict for a batch of feedback records: the most recent one wins.
 *
 * Not "any approve outranks a revise" — approving seals a plan but does not end
 * your ability to review it, so approving and then carving a hole and leaving
 * notes is a supported sequence. Under a precedence rule those later
 * notes would still be reported as an approval and the agent would stop. The
 * reviewer's latest submit is their current position.
 */
function summarizeVerdict(feedback: Feedback[]): Feedback['verdict'] {
  const ordered = [...feedback].sort(
    (a, b) => a.created.localeCompare(b.created) || a.id.localeCompare(b.id),
  );
  return ordered[ordered.length - 1]?.verdict ?? 'revise';
}

export interface ResumeOptions extends PresentOptions {
  /**
   * Comments from earlier versions whose quoted text still appears verbatim in
   * this one. See {@link carriedOver}.
   */
  carried: CarriedComment[];
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
 * Not the plan itself. It used to emit the whole thing as a fenced skeleton on
 * every call, which for a plan of any size dwarfed the feedback it exists to
 * deliver — and the agent that wrote the plan already has it. What survives is
 * the quoted lines each comment is anchored to: one to three lines apiece, and
 * the only thing that makes a line number mean anything after a revision has
 * moved it. A session that genuinely does not have the plan runs
 * `planx show <id> --plain`.
 */
export function presentResume(opts: ResumeOptions): string {
  const verdict = summarizeVerdict(opts.feedback);
  const edits = collapseEdits(opts.edits ?? []);

  // A version nobody has opened. An edit is a review, so a hand-rewritten line
  // takes this branch off the table however few records there are beside it.
  if (!opts.feedback.length && !edits.length) {
    const out = [
      `## planx — ${opts.planId} v${opts.version}`,
      '',
      `No review of v${opts.version} yet. Ask the user to run \`planx\` and review it,`,
      'then to paste back the command it prints. Do not revise in the meantime —',
      'there is nothing to revise towards.',
      '',
    ];
    // Except when the last version's notes look skipped. That is precisely the
    // case where an agent captured a new version, was told nobody has reviewed
    // it yet, and would otherwise never learn it left something behind.
    if (opts.carried.length) out.push(...carriedSection(opts.carried));
    return out.join('\n');
  }

  const out: string[] = [`## planx — ${opts.planId} v${opts.version} (verdict: ${verdict})`, ''];

  // Above what was asked: this is the one part of the review that is already
  // settled, and reading it first is what stops the agent rewriting it.
  if (edits.length) out.push(...editedSection(edits, opts.version));

  // Submitting edits alone writes an empty feedback record, so the heading is
  // conditional on there being something under it rather than on the record.
  const asked = renderAnnotations(opts.feedback);
  if (asked.length) out.push('### What was asked', '', ...asked);

  if (opts.carried.length) out.push(...carriedSection(opts.carried));

  if (verdict === 'approve') {
    out.push('---', 'Approved. Implement it as written.', '');
    return out.join('\n');
  }
  if (verdict === 'reject') {
    out.push('---', 'Rejected. Stop and ask before writing another version.', '');
    return out.join('\n');
  }

  out.push('---');
  // A version whose only review is a set of edits has no comment to address,
  // and telling the agent to address every comment there sends it looking for
  // one. What it has to do instead is carry the reviewer's words through.
  const lead = asked.length
    ? 'Revise the plan addressing every comment.'
    : 'Revise the plan, keeping every edited line exactly as it now reads.';
  out.push(`${lead} Then run:`);
  out.push(`  planx capture --plan-id ${opts.planId} --parent v${opts.version} --stdin`, '');
  return out.join('\n');
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
