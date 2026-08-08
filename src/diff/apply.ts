import { applyPatch, parsePatch, type StructuredPatch } from 'diff';

export interface ApplyOk {
  ok: true;
  /** The parent text with every hunk applied. */
  text: string;
  hunks: number;
  added: number;
  removed: number;
}

export interface ApplyFailure {
  ok: false;
  /** 1-based hunk that could not be placed, or null when nothing parsed. */
  hunk: number | null;
  /** A fragment the caller names the plan in. No trailing stop. */
  reason: string;
}

export type ApplyResult = ApplyOk | ApplyFailure;

/**
 * Colour is not part of the format.
 *
 * `planx diff --plain` writes its hunk headers through `cyan` and its bodies
 * through `green` and `red`, so a diff that went out through a terminal and
 * came back in carries escape sequences that would land inside the context
 * lines and stop them matching. Strip them rather than fail on them.
 */
const CSI = /\u001b\[[0-9;?]*[ -\/]*[@-~]/gu;

/**
 * Apply a unified diff to the text of a stored version.
 *
 * This is the write half of `planx diff --plain`: the format an agent reads a
 * revision out of is the format it writes one back in. A revision that touches
 * three lines of a two-hundred-line plan costs three lines of output instead of
 * two hundred, every round.
 *
 * The result is the whole document either way — what gets stored is unchanged,
 * so history, diffing and feedback anchoring do not know a patch was involved.
 *
 * `fuzzFactor` stays at 0 deliberately. jsdiff already searches outward from
 * the offset in the `@@` header, which absorbs the line numbers agents
 * habitually miscount, but a fuzzy *context* match would let a patch apply
 * cleanly to the wrong place — the one failure mode this must never have.
 */
export function applyUnifiedPatch(base: string, patch: string): ApplyResult {
  const parsed = parse(patch);
  if (typeof parsed === 'string') return { ok: false, hunk: null, reason: parsed };

  const files = parsed.filter((file) => file.hunks.length);
  if (!files.length) {
    return { ok: false, hunk: null, reason: 'the payload holds no diff hunks' };
  }
  if (files.length > 1) {
    return {
      ok: false,
      hunk: null,
      reason: 'the payload patches more than one file, and a plan is one document',
    };
  }

  const file = files[0]!;
  const applied = applyPatch(base, file, { fuzzFactor: 0 });
  if (applied === false) {
    return { ok: false, hunk: firstUnplaceable(base, file), reason: 'a hunk does not match' };
  }

  const { added, removed } = countLines(file);
  return { ok: true, text: applied, hunks: file.hunks.length, added, removed };
}

/**
 * The hunks, or why there are none.
 *
 * A malformed payload is a failed patch, not a crash. The parser's own words
 * come back with it because the usual way to malform one is a `@@` line whose
 * counts do not match the body under it — jsdiff says which hunk and what it
 * expected, and *that* is what an agent needs to fix it.
 */
function parse(patch: string): StructuredPatch[] | string {
  try {
    return parsePatch(patch.replace(CSI, ''));
  } catch (err) {
    const detail = err instanceof Error ? err.message.trim() : String(err);
    return `the patch does not parse — ${detail || 'malformed unified diff'}`;
  }
}

/**
 * Which hunk to name in the failure.
 *
 * `applyPatch` answers only yes or no for the patch as a whole, so the hunks
 * are replayed one at a time to find the first that cannot be placed. This runs
 * only on a patch that has already failed, so it costs nothing on the happy
 * path and cannot affect what gets stored.
 */
function firstUnplaceable(base: string, file: StructuredPatch): number {
  let text = base;
  for (const [index, hunk] of file.hunks.entries()) {
    const next = applyPatch(text, { ...file, hunks: [hunk] }, { fuzzFactor: 0 });
    if (next === false) return index + 1;
    text = next;
  }
  // Every hunk placed on its own but not in sequence, so what failed is the
  // order they came in. The last one is where the sequence ran out.
  return file.hunks.length;
}

function countLines(file: StructuredPatch): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      // `\ No newline at end of file` is neither, and starts with neither.
      if (line.startsWith('+')) added++;
      else if (line.startsWith('-')) removed++;
    }
  }
  return { added, removed };
}
