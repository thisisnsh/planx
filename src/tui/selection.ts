/**
 * Selection is line-based, everywhere.
 *
 * You cannot select a sub-line span. This is a constraint, not a shortcut. A word-level anchor gives the model an ambiguous target — "this
 * word, in a sentence you are about to rewrite anyway" — while a line range
 * gives it a self-contained unit it can reason about and replace. It also means
 * feedback anchors, lock anchors and diff hunks share one coordinate system, so
 * a lock and a comment on overlapping text compose predictably.
 *
 * Everything here is a pure function of (rows, events). None of it touches a
 * terminal, which is what makes the interaction testable.
 */

export interface SelectableRow {
  /** The new-version line this row shows, or null for a deletion or a gap. */
  newLine: number | null;
  /** Index of the collapsed gap this row stands for, or null. */
  gapIndex: number | null;
  /** Drawn, but never rested on — the edges and the wrapped rows of a note box. */
  skip?: boolean;
}

export interface SelectionState {
  /** Where the selection started; null when nothing is being selected. */
  anchor: number | null;
  cursor: number;
  /** True while a selection is being extended. */
  active: boolean;
}

export function initialSelection(): SelectionState {
  return { anchor: null, cursor: 0, active: false };
}

export type SelectionEvent =
  | { type: 'move'; delta: number }
  | { type: 'moveTo'; index: number }
  | { type: 'toggleVisual' }
  | { type: 'clear' };

export function reduceSelection(
  state: SelectionState,
  event: SelectionEvent,
  rows: readonly SelectableRow[],
): SelectionState {
  switch (event.type) {
    case 'move': {
      return { ...state, cursor: walk(rows, state.cursor, event.delta) };
    }
    case 'moveTo': {
      return { ...state, cursor: settle(rows, event.index) };
    }
    case 'toggleVisual': {
      // `v` anchors here and the arrows extend from it, which is the only way
      // to select. Mouse capture used to be the other way in, but it hijacked
      // the terminal's own text selection, so copying a line out of a plan
      // stopped working — a bad trade for a drag.
      if (state.active) return { ...state, active: false, anchor: null };
      return { ...state, active: true, anchor: state.cursor };
    }
    case 'clear': {
      return { ...state, active: false, anchor: null };
    }
  }
}

/**
 * Take `delta` rows, then land on a row the cursor can rest on.
 *
 * A note is one stop, not four. The cursor steps into the box — that is what
 * left the box as scenery before, when the only way to fold a note was to press
 * space on the line above it and nothing said so — but it rests on the note's
 * first line of text and passes over the rest: an arrow beside `╰────╯` points
 * at nothing, and a note that wrapped to six lines cost six presses to walk by.
 *
 * The landing runs in the direction of travel, so a box is entered at the same
 * row from above and from below.
 *
 * Selection is unaffected — a feedback row carries `newLine: null`, so
 * `spanAtCursor` declines and neither a comment nor a lock can start there.
 */
function walk(rows: readonly SelectableRow[], from: number, delta: number): number {
  return stopNear(rows, settle(rows, from + delta), delta < 0 ? -1 : 1) ?? from;
}

/** Clamp to the row list. */
function settle(rows: readonly SelectableRow[], index: number): number {
  return Math.max(0, Math.min(rows.length - 1, index));
}

/**
 * `index` itself, or the nearest row the cursor may rest on — looking the way
 * it was heading first, then back the other way.
 *
 * The fallback is what keeps the last note in a plan reachable: `G` lands on
 * the box's closing edge, and there is nothing below it to settle onto.
 */
function stopNear(rows: readonly SelectableRow[], index: number, direction: 1 | -1): number | null {
  for (const step of [direction, -direction] as const) {
    for (let i = index; i >= 0 && i < rows.length; i += step) {
      if (!rows[i]?.skip) return i;
    }
  }
  return null;
}

/**
 * Where the cursor belongs after the rows have been rebuilt under it.
 *
 * Folding a note takes rows out from beneath the cursor and unfolding puts them
 * back, so the row it was on can become one it may not rest on — or stop
 * existing at all, which `h` can do dozens of times over.
 */
export function settleCursor(rows: readonly SelectableRow[], cursor: number): number {
  const clamped = settle(rows, cursor);
  return stopNear(rows, clamped, 1) ?? clamped;
}

/** The inclusive row-index range currently highlighted, or null. */
export function selectedRows(state: SelectionState): { from: number; to: number } | null {
  if (state.anchor === null) return null;
  return {
    from: Math.min(state.anchor, state.cursor),
    to: Math.max(state.anchor, state.cursor),
  };
}

export function isRowSelected(state: SelectionState, index: number): boolean {
  const range = selectedRows(state);
  return range !== null && index >= range.from && index <= range.to;
}

export interface LineSpan {
  /** 1-based, inclusive, in the new version's coordinates. */
  start: number;
  end: number;
}

/**
 * Map the highlighted rows onto new-version lines.
 *
 * Deleted rows and collapsed gaps can sit inside the highlight but contribute
 * nothing: they do not exist in the version being annotated, so there is no
 * line for a comment or a lock to attach to. A selection made up entirely of
 * those yields null, and the caller declines the action.
 */
export function spanOf(rows: readonly SelectableRow[], state: SelectionState): LineSpan | null {
  const range = selectedRows(state);
  if (!range) return null;

  let start = Number.POSITIVE_INFINITY;
  let end = Number.NEGATIVE_INFINITY;
  for (let i = range.from; i <= range.to && i < rows.length; i++) {
    const line = rows[i]?.newLine;
    if (line === null || line === undefined) continue;
    start = Math.min(start, line);
    end = Math.max(end, line);
  }

  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return { start, end };
}

/**
 * The span to act on when nothing is selected: the cursor's own line.
 *
 * Pressing `f` without selecting first should comment on the line under the
 * cursor rather than doing nothing — an explicit selection is for ranges.
 */
export function spanAtCursor(
  rows: readonly SelectableRow[],
  state: SelectionState,
): LineSpan | null {
  const explicit = spanOf(rows, state);
  if (explicit) return explicit;
  const line = rows[state.cursor]?.newLine;
  if (line === null || line === undefined) return null;
  return { start: line, end: line };
}

/** Keep the cursor inside the viewport, returning the new scroll offset. */
export function scrollFor(
  cursor: number,
  offset: number,
  height: number,
  rowCount: number,
): number {
  const maxOffset = Math.max(0, rowCount - height);
  if (cursor < offset) return Math.min(cursor, maxOffset);
  if (cursor >= offset + height) return Math.min(cursor - height + 1, maxOffset);
  return Math.min(offset, maxOffset);
}
