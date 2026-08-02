import { locateLock } from '../locks/anchor.js';
import type { Feedback, LocksFile } from '../store/types.js';

export interface PresentOptions {
  planId: string;
  version: number;
  feedback: Feedback[];
  locks: LocksFile;
  /** The version's lines, for reporting where each lock currently sits. */
  docLines: string[];
}

/**
 * The markdown `await` prints when it unblocks.
 *
 * This is a prompt, not a report. It is designed to be maximally actionable in
 * context: every annotation carries the verbatim quote it refers to, the locked
 * list states the constraint as an instruction, and the last line is the exact
 * command to run next (PLAN §5).
 */
export function presentFeedback(opts: PresentOptions): string {
  const verdict = summarizeVerdict(opts.feedback);
  const out: string[] = [
    `## planx feedback — ${opts.planId} v${opts.version} (verdict: ${verdict})`,
    '',
  ];

  let index = 0;
  for (const record of opts.feedback) {
    for (const annotation of record.annotations) {
      if (annotation.kind !== 'comment') continue;
      index++;
      const where = annotation.section ? ` under ${JSON.stringify(annotation.section)}` : '';
      const lines =
        annotation.anchor.start_line === annotation.anchor.end_line
          ? `line ${annotation.anchor.start_line}`
          : `lines ${annotation.anchor.start_line}–${annotation.anchor.end_line}`;
      out.push(`### [${annotation.id || `a${index}`}]${where} (${lines})`);
      for (const line of annotation.quote.split('\n')) out.push(`> ${line}`);
      out.push('');
      if (annotation.comment.trim()) out.push(`**Feedback:** ${annotation.comment.trim()}`, '');
    }

    if (record.general.trim()) {
      out.push('### General', '', record.general.trim(), '');
    }
  }

  const locked = describeLocks(opts);
  if (locked.length) {
    out.push('### 🔒 Locked', ...locked, '');
  }

  if (verdict === 'approve') {
    out.push('---', 'Approved. The plan is sealed — every section is now locked.', '');
    return out.join('\n');
  }
  if (verdict === 'reject') {
    out.push('---', 'Rejected. Stop and ask before writing another version.', '');
    return out.join('\n');
  }

  out.push('---');
  if (locked.length) {
    out.push(
      'Revise the plan addressing every annotation. Locked blocks must be reproduced',
      'as `[[planx:keep L1]]` markers — do not re-emit their text. Then run:',
    );
  } else {
    out.push('Revise the plan addressing every annotation. Then run:');
  }
  out.push(
    `  planx capture --plan-id ${opts.planId} --parent v${opts.version} --splice --stdin`,
    '',
  );
  return out.join('\n');
}

function describeLocks(opts: PresentOptions): string[] {
  const rows: string[] = [];
  for (const lock of Object.values(opts.locks.locks)) {
    const found = locateLock(opts.docLines, lock);
    const where = found.ok
      ? found.range.start === found.range.end
        ? `(line ${found.range.start + 1})`
        : `(lines ${found.range.start + 1}–${found.range.end + 1})`
      : '(not located in this version)';
    const label = lock.section ? `${JSON.stringify(lock.section)} ` : '';
    rows.push(`- **${lock.id}** ${label}${where} — do not modify`);
  }
  return rows.sort();
}

/**
 * One verdict for a batch of feedback records: the most recent one wins.
 *
 * Not "any approve outranks a revise" — approving seals a plan but does not end
 * your ability to review it, so approving and then carving a hole and leaving
 * notes is a supported sequence (PLAN §6). Under a precedence rule those later
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
  /** The version's text in skeleton form — locked blocks as `[[planx:keep …]]`. */
  skeleton: string;
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
 * Everything an agent needs to pick a plan back up, in one read.
 *
 * `await` used to deliver this by blocking until the reviewer submitted. The
 * reviewer now hands over a command instead, so the same payload is assembled
 * on demand: the plan as it stands, what was asked of it, and what may not
 * change. The plan text is included rather than left to a second `planx show`
 * call so this works in a session that has never seen the plan.
 */
export function presentResume(opts: ResumeOptions): string {
  const verdict = summarizeVerdict(opts.feedback);

  if (!opts.feedback.length) {
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

  const out: string[] = [
    `## planx — ${opts.planId} v${opts.version} (verdict: ${verdict})`,
    '',
    '### The plan as it stands',
    '',
    '````markdown',
    opts.skeleton.trimEnd(),
    '````',
    '',
    '### What was asked',
    '',
    ...renderAnnotations(opts.feedback),
  ];

  if (opts.carried.length) out.push(...carriedSection(opts.carried));

  const locked = describeLocks(opts);
  if (locked.length) out.push('### 🔒 Locked', ...locked, '');

  if (verdict === 'approve') {
    out.push('---', 'Approved and sealed — every section is locked. Implement it as written.', '');
    return out.join('\n');
  }
  if (verdict === 'reject') {
    out.push('---', 'Rejected. Stop and ask before writing another version.', '');
    return out.join('\n');
  }

  out.push('---');
  if (locked.length) {
    out.push(
      'Revise the plan addressing every comment. Locked blocks must be reproduced',
      'as `[[planx:keep L1]]` markers — do not re-emit their text. Then run:',
    );
  } else {
    out.push('Revise the plan addressing every comment. Then run:');
  }
  out.push(
    `  planx capture --plan-id ${opts.planId} --parent v${opts.version} --splice --stdin`,
    '',
  );
  return out.join('\n');
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
      if (annotation.kind !== 'comment') continue;
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
      if (annotation.kind !== 'comment') continue;
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

/** What `unlock-request` prints once you decide. */
export function presentUnlockDecision(
  planId: string,
  lockId: string,
  granted: boolean,
  note: string,
): string {
  if (!granted) {
    return [
      `## planx — unlock of ${lockId} denied`,
      '',
      note.trim() ? `**Reason:** ${note.trim()}` : 'No reason given.',
      '',
      `${lockId} stays locked. Revise the plan without changing it, or stop and ask.`,
      '',
    ].join('\n');
  }

  return [
    `## planx — unlock of ${lockId} granted (single use)`,
    '',
    note.trim() ? `**Note:** ${note.trim()}` : '',
    '',
    `You may now capture one version that modifies ${lockId}. The grant burns on`,
    `that capture and the lock re-arms on whatever you wrote. Run:`,
    `  planx capture --plan-id ${planId} --splice --stdin`,
    '',
  ]
    .filter((line, i, all) => !(line === '' && all[i - 1] === ''))
    .join('\n');
}
