/**
 * Locks, anchored to the text they froze.
 *
 * The CLI stores a normalized hash of the block and re-locates it in whatever
 * version it is asked about — which is why a lock survives lines moving. The
 * simulator keeps the block's lines and looks for them, which behaves the same
 * way for the plans on this site: a locked section that moved down two lines in
 * the next version is still locked, and one the agent rewrote is not found.
 */

import { sectionOf } from './markdown.js';

export interface SimLock {
  id: string;
  /** The exact lines this lock froze — its anchor. */
  lines: string[];
  section: string | null;
  origin: 'user' | 'agent' | 'seal';
}

export interface LineSpan {
  /** 1-based, inclusive. */
  start: number;
  end: number;
}

const norm = (line: string) => line.trim().replace(/\s+/g, ' ');

/** Where this lock sits in `docLines`, or null when its text is gone. */
export function locateLock(docLines: readonly string[], lock: SimLock): LineSpan | null {
  const want = lock.lines.map(norm);
  const have = docLines.map(norm);
  for (let i = 0; i + want.length <= have.length; i++) {
    let hit = true;
    for (let j = 0; j < want.length; j++) {
      if (have[i + j] !== want[j]) {
        hit = false;
        break;
      }
    }
    if (hit) return { start: i + 1, end: i + want.length };
  }
  return null;
}

export function lockedLineMap(
  docLines: readonly string[],
  locks: readonly SimLock[],
): Map<number, string> {
  const map = new Map<number, string>();
  for (const lock of locks) {
    const at = locateLock(docLines, lock);
    if (!at) continue;
    for (let line = at.start; line <= at.end; line++) map.set(line, lock.id);
  }
  return map;
}

function nextId(locks: readonly SimLock[]): string {
  let highest = 0;
  for (const lock of locks) {
    const match = /^L(\d+)$/.exec(lock.id);
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return `L${highest + 1}`;
}

/**
 * Lock a span, minus whatever is already locked inside it.
 *
 * Locks never overlap: pressing `l` on something half frozen freezes the rest,
 * and the parts that already had a lock keep the one they had.
 */
export function addLocks(
  locks: SimLock[],
  docLines: readonly string[],
  span: LineSpan,
  origin: SimLock['origin'] = 'user',
): { locked: LineSpan[]; skipped: LineSpan[] } {
  const covered = lockedLineMap(docLines, locks);
  const locked: LineSpan[] = [];
  const skipped: LineSpan[] = [];

  let run: LineSpan | null = null;
  let held: LineSpan | null = null;
  const flush = () => {
    if (run) {
      const lines = docLines.slice(run.start - 1, run.end);
      locks.push({
        id: nextId(locks),
        lines,
        section: sectionOf(docLines, run.start - 1),
        origin,
      });
      locked.push(run);
      run = null;
    }
    if (held) {
      skipped.push(held);
      held = null;
    }
  };

  for (let line = span.start; line <= span.end; line++) {
    if (covered.has(line)) {
      if (run) flush();
      held = held ? { start: held.start, end: line } : { start: line, end: line };
    } else {
      if (held) flush();
      run = run ? { start: run.start, end: line } : { start: line, end: line };
    }
  }
  flush();
  return { locked, skipped };
}

/**
 * Unlock a span. A lock only partly covered by it splits, keeping the frozen
 * remainder frozen — the reviewer opened three lines, not the whole section.
 */
export function unlockRange(
  locks: SimLock[],
  docLines: readonly string[],
  span: LineSpan,
): string[] {
  const removed: string[] = [];
  for (const lock of [...locks]) {
    const at = locateLock(docLines, lock);
    if (!at || at.end < span.start || at.start > span.end) continue;

    removed.push(lock.id);
    locks.splice(locks.indexOf(lock), 1);

    const keep: LineSpan[] = [];
    if (at.start < span.start) keep.push({ start: at.start, end: span.start - 1 });
    if (at.end > span.end) keep.push({ start: span.end + 1, end: at.end });
    for (const part of keep) {
      locks.push({
        id: nextId(locks),
        lines: docLines.slice(part.start - 1, part.end),
        section: sectionOf(docLines, part.start - 1),
        origin: lock.origin,
      });
    }
  }
  return removed;
}

/** Approval seals the plan: every section becomes a lock. */
export function sealPlan(locks: SimLock[], docLines: readonly string[]): void {
  locks.length = 0;
  const starts: number[] = [];
  docLines.forEach((line, i) => {
    if (/^#{1,3}\s+\S/.test(line)) starts.push(i + 1);
  });
  if (!starts.length || starts[0] !== 1) starts.unshift(1);

  starts.forEach((start, i) => {
    const end = i + 1 < starts.length ? starts[i + 1]! - 1 : docLines.length;
    const lines = docLines.slice(start - 1, end);
    if (!lines.some((line) => line.trim())) return;
    locks.push({
      id: `L${locks.length + 1}`,
      lines,
      section: sectionOf(docLines, start - 1),
      origin: 'seal',
    });
  });
}
