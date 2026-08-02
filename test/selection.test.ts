import { describe, expect, it } from 'vitest';
import { fuzzyFilter, fuzzyMatch } from '../src/tui/fuzzy.js';
import {
  initialSelection,
  reduceSelection,
  scrollFor,
  selectedRows,
  spanAtCursor,
  spanOf,
  type SelectableRow,
  type SelectionEvent,
  type SelectionState,
} from '../src/tui/selection.js';

/** A diff view: three context lines, a deletion, an addition, and a gap. */
const ROWS: SelectableRow[] = [
  { newLine: 1, gapIndex: null },
  { newLine: 2, gapIndex: null },
  { newLine: 3, gapIndex: null },
  { newLine: null, gapIndex: null }, // deleted line
  { newLine: 4, gapIndex: null },
  { newLine: null, gapIndex: 0 }, // collapsed gap
  { newLine: 5, gapIndex: null },
];

function run(events: SelectionEvent[], rows = ROWS): SelectionState {
  return events.reduce(
    (state, event) => reduceSelection(state, event, rows.length),
    initialSelection(),
  );
}

describe('keyboard selection', () => {
  it('starts a visual selection at the cursor and extends it', () => {
    const state = run([
      { type: 'move', delta: 1 },
      { type: 'toggleVisual' },
      { type: 'move', delta: 2 },
    ]);
    expect(selectedRows(state)).toEqual({ from: 1, to: 3 });
    expect(spanOf(ROWS, state)).toEqual({ start: 2, end: 3 });
  });

  it('extends upward from the anchor just as well as downward', () => {
    const state = run([
      { type: 'moveTo', index: 4 },
      { type: 'toggleVisual' },
      { type: 'move', delta: -3 },
    ]);
    expect(selectedRows(state)).toEqual({ from: 1, to: 4 });
  });

  it('toggles visual mode off and drops the selection', () => {
    const state = run([
      { type: 'toggleVisual' },
      { type: 'move', delta: 2 },
      { type: 'toggleVisual' },
    ]);
    expect(selectedRows(state)).toBeNull();
  });

  it('clamps the cursor to the row list', () => {
    expect(run([{ type: 'move', delta: -5 }]).cursor).toBe(0);
    expect(run([{ type: 'move', delta: 99 }]).cursor).toBe(ROWS.length - 1);
  });
});

describe('mapping a selection to lines', () => {
  it('skips deletions and gaps inside the range', () => {
    const state = run([
      { type: 'moveTo', index: 2 },
      { type: 'toggleVisual' },
      { type: 'moveTo', index: 6 },
    ]);
    // Rows 3 and 5 have no new-version line; the span spreads from 3 to 5.
    expect(spanOf(ROWS, state)).toEqual({ start: 3, end: 5 });
  });

  it('returns null for a selection of only deletions and gaps', () => {
    const state = run([{ type: 'moveTo', index: 5 }, { type: 'toggleVisual' }]);
    expect(spanOf(ROWS, state)).toBeNull();
  });

  it('falls back to the cursor line when nothing is selected', () => {
    const state = run([{ type: 'moveTo', index: 4 }]);
    expect(spanOf(ROWS, state)).toBeNull();
    expect(spanAtCursor(ROWS, state)).toEqual({ start: 4, end: 4 });
  });

  it('declines when the cursor itself has no line', () => {
    expect(spanAtCursor(ROWS, run([{ type: 'moveTo', index: 3 }]))).toBeNull();
  });
});

describe('scrolling', () => {
  it('follows the cursor off both ends of the viewport', () => {
    expect(scrollFor(0, 0, 10, 100)).toBe(0);
    expect(scrollFor(12, 0, 10, 100)).toBe(3);
    expect(scrollFor(2, 10, 10, 100)).toBe(2);
  });

  it('never scrolls past the end of a short document', () => {
    expect(scrollFor(4, 8, 10, 5)).toBe(0);
  });
});

describe('fuzzy matching', () => {
  it('matches initials across word boundaries', () => {
    expect(fuzzyMatch('gcr', 'guard-clock-regression-a3f9', 1)).not.toBeNull();
    expect(fuzzyMatch('xyz', 'guard-clock-regression', 1)).toBeNull();
  });

  it('ranks a word-start run above a scattered match', () => {
    const items = ['guard-clock-regression', 'gigantic-crumbly-rutabaga'];
    expect(fuzzyFilter('gcr', items, (s) => s)[0]!.item).toBe('guard-clock-regression');
  });

  it('reports which characters matched, for highlighting', () => {
    expect(fuzzyMatch('gc', 'guard-clock', 1)!.positions).toEqual([0, 6]);
  });

  it('keeps everything when the needle is empty', () => {
    expect(fuzzyFilter('', ['a', 'b'], (s) => s)).toHaveLength(2);
  });
});
