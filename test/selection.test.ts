import { describe, expect, it } from 'vitest';
import { fuzzyFilter, fuzzyMatch } from '../src/tui/fuzzy.js';
import { hasMouseSequence, parseMouse } from '../src/tui/mouse.js';
import {
  initialSelection,
  isRowSelected,
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

describe('mouse parsing', () => {
  it('decodes press, drag and release', () => {
    const { events } = parseMouse('\x1b[<0;12;5M\x1b[<32;20;9M\x1b[<0;20;9m');
    expect(events.map((e) => [e.type, e.col, e.row])).toEqual([
      ['down', 12, 5],
      ['drag', 20, 9],
      ['up', 20, 9],
    ]);
  });

  it('decodes wheel events with a direction', () => {
    const { events } = parseMouse('\x1b[<64;1;1M\x1b[<65;1;1M');
    expect(events.map((e) => [e.type, e.direction])).toEqual([
      ['scroll', -1],
      ['scroll', 1],
    ]);
  });

  it('strips sequences so they never reach the keyboard handler', () => {
    const { events, rest } = parseMouse('a\x1b[<0;1;1Mb\x1b[<0;1;1mc');
    expect(rest).toBe('abc');
    expect(events).toHaveLength(2);
  });

  it('leaves plain keystrokes untouched', () => {
    expect(parseMouse('cScq')).toEqual({ events: [], rest: 'cScq' });
    expect(hasMouseSequence('cScq')).toBe(false);
    expect(hasMouseSequence('\x1b[<0;1;1M')).toBe(true);
  });

  it('handles a sequence split across reads without inventing events', () => {
    expect(parseMouse('\x1b[<0;12').events).toHaveLength(0);
  });
});

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

describe('mouse selection', () => {
  it('snaps a drag to whole lines regardless of column', () => {
    const state = run([
      { type: 'mouseDown', index: 1 },
      { type: 'mouseDrag', index: 2 },
      { type: 'mouseUp', index: 2 },
    ]);
    expect(spanOf(ROWS, state)).toEqual({ start: 2, end: 3 });
  });

  it('keeps the selection after the button is released', () => {
    const state = run([
      { type: 'mouseDown', index: 0 },
      { type: 'mouseUp', index: 2 },
    ]);
    expect(isRowSelected(state, 1)).toBe(true);
  });

  it('ignores drag and release with no press behind them', () => {
    expect(selectedRows(run([{ type: 'mouseDrag', index: 3 }]))).toBeNull();
    expect(selectedRows(run([{ type: 'mouseUp', index: 3 }]))).toBeNull();
  });
});

describe('mapping a selection to lines', () => {
  it('skips deletions and gaps inside the range', () => {
    const state = run([
      { type: 'mouseDown', index: 2 },
      { type: 'mouseDrag', index: 6 },
    ]);
    // Rows 3 and 5 have no new-version line; the span spreads from 3 to 5.
    expect(spanOf(ROWS, state)).toEqual({ start: 3, end: 5 });
  });

  it('returns null for a selection of only deletions and gaps', () => {
    const state = run([
      { type: 'mouseDown', index: 5 },
      { type: 'mouseDrag', index: 5 },
    ]);
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
