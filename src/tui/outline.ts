/**
 * The map down the right of the document.
 *
 * A long plan is one flat column of rows: nothing on screen says which section
 * you are standing in, and the only way to find out is to scroll back to the
 * nearest heading. This is that answer, drawn beside the plan rather than
 * looked up.
 *
 * Pure string functions, no React — the same spirit as ./selection.ts and
 * ./hints.ts — so the layout is testable without mounting a terminal.
 */

import { dim, padEnd, signal, truncate } from '../render/ansi.js';
import { headingsIn } from './model.js';
import { scrollFor } from './selection.js';

export interface OutlineEntry {
  /** 1-based line of the heading in the version under review. */
  line: number;
  /** 2, 3 or 4. */
  level: number;
  title: string;
}

/**
 * The `#` title is not a section: it is the name of the plan, it is already on
 * the frame's top rule, and folding it would collapse the whole document to one
 * row. `#####` and deeper are paragraphs with titles on them — the same reason
 * `foldEnd` declines them.
 */
const MIN_LEVEL = 2;
const MAX_LEVEL = 4;

/**
 * Every section of the plan, in document order.
 *
 * A heading with nothing under it is one of these even though `foldEnd`
 * declines to fold it: it is a place in the plan, so it belongs in the map and
 * `tab` should stop on it. Only folding cares whether there is anything to hide.
 */
export function outlineEntries(docLines: readonly string[]): OutlineEntry[] {
  return headingsIn(docLines)
    .filter((h) => h.level >= MIN_LEVEL && h.level <= MAX_LEVEL)
    .map((h) => ({ line: h.line, level: h.level, title: h.text }));
}

/**
 * Which entry the cursor is inside — the last one at or above `line`.
 *
 * `-1` when the cursor sits above the first heading, or on no line of the
 * document at all.
 */
export function currentEntry(entries: readonly OutlineEntry[], line: number | null): number {
  if (line === null) return -1;
  let found = -1;
  for (let i = 0; i < entries.length; i++) {
    if (entries[i]!.line > line) break;
    found = i;
  }
  return found;
}

/** `▸ ` or the two spaces that stand in for it. */
const MARKER_WIDTH = 2;
/** Columns one level of nesting steps in by. */
const INDENT = 2;

export interface OutlineOptions {
  entries: readonly OutlineEntry[];
  current: number;
  height: number;
  width: number;
  /** Heading lines whose sections are folded, for the marker. */
  folded: ReadonlySet<number>;
}

/**
 * The column, as exactly `height` rows of exactly `width` visible columns.
 *
 * One row per entry, in three parts: the marker, then the indent, then the
 * title. The marker keeps a column of its own on the left of every row rather
 * than moving with the heading's depth, so a fold reads as a mark against the
 * list and not as a fourth level of nesting.
 *
 * The indent is what makes this an outline rather than a list: it is the only
 * thing on screen that says a `###` belongs to the `##` above it, and without
 * it a plan's subsections read as siblings of its sections.
 *
 * The current entry is the signal yellow the cursor arrow uses and every other
 * entry is dim. Nothing is bold — colour carries the weight here as it does
 * everywhere else in the frame.
 *
 * More sections than there are body rows is normal on a long plan, so the
 * entries are windowed with the same `scrollFor` that scrolls the document.
 * The window is a function of the current entry alone rather than of a stored
 * offset: a map that remembers where it was scrolled to is a second thing to
 * keep in sync with the cursor, and it has nothing to say that the section you
 * are in does not.
 */
export function outlineColumn(opts: OutlineOptions): string[] {
  const { entries, current, height, width } = opts;
  const offset = scrollFor(Math.max(0, current), 0, height, entries.length);
  const blank = ' '.repeat(Math.max(0, width));

  const out: string[] = [];
  for (let i = 0; i < height; i++) {
    const index = offset + i;
    const entry = entries[index];
    if (!entry) {
      out.push(blank);
      continue;
    }
    const marker = opts.folded.has(entry.line) ? '▸ ' : '  ';
    const indent = ' '.repeat(INDENT * (entry.level - MIN_LEVEL));
    const room = Math.max(1, width - MARKER_WIDTH - indent.length);
    const text = padEnd(`${marker}${indent}${truncate(entry.title, room)}`, width);
    out.push(index === current ? signal(text) : dim(text));
  }
  return out;
}
