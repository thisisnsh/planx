import { Box, Text, useApp, useInput, useStdout } from 'ink';
import { useMemo, useState } from 'react';
import { bold, dim, inverse, padEnd, signal, stripAnsi, truncate } from '../render/ansi.js';
import { bottomRule, brandTitle, frameLine, FRAME_PADDING, REPO, topRule } from './frame.js';
import { fuzzyFilter } from './fuzzy.js';

/** Matches the review's floor, so both frames narrow to the same width. */
const MIN_WIDTH = 48;

export interface PickerItem<T> {
  value: T;
  label: string;
  hint?: string;
  /** Extra text that should match when typing, but is not displayed. */
  searchable?: string;
}

export interface PickerProps<T> {
  title: string;
  subtitle?: string;
  items: Array<PickerItem<T>>;
  multi?: boolean;
  footer?: string;
  version?: string;
  onDone: (chosen: T[]) => void;
  onCancel: () => void;
}

/**
 * One picker for every "choose a thing" moment: plan, version, agent, model,
 * the multi-select `planx clean` uses, and the yes/no confirmations. Filtering
 * is a fuzzy subsequence match, so `gcr` finds guard-clock-regression.
 *
 * It wears the same frame the review does. Bare `planx` used to show two
 * unrelated visual languages before you reached the plan — a list of plain rows,
 * then a bordered document — which made the picker look like something else's
 * output that happened to appear first.
 */
export function Picker<T>({
  title,
  subtitle,
  items,
  multi,
  footer,
  version,
  onDone,
  onCancel,
}: PickerProps<T>) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const [marked, setMarked] = useState<ReadonlySet<number>>(() => new Set());

  const filtered = useMemo(
    () =>
      fuzzyFilter(query, items, (item) => `${item.label} ${item.searchable ?? ''}`).map(
        (m) => m.item,
      ),
    [query, items],
  );

  // The frame costs four rows of chrome above the list and three below it.
  const height = Math.max(3, Math.min(filtered.length, (stdout?.rows ?? 24) - 9));
  const start = Math.max(0, Math.min(cursor - Math.floor(height / 2), filtered.length - height));
  const visible = filtered.slice(start, start + height);

  useInput((input, key) => {
    if (key.escape || (key.ctrl && input === 'c')) {
      onCancel();
      exit();
      return;
    }
    if (key.downArrow || (key.ctrl && input === 'n')) {
      return setCursor((c) => Math.min(filtered.length - 1, c + 1));
    }
    if (key.upArrow || (key.ctrl && input === 'p')) {
      return setCursor((c) => Math.max(0, c - 1));
    }
    if (key.return) {
      if (multi) {
        const chosen = [...marked].sort((a, b) => a - b).map((i) => items[i]!.value);
        return onDone(chosen.length ? chosen : filtered[cursor] ? [filtered[cursor]!.value] : []);
      }
      const picked = filtered[cursor];
      return onDone(picked ? [picked.value] : []);
    }
    if (multi && input === ' ') {
      const item = filtered[cursor];
      if (!item) return;
      const index = items.indexOf(item);
      return setMarked((set) => {
        const next = new Set(set);
        if (next.has(index)) next.delete(index);
        else next.add(index);
        return next;
      });
    }
    if (multi && input === 'x') {
      return setMarked(new Set(filtered.map((item) => items.indexOf(item))));
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
  const count = `${filtered.length}/${items.length}`;
  const lead = query ? `filter: ${query}${inverse(' ')}` : dim(subtitle ?? '');
  const subtitleRow = `  ${padEnd(lead, inner - 2 - count.length)}${dim(count)}`;

  const rows = [
    `  ${bold(title)}`,
    subtitleRow,
    '',
    ...visible.map((item) => {
      const index = filtered.indexOf(item);
      const active = index === cursor;
      const isMarked = marked.has(items.indexOf(item));
      const mark = multi ? (isMarked ? '◉ ' : '◯ ') : active ? '❯ ' : '  ';
      const label = padEnd(truncate(item.label, labelWidth), labelWidth);
      const hint = item.hint ? dim(`  ${truncate(item.hint, inner - labelWidth - 6)}`) : '';
      const line = `${mark}${label}${hint}`;
      // Inverse video has to own the whole row: a dim hint inside an inverse
      // run closes its own style and leaves the rest painted normally, which
      // reads as a highlight that stops half way.
      return `  ${active ? inverse(signal(padEnd(stripAnsi(line), inner - 2))) : line}`;
    }),
    ...(filtered.length ? [] : [dim('  no matches')]),
    '',
    dim(
      `  ${
        footer ??
        (multi
          ? '↑↓ choose · space mark · x mark all · enter confirm · esc cancel'
          : '↑↓ choose · enter open · esc cancel')
      }`,
    ),
  ];

  return (
    <Box flexDirection="column">
      <Text>{topRule(frameWidth, brandTitle(version))}</Text>
      <Text>{frameLine('', inner)}</Text>
      {rows.map((line, i) => (
        <Text key={i}>{frameLine(line, inner)}</Text>
      ))}
      <Text>{bottomRule(frameWidth, ` ★ ${REPO} `)}</Text>
    </Box>
  );
}
