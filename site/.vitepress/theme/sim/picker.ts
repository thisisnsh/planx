/**
 * Bare `planx` — the plan list, ported from src/tui/Picker.tsx.
 *
 * It wears the same frame the review does, because two visual languages before
 * you reach a plan is what made the old list look like something else's output
 * that happened to appear first. A plan row opens into its versions with `→`,
 * typing filters by fuzzy subsequence, and `d` is the one destructive key in
 * planx — so it names its target in full and asks.
 */

import { hintLines, type Hint } from './hints.js';
import { fit, len, p, type Line } from './text.js';
import { PLANX_VERSION, REPO } from './engine.js';

export interface PickerItem {
  label: string;
  hint: string;
  /** How the row is named in a delete confirmation. */
  deleteAs: string;
  children?: PickerItem[];
}

export interface PickerState {
  items: PickerItem[];
  query: string;
  cursor: number;
  expanded: Set<number>;
  confirming: string | null;
  status: string | null;
  deleted: string[];
  cols: number;
  did: Set<string>;
}

export function createPicker(items: PickerItem[]): PickerState {
  return {
    items: items.map((item) => ({ ...item, children: item.children?.map((c) => ({ ...c })) })),
    query: '',
    cursor: 0,
    expanded: new Set(),
    confirming: null,
    status: null,
    deleted: [],
    cols: 80,
    did: new Set(),
  };
}

interface Row {
  item: PickerItem;
  parent: number;
  child: boolean;
}

/** A fuzzy subsequence match, so `gcr` finds guard-clock-regression. */
function matches(query: string, text: string): boolean {
  const needle = query.toLowerCase().replace(/\s+/g, '');
  const hay = text.toLowerCase();
  let i = 0;
  for (const char of hay) {
    if (char === needle[i]) i++;
    if (i === needle.length) return true;
  }
  return i === needle.length;
}

export function rowsOf(state: PickerState): Row[] {
  // Typing collapses everything and matches plans only: a filter is for finding
  // a plan, and matching `v3` across forty of them would bury it.
  const items = state.query
    ? state.items.filter((item) => matches(state.query, `${item.label} ${item.hint}`))
    : state.items;
  const rows: Row[] = [];
  items.forEach((item, parent) => {
    rows.push({ item, parent, child: false });
    if (state.query || !state.expanded.has(parent)) return;
    for (const child of item.children ?? []) rows.push({ item: child, parent, child: true });
  });
  return rows;
}

export function pickerPress(state: PickerState, key: string): void {
  const rows = rowsOf(state);
  const here = rows[state.cursor];

  if (state.confirming !== null) {
    if (key === 'enter') {
      const target = here?.item;
      if (target) {
        state.deleted.push(target.deleteAs);
        if (here!.child) {
          const parent = state.items[here!.parent];
          if (parent?.children) parent.children = parent.children.filter((c) => c !== target);
        } else {
          state.items = state.items.filter((item) => item !== target);
        }
        state.status = `Deleted ${target.deleteAs}. This cannot be undone.`;
        state.did.add('delete');
      }
      state.expanded = new Set();
      state.cursor = Math.max(0, Math.min(state.cursor, rowsOf(state).length - 1));
      state.confirming = null;
      return;
    }
    if (key === 'escape' || key === 'n') state.confirming = null;
    return;
  }

  state.status = null;
  if (key === 'down') {
    state.cursor = Math.min(rows.length - 1, state.cursor + 1);
    return;
  }
  if (key === 'up') {
    state.cursor = Math.max(0, state.cursor - 1);
    return;
  }
  if (key === 'right') {
    if (!here || here.child || !here.item.children?.length) return;
    state.expanded.add(here.parent);
    state.did.add('versions');
    return;
  }
  if (key === 'left') {
    if (!here || !state.expanded.has(here.parent)) return;
    state.expanded.delete(here.parent);
    state.cursor = rowsOf(state).findIndex((row) => row.parent === here.parent && !row.child);
    return;
  }
  if (key === 'enter') {
    state.status = here ? `Opens ${here.item.deleteAs} in the review.` : null;
    state.did.add('open');
    return;
  }
  if (key === 'escape') {
    state.status = 'esc leaves the picker.';
    return;
  }
  // `^d`, not `d`. A bare letter opened the confirmation before the filter ever
  // saw it, so no plan whose name starts with `d` could be filtered for.
  if (key === 'ctrl+d' && here) {
    state.confirming = here.item.deleteAs;
    state.did.add('confirm');
    return;
  }
  if (key === 'backspace') {
    state.cursor = 0;
    state.query = state.query.slice(0, -1);
    return;
  }
  const char =
    key === 'space' ? ' ' : key.startsWith('text:') ? key.slice(5) : key.length === 1 ? key : null;
  if (char) {
    state.cursor = 0;
    state.query += char;
    state.did.add('filter');
  }
}

export function pickerHints(state: PickerState): Hint[] {
  if (state.confirming !== null) {
    return [
      ['enter', 'delete'],
      ['esc', 'cancel'],
    ];
  }
  const rows = rowsOf(state);
  const here = rows[state.cursor];
  const hints: Hint[] = [
    ['↑↓', 'choose'],
    ['enter', 'open'],
    ['esc', 'cancel'],
  ];
  const open = here !== undefined && rows.some((row) => row.parent === here.parent && row.child);
  if (!state.query && here) {
    if (open) hints.push(['←', 'collapse']);
    else if (!here.child && here.item.children?.length) hints.push(['→', 'versions']);
  }
  if (here) hints.push(['^d', 'delete']);
  return hints;
}

