import { describe, expect, it } from 'vitest';
import { feedbackRows, headingRows, type ViewRow } from '../src/tui/model.js';

/**
 * `headingRows` over hand-made rows.
 *
 * The rest of `model.ts` is covered through the rendered frame, which is the
 * right place for anything about how a fold looks. These cases are about which
 * rows count as a stop, and every one of them is awkward to drive through a
 * terminal: a fence, a deletion in a diff, a row that stands in for hidden
 * lines.
 */

/** A drawn row of the document, at `newLine` — or null, like a deletion. */
function doc(newLine: number | null): ViewRow {
  return {
    kind: 'doc',
    gutter: '',
    gutterActive: '',
    text: '',
    newLine,
    gapIndex: null,
    blockIndex: 0,
    rail: false,
    fold: null,
  };
}

/** Rows for the whole document, one per line, in order. */
function drawn(lines: readonly string[]): ViewRow[] {
  return lines.map((_, i) => doc(i + 1));
}

describe('headingRows', () => {
  it('finds every level, and nothing that is not a heading', () => {
    const lines = ['# One', 'text', '## Two', '###### Six', 'not # a heading', '#no space'];
    expect(headingRows(drawn(lines), lines)).toEqual([0, 2, 3]);
  });

  it('does not take a # inside a fence', () => {
    const lines = ['# Real', '```sh', '# a shell comment', '```', '## Also real'];
    expect(headingRows(drawn(lines), lines)).toEqual([0, 4]);
  });

  it('leaves a folded section with only its own heading', () => {
    const lines = ['# One', '## Two', 'hidden', 'hidden', '## Three'];
    // What a fold draws: the heading, then a stand-in row carrying no line.
    const rows: ViewRow[] = [doc(1), doc(2), doc(null), doc(5)];
    expect(headingRows(rows, lines)).toEqual([0, 1, 3]);
  });

  it('does not stop on a heading deleted since the previous version', () => {
    const lines = ['# One', '## Kept'];
    // A deletion is a line of the version before this one: no `newLine` at all,
    // whatever text it happens to carry.
    const rows: ViewRow[] = [doc(1), doc(null), doc(2)];
    expect(headingRows(rows, lines)).toEqual([0, 2]);
  });

  it('does not turn a feedback box between two headings into a stop', () => {
    const lines = ['# One', '## Two'];
    const rows: ViewRow[] = [
      doc(1),
      ...feedbackRows('a1', 'a note', { blockIndex: 0, boxWidth: 30, collapsed: false }),
      doc(2),
    ];
    expect(headingRows(rows, lines)).toEqual([0, rows.length - 1]);
  });
});
