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
  const ordered = [...feedback].sort((a, b) => a.created.localeCompare(b.created));
  return ordered[ordered.length - 1]?.verdict ?? 'revise';
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
