/**
 * One order for every list of keys planx prints — src/tui/hints.ts, ported.
 *
 * Arrow keys first, then everything else alphabetically by the key itself, then
 * `esc`, then `?`. A rule rather than a judgement per line, so a key is always
 * in the same place.
 */

export type Hint = [key: string, what: string];

function rank(key: string): string {
  if (key.startsWith('←') || key.startsWith('↑') || key.startsWith('→')) return `0${key}`;
  if (key === 'esc') return '2';
  if (key === '?') return '3';
  return `1${key.toLowerCase().replace(/\^/g, '')}`;
}

export function orderHints(hints: readonly Hint[]): Hint[] {
  return [...hints].sort(([a], [b]) => rank(a).localeCompare(rank(b)));
}

const SEPARATOR = ' · ';
const MAX_ROWS = 3;

/** The hints folded to a width, never splitting a `key what` pair. */
export function hintLines(hints: readonly Hint[], width: number, maxRows = MAX_ROWS): string[] {
  const ordered = orderHints(hints);
  if (!ordered.length) return [''];

  const pairs = ordered.map(([key, what]) => `${key} ${what}`);
  const rows = packRows(pairs, width);
  if (rows.length <= maxRows) return rows.map((row) => row.join(SEPARATOR));

  const kept = rows.slice(0, maxRows);
  // `?` ranks last, so it is the pair the cap drops first and the only one that
  // leads anywhere the dropped ones can still be read.
  if (ordered[ordered.length - 1]![0] === '?') {
    const tail = kept[kept.length - 1]!;
    tail.push(pairs[pairs.length - 1]!);
    while (tail.length > 1 && tail.join(SEPARATOR).length > width) tail.splice(tail.length - 2, 1);
  }
  return kept.map((row) => row.join(SEPARATOR));
}

function packRows(pairs: readonly string[], width: number): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let used = 0;
  for (const pair of pairs) {
    const cost = row.length ? SEPARATOR.length + pair.length : pair.length;
    if (row.length && used + cost > width) {
      rows.push(row);
      row = [pair];
      used = pair.length;
      continue;
    }
    row.push(pair);
    used += cost;
  }
  if (row.length) rows.push(row);
  return rows;
}
