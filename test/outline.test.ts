import { beforeEach, describe, expect, it } from 'vitest';
import { setColorEnabled, visibleLength } from '../src/render/ansi.js';
import { currentEntry, outlineColumn, outlineEntries } from '../src/tui/outline.js';

beforeEach(() => {
  setColorEnabled(false);
});

/** A plan with every level in it, including the two that are not sections. */
const PLAN = [
  '# The title', // 1
  '', // 2
  '## One', // 3
  'a', // 4
  '', // 5
  '### Under one', // 6
  'b', // 7
  '', // 8
  '#### Deeper still', // 9
  'c', // 10
  '', // 11
  '##### Too deep', // 12
  'd', // 13
  '', // 14
  '```', // 15
  '## Not a heading', // 16
  '```', // 17
  '', // 18
  '## Two', // 19
  'e', // 20
];

describe('what the outline lists', () => {
  it('takes ## to ####, and leaves out the title, the deep ones and a fence', () => {
    expect(outlineEntries(PLAN)).toEqual([
      { line: 3, level: 2, title: 'One' },
      { line: 6, level: 3, title: 'Under one' },
      { line: 9, level: 4, title: 'Deeper still' },
      { line: 19, level: 2, title: 'Two' },
    ]);
  });

  /**
   * `foldEnd` declines a heading with nothing under it, because folding it
   * would hide nothing. It is still a place in the plan, so it is still an
   * entry — only folding cares whether there is anything to hide.
   */
  it('keeps a heading with nothing under it', () => {
    expect(outlineEntries(['# T', '', '## Empty', '## Next', 'a'])).toEqual([
      { line: 3, level: 2, title: 'Empty' },
      { line: 4, level: 2, title: 'Next' },
    ]);
  });
});

describe('which entry the cursor is in', () => {
  const entries = outlineEntries(PLAN);

  it('is the section a line of the body belongs to', () => {
    expect(currentEntry(entries, 4)).toBe(0);
    expect(currentEntry(entries, 7)).toBe(1);
    expect(currentEntry(entries, 20)).toBe(3);
  });

  it('is the section itself when the cursor is on its heading', () => {
    expect(currentEntry(entries, 3)).toBe(0);
    expect(currentEntry(entries, 19)).toBe(3);
  });

  it('is nothing above the first heading, or on no line at all', () => {
    expect(currentEntry(entries, 1)).toBe(-1);
    expect(currentEntry(entries, null)).toBe(-1);
  });
});

describe('drawing the column', () => {
  const entries = outlineEntries(PLAN);
  const draw = (over: Partial<Parameters<typeof outlineColumn>[0]> = {}) =>
    outlineColumn({
      entries,
      current: -1,
      height: 6,
      width: 22,
      folded: new Set<number>(),
      ...over,
    });

  it('steps a ### in past its ##, and a #### past that', () => {
    const rows = draw();
    expect(rows[0]).toBe('  One'.padEnd(22));
    expect(rows[1]).toBe('    Under one'.padEnd(22));
    expect(rows[2]).toBe('      Deeper still'.padEnd(22));
    expect(rows[3]).toBe('  Two'.padEnd(22));
  });

  /**
   * The marker keeps a column of its own on the left rather than moving with
   * the heading's depth: a fold is a mark against the list, not a fourth level
   * of nesting.
   */
  it('puts every marker in the same column, whatever the depth', () => {
    const rows = draw({ folded: new Set([3, 9]) });
    expect(rows[0]).toBe('▸ One'.padEnd(22));
    expect(rows[1]).toBe('    Under one'.padEnd(22));
    expect(rows[2]).toBe('▸     Deeper still'.padEnd(22));
    expect(rows[0]!.indexOf('▸')).toBe(rows[2]!.indexOf('▸'));
  });

  it('truncates a long title rather than wrapping it', () => {
    const long = [{ line: 1, level: 2, title: 'A section with a very long name indeed' }];
    const rows = outlineColumn({
      entries: long,
      current: 0,
      height: 2,
      width: 22,
      folded: new Set<number>(),
    });
    expect(rows[0]).toContain('…');
    expect(rows[0]).toContain('A section with a');
    expect(visibleLength(rows[0]!)).toBe(22);
  });

  it('pads to exactly the height, in rows of exactly the width', () => {
    const rows = draw({ height: 9, width: 14 });
    expect(rows).toHaveLength(9);
    for (const row of rows) expect(visibleLength(row)).toBe(14);
    expect(rows.slice(4).every((row) => !row.trim())).toBe(true);
  });

  /**
   * More sections than there are body rows is normal on a long plan, so the
   * window follows the section you are in rather than pinning to the top.
   */
  it('windows the entries so the current one is always on screen', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      line: i + 1,
      level: 2,
      title: `S${i + 1}`,
    }));
    const window = (current: number) =>
      outlineColumn({ entries: many, current, height: 4, width: 10, folded: new Set<number>() })
        .map((row) => row.trim())
        .filter(Boolean);

    expect(window(0)).toEqual(['S1', 'S2', 'S3', 'S4']);
    expect(window(2)).toEqual(['S1', 'S2', 'S3', 'S4']);
    expect(window(6)).toEqual(['S4', 'S5', 'S6', 'S7']);
    expect(window(19)).toEqual(['S17', 'S18', 'S19', 'S20']);
  });
});
