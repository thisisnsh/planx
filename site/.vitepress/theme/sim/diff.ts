/**
 * The line diff, ported from src/diff for the browser.
 *
 * The CLI leans on the `diff` package; a plan is forty lines, so a plain
 * longest-common-subsequence table is both smaller and enough. What matters is
 * that the output shape is identical to src/diff/types.ts, because the row
 * model and the collapse rules downstream are the same code translated.
 */

export type RowKind = 'context' | 'add' | 'del';

export interface Segment {
  text: string;
  changed: boolean;
}

export interface DiffRow {
  kind: RowKind;
  text: string;
  oldLine: number | null;
  newLine: number | null;
  segments?: Segment[];
}

export type Block =
  { kind: 'rows'; rows: DiffRow[] } | { kind: 'gap'; count: number; rows: DiffRow[] };

/** A trailing newline is a terminator, not an empty final line. */
export function splitLines(text: string): string[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

export function rowsForSingleVersion(text: string): DiffRow[] {
  return splitLines(text).map((line, i) => ({
    kind: 'context' as const,
    text: line,
    oldLine: i + 1,
    newLine: i + 1,
  }));
}

/** Indices of the longest common subsequence of two token arrays. */
function lcs<T>(a: readonly T[], b: readonly T[]): Array<[number, number]> {
  const table: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i]![j] =
        a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }
  const pairs: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) i++;
    else j++;
  }
  return pairs;
}

export function diffVersions(oldText: string, newText: string): DiffRow[] {
  const a = splitLines(oldText);
  const b = splitLines(newText);
  const common = lcs(a, b);

  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;
  const emitTo = (endA: number, endB: number) => {
    while (i < endA) {
      rows.push({ kind: 'del', text: a[i]!, oldLine: i + 1, newLine: null });
      i++;
    }
    while (j < endB) {
      rows.push({ kind: 'add', text: b[j]!, oldLine: null, newLine: j + 1 });
      j++;
    }
  };

  for (const [ai, bj] of common) {
    emitTo(ai, bj);
    rows.push({ kind: 'context', text: a[ai]!, oldLine: ai + 1, newLine: bj + 1 });
    i = ai + 1;
    j = bj + 1;
  }
  emitTo(a.length, b.length);

  return annotateWordDiffs(rows);
}

/**
 * Pair each deletion run with the addition run that replaced it, so a one-word
 * edit reads as a one-word edit. Positional pairing only — anything cleverer
 * produces confident-looking highlights on unrelated lines.
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
    for (let k = 0; k < Math.min(dels.length, adds.length); k++) {
      const del = dels[k]!;
      const add = adds[k]!;
      if (!worthPairing(del.text, add.text)) continue;
      const [left, right] = wordSegments(del.text, add.text);
      del.segments = left;
      add.segments = right;
    }
    i = addEnd > i ? addEnd : i + 1;
  }
  return rows;
}

/** Two lines that share nothing get no word highlighting — it would be noise. */
function worthPairing(a: string, b: string): boolean {
  if (!a.trim() || !b.trim()) return false;
  const tokens = (s: string) => new Set(s.toLowerCase().match(/[a-z0-9_]+/g) ?? []);
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.size || !tb.size) return false;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / Math.max(ta.size, tb.size) >= 0.25;
}

const WORDS = /\s+|[A-Za-z0-9_]+|[^\sA-Za-z0-9_]/g;

export function wordSegments(oldLine: string, newLine: string): [Segment[], Segment[]] {
  const a = oldLine.match(WORDS) ?? [];
  const b = newLine.match(WORDS) ?? [];
  const common = lcs(a, b);

  const left: Segment[] = [];
  const right: Segment[] = [];
  const push = (into: Segment[], text: string, changed: boolean) => {
    const last = into[into.length - 1];
    if (last && last.changed === changed) last.text += text;
    else into.push({ text, changed });
  };

  let i = 0;
  let j = 0;
  for (const [ai, bj] of common) {
    while (i < ai) push(left, a[i++]!, true);
    while (j < bj) push(right, b[j++]!, true);
    push(left, a[ai]!, false);
    push(right, b[bj]!, false);
    i = ai + 1;
    j = bj + 1;
  }
  while (i < a.length) push(left, a[i++]!, true);
  while (j < b.length) push(right, b[j++]!, true);
  return [left, right];
}

/** The word diff for a line the reviewer rewrote in place. */
export function editSegments(before: string, after: string): Segment[] | null {
  if (!worthPairing(before, after)) return null;
  return wordSegments(before, after)[1];
}

export const DEFAULT_CONTEXT = 3;

/**
 * Group rows into displayed runs and collapsed gaps.
 *
 * A gap is only worth making when it hides more than it costs, which is why
 * fewer than four hidden lines are simply drawn.
 */
export function collapse(rows: DiffRow[], context = DEFAULT_CONTEXT, minGap = 4): Block[] {
  const keep = new Set<number>();
  rows.forEach((row, i) => {
    if (row.kind === 'context') return;
    for (let j = Math.max(0, i - context); j <= Math.min(rows.length - 1, i + context); j++)
      keep.add(j);
  });
  if (keep.size === 0) return [{ kind: 'rows', rows }];

  const blocks: Block[] = [];
  let i = 0;
  while (i < rows.length) {
    const start = i;
    if (keep.has(i)) {
      while (i < rows.length && keep.has(i)) i++;
      blocks.push({ kind: 'rows', rows: rows.slice(start, i) });
    } else {
      while (i < rows.length && !keep.has(i)) i++;
      const hidden = rows.slice(start, i);
      if (hidden.length >= minGap) blocks.push({ kind: 'gap', count: hidden.length, rows: hidden });
      else blocks.push({ kind: 'rows', rows: hidden });
    }
  }
  return blocks;
}
