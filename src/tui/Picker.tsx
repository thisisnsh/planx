import { Box, Text, useInput, useStdout } from 'ink';
import { useMemo, useState } from 'react';
import {
  bold,
  dim,
  green,
  inverse,
  padEnd,
  red,
  signal,
  stripAnsi,
  truncate,
} from '../render/ansi.js';
import { EXIT_PROMPT, useDoubleCtrlC } from './exit.js';
import { bottomRule, brandTitle, frameLine, FRAME_PADDING, REPO, topRule } from './frame.js';
import { fuzzyFilter } from './fuzzy.js';
import { hintLines, type Hint } from './hints.js';

/** Matches the review's floor, so both frames narrow to the same width. */
const MIN_WIDTH = 48;

export interface PickerItem<T> {
  value: T;
  label: string;
  /** The grey column: what the row is, other than its name. */
  hint?: string;
  /** Extra text that should match when typing, but is not displayed. */
  searchable?: string;
  /** Rows revealed by `→`. A row with none is a leaf. */
  children?: Array<PickerItem<T>>;
  /** `executed` paints the row green: this is the version that was built. */
  tone?: 'executed';
  /**
   * How this row is named in a delete confirmation — `guard-clock-a3f9 v3`.
   * Absent means the row cannot be deleted, and `ctrl+d` is not offered on it.
   */
  deleteAs?: string;
}

export interface PickerSection<T> {
  /** Stable key, used for React keys and to re-find a section after a
   *  delete rebuilds the list. */
  key: string;
  /** Dim divider row drawn above the section. Omitted entirely when the
   *  section has no label and is the only section (a plain flat list). */
  label?: string;
  /**
   * Open the list with this section folded to its header.
   *
   * Only honoured where there is a `label` to fold to — a section with no
   * header row has nothing left to stand for it, and nothing to press `→` on.
   */
  defaultCollapsed?: boolean;
  /** A section with nothing in it — no items, and after a filter, no matches
   *  either — disappears entirely, header included. */
  items: Array<PickerItem<T>>;
}

export interface PickerProps<T> {
  title: string;
  subtitle?: string;
  sections: Array<PickerSection<T>>;
  version?: string;
  /** Delete the row, and return the list as it stands afterwards. */
  onDelete?: (item: PickerItem<T>) => Array<PickerSection<T>>;
  /** What enter does here. The plan list opens; a short choice prompt chooses. */
  enterLabel?: string;
  /** What a second ctrl+c does. Defaults to ending the process with 130. */
  onQuit?: () => void;
  onDone: (chosen: T[]) => void;
}

/** One drawn row: a section header, a top-level item, or a child of one. */
type Row<T> =
  | { kind: 'header'; sectionKey: string; label: string; collapsed: boolean; held: number }
  | { kind: 'item'; item: PickerItem<T>; parent: number; child: boolean; sectionKey: string };

/**
 * Rows the cursor is allowed to stop on.
 *
 * An open section's header is a divider and is stepped over. A collapsed one is
 * the only row its section has left, so it has to be reachable — there would
 * otherwise be no way back to what it is holding.
 */
function selectable<T>(row: Row<T> | undefined): boolean {
  return row?.kind === 'item' || (row?.kind === 'header' && row.collapsed);
}

/**
 * A delete waiting on the word.
 *
 * There is no trash behind this and no `restore` command, so the last thing
 * between a keystroke and a plan that is gone used to be one press of `enter`.
 * Typing the word costs six characters and cannot be done by accident.
 */
interface Confirming {
  /** The row named in full: `guard-clock-a3f9 v3`. */
  target: string;
  typed: string;
}

/** The word, and the only thing that turns `enter` back into a delete. */
const CONFIRM_WORD = 'delete';

/** What the confirmation costs the list: the question, and the line you type. */
const CONFIRM_ROWS = 2;

/** Past the mark and the label column, so it reads as belonging to the row. */
const CONFIRM_INSET = '      ';

function confirmed(state: Confirming): boolean {
  return state.typed.trim().toLowerCase() === CONFIRM_WORD;
}

/**
 * The two rows under the row being deleted.
 *
 * The only thing between you and a permanent delete, so it names the target in
 * full rather than asking about "this". Red, not bold: the colour is what says
 * destructive, and every confirmation planx draws reads the same.
 */
