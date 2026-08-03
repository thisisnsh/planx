import { describe, expect, it } from 'vitest';
import { fuzzyFilter, fuzzyMatch } from '../src/tui/fuzzy.js';
import { hintLine, hintLines, orderHints, type Hint } from '../src/tui/hints.js';
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
  { newLine: null, gapIndex: null },
  { newLine: null, gapIndex: null },
  { newLine: null, gapIndex: null },
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

describe('walking into notes', () => {
  it('steps into the box rather than over it, and out the other side', () => {
    const down = run(
      [
        { type: 'moveTo', index: 1 },
        { type: 'move', delta: 1 },
      ],
      ANNOTATED,
    );
    expect(down.cursor).toBe(2);

    const out = run(
      [
        { type: 'moveTo', index: 4 },
        { type: 'move', delta: 1 },
      ],
      ANNOTATED,
    );
    expect(out.cursor).toBe(5);
  });

  it('counts drawn rows, so the box is four presses deep', () => {
    expect(run([{ type: 'move', delta: 4 }], ANNOTATED).cursor).toBe(4);
  });

  it('starts no selection on a box row, which has no line to anchor to', () => {
    const state = run([{ type: 'moveTo', index: 3 }, { type: 'toggleVisual' }], ANNOTATED);
    expect(spanAtCursor(ANNOTATED, state)).toBeNull();
    expect(spanOf(ANNOTATED, state)).toBeNull();
  });

  it('rests on the last row of a box that ends the list', () => {
    const rows: SelectableRow[] = [...ANNOTATED.slice(0, 5)];
    expect(run([{ type: 'move', delta: 99 }], rows).cursor).toBe(4);
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
    expect(wrapComment(`hi ${'b'.repeat(12)}`, 10)).toEqual(['hi ', 'bbbbbbbbbb', 'bb']);
  });

  it('fills the box exactly before it wraps', () => {
    expect(wrapComment('abcde fghij', 11)).toEqual(['abcde fghij']);
    expect(wrapComment('abcde fghijk', 11)).toEqual(['abcde ', 'fghijk']);
  });

  // A note is usually prose and sometimes a snippet, and the wrap cannot tell
  // which — so every space you typed is a space you get back.
  it('keeps a run of spaces rather than collapsing it', () => {
    expect(wrapComment('one     two', 20)).toEqual(['one     two']);
    expect(wrapComment('    indented', 20)).toEqual(['    indented']);
  });

  it('keeps a run of spaces through a round trip at the box edge', () => {
    // Wrapping is the only thing that may move them, and it moves the overflow
    // down rather than dropping it.
    expect(wrapComment('ab    cd', 8).join('')).toBe('ab    cd');
    expect(wrapComment('a  b  c  d', 5).join('')).toBe('a  b  c  d');
  });
});

describe('the order every list of keys is printed in', () => {
  it('puts the arrows first, then a to z, then esc, then ?', () => {
    const shuffled: Hint[] = [
      ['?', 'help'],
      ['x', 'exit'],
      ['esc', 'back'],
      ['a', 'approve'],
      ['space', 'fold'],
      ['←→', 'version'],
      ['s', 'submit'],
    ];
    expect(orderHints(shuffled).map(([key]) => key)).toEqual([
      '←→',
      'a',
      's',
      'space',
      'x',
      'esc',
      '?',
    ]);
  });

  it('files a modified key under its letter, not under the caret', () => {
    const keys: Hint[] = [
      ['g G', 'ends'],
      ['^d ^u', 'half a screen'],
      ['f', 'feedback'],
    ];
    expect(orderHints(keys).map(([key]) => key)).toEqual(['^d ^u', 'f', 'g G']);
  });

  it('joins them into the grey line under the frame', () => {
    expect(
      hintLine([
        ['esc', 'cancel'],
        ['enter', 'save'],
      ]),
    ).toBe('enter save · esc cancel');
  });
});

/** The browse bar at its widest — the set the 80-column report was about. */
const BROWSE: Hint[] = [
  ['←→', 'version'],
  ['d', 'hide diff'],
  ['f', 'feedback'],
  ['l', 'lock lines'],
  ['n', 'note'],
  ['s', 'submit'],
  ['v', 'unselect lines'],
  ['x', 'exit'],
  ['esc', 'back'],
  ['?', 'help'],
];

describe('folding the hint bar', () => {
  it('packs to the width without splitting a key from what it does', () => {
    const rows = hintLines(BROWSE, 60);
    for (const row of rows) {
      expect(row.length).toBeLessThanOrEqual(60);
      for (const pair of row.split(' · ')) expect(pair).toMatch(/^\S+ \S/);
    }
    // Every pair is still there, in the one order, just across rows.
    expect(rows.join(' · ')).toBe(hintLine(BROWSE));
  });

  it('keeps the keys an 80-column terminal used to cut', () => {
    const shown = hintLines(BROWSE, 75).join(' · ');
    for (const pair of ['s submit', 'v unselect lines', 'x exit', 'esc back', '? help']) {
      expect(shown).toContain(pair);
    }
  });

  it('caps at three rows, and spends the last of them on ? help', () => {
    const rows = hintLines(BROWSE, 20);
    expect(rows.length).toBe(3);
    expect(rows.at(-1)).toContain('? help');
    expect(rows.at(-1)!.length).toBeLessThanOrEqual(20);
    // Something had to go, and it came off the end rather than mid-hint.
    expect(rows.join(' · ')).not.toContain('…');
    expect(hintLine(BROWSE)).toContain(rows[0]!);
  });

  it('is the same thing as the single line when nothing has to fold', () => {
    expect(hintLines(BROWSE, Infinity)).toEqual([hintLine(BROWSE)]);
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
