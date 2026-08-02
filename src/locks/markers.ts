import { splitLines } from '../diff/lines.js';
import type { LocksFile } from '../store/types.js';
import { locateLock, normalizedLines } from './anchor.js';

/**
 * A `[[planx:keep …]]` marker, which must sit alone on its line. An optional
 * trailing HTML comment is allowed so `--skeleton` output can label the block
 * for a human reading it.
 */
const MARKER = /^[ \t]*\[\[planx:keep(?:[ \t]+([^\]]*?))?\]\][ \t]*(?:<!--.*-->)?[ \t]*$/;
const MARKER_ANYWHERE = /\[\[planx:keep\b/;
const FENCE = /^\s*(`{3,}|~{3,})/;

const SPAN = /^v?(\d+)#(\d+)-(\d+)$/;

export class MarkerError extends Error {
  constructor(
    message: string,
    readonly line: number,
  ) {
    super(message);
    this.name = 'MarkerError';
  }
}

export interface SkeletonOptions {
  locks: LocksFile;
}

/**
 * Render a plan with locked blocks collapsed to markers.
 *
 * Locked blocks are by definition text that is not changing, and after approval
 * they are the whole document — making the agent read them every round is pure
 * waste.
 */
export function renderSkeleton(text: string, locks: LocksFile): string {
  const lines = splitLines(text);
  const docLines = normalizedLines(text);

  const replacements: Array<{ start: number; end: number; id: string; section: string | null }> =
    [];
  for (const lock of Object.values(locks.locks)) {
    const found = locateLock(docLines, lock);
    if (!found.ok) continue;
    replacements.push({ ...found.range, id: lock.id, section: lock.section });
  }
  replacements.sort((a, b) => a.start - b.start);

  const out: string[] = [];
  let cursor = 0;
  for (const r of replacements) {
    if (r.start < cursor) continue; // overlapping locks: first one wins
    out.push(...lines.slice(cursor, r.start));
    const count = r.end - r.start + 1;
    const label = r.section ? `${r.section} — ${count} lines, locked` : `${count} lines, locked`;
    out.push(`[[planx:keep ${r.id}]]   <!-- ${label} -->`);
    cursor = r.end + 1;
  }
  out.push(...lines.slice(cursor));
  return `${out.join('\n')}\n`;
}

export interface SpliceContext {
  locks: LocksFile;
  /** version number → that version's full text, for `[[planx:keep v2#88-104]]`. */
  versionText: (n: number) => string | null;
}

export interface SpliceResult {
  text: string;
  /** Lock ids expanded from markers — these blocks were not retyped by hand. */
  expandedLocks: string[];
  /** Markers left literal because they sit inside a fenced code block. */
  literalInFence: number[];
}

/**
 * Expand `[[planx:keep …]]` markers into the text they stand for.
 *
 * Splice runs *before* lock verification so the marker path is the frictionless
 * one and hand-retyping a locked block is what trips the guard. Unknown or
 * malformed markers are a hard error, never silently dropped — a dropped marker
 * means silently deleting a section of the plan.
 *
 * Markers inside a fenced code block are left verbatim. A plan that documents
 * this syntax — including this project's own — must be able to show a marker
 * without it being expanded. The caller is told which lines those were so it
 * can say so out loud rather than leaving it a surprise.
 */
export function splice(text: string, ctx: SpliceContext): SpliceResult {
  const lines = splitLines(text);
  const out: string[] = [];
  const expandedLocks: string[] = [];
  const literalInFence: number[] = [];
  let inFence = false;

  lines.forEach((line, i) => {
    if (FENCE.test(line)) {
      inFence = !inFence;
      out.push(line);
      return;
    }

    const match = MARKER.exec(line);
    if (!match) {
      // Catch a marker that is present but not alone on its line, rather than
      // writing it through as prose the reader will never notice is wrong.
      if (!inFence && MARKER_ANYWHERE.test(line)) {
        throw new MarkerError(
          `planx: a [[planx:keep …]] marker must be alone on its line (line ${i + 1}):\n  ${line}`,
          i + 1,
        );
      }
      out.push(line);
      return;
    }

    if (inFence) {
      literalInFence.push(i + 1);
      out.push(line);
      return;
    }

    const ref = match[1]?.trim() ?? '';
    if (!ref) {
      throw new MarkerError(
        `planx: [[planx:keep]] on line ${i + 1} names nothing. Use [[planx:keep L2]] or [[planx:keep v2#88-104]].`,
        i + 1,
      );
    }

    const span = SPAN.exec(ref);
    if (span) {
      out.push(...expandSpan(ctx, span, i + 1));
      return;
    }

    const lock = ctx.locks.locks[ref];
    if (!lock) {
      const known = Object.keys(ctx.locks.locks).join(', ') || 'none';
      throw new MarkerError(
        `planx: [[planx:keep ${ref}]] on line ${i + 1} names a lock that does not exist. Known locks: ${known}.`,
        i + 1,
      );
    }
    expandedLocks.push(lock.id);
    out.push(...splitLines(lock.text));
  });

  return { text: `${out.join('\n')}\n`, expandedLocks, literalInFence };
}

function expandSpan(ctx: SpliceContext, span: RegExpExecArray, line: number): string[] {
  const version = Number.parseInt(span[1]!, 10);
  const from = Number.parseInt(span[2]!, 10);
  const to = Number.parseInt(span[3]!, 10);
  const source = ctx.versionText(version);

  if (source === null) {
    throw new MarkerError(
      `planx: [[planx:keep v${version}#${from}-${to}]] on line ${line} refers to a version that is not stored.`,
      line,
    );
  }
  const sourceLines = splitLines(source);
  if (from < 1 || to < from || to > sourceLines.length) {
    throw new MarkerError(
      `planx: [[planx:keep v${version}#${from}-${to}]] on line ${line} is out of range — v${version} has ${sourceLines.length} lines.`,
      line,
    );
  }
  return sourceLines.slice(from - 1, to);
}

/** Does this text contain any marker at all? Used to decide whether to warn. */
export function hasMarkers(text: string): boolean {
  return MARKER_ANYWHERE.test(text);
}
