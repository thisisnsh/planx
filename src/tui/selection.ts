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
  /** Feedback rows are drawn in the document but are not part of it, so the
   *  cursor steps over them. Absent means a document row. */
  kind?: 'doc' | 'feedback';
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
 * Take `delta` document rows, stepping over the notes in between.
 *
 * A note is attached to a line, not a line of its own: everything you can do to
 * one is done from the line it hangs off. Walking into a six-row box to get past
 * a six-word comment would make a heavily annotated plan unreadable by arrow
 * key, and there would be nothing to do once you were in there.
 */
function walk(rows: readonly SelectableRow[], from: number, delta: number): number {
  const direction = Math.sign(delta);
  if (direction === 0) return from;

  let cursor = from;
  for (let taken = 0; taken < Math.abs(delta); taken++) {
    let next = cursor + direction;
    while (next >= 0 && next < rows.length && rows[next]?.kind === 'feedback') next += direction;
    // Stepping off either end leaves the cursor where it was rather than
    // parking it on a box edge.
    if (next < 0 || next >= rows.length) break;
    cursor = next;
  }
  return cursor;
}

/** Clamp an absolute jump to the row list, and off a note if it lands on one. */
function settle(rows: readonly SelectableRow[], index: number): number {
  let cursor = Math.max(0, Math.min(rows.length - 1, index));
  while (cursor > 0 && rows[cursor]?.kind === 'feedback') cursor--;
  while (cursor < rows.length - 1 && rows[cursor]?.kind === 'feedback') cursor++;
  return cursor;
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
