/**
 * One order for every list of keys planx prints.
 *
 * Arrow keys first, then everything else alphabetically by the key itself, then
 * `esc`, then `?`. A rule rather than a judgement per line, so a key is always
 * in the same place and you stop re-reading the hints to find it.
 *
 * It is a function rather than a convention because the hint line and `?` are
 * written in two different places and would otherwise drift: both sort through
 * here, so they cannot disagree about where a key belongs.
 */
export type Hint = [key: string, what: string];

/**
 * Sortable form of a key.
 *
 * `^d` sits beside `d` — a reader looking for the paging keys looks under the
 * letter, not under the caret — and case is not a distinction anybody is
 * scanning for. `esc` and `?` are pinned to the end because they are the two
 * keys that mean the same thing everywhere and never need finding.
 */
function rank(key: string): string {
  if (key.startsWith('←') || key.startsWith('↑') || key.startsWith('→')) return `0${key}`;
  if (key === 'esc') return '2';
  if (key === '?') return '3';
  return `1${key.toLowerCase().replace(/\^/g, '')}`;
}

export function orderHints(hints: readonly Hint[]): Hint[] {
  return [...hints].sort(([a], [b]) => rank(a).localeCompare(rank(b)));
}

/** The grey line under a frame: `a approve · d show diff · … · ? help`. */
export function hintLine(hints: readonly Hint[]): string {
  return orderHints(hints)
    .map(([key, what]) => `${key} ${what}`)
    .join(' · ');
}
