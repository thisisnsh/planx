import { diffArrays, diffWordsWithSpace } from 'diff';
import type { DiffRow, DiffStat, Segment } from './types.js';

/**
 * Split into lines for diffing and display.
 *
 * A trailing newline is a terminator, not an empty final line — without this
 * every plan would show a phantom blank row at the bottom.
 */
export function splitLines(text: string): string[] {
  const normalized = text.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/**
 * Line-level diff of two versions.
 *
 * Line-based throughout, which is the same coordinate system feedback anchors,
 * lock anchors and diff hunks all share — so a lock and a comment on
 * overlapping text compose without character-offset merging.
 */
export function diffVersions(oldText: string, newText: string): DiffRow[] {
  const a = splitLines(oldText);
  const b = splitLines(newText);
  const parts = diffArrays(a, b);

  const rows: DiffRow[] = [];
  let oldNo = 1;
  let newNo = 1;

  for (const part of parts) {
    const values = part.value as string[];
    if (part.added) {
      for (const text of values) rows.push({ kind: 'add', text, oldLine: null, newLine: newNo++ });
    } else if (part.removed) {
      for (const text of values) rows.push({ kind: 'del', text, oldLine: oldNo++, newLine: null });
    } else {
      for (const text of values) {
        rows.push({ kind: 'context', text, oldLine: oldNo++, newLine: newNo++ });
      }
    }
  }

  return annotateWordDiffs(rows);
}

/**
 * Pair each deletion run with the addition run that replaced it and compute a
 * word diff between corresponding lines, so a one-word edit reads as a one-word
 * edit instead of a whole line rewritten.
 */
function annotateWordDiffs(rows: DiffRow[]): DiffRow[] {
  let i = 0;
  while (i < rows.length) {
    if (rows[i]!.kind !== 'del') {
      i++;
      continue;
    }
    let delEnd = i;
    while (delEnd < rows.length && rows[delEnd]!.kind === 'del') delEnd++;
    let addEnd = delEnd;
    while (addEnd < rows.length && rows[addEnd]!.kind === 'add') addEnd++;

    const dels = rows.slice(i, delEnd);
    const adds = rows.slice(delEnd, addEnd);

    // Only pair up positionally. Anything cleverer (best-match across the run)
    // produces confident-looking highlights on lines that are not related.
    const pairs = Math.min(dels.length, adds.length);
    for (let k = 0; k < pairs; k++) {
      const del = dels[k]!;
      const add = adds[k]!;
      if (!worthPairing(del.text, add.text)) continue;
      const [delSegs, addSegs] = wordSegments(del.text, add.text);
      del.segments = delSegs;
      add.segments = addSegs;
    }

    i = addEnd > i ? addEnd : i + 1;
  }
  return rows;
}

/**
 * Word highlighting on two lines that share nothing is noise — it marks the
 * entire line as changed with extra colour. Require some common ground first.
 */
function worthPairing(a: string, b: string): boolean {
  if (!a.trim() || !b.trim()) return false;
  const tokens = (s: string) => new Set(s.toLowerCase().match(/[a-z0-9_]+/g) ?? []);
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return false;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / Math.max(ta.size, tb.size) >= 0.25;
}

/**
 * The word-level segments for a line the reviewer rewrote in place.
 *
 * The same pairing rule the diff uses, for the same reason: two lines that
 * share nothing come back as null and the caller draws the new text plainly,
 * rather than lighting up every word as changed.
 */
export function editSegments(before: string, after: string): Segment[] | null {
  if (!worthPairing(before, after)) return null;
  return wordSegments(before, after)[1];
}

function wordSegments(oldLine: string, newLine: string): [Segment[], Segment[]] {
  const parts = diffWordsWithSpace(oldLine, newLine);
  const left: Segment[] = [];
  const right: Segment[] = [];
  for (const part of parts) {
    if (part.added) right.push({ text: part.value, changed: true });
    else if (part.removed) left.push({ text: part.value, changed: true });
    else {
      left.push({ text: part.value, changed: false });
      right.push({ text: part.value, changed: false });
    }
  }
  return [merge(left), merge(right)];
}

function merge(segments: Segment[]): Segment[] {
  const out: Segment[] = [];
  for (const seg of segments) {
    const last = out[out.length - 1];
    if (last && last.changed === seg.changed) last.text += seg.text;
    else out.push({ ...seg });
  }
  return out;
}

export function statOf(rows: DiffRow[]): DiffStat {
  const stat: DiffStat = { added: 0, removed: 0, unchanged: 0 };
  for (const row of rows) {
    if (row.kind === 'add') stat.added++;
    else if (row.kind === 'del') stat.removed++;
    else stat.unchanged++;
  }
  return stat;
}

/**
 * The rows a fresh plan produces — every line an addition. Lets `show` and the
 * v1 case reuse the whole diff rendering path instead of a parallel one.
 */
export function rowsForSingleVersion(text: string): DiffRow[] {
  return splitLines(text).map((line, i) => ({
    kind: 'context' as const,
    text: line,
    oldLine: i + 1,
    newLine: i + 1,
  }));
}