export function pickerFrame(state: PickerState, height: number): Line[] {
  const width = state.cols;
  const inner = width - 4;
  const rows = rowsOf(state);
  const labelWidth = Math.max(12, Math.floor((inner - 6) * 0.55));
  const shown = Math.max(3, Math.min(rows.length, height));
  const start = Math.max(0, Math.min(state.cursor - Math.floor(shown / 2), rows.length - shown));
  const visible = rows.slice(start, start + shown);

  const count = `${rows.length}/${state.items.length}`;
  const lead: Line = state.query
    ? [p(`filter: ${state.query}`), p(' ', 'caret')]
    : [p('every plan in ~/.planx, newest first', 'dim')];
  const subtitle: Line = [p('  '), ...fit(lead, inner - 2 - count.length), p(count, 'dim')];

  const body: Line[] = [
    [p('  '), p('planx', 'bold')],
    subtitle,
    [],
    ...visible.map((row) => {
      const active = rows.indexOf(row) === state.cursor;
      const indent = row.child ? '   ' : '';
      const mark = active ? '❯ ' : '  ';
      const label = `${row.item.label}`
        .padEnd(labelWidth - indent.length, ' ')
        .slice(0, labelWidth - indent.length);
      const line = `${mark}${indent}${label}  ${row.item.hint}`;
      // Inverse video has to own the whole row: a highlight that stops half way
      // is what happens when a dim run closes its own style inside one.
      if (active) return [p('  '), ...fit([p(line, 'inv')], inner - 2)];
      return [
        p('  '),
        p(`${mark}${indent}`),
        p(label),
        ...fit(
          [p(`  ${row.item.hint}`, 'dim')],
          inner - 2 - mark.length - indent.length - label.length,
        ),
      ];
    }),
    ...(rows.length ? [] : [[p('  no matches', 'dim')] as Line]),
  ];
  while (body.length < height + 3) body.push([]);

  const message: Line =
    state.confirming !== null
      ? [p('  '), p(`delete ${state.confirming}? this cannot be undone`, 'red')]
      : state.status
        ? [p('  '), p(state.status, 'sig')]
        : [];

  const hints = hintLines(pickerHints(state), inner - 2).map(
    (line) => [p('  '), p(line, 'dim')] as Line,
  );

  return [
    topRule(width),
    frameLine([], inner),
    ...body.map((line) => frameLine(line, inner)),
    frameLine(message, inner),
    ...hints.map((line) => frameLine(line, inner)),
    bottomRule(width),
  ];
}

function frameLine(content: Line, inner: number): Line {
  return [p('│', 'sig'), p(' '), ...fit(content, inner), p(' '), p('│', 'sig')];
}

function topRule(width: number): Line {
  const title: Line = [p(' '), p('planx', 'sig bold'), p(` v${PLANX_VERSION}`, 'dim'), p(' ')];
  return [
    p('╭─', 'sig'),
    ...title,
    p(`${'─'.repeat(Math.max(0, width - 3 - len(title)))}╮`, 'sig'),
  ];
}

function bottomRule(width: number): Line {
  const footer = ` ★ ${REPO} `;
  return [
    p(`╰${'─'.repeat(Math.max(0, width - 3 - footer.length))}`, 'sig'),
    p(footer, 'dim'),
    p('─╯', 'sig'),
  ];
}

/** The list the retention page opens on. */
export function demoPlans(): PickerItem[] {
  return [
    {
      label: 'guard-clock-a3f9',
      hint: 'Guard the clock regression · 3 versions · 2h ago',
      deleteAs: 'guard-clock-a3f9',
      children: [
        { label: 'v3', hint: 'captured 2h ago · 1 feedback', deleteAs: 'guard-clock-a3f9 v3' },
        { label: 'v2', hint: 'captured yesterday · reviewed', deleteAs: 'guard-clock-a3f9 v2' },
        { label: 'v1', hint: 'captured yesterday · reviewed', deleteAs: 'guard-clock-a3f9 v1' },
      ],
    },
    {
      label: 'rate-limit-uploads-77c2',
      hint: 'Rate limit the upload endpoint · 2 versions · 1d ago',
      deleteAs: 'rate-limit-uploads-77c2',
      children: [
        { label: 'v2', hint: 'captured 1d ago · reviewed', deleteAs: 'rate-limit-uploads-77c2 v2' },
        { label: 'v1', hint: 'captured 3d ago', deleteAs: 'rate-limit-uploads-77c2 v1' },
      ],
    },
    {
      label: 'retry-webhooks-1b40',
      hint: 'Retry failed webhooks with backoff · 1 version · 5d ago',
      deleteAs: 'retry-webhooks-1b40',
      children: [
        {
          label: 'v1',
          hint: 'captured 5d ago · never reviewed',
          deleteAs: 'retry-webhooks-1b40 v1',
        },
      ],
    },
  ];
}
