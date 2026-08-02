/**
 * Selection is line-based, everywhere.
 *
 * You cannot select a sub-line span: dragging from the middle of one line to
 * the middle of another selects both lines entirely. This is a constraint, not
 * a shortcut. A word-level anchor gives the model an ambiguous target — "this
 * word, in a sentence you are about to rewrite anyway" — while a line range
 * gives it a self-contained unit it can reason about and replace. It also means
 * feedback anchors, lock anchors and diff hunks share one coordinate system, so
 * a lock and a comment on overlapping text compose predictably (PLAN §5).
 *
 * Everything here is a pure function of (rows, events). None of it touches a
 * terminal, which is what makes the interaction testable.
 */

export interface SelectableRow {
  /** The new-version line this row shows, or null for a deletion or a gap. */
  newLine: number | null;
  /** Index of the collapsed gap this row stands for, or null. */
  gapIndex: number | null;
}

export interface SelectionState {
  /** Where the selection started; null when nothing is being selected. */
  anchor: number | null;
  cursor: number;
  /** True while dragging or in keyboard visual mode. */
  active: boolean;
}

export function initialSelection(): SelectionState {
  return { anchor: null, cursor: 0, active: false };
}

export type SelectionEvent =
  | { type: 'move'; delta: number }
  | { type: 'moveTo'; index: number }
  | { type: 'toggleVisual' }
  | { type: 'clear' }
  | { type: 'mouseDown'; index: number }
  | { type: 'mouseDrag'; index: number }
  | { type: 'mouseUp'; index: number };

export function reduceSelection(
  state: SelectionState,
  event: SelectionEvent,
  rowCount: number,
): SelectionState {
  const clamp = (n: number) => Math.max(0, Math.min(rowCount - 1, n));

  switch (event.type) {
    case 'move': {
      return { ...state, cursor: clamp(state.cursor + event.delta) };
    }
    case 'moveTo': {
      return { ...state, cursor: clamp(event.index) };
    }
    case 'toggleVisual': {
      // Keyboard visual mode is not optional. Mouse capture hijacks the
      // terminal's own text selection, which infuriates anyone trying to copy a
      // line out, so `m` can turn the mouse off — and then this is the only way
      // to select anything (PLAN §8).
      if (state.active) return { ...state, active: false, anchor: null };
      return { ...state, active: true, anchor: state.cursor };
    }
    case 'clear': {
      return { ...state, active: false, anchor: null };
    }
    case 'mouseDown': {
      return { anchor: clamp(event.index), cursor: clamp(event.index), active: true };
    }
    case 'mouseDrag': {
      if (!state.active) return state;
      return { ...state, cursor: clamp(event.index) };
    }
    case 'mouseUp': {
      if (!state.active) return state;
      // The selection survives the release: you drag, then press `c` to comment
      // on it. Clearing here would make every drag a no-op.
      return { ...state, cursor: clamp(event.index) };
    }
  }
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
 * Pressing `c` without selecting first should comment on the line under the
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