function confirmRows(state: Confirming): string[] {
  return [
    `${CONFIRM_INSET}${red(`delete ${state.target}? this cannot be undone`)}`,
    `${CONFIRM_INSET}${dim(`type ${CONFIRM_WORD} to confirm:`)} ${state.typed}${inverse(' ')}`,
  ];
}

/**
 * Flatten every section, and the tree under each of its items, to the rows
 * that are actually on screen.
 *
 * Expansion is a set of top-level indices counted once across every section —
 * the same shape the review's `expandedGaps` has — and the row list is rebuilt
 * from it on every render. A plan with fifty versions is fifty strings; keeping
 * a second, patched copy of the tree in sync would cost more than rebuilding it.
 *
 * A filter matches within each section on its own. A section with nothing to
 * show — no items, or none of them matching — drops out entirely, header
 * included, the same way the plain "no matches" line stands in for the
 * filtered list as a whole.
 *
 * A collapsed section keeps its header and drops its items, and a filter
 * reaches into it anyway: a match you cannot see is worse than a section you
 * have to fold again, and the collapsed set is kept for when the query clears.
 * Its items still spend their `parent` indices while folded, so expanding a
 * section does not renumber the trees in the sections below it.
 */
function flatten<T>(
  sections: Array<PickerSection<T>>,
  expanded: ReadonlySet<number>,
  query: string,
  collapsed: ReadonlySet<string> = new Set(),
): Array<Row<T>> {
  const rows: Array<Row<T>> = [];
  let parent = 0;

  for (const section of sections) {
    const items = query
      ? fuzzyFilter(query, section.items, (i) => `${i.label} ${i.searchable ?? ''}`).map(
          (m) => m.item,
        )
      : section.items;
    if (!items.length) continue;

    const shut = !query && Boolean(section.label) && collapsed.has(section.key);
    if (section.label) {
      rows.push({
        kind: 'header',
        sectionKey: section.key,
        label: section.label,
        collapsed: shut,
        held: items.length,
      });
    }
    if (shut) {
      parent += items.length;
      continue;
    }
    for (const item of items) {
      rows.push({ kind: 'item', item, parent, child: false, sectionKey: section.key });
      // A filter draws every match collapsed: it is for finding a plan, and
      // matching a version number across forty of them would bury the thing
      // you were looking for.
      if (!query && expanded.has(parent)) {
        for (const child of item.children ?? []) {
          rows.push({ kind: 'item', item: child, parent, child: true, sectionKey: section.key });
        }
      }
      parent++;
    }
  }

  return rows;
}

/** The nearest selectable row past `cursor` in `direction`, or `cursor`
 *  unchanged when there is none — an open header is stepped over, never
 *  landed on. */
function stepCursor<T>(rows: Array<Row<T>>, cursor: number, direction: 1 | -1): number {
  let i = cursor + direction;
  while (i >= 0 && i < rows.length) {
    if (selectable(rows[i])) return i;
    i += direction;
  }
  return cursor;
}

/** The first selectable row — where the cursor opens, and where it lands
 *  after a filter changes what is visible. */
function firstSelectable<T>(rows: Array<Row<T>>): number {
  const index = rows.findIndex((row) => selectable(row));
  return index === -1 ? 0 : index;
}

/** `index`, pulled onto the nearest selectable row — what a delete leaves the
 *  cursor on, since the row it pointed at may now be gone. */
function clampToSelectable<T>(rows: Array<Row<T>>, index: number): number {
  const bounded = Math.max(0, Math.min(index, rows.length - 1));
  if (selectable(rows[bounded])) return bounded;
  const forward = stepCursor(rows, bounded, 1);
  return selectable(rows[forward]) ? forward : firstSelectable(rows);
}

/** The sections that open folded — `defaultCollapsed`, honoured only where
 *  there is a header row left to unfold them from. */
function initialCollapsed<T>(sections: Array<PickerSection<T>>): Set<string> {
  return new Set(sections.filter((s) => s.defaultCollapsed && s.label).map((s) => s.key));
}

