import { splitLines } from '../diff/lines.js';
import { normalize, sha256 } from './ids.js';

/**
 * The store's own idea of what a line is, and how to say where one sits.
 *
 * Every anchor in planx — a comment's, an edit's — is a line number in a
 * normalized document, so the splitting has to happen in exactly one place or
 * two callers disagree about which line is line 40.
 */
export interface LineRange {
  /** 0-based, inclusive. */
  start: number;
  end: number;
}

export function normalizedLines(text: string): string[] {
  return splitLines(normalize(text));
}

const CONTEXT_LINES = 2;

/**
 * Hash of the lines bracketing a range. Deliberately excludes the range itself:
 * its job is to tell two identical passages apart by where they sit.
 */
export function contextSha(lines: string[], range: LineRange): string {
  const before = lines.slice(Math.max(0, range.start - CONTEXT_LINES), range.start);
  const after = lines.slice(range.end + 1, range.end + 1 + CONTEXT_LINES);
  return sha256(`${before.join('\n')} ${after.join('\n')}`);
}
