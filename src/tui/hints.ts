/**
 * One order for every list of keys planx prints.
 *
 * Arrow keys first, then everything else alphabetically by the key itself, then
 * `esc`, `ctrl+c`, `?`. A rule rather than a judgement per line, so a key is
 * always in the same place and you stop re-reading the hints to find it.
 *
 * It is a function rather than a convention because the hint line and `?` are
 * written in two different places and would otherwise drift: both sort through
 * here, so they cannot disagree about where a key belongs.
 */
export type Hint = [key: string, what: string];

/**
 * Sortable form of a key.
 *
 * `ctrl+j` sits beside `j` — a reader looking for the paging keys looks under
 * the letter, not under the `ctrl+` prefix — and case is not a distinction
 * anybody is scanning for. `esc`, `ctrl+c` and `?` are pinned to the end
 * because they are the three keys that mean the same thing on every screen
 * and never need finding.
 *
 * `ctrl+c` does not sort under `c` beside `ctrl+j` for that reason: `ctrl+j`
 * is a paging key you look for under its letter, and `ctrl+c` is one of the
 * three that end the line together.
 */
function rank(key: string): string {
  if (key.startsWith('←') || key.startsWith('↑') || key.startsWith('→')) return `0${key}`;
  if (key === 'esc') return '2';
  if (key === 'ctrl+c') return '3';
  if (key === '?') return '4';
  return `1${key.toLowerCase().replace(/ctrl\+/g, '')}`;
}

export function orderHints(hints: readonly Hint[]): Hint[] {
  return [...hints].sort(([a], [b]) => rank(a).localeCompare(rank(b)));
}

/** What sits between two hints on the same row. */
const SEPARATOR = ' · ';

/**
 * A hint bar that eats the body is a worse trade than a shorter one.
 *
 * At `MIN_WIDTH` the full browse set needs four rows, and four rows of grey
 * text under a plan is not a hint bar any more. Past the cap the tail is
 * dropped and `?` is put back on the end, because the one key that recovers
 * everything dropped is the one that cannot be.
 */
const MAX_ROWS = 3;

/**
 * The hints folded to a width, never splitting a `key what` pair.
 *
 * The bar used to be one string handed to `truncate`, which cut it mid-hint
 * with nothing to say it had: at 80 columns the browse bar lost its last five
 * entries, and because the order is fixed they were always the same five — the
 * keys that end the session.
 */
export function hintLines(hints: readonly Hint[], width: number, maxRows = MAX_ROWS): string[] {
  const ordered = orderHints(hints);
  if (!ordered.length) return [''];

  const pairs = ordered.map(([key, what]) => `${key} ${what}`);
  const rows = packRows(pairs, width);
  if (rows.length <= maxRows) return rows.map(joinRow);

  const kept = rows.slice(0, maxRows);
  // `?` ranks last, so it is the pair the cap drops first and the only one that
  // leads anywhere the dropped ones can still be read. It goes back on the end,
  // displacing whatever no longer fits beside it.
  if (ordered[ordered.length - 1]![0] === '?') {
    const tail = kept[kept.length - 1]!;
    tail.push(pairs[pairs.length - 1]!);
    while (tail.length > 1 && joinRow(tail).length > width) tail.splice(tail.length - 2, 1);
  }
  return kept.map(joinRow);
}

/** The grey line under a frame: `a approve · d show diff · … · ? help`. */
export function hintLine(hints: readonly Hint[]): string {
  // The single-row form is the unfolded one, so the two cannot drift.
  return hintLines(hints, Infinity)[0]!;
}

/** Greedy packing: a pair goes on the current row, or opens the next one. */
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

function joinRow(row: readonly string[]): string {
  return row.join(SEPARATOR);
}