/**
 * The list you land on, and the tree under it.
 *
 * A plan row opens into its versions, newest first. That is what makes a
 * version number reachable on a narrow terminal — the old single row put the
 * version in the middle of a grey column and truncated it away first — and it
 * is what gives `ctrl+d` something specific to point at.
 *
 * Sections fold on the same two keys, so a list that is mostly plans from
 * somewhere else can be put away without filtering it out one letter at a
 * time. A folded section keeps its header, says how many rows it is holding,
 * and is the one header the cursor can land on.
 *
 * Filtering is a fuzzy subsequence match, so `gcr` finds
 * guard-clock-regression. Every printable character goes to it — deleting is
 * `ctrl+d`, because a bare `d` took the keystroke before the filter saw it and
 * made every plan starting with `d` unfindable. Typing collapses everything and
 * matches plans only: a filter is for finding a plan, and matching `v3` across
 * forty of them would bury the thing you were looking for.
 *
 * It wears the same frame the review does. Bare `planx` used to show two
 * unrelated visual languages before you reached the plan — a list of plain rows,
 * then a bordered document — which made the picker look like something else's
 * output that happened to appear first.
 */
export function Picker<T>({
  title,
  subtitle,
  sections: initial,
  version,
  onDelete,
  enterLabel = 'open',
  onQuit,
  onDone,
}: PickerProps<T>) {
  const { stdout } = useStdout();
  // Above the handler below, so it fires while the confirmation is waiting for
  // the word as well as on the list itself.
  const leaving = useDoubleCtrlC({ onExit: onQuit });
  const [sections, setSections] = useState(initial);
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => initialCollapsed(initial));
  const [cursor, setCursor] = useState(() =>
    firstSelectable(flatten(initial, new Set(), '', initialCollapsed(initial))),
  );
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(() => new Set());
  const [confirming, setConfirming] = useState<Confirming | null>(null);

  const rows = useMemo(
    () => flatten(sections, expanded, query, collapsed),
    [sections, expanded, query, collapsed],
  );

  const here = rows[cursor];

  // One row between the list and the hint bar, and one only. The armed ctrl+c
  // line used to have a row of its own down here, reserved on every frame and
  // empty on almost all of them; it takes the hint bar instead, the same way
  // the review's does, so the frame does not change height when you press it
  // and there is a single blank above the bar on every screen planx draws.
  const messageRows = [''];

  // The frame costs four rows of chrome above the list and three below it, plus
  // the message row.
  const chrome = 8 + messageRows.length;
  const height = Math.max(3, Math.min(rows.length, (stdout?.rows ?? 24) - chrome));
  // The confirmation is two rows spliced into the list under its own target, so
  // the list gives up two while it is open and the frame is the same either way.
  const listHeight = confirming === null ? height : Math.max(1, height - CONFIRM_ROWS);
  const start = Math.max(
    0,
    Math.min(cursor - Math.floor(listHeight / 2), rows.length - listHeight),
  );
  const visible = rows.slice(start, start + listHeight);

  function collapse(parent: number) {
    setExpanded((set) => {
      const next = new Set(set);
      next.delete(parent);
      return next;
    });
    // Back onto the plan the versions belonged to, which is the row the
    // collapsed tree leaves under your finger.
    setCursor(rows.findIndex((row) => row.kind === 'item' && row.parent === parent && !row.child));
  }

  /** The header row a section folds to, or -1 for a section that has none. */
  function headerIndex(sectionKey: string): number {
    return rows.findIndex((row) => row.kind === 'header' && row.sectionKey === sectionKey);
  }

  /**
   * Fold a section from a row inside it, the way the review folds a heading
   * from a line under it — the alternative is scrolling back to the header
   * first, on a list where the header is the one row the cursor cannot reach.
   */
  function hideSection(sectionKey: string) {
    const header = headerIndex(sectionKey);
    if (header === -1) return;
    setCollapsed((set) => new Set(set).add(sectionKey));
    // Onto the row that now stands for everything the section was holding.
    // Rows below it move; the header itself does not.
    setCursor(header);
  }

  /** Unfold a section from its header, onto the first row it brings back. */
  function showSection(sectionKey: string) {
    setCollapsed((set) => {
      const next = new Set(set);
      next.delete(sectionKey);
      return next;
    });
    setCursor(headerIndex(sectionKey) + 1);
  }

  function remove(item: PickerItem<T>) {
    const next = onDelete?.(item) ?? sections;
    setSections(next);
    // Every index into the old list is suspect once a row has gone, and there
    // is nothing worth salvaging: you deleted the thing you were looking at.
    // What is folded is not an index and survives — the section keys are the
    // same ones, and reopening a section you closed is not what a delete means.
    setExpanded(new Set());
    setCursor((c) => clampToSelectable(flatten(next, new Set(), query, collapsed), c));
    setConfirming(null);
  }

  useInput((input, key) => {
    if (confirming !== null) {
      if (key.escape) return setConfirming(null);
      // Anything short of the word is not an answer, so enter is not one
      // either — it does nothing at all rather than doing the thing.
      if (key.return) {
        return confirmed(confirming) && here?.kind === 'item' ? remove(here.item) : undefined;
      }
      if (key.backspace || key.delete) {
        return setConfirming({ ...confirming, typed: confirming.typed.slice(0, -1) });
      }
      if (input && !key.ctrl && !key.meta) {
        setConfirming({ ...confirming, typed: confirming.typed + input });
      }
      return;
    }

    // `esc` does not leave the list. Leaving planx is ctrl+c twice wherever you
    // are, and this was the one screen where a single key still ended the
    // session — on a list you reach by typing `planx` with no arguments, which
    // is where a stray escape is likeliest. It still means *not this row*
    // inside the delete confirmation above, which is backing out of a
    // question rather than leaving.
    if (key.downArrow || (key.ctrl && input === 'n')) {
      return setCursor((c) => stepCursor(rows, c, 1));
    }
    if (key.upArrow || (key.ctrl && input === 'p')) {
      return setCursor((c) => stepCursor(rows, c, -1));
    }
    // `→` opens the nearest thing that is shut, `←` shuts the nearest thing
    // that is open: a section from its own header, then a plan's versions, then
    // the section the plan is standing in. One pair of keys down the whole
    // tree, rather than a second pair for sections that would have to be
    // explained on the bar.
    if (key.rightArrow) {
      if (here?.kind === 'header') return showSection(here.sectionKey);
      if (!here || here.kind !== 'item' || here.child || !here.item.children?.length) return;
      return setExpanded((set) => new Set(set).add(here.parent));
    }
    if (key.leftArrow) {
      if (!here || here.kind !== 'item') return;
      if (expanded.has(here.parent)) return collapse(here.parent);
      return hideSection(here.sectionKey);
    }
    // On a folded header enter opens the section rather than choosing nothing:
    // the row names a section, and a picker that quit empty-handed on the one
    // row that is not a plan would be answering a question nobody asked.
    if (key.return) {
      if (here?.kind === 'header') return showSection(here.sectionKey);
      return onDone(here?.kind === 'item' ? [here.item.value] : []);
    }
    // `ctrl+d`, not `d`. A bare letter opened the confirmation before the
    // filter ever saw it, so no plan whose name starts with `d` could be
    // filtered for — and finding a plan is what the list is for.
    if (key.ctrl && input === 'd' && here?.kind === 'item' && here.item.deleteAs) {
      return setConfirming({ target: here.item.deleteAs, typed: '' });
    }

    if (key.backspace || key.delete) {
      const nextQuery = query.slice(0, -1);
      setQuery(nextQuery);
      return setCursor(firstSelectable(flatten(sections, expanded, nextQuery, collapsed)));
    }
    if (input && !key.ctrl && !key.meta) {
      const nextQuery = query + input;
      setQuery(nextQuery);
      return setCursor(firstSelectable(flatten(sections, expanded, nextQuery, collapsed)));
    }
  });

  const frameWidth = Math.max(MIN_WIDTH, (stdout?.columns ?? 80) - 1);
  const inner = frameWidth - FRAME_PADDING;
  const labelWidth = Math.max(12, Math.floor((inner - 6) * 0.55));

  // The query takes the subtitle's row when there is one, so the frame does not
  // change height the moment you start typing.
  //
  // Both halves count top-level items only — a plan expanded into its versions
  // never inflated this before, and a header row is not an item either.
  const totalItems = sections.reduce((n, s) => n + s.items.length, 0);
  const visibleItems = rows.filter((row) => row.kind === 'item' && !row.child).length;
  const count = `${visibleItems}/${totalItems}`;
  const lead = query ? `filter: ${query}${inverse(' ')}` : dim(subtitle ?? '');
  const subtitleRow = `  ${padEnd(lead, inner - 2 - count.length)}${dim(count)}`;

  const hints: Hint[] = [
    ['↑↓', 'choose'],
    ['enter', here?.kind === 'header' ? 'show section' : enterLabel],
    ['ctrl+c', 'exit'],
  ];
  // The tree is the only thing on this screen with no key on the bar saying it
  // is there. Contextual, the way the review varies `d show diff` / `d hide
  // diff`: a row offers the direction it can actually go, and a filtered list —
  // which matches plans only, and draws every one of them collapsed — offers
  // neither, because neither arrow does anything there.
  const open =
    here?.kind === 'item' &&
    rows.some((row) => row.kind === 'item' && row.parent === here.parent && row.child);
  if (here?.kind === 'header') {
    hints.push(['→', 'show section']);
  } else if (!query && here?.kind === 'item') {
    if (open) hints.push(['←', 'collapse']);
    else {
      if (!here.child && here.item.children?.length) hints.push(['→', 'versions']);
      // Only where there is a header to fold to. `←` is the same key that
      // closes a plan's versions, so it is offered for one thing at a time:
      // the versions while they are open, the section once they are not.
      if (headerIndex(here.sectionKey) !== -1) hints.push(['←', 'hide section']);
    }
  }
  if (here?.kind === 'item' && here.item.deleteAs) hints.push(['ctrl+d', 'delete']);

  const drawn = [
    `  ${bold(title)}`,
    subtitleRow,
    '',
    ...visible.flatMap((row) => {
      const active = rows.indexOf(row) === cursor;
      // A header carries no cursor column of its own — an open one cannot be
      // reached, and a folded one is painted rather than marked — so it sits at
      // the same left margin as the title and subtitle above it, not indented
      // out to the item rows. The `❯` would otherwise appear and disappear two
      // columns left of every other one on the screen.
      if (row.kind !== 'item') {
        // What the fold is holding, said in numbers: a section that took its
        // rows away with it and left nothing in their place reads as plans
        // that are gone rather than plans that are folded.
        const held = row.collapsed ? `  ${row.held} hidden` : '';
        const line = `${truncate(row.label, Math.max(1, inner - 2 - held.length))}${held}`;
        return [`  ${active ? inverse(signal(padEnd(line, inner - 2))) : dim(line)}`];
      }
      const indent = row.child ? '   ' : '';
      const mark = active ? '❯ ' : '  ';
      const width = labelWidth - indent.length;
      const built = truncate(row.item.label, width);
      // Built, and it is still the plan: green says so, and the version rows
      // say it in words as well, because colour alone is a legend nobody was
      // given.
      const label = padEnd(row.item.tone === 'executed' ? green(built) : built, width);
      const hint = row.item.hint ? dim(`  ${truncate(row.item.hint, inner - labelWidth - 6)}`) : '';
      const line = `${mark}${indent}${label}${hint}`;
      // Inverse video has to own the whole row: a dim hint inside an inverse
      // run closes its own style and leaves the rest painted normally, which
      // reads as a highlight that stops half way. Under the cursor, an executed
      // row keeps its colour — `signal` over it would swallow the green.
      const paint = row.item.tone === 'executed' ? green : signal;
      const drawnRow = `  ${active ? inverse(paint(padEnd(stripAnsi(line), inner - 2))) : line}`;
      // The confirmation sits directly under what it is about. Drawn after the
      // whole list, the red line was nowhere near the plan it named.
      return active && confirming !== null ? [drawnRow, ...confirmRows(confirming)] : [drawnRow];
    }),
    ...(rows.length ? [] : [dim('  no matches')]),
    ...messageRows,
    // An armed ctrl+c takes the bar. It is the only thing that ends the
    // session, so it outranks both the hints and the delete confirmation's own
    // — `esc cancel` can wait for the two seconds this takes to lapse.
    ...(leaving
      ? [`  ${red(EXIT_PROMPT)}`]
      : hintLines(
          confirming === null
            ? hints
            : // `enter delete` appears the moment the word does. The bar says what
              // the gate wants, and then says it has it.
              confirmed(confirming)
              ? ([
                  ['enter', 'delete'],
                  ['esc', 'cancel'],
                ] satisfies Hint[])
              : ([['esc', 'cancel']] satisfies Hint[]),
          inner - 2,
        ).map((line) => dim(`  ${line}`))),
  ];

  return (
    <Box flexDirection="column">
      <Text>{topRule(frameWidth, brandTitle(version))}</Text>
      <Text>{frameLine('', inner)}</Text>
      {drawn.map((line, i) => (
        <Text key={i}>{frameLine(line, inner)}</Text>
      ))}
      <Text>{bottomRule(frameWidth, ` ★ ${REPO} `)}</Text>
    </Box>
  );
}
