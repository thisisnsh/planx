import { Box, Text, useApp, useInput, useStdout } from 'ink';
import { useMemo, useState } from 'react';
import { bold, dim, inverse, padEnd, red, signal, stripAnsi, truncate } from '../render/ansi.js';
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
  onDone: (chosen: T[]) => void;
  onCancel: () => void;
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

function confirmed(state: Confirming): boolean {
  return state.typed.trim().toLowerCase() === CONFIRM_WORD;
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
  onDone,
  onCancel,
}: PickerProps<T>) {
  const { exit } = useApp();
  const { stdout } = useStdout();
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

  // The frame costs four rows of chrome above the list and three below it, and
  // the confirmation takes one more for the line you type into.
  const chrome = confirming === null ? 9 : 10;
  const height = Math.max(3, Math.min(rows.length, (stdout?.rows ?? 24) - chrome));
  const start = Math.max(0, Math.min(cursor - Math.floor(height / 2), rows.length - height));
  const visible = rows.slice(start, start + height);

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

    if (key.escape || (key.ctrl && input === 'c')) {
      onCancel();
      exit();
      return;
    }
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
    ['enter', 'open'],
    ['esc', 'cancel'],
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
    ...visible.map((row) => {
      const active = rows.indexOf(row) === cursor;
      const indent = row.child ? '   ' : '';
      const mark = active ? '❯ ' : '  ';
      const width = labelWidth - indent.length;
      const label = padEnd(truncate(row.item.label, width), width);
      const hint = row.item.hint ? dim(`  ${truncate(row.item.hint, inner - labelWidth - 6)}`) : '';
      const line = `${mark}${indent}${label}${hint}`;
      // Inverse video has to own the whole row: a dim hint inside an inverse
      // run closes its own style and leaves the rest painted normally, which
      // reads as a highlight that stops half way.
      return `  ${active ? inverse(signal(padEnd(stripAnsi(line), inner - 2))) : line}`;
    }),
    ...(rows.length ? [] : [dim('  no matches')]),
    // The only thing between you and a permanent delete, so it names the target
    // in full rather than asking about "this". Red, not bold: the colour is
    // what says destructive, and every confirmation planx draws reads the same.
    ...(confirming === null
      ? ['']
      : [
          `  ${red(`delete ${confirming.target}? this cannot be undone`)}`,
          `  ${dim(`type ${CONFIRM_WORD} to confirm:`)} ${confirming.typed}${inverse(' ')}`,
        ]),
    ...hintLines(
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
    ).map((line) => dim(`  ${line}`)),
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
