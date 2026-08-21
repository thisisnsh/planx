import { Box, Text, useApp, useInput, useStdout } from 'ink';
import { useEffect, useState } from 'react';
import {
  bold,
  caretLine,
  dim,
  gray,
  green,
  padEnd,
  red,
  signal,
  truncate,
} from '../render/ansi.js';
import { customLaunchLine, promptFor } from '../exec/launch.js';
import { DEFAULT_FIELDS, type DefaultKey } from '../store/defaults.js';
import type { Defaults as DefaultValues } from '../store/types.js';
import { EXIT_PROMPT, useDoubleCtrlC } from './exit.js';
import { bottomRule, brandTitle, frameLine, FRAME_PADDING, REPO_FOOTER, topRule } from './frame.js';
import { HIDE_HINTS, hintFooter, hintLines, isHintToggle, typable, type Hint } from './hints.js';

/** Matches the review's floor and the picker's, so every frame narrows alike. */
const MIN_WIDTH = 48;
/** Columns between the widest label and the value column. */
const LABEL_GAP = 4;
/** The cursor arrow and the space after it, as everywhere else planx draws. */
const CURSOR_GUTTER = 2;

/** What an unset field says, in the column where a command would be. */
const NOT_SET = '(not set)';

export interface DefaultsProps {
  /** The block as it stands. Every commit replaces one key of it. */
  values: DefaultValues;
  /** planx's own version, for the frame. */
  version?: string;
  /**
   * Write one field. The screen owns no store: it says which key changed and
   * to what, and the CLI does the write — which keeps every write to the store
   * on the side of the seam that already owns them.
   */
  onSave: (key: DefaultKey, value: string | null) => void;
  /** What a second ctrl+c does. Defaults to ending the process with 130. */
  onQuit?: () => void;
  /**
   * Whether the hint rows are drawn. The store holds the last answer; the
   * screen owns the live state and reports every change.
   */
  hints?: boolean;
  onHintsChange?: (shown: boolean) => void;
  onDone: () => void;
}

/** Typing into the highlighted field, or walking between them. */
type Mode = { kind: 'browse' } | { kind: 'editing'; draft: string; caret: number };

/**
 * The commands you brought yourself, and what planx appends to them.
 *
 * One row per field, with the highlighted one previewed underneath as the line
 * it would actually run — built by the same two functions the hand-off list
 * uses, so the `$planx` a Codex command earns here is the `$planx` it gets
 * there, and a value typed into either place reads back the same.
 *
 * Every commit writes immediately. There is nothing pending to lose, which is
 * why `esc` leaves without a question — the one screen planx draws where that
 * is true, because it is the one screen with no document behind it.
 */
