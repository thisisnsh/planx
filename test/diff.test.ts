import { afterEach, describe, expect, it } from 'vitest';
import { collapse, flatten } from '../src/diff/collapse.js';
import { diffVersions, rowsForSingleVersion, splitLines, statOf } from '../src/diff/lines.js';
import { setColorEnabled, stripAnsi, truncate, visibleLength } from '../src/render/ansi.js';
import { renderDocument, renderRichLines, renderUnified } from '../src/render/diff.js';
import { highlightMarkdown, sectionOf } from '../src/render/markdown.js';

afterEach(() => setColorEnabled(null));

describe('splitLines', () => {
  it('treats a trailing newline as a terminator, not an empty line', () => {
    expect(splitLines('a\nb\n')).toEqual(['a', 'b']);
    expect(splitLines('a\nb')).toEqual(['a', 'b']);
    expect(splitLines('')).toEqual(['']);
  });

  it('normalizes CRLF', () => {
    expect(splitLines('a\r\nb\r\n')).toEqual(['a', 'b']);
  });
});

describe('diffVersions', () => {
  it('numbers old and new lines independently', () => {
    const rows = diffVersions('one\ntwo\nthree\n', 'one\nTWO\nthree\n');
    expect(rows.map((r) => [r.kind, r.oldLine, r.newLine])).toEqual([
      ['context', 1, 1],
      ['del', 2, null],
      ['add', null, 2],
      ['context', 3, 3],
    ]);
  });

  it('word-diffs a line that was edited in place', () => {
    const rows = diffVersions(
      'Guard belongs in the poller.\n',
      'Guard belongs in the R2 write path.\n',
    );
    const add = rows.find((r) => r.kind === 'add')!;
    expect(add.segments).toBeDefined();
    expect(add.segments!.filter((s) => s.changed).map((s) => s.text.trim())).toContain(
      'R2 write path',
    );
    expect(add.segments!.map((s) => s.text).join('')).toBe(add.text);
  });

  it('skips word-diffing two lines that share nothing', () => {
    const rows = diffVersions('alpha beta gamma\n', 'zulu yankee xray\n');
    expect(rows.find((r) => r.kind === 'add')!.segments).toBeUndefined();
  });

  it('counts a pure append correctly', () => {
    const rows = diffVersions('a\n', 'a\nb\nc\n');
    expect(statOf(rows)).toEqual({ added: 2, removed: 0, unchanged: 1 });
  });

  it('renders a single version as all-context rows', () => {
    expect(rowsForSingleVersion('a\nb\n')).toEqual([
      { kind: 'context', text: 'a', oldLine: 1, newLine: 1 },
      { kind: 'context', text: 'b', oldLine: 2, newLine: 2 },
    ]);
  });
});

describe('collapse', () => {
  const long = (n: number, prefix = 'line') =>
    Array.from({ length: n }, (_, i) => `${prefix} ${i}`).join('\n') + '\n';

  it('hides long unchanged runs behind a gap', () => {
    const rows = diffVersions(long(30), `${long(30)}tail\n`);
    const blocks = collapse(rows);
    expect(blocks.some((b) => b.kind === 'gap')).toBe(true);
    const gap = blocks.find((b) => b.kind === 'gap')!;
    expect(gap.count).toBeGreaterThan(20);
  });

  it('does not collapse a run shorter than it costs to hide', () => {
    const rows = diffVersions('a\nb\nc\nd\ne\n', 'A\nb\nc\nd\nE\n');
    expect(collapse(rows, 1, 4).every((b) => b.kind === 'rows')).toBe(true);
  });

  it('shows everything when nothing changed', () => {
    const rows = diffVersions(long(50), long(50));
    expect(collapse(rows)).toEqual([{ kind: 'rows', rows }]);
  });

  it('expands only the gap that was toggled', () => {
    const rows = diffVersions(`head\n${long(30)}tail\n`, `HEAD\n${long(30)}TAIL\n`);
    const blocks = collapse(rows);
    const gapIndex = blocks.findIndex((b) => b.kind === 'gap');
    expect(gapIndex).toBeGreaterThanOrEqual(0);

    const collapsed = flatten(blocks);
    const expanded = flatten(blocks, new Set([gapIndex]));
    expect(expanded.length).toBeGreaterThan(collapsed.length);
    expect(collapsed.filter((e) => e.gapIndex !== null)).toHaveLength(1);
    expect(expanded.filter((e) => e.gapIndex !== null)).toHaveLength(0);
  });
});

