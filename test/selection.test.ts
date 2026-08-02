import { describe, expect, it } from 'vitest';
import { fuzzyFilter, fuzzyMatch } from '../src/tui/fuzzy.js';
import { wrapComment } from '../src/tui/model.js';
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

/** The same, with a three-row note box hanging off line 2. */
const ANNOTATED: SelectableRow[] = [
  { newLine: 1, gapIndex: null },
  { newLine: 2, gapIndex: null },
  { newLine: null, gapIndex: null, kind: 'feedback' },
  { newLine: null, gapIndex: null, kind: 'feedback' },
  { newLine: null, gapIndex: null, kind: 'feedback' },
  { newLine: 3, gapIndex: null },
];

function run(events: SelectionEvent[], rows = ROWS): SelectionState {
  return events.reduce((state, event) => reduceSelection(state, event, rows), initialSelection());
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

describe('walking past notes', () => {
  it('steps over a note box rather than into it', () => {
    const down = run([{ type: 'moveTo', index: 1 }, { type: 'move', delta: 1 }], ANNOTATED);
    expect(down.cursor).toBe(5);

    const up = run([{ type: 'moveTo', index: 5 }, { type: 'move', delta: -1 }], ANNOTATED);
    expect(up.cursor).toBe(1);
  });

  it('counts document rows, not drawn rows', () => {
    expect(run([{ type: 'move', delta: 2 }], ANNOTATED).cursor).toBe(5);
  });

  it('stays put rather than landing on a box at the end of the list', () => {
    const rows: SelectableRow[] = [...ANNOTATED.slice(0, 5)];
    expect(run([{ type: 'moveTo', index: 1 }, { type: 'move', delta: 1 }], rows).cursor).toBe(1);
    expect(run([{ type: 'moveTo', index: 4 }], rows).cursor).toBe(1);
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

/**
 * The two bugs that made typing a note feel broken were both here, and this is
 * the cheapest place to pin them: no terminal, no render, no timing.
 */
describe('wrapping a note', () => {
  it('keeps a trailing space, so pressing space moves the caret', () => {
    expect(wrapComment('hello ', 20)).toEqual(['hello ']);
    expect(wrapComment('hello', 20)).toEqual(['hello']);
  });

  it('carries a trailing space onto the next line when it lands on the edge', () => {
    // Ten characters in a ten-wide box: the space has nowhere to go but down,
    // and it has to go somewhere or the caret never moves.
    expect(wrapComment('abcdefghij ', 10)).toEqual(['abcdefghij', ' ']);
  });

  it('breaks a word wider than the box instead of leaving it to be truncated', () => {
    expect(wrapComment('a'.repeat(25), 10)).toEqual(['aaaaaaaaaa', 'aaaaaaaaaa', 'aaaaa']);
    // With something already on the line, the long word starts on a fresh one.
    expect(wrapComment(`hi ${'b'.repeat(12)}`, 10)).toEqual(['hi', 'bbbbbbbbbb', 'bb']);
  });

  it('fills the box exactly before it wraps', () => {
    expect(wrapComment('abcde fghij', 11)).toEqual(['abcde fghij']);
    expect(wrapComment('abcde fghijk', 11)).toEqual(['abcde', 'fghijk']);
  });

  it('still collapses runs of spaces — a note is prose, not code', () => {
    expect(wrapComment('one     two', 20)).toEqual(['one two']);
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
