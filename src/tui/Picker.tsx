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
   * Absent means the row cannot be deleted, and `^d` is not offered on it.
   */
  deleteAs?: string;
}

export interface PickerProps<T> {
  title: string;
  subtitle?: string;
  items: Array<PickerItem<T>>;
  version?: string;
  /** Delete the row, and return the list as it stands afterwards. */
  onDelete?: (item: PickerItem<T>) => Array<PickerItem<T>>;
  /** What enter does here. The plan list opens; a short choice prompt chooses. */
  enterLabel?: string;
  /** What a second ctrl+c does. Defaults to ending the process with 130. */
  onQuit?: () => void;
  onDone: (chosen: T[]) => void;
}

/** One drawn row: a top-level item, or a child of one. */
interface Row<T> {
  item: PickerItem<T>;
  /** Index of the top-level item this row belongs to. */
  parent: number;
  child: boolean;
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
 * Flatten the tree to the rows that are actually on screen.
 *
 * Expansion is a set of top-level indices, the same shape the review's
 * `expandedGaps` has, and the row list is rebuilt from it on every render. A
 * plan with fifty versions is fifty strings; keeping a second, patched copy of
 * the tree in sync would cost more than rebuilding it.
 */
function flatten<T>(items: Array<PickerItem<T>>, expanded: ReadonlySet<number>): Array<Row<T>> {
  const rows: Array<Row<T>> = [];
  items.forEach((item, parent) => {
    rows.push({ item, parent, child: false });
    if (!expanded.has(parent)) return;
    for (const child of item.children ?? []) rows.push({ item: child, parent, child: true });
  });
  return rows;
}

/**
 * The list you land on, and the tree under it.
 *
 * A plan row opens into its versions, newest first. That is what makes a
 * version number reachable on a narrow terminal — the old single row put the
 * version in the middle of a grey column and truncated it away first — and it
 * is what gives `^d` something specific to point at.
 *
 * Filtering is a fuzzy subsequence match, so `gcr` finds
 * guard-clock-regression. Every printable character goes to it — deleting is
 * `^d`, because a bare `d` took the keystroke before the filter saw it and made
 * every plan starting with `d` unfindable. Typing collapses everything and
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
  items: initial,
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
  const [items, setItems] = useState(initial);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(() => new Set());
  const [confirming, setConfirming] = useState<Confirming | null>(null);

  const rows = useMemo(() => {
    if (!query) return flatten(items, expanded);
    const matched = fuzzyFilter(query, items, (i) => `${i.label} ${i.searchable ?? ''}`).map(
      (m) => m.item,
    );
    return flatten(matched, new Set());
  }, [items, expanded, query]);

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
    setCursor(rows.findIndex((row) => row.parent === parent && !row.child));
  }

  function remove(item: PickerItem<T>) {
    const next = onDelete?.(item) ?? items;
    setItems(next);
    // Every index into the old list is suspect once a row has gone, and there
    // is nothing worth salvaging: you deleted the thing you were looking at.
    setExpanded(new Set());
    setCursor((c) => Math.max(0, Math.min(c, next.length - 1)));
    setConfirming(null);
  }

  useInput((input, key) => {
    if (confirming !== null) {
      if (key.escape) return setConfirming(null);
      // Anything short of the word is not an answer, so enter is not one
      // either — it does nothing at all rather than doing the thing.
      if (key.return) return confirmed(confirming) ? remove(here!.item) : undefined;
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
      return setCursor((c) => Math.min(rows.length - 1, c + 1));
    }
    if (key.upArrow || (key.ctrl && input === 'p')) {
      return setCursor((c) => Math.max(0, c - 1));
    }
    if (key.rightArrow) {
      if (!here || here.child || !here.item.children?.length) return;
      return setExpanded((set) => new Set(set).add(here.parent));
    }
    if (key.leftArrow) {
      if (!here || !expanded.has(here.parent)) return;
      return collapse(here.parent);
    }
    if (key.return) return onDone(here ? [here.item.value] : []);
    // `^d`, not `d`. A bare letter opened the confirmation before the filter
    // ever saw it, so no plan whose name starts with `d` could be filtered for
    // — and finding a plan is what the list is for.
    if (key.ctrl && input === 'd' && here?.item.deleteAs) {
      return setConfirming({ target: here.item.deleteAs, typed: '' });
    }

    if (key.backspace || key.delete) {
      setCursor(0);
      return setQuery((q) => q.slice(0, -1));
    }
    if (input && !key.ctrl && !key.meta) {
      setCursor(0);
      setQuery((q) => q + input);
    }
  });

  const frameWidth = Math.max(MIN_WIDTH, (stdout?.columns ?? 80) - 1);
  const inner = frameWidth - FRAME_PADDING;
  const labelWidth = Math.max(12, Math.floor((inner - 6) * 0.55));

  // The query takes the subtitle's row when there is one, so the frame does not
  // change height the moment you start typing.
  const count = `${rows.length}/${items.length}`;
  const lead = query ? `filter: ${query}${inverse(' ')}` : dim(subtitle ?? '');
  const subtitleRow = `  ${padEnd(lead, inner - 2 - count.length)}${dim(count)}`;

  const hints: Hint[] = [
    ['↑↓', 'choose'],
    ['enter', enterLabel],
    ['^c', 'exit'],
  ];
  // The tree is the only thing on this screen with no key on the bar saying it
  // is there. Contextual, the way the review varies `d show diff` / `d hide
  // diff`: a row offers the direction it can actually go, and a filtered list —
  // which matches plans only, and draws every one of them collapsed — offers
  // neither, because neither arrow does anything there.
  const open = here !== undefined && rows.some((row) => row.parent === here.parent && row.child);
  if (!query && here) {
    if (open) hints.push(['←', 'collapse']);
    else if (!here.child && here.item.children?.length) hints.push(['→', 'versions']);
  }
  if (here?.item.deleteAs) hints.push(['^d', 'delete']);

  const drawn = [
    `  ${bold(title)}`,
    subtitleRow,
    '',
    ...visible.flatMap((row) => {
      const active = rows.indexOf(row) === cursor;
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