describe('unified rendering', () => {
  it('emits real hunk headers an agent can already read', () => {
    setColorEnabled(false);
    const rows = diffVersions('one\ntwo\nthree\n', 'one\nTWO\nthree\n');
    const out = renderUnified(rows, { mode: 'plain', oldLabel: 'v1', newLabel: 'v2' });
    expect(out[0]).toBe('--- v1');
    expect(out[1]).toBe('+++ v2');
    expect(out[2]).toMatch(/^@@ -1,3 \+1,3 @@$/);
    expect(out).toContain('-two');
    expect(out).toContain('+TWO');
  });

  it('emits only labels when the versions are identical', () => {
    setColorEnabled(false);
    const rows = diffVersions('same\n', 'same\n');
    expect(renderUnified(rows, { mode: 'plain', oldLabel: 'v1', newLabel: 'v2' })).toEqual([
      '--- v1',
      '+++ v2',
    ]);
  });

  it('honours NO_COLOR', () => {
    setColorEnabled(false);
    const rows = diffVersions('a\n', 'b\n');
    for (const line of renderUnified(rows, { mode: 'plain' })) {
      expect(line).toBe(stripAnsi(line));
    }
  });
});

describe('rich rendering', () => {
  it('marks locked lines in the gutter and tags them with the lock id', () => {
    setColorEnabled(false);
    const rows = diffVersions('a\nb\n', 'a\nB\n');
    const lines = renderRichLines(collapse(rows), {
      mode: 'rich',
      lockedLines: new Map([[1, 'L2']]),
    });
    const locked = lines.find((l) => l.newLine === 1)!;
    expect(locked.text).toContain('🔒');
    expect(locked.text).toContain('[L2]');
  });

  it('tags annotated lines with their annotation ids', () => {
    setColorEnabled(false);
    const rows = diffVersions('a\nb\n', 'a\nB\n');
    const lines = renderRichLines(collapse(rows), {
      mode: 'rich',
      annotated: new Map([[2, ['a1', 'a2']]]),
    });
    expect(lines.find((l) => l.newLine === 2)!.text).toContain('●a1 ●a2');
  });

  it('keeps deletions addressable but outside the new-version numbering', () => {
    setColorEnabled(false);
    const rows = diffVersions('gone\nkept\n', 'kept\n');
    const lines = renderRichLines(collapse(rows), { mode: 'rich' });
    expect(lines.some((l) => l.newLine === null && l.gapIndex === null)).toBe(true);
  });
});

describe('markdown highlighting', () => {
  it('leaves the visible text untouched', () => {
    setColorEnabled(true);
    const source = [
      '# Title',
      '',
      '## Approach',
      'Use `poller.ts` and **bold**.',
      '```ts',
      'const x = 1;',
      '```',
      '- item',
    ];
    expect(highlightMarkdown(source).map(stripAnsi)).toEqual(source);
  });

  it('styles headings but not text inside a fence', () => {
    setColorEnabled(true);
    const [heading, , fenced] = highlightMarkdown(['## Approach', '```', '## not a heading']);
    expect(heading).not.toBe('## Approach');
    expect(stripAnsi(fenced!)).toBe('## not a heading');
  });

  it('finds the section a line belongs to, ignoring headings inside fences', () => {
    const lines = ['preamble', '## Context', 'a', '```', '## Fake', '```', 'b', '## Rollout', 'c'];
    expect(sectionOf(lines, 0)).toBeNull();
    expect(sectionOf(lines, 2)).toBe('## Context');
    expect(sectionOf(lines, 6)).toBe('## Context');
    expect(sectionOf(lines, 8)).toBe('## Rollout');
  });
});

describe('ansi helpers', () => {
  it('measures and truncates by visible width', () => {
    setColorEnabled(true);
    const styled = `\x1b[1mhello\x1b[22m world`;
    expect(visibleLength(styled)).toBe(11);
    expect(stripAnsi(truncate(styled, 8))).toBe('hello w…');
  });

  it('does not emit escapes when colour is off', () => {
    setColorEnabled(false);
    expect(truncate('abcdefghij', 5)).toBe('abcd…');
    expect(renderDocument('# Title\n', 'rich')).toEqual(['# Title']);
  });
});
