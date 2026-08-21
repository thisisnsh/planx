/**
 * One order for every list of keys planx prints.
 *
 * Arrow keys first, then everything else alphabetically by the key itself, then
 * `esc`, `ctrl+c`, `ctrl+_`, `?`. A rule rather than a judgement per line, so a
 * key is always in the same place and you stop re-reading the hints to find it.
 *
 * It is a function rather than a convention because the hint line and `?` are
 * written in two different places and would otherwise drift: both sort through
 * here, so they cannot disagree about where a key belongs.
 */
export type Hint = [key: string, what: string];

/**
 * How the toggle is written wherever planx names it.
 *
 * Terminals send it as the single byte `0x1f`, which `isHintToggle` matches
 * alongside the modified `_` a kitty-protocol terminal reports instead.
 */
export const HINT_TOGGLE = 'ctrl+_';

/** The bar's own entry, appended wherever hints are drawn. */
export const HIDE_HINTS: Hint = [HINT_TOGGLE, 'hide hints'];

/**
 * The bottom rule's left-hand lead, and nothing at all while the rows are up:
 * with the bar on screen it already says how to put it away, and a border
 * repeating it is the same sentence twice.
 */
export function hintFooter(shown: boolean): string {
  return shown ? '' : ` ${HINT_TOGGLE} show hints `;
}

/**
 * Both forms the chord arrives in, and neither of them sets `key.ctrl` alone.
 *
 * Terminals send `ctrl+_` as the single byte `0x1f`. Ink's `parse-keypress`
 * only lifts `0x01`–`0x1a` into `{name, ctrl: true}`, so `0x1f` falls through
 * every branch and reaches `useInput` as `input === '\x1f'` with `key.ctrl`
 * false. Under the kitty keyboard protocol the same chord arrives as a CSI-u
 * sequence and Ink reports the base key with its modifiers instead.
 *
 * `ctrl+/` sends `0x1f` on many terminals too, so it toggles as well. That is a
 * free alias, not a second binding: the label stays `ctrl+_`.
 */
export function isHintToggle(input: string, key: { ctrl: boolean }): boolean {
  return input === '\x1f' || (key.ctrl && (input === '_' || input === '-'));
}

/**
 * Text a keypress should be allowed to type. Control bytes are not.
 *
 * `0x1f` reaches the editors with `key.ctrl` false, so the branches that append
 * anything not ctrl or meta would push the toggle into whatever is being typed.
 * A filter rather than a check for `0x1f`, because it closes the same hole for
 * every other stray control byte.
 */
export function typable(input: string): string {
  return input.replace(/[\x00-\x1f\x7f]/g, '');
}

/**
 * Sortable form of a key.
 *
 * `ctrl+j` sits beside `j` — a reader looking for the paging keys looks under
 * the letter, not under the `ctrl+` prefix — and case is not a distinction
 * anybody is scanning for. `esc`, `ctrl+c`, `ctrl+_` and `?` are pinned to the
 * end because they are the keys that mean the same thing on every screen and
 * never need finding.
 *
 * `ctrl+c` does not sort under `c` beside `ctrl+j` for that reason: `ctrl+j`
 * is a paging key you look for under its letter, and `ctrl+c` is one of the
 * ones that end the line together.
 *
 * The toggle sits between `ctrl+c` and `?`. Without a line of its own it would
 * strip its `ctrl+` and sort under `_`, which lands it ahead of every letter
 * and puts a key about the chrome between the arrows and `d`.
 */
function rank(key: string): string {
  if (key.startsWith('←') || key.startsWith('↑') || key.startsWith('→')) return `0${key}`;
  if (key === 'esc') return '2';
  if (key === 'ctrl+c') return '3';
  if (key === HINT_TOGGLE) return '4';
  if (key === '?') return '5';
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
 * dropped and the pinned keys are put back on the end — `?` recovers
 * everything dropped, and `ctrl+_` is the one that puts the bar away, which
 * matters most on exactly the terminal narrow enough to cap it.
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
  const pins = pinned(ordered, pairs);
  if (pins.length) {
    // Whatever the cap kept of the row the pins land on, minus any pin already
    // on it — a pin is put back once, not twice.
    const rest = kept[kept.length - 1]!.filter((pair) => !pins.includes(pair));
    // Non-pinned pairs go from the end until the row fits. On a frame too
    // narrow for even the pins the row is the pins alone, and `frameLine`
    // truncates it as it does every other over-long piece of chrome.
    while (rest.length && joinRow([...rest, ...pins]).length > width) rest.pop();
    kept[kept.length - 1] = [...rest, ...pins];
  }
  return kept.map(joinRow);
}

/**
 * The trailing entries the cap may not drop, in the order they are written.
 *
 * Taken off the end of the sorted list rather than searched for, because the
 * pins are pinned by `rank`: whatever of `ctrl+_` and `?` a screen offers is
 * already the last thing on it.
 */
function pinned(ordered: readonly Hint[], pairs: readonly string[]): string[] {
  const pins: string[] = [];
  for (let i = ordered.length - 1; i >= 0; i--) {
    const key = ordered[i]![0];
    if (key !== '?' && key !== HINT_TOGGLE) break;
    pins.unshift(pairs[i]!);
  }
  return pins;
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