export function Defaults({
  values,
  version,
  onSave,
  onQuit,
  hints: hintsShown = true,
  onHintsChange,
  onDone,
}: DefaultsProps) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  // Above the handler below, so it fires while a value is being typed too.
  const leaving = useDoubleCtrlC({ onExit: onQuit });

  const [stored, setStored] = useState(values);
  const [index, setIndex] = useState(0);
  const [mode, setMode] = useState<Mode>({ kind: 'browse' });
  /** The green line the last write left, until the next keystroke. */
  const [saved, setSaved] = useState<string | null>(null);
  const [showHints, setShowHints] = useState(hintsShown);

  const field = DEFAULT_FIELDS[index]!;
  const value = stored[field.key];

  function commit(key: DefaultKey, next: string | null, note: string) {
    const trimmed = next === null ? null : next.trim();
    const settled = trimmed ? trimmed : null;
    setStored((current) => ({ ...current, [key]: settled }));
    onSave(key, settled);
    setSaved(note);
  }

  // The hint rows, away and back — above the handler below, so it fires while a
  // value is being typed as well as on the list.
  useInput((input, key) => {
    if (!isHintToggle(input, key)) return;
    const next = !showHints;
    setShowHints(next);
    onHintsChange?.(next);
  });

  useInput((input, key) => {
    if (mode.kind === 'editing') {
      // The stored value comes back. Nothing was written on the way in, so
      // there is nothing to undo — only the draft to drop.
      if (key.escape) return setMode({ kind: 'browse' });
      if (key.return) {
        commit(field.key, mode.draft, mode.draft.trim() ? 'Saved.' : 'Cleared.');
        return setMode({ kind: 'browse' });
      }
      if (key.leftArrow) return setMode({ ...mode, caret: Math.max(0, mode.caret - 1) });
      if (key.rightArrow) {
        return setMode({ ...mode, caret: Math.min(mode.draft.length, mode.caret + 1) });
      }
      if (key.ctrl && input === 'a') return setMode({ ...mode, caret: 0 });
      if (key.ctrl && input === 'e') return setMode({ ...mode, caret: mode.draft.length });

      if (key.backspace || key.delete) {
        if (mode.caret === 0) return;
        return setMode({
          ...mode,
          draft: `${mode.draft.slice(0, mode.caret - 1)}${mode.draft.slice(mode.caret)}`,
          caret: mode.caret - 1,
        });
      }
      if (input && !key.ctrl && !key.meta) {
        // `0x1f` arrives with `key.ctrl` false, so without this the toggle
        // would type itself into the command.
        const text = typable(input.replace(/[\r\n]+/g, ' '));
        if (!text) return;
        return setMode({
          ...mode,
          draft: `${mode.draft.slice(0, mode.caret)}${text}${mode.draft.slice(mode.caret)}`,
          caret: mode.caret + text.length,
        });
      }
      return;
    }

    setSaved(null);
    if (key.upArrow) return setIndex((i) => Math.max(0, i - 1));
    if (key.downArrow) return setIndex((i) => Math.min(DEFAULT_FIELDS.length - 1, i + 1));
    if (key.return) {
      // The caret at the end, because the common edit is adding a flag.
      return setMode({ kind: 'editing', draft: value ?? '', caret: (value ?? '').length });
    }
    // Clearing is its own key rather than opening the value and emptying it:
    // the field is right there under the cursor saying what it holds.
    if (key.backspace || key.delete) {
      if (value === null) return;
      return commit(field.key, null, 'Cleared.');
    }
    if (key.escape) return onDone();
  });

  useEffect(() => () => exit(), [exit]);

  const frameWidth = Math.max(MIN_WIDTH, (stdout?.columns ?? 80) - 1);
  const inner = frameWidth - FRAME_PADDING;
  const labelWidth = Math.max(...DEFAULT_FIELDS.map((f) => f.label.length));
  const room = Math.max(1, inner - CURSOR_GUTTER - labelWidth - LABEL_GAP);

  const hints: Hint[] = [
    ['↑↓', 'choose'],
    ['enter', mode.kind === 'editing' ? 'save' : 'edit'],
    ['esc', mode.kind === 'editing' ? 'discard' : 'done'],
    ...(mode.kind === 'editing' ? [] : ([['⌫', 'clear']] satisfies Hint[])),
    ['ctrl+c', 'exit'],
  ];

  const drawn = [
    `  ${bold(signal('Defaults'))}`,
    `  ${dim('Your own commands, and what PlanX appends to them.')}`,
    '',
    ...DEFAULT_FIELDS.map((entry, i) => {
      const active = i === index;
      // The picker's mark rather than the review's arrow: this is a short list
      // you choose a row from, not a document you point at a line of.
      const label = `${active ? '❯' : ' '} ${padEnd(entry.label, labelWidth)}`;
      const typing = active && mode.kind === 'editing';
      const text = typing
        ? caretLine(mode.draft, mode.caret, room)
        : shown(stored[entry.key], room, active);
      return `${active && !typing ? signal(label) : gray(label)}${' '.repeat(LABEL_GAP)}${text}`;
    }),
    '',
    `  ${dim(truncate(field.summary, inner - 2))}`,
    `  ${saved ? green(saved) : preview(mode.kind === 'editing' ? mode.draft : value, field.sample, inner - 2)}`,
  ];

  return (
    <Box flexDirection="column">
      <Text>{topRule(frameWidth, brandTitle(version))}</Text>
      <Text>{frameLine('', inner)}</Text>
      {drawn.map((line, i) => (
        <Text key={i}>{frameLine(line, inner)}</Text>
      ))}
      <Text>{frameLine('', inner)}</Text>
      {/*
        An armed ctrl+c takes the bar rather than a row of its own, and takes it
        whatever the toggle says: hiding it would make the first ctrl+c look
        like it did nothing. The screen does not scroll, so hiding the rows
        simply makes the frame shorter.
      */}
      {(leaving
        ? [`  ${red(EXIT_PROMPT)}`]
        : showHints
          ? hintLines([...hints, HIDE_HINTS], inner - 2).map((line) => dim(`  ${line}`))
          : []
      ).map((line, i) => (
        <Text key={i}>{frameLine(line, inner)}</Text>
      ))}
      <Text>{bottomRule(frameWidth, REPO_FOOTER, hintFooter(showHints))}</Text>
    </Box>
  );
}

/** A stored value, or what an unset field says where one would be. */
function shown(value: string | null, room: number, active: boolean): string {
  if (value === null) return dim(NOT_SET);
  const text = truncate(value, room);
  return active ? text : gray(text);
}

/**
 * The line the highlighted field would actually run.
 *
 * An unset field previews nothing and says so: there is no command to append
 * to, and a `Runs:` line showing only a prompt would be a lie about what would
 * happen if you picked the row.
 */
function preview(value: string | null, sample: string, width: number): string {
  if (!value?.trim()) return dim('Nothing to run until this is set.');
  const line = customLaunchLine(value, promptFor(value, sample));
  return dim(truncate(`Runs: ${line}`, width));
}
