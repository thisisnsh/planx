import { diffVersions } from '../diff/lines.js';
import { bold, dim, green, red, yellow } from '../render/ansi.js';
import type { GrantRecord, LocksFile, LockRecord } from '../store/types.js';
import { locateLock, normalizedLines } from './anchor.js';
import { activeGrant } from './manage.js';

export interface Violation {
  lockId: string;
  section: string | null;
  reason: 'modified' | 'ambiguous';
  /** Lines from the previous version that the lock covered. */
  removed: string[];
  /** Lines that appear to have replaced them. */
  added: string[];
}

export interface VerifyInput {
  locks: LocksFile;
  /** The version being revised, for explaining what changed. Null for a first capture. */
  previousText: string | null;
  nextText: string;
}

export interface VerifyResult {
  violations: Violation[];
  /** Grants that authorised a change and should burn if the capture proceeds. */
  grantsToConsume: GrantRecord[];
  /** Proposed replacement text per lock, used to re-arm a granted lock. */
  proposedByLock: Map<string, string>;
}

/**
 * Check a candidate version against every active lock.
 *
 * Enforcement lives here — inside the write path — rather than in the prompt.
 * The requirement is that locks hold even in bypass-permissions mode, and a
 * prompt is advice: an unattended agent will eventually ignore it. `capture`
 * refusing to write is the only mechanism that survives that.
 */
export function verifyLocks(input: VerifyInput): VerifyResult {
  const result: VerifyResult = { violations: [], grantsToConsume: [], proposedByLock: new Map() };
  const nextLines = normalizedLines(input.nextText);

  for (const lock of Object.values(input.locks.locks)) {
    const grant = activeGrant(input.locks, lock.id);
    if (grant) {
      result.grantsToConsume.push(grant);
      if (grant.note.trim()) result.proposedByLock.set(lock.id, grant.note);
      continue;
    }

    const found = locateLock(nextLines, lock);
    if (found.ok) continue;

    result.violations.push({
      lockId: lock.id,
      section: lock.section,
      reason: found.reason === 'ambiguous' ? 'ambiguous' : 'modified',
      ...explain(input.previousText, input.nextText, lock),
    });
  }

  return result;
}

/**
 * Work out what replaced a locked block, so the rejection can show it.
 *
 * The agent needs to see its own edit quoted back; "L2 was modified" alone
 * sends it hunting. This is best-effort by construction — the block is gone, so
 * we diff the two versions and report the changes that landed where it used to
 * be.
 */
function explain(
  previousText: string | null,
  nextText: string,
  lock: LockRecord,
): { removed: string[]; added: string[] } {
  if (previousText === null) return { removed: lock.text.split('\n'), added: [] };

  const prevLines = normalizedLines(previousText);
  const at = locateLock(prevLines, lock);
  if (!at.ok) return { removed: lock.text.split('\n'), added: [] };

  const rows = diffVersions(previousText, nextText);
  const from = at.range.start + 1;
  const to = at.range.end + 1;

  const removed: string[] = [];
  const added: string[] = [];
  rows.forEach((row, i) => {
    if (row.kind === 'del' && row.oldLine !== null && row.oldLine >= from && row.oldLine <= to) {
      removed.push(row.text);
      // The additions that replaced this deletion run sit immediately after it.
      for (let j = i + 1; j < rows.length && rows[j]!.kind === 'add'; j++) {
        if (!added.includes(rows[j]!.text)) added.push(rows[j]!.text);
      }
    }
  });

  return { removed, added };
}

const MAX_SHOWN = 6;

/**
 * The rejection message.
 *
 * This text is part of the product, not an error string. An agent *will* hit
 * this mid-revision — that is the design — so it has to say exactly what to do
 * next, including the one path that is not "work around the lock".
 */
export function formatViolations(planId: string, violations: Violation[]): string {
  const out: string[] = [];

  for (const v of violations) {
    const label = v.section ? ` (${JSON.stringify(v.section)})` : '';
    if (v.reason === 'ambiguous') {
      out.push(
        red(
          `✗ planx: locked block ${bold(v.lockId)}${label} now appears more than once — version rejected.`,
        ),
        '',
        '  planx cannot tell which copy is the locked one, and it will not guess.',
        '  Remove the duplicate, or unlock the block and re-lock the copy you meant.',
        '',
      );
      continue;
    }

    out.push(
      red(`✗ planx: locked block ${bold(v.lockId)}${label} was modified — version rejected.`),
      '',
    );
    for (const line of v.removed.slice(0, MAX_SHOWN)) out.push(`  ${red(`- ${line}`)}`);
    if (v.removed.length > MAX_SHOWN)
      out.push(dim(`    … ${v.removed.length - MAX_SHOWN} more removed`));
    for (const line of v.added.slice(0, MAX_SHOWN)) out.push(`  ${green(`+ ${line}`)}`);
    if (v.added.length > MAX_SHOWN) out.push(dim(`    … ${v.added.length - MAX_SHOWN} more added`));
    out.push('');
    out.push('  This block is locked. Nothing was written.');
    out.push('  If you did not mean to touch it, use a [[planx:keep …]] marker instead.');
    out.push('  If you did, explain the change to the user first. Only once they agree:');
    out.push(yellow(`      planx unlock ${planId} ${v.lockId} --reason "..."`));
    out.push('  Then re-run capture.');
    out.push('');
  }

  return out.join('\n');
}
