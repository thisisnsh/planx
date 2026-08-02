import { Box, Text, useApp, useInput, useStdout } from 'ink';
import { useMemo, useState } from 'react';
import { truncate } from '../render/ansi.js';
import { fuzzyFilter } from './fuzzy.js';

export interface PickerItem<T> {
  value: T;
  label: string;
  hint?: string;
  /** Extra text that should match when typing, but is not displayed. */
  searchable?: string;
}

export interface PickerProps<T> {
  title: string;
  items: Array<PickerItem<T>>;
  multi?: boolean;
  footer?: string;
  onDone: (chosen: T[]) => void;
  onCancel: () => void;
}

/**
 * One picker for every "choose a thing" moment: plan, version, agent, model,
 * and the multi-select `planx clean` uses. Filtering is a fuzzy subsequence
 * match, so `gcr` finds guard-clock-regression.
 */
export function Picker<T>({ title, items, multi, footer, onDone, onCancel }: PickerProps<T>) {
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

  const height = Math.max(3, Math.min(filtered.length, (stdout?.rows ?? 24) - 6));
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

  const width = (stdout?.columns ?? 80) - 4;

  return (
    <Box flexDirection="column">
      <Text bold color="cyan">
        {title}
      </Text>
      <Box>
        <Text>{'❯ '}</Text>
        <Text>{query}</Text>
        <Text inverse> </Text>
        <Text dimColor>{`  ${filtered.length}/${items.length}`}</Text>
      </Box>
      {visible.map((item) => {
        const index = filtered.indexOf(item);
        const active = index === cursor;
        const isMarked = marked.has(items.indexOf(item));
        return (
          <Text key={item.label + index} inverse={active}>
            {multi ? (isMarked ? '◉ ' : '◯ ') : active ? '❯ ' : '  '}
            {truncate(item.label, Math.floor(width * 0.6))}
            {item.hint ? (
              <Text dimColor>{`  ${truncate(item.hint, Math.floor(width * 0.35))}`}</Text>
            ) : null}
          </Text>
        );
      })}
      {filtered.length === 0 ? <Text dimColor>no matches</Text> : null}
      <Text dimColor>
        {footer ??
          (multi
            ? 'space mark · x mark all · enter confirm · esc cancel'
            : 'enter select · esc cancel')}
      </Text>
    </Box>
  );
}
