import { Box, Text, useApp, useInput, useStdout } from 'ink';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { contextSha } from '../locks/anchor.js';
import { buildAnnotation } from '../protocol/submit.js';
import { stripAnsi, truncate } from '../render/ansi.js';
import type { RenderMode } from '../render/diff.js';
import type { Annotation, Feedback } from '../store/types.js';
import { buildModel, type ViewRow } from './model.js';
import {
  initialSelection,
  isRowSelected,
  reduceSelection,
  scrollFor,
  spanAtCursor,
  type SelectionState,
} from './selection.js';

export interface ReviewResult {
  action: 'submit' | 'approve' | 'reject' | 'quit';
  annotations: Annotation[];
  general: string;
}

export interface ReviewAppProps {
  planId: string;
  title: string;
  versionA: number | null;
  versionB: number;
  mode: RenderMode;
  /** planx's own version, for the frame. */
  version: string;
  /** Feedback already left on this version, shown so you do not repeat yourself. */
  previous: Feedback[];
  onDone: (result: ReviewResult) => void;
}

/**
 * What the keyboard is doing right now.
 *
 * Writing a note and driving the document want the same keys — `s` is submit in
 * one and the letter s in the other — so the mode is explicit rather than
 * inferred from whether some overlay happens to be open. Editing happens in the
 * document, not in a dialog on top of it, which is the whole point of putting
 * notes inline.
 */
type Mode =
  | { kind: 'browse' }
  | { kind: 'editing'; annotationId: string; draft: string; isNew: boolean }
  | { kind: 'note'; draft: string }
  | { kind: 'confirm' }
  | { kind: 'help' };

/** Frame, header, footer and the repo line. */
const CHROME_HEIGHT = 9;
const MIN_BODY = 5;
const REPO = 'github.com/thisisnsh/planx';

export function ReviewApp(props: ReviewAppProps) {
  const { exit } = useApp();
  const { stdout } = useStdout();

  const [selection, setSelection] = useState<SelectionState>(initialSelection);
  const [offset, setOffset] = useState(0);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [expandedGaps, setExpandedGaps] = useState<ReadonlySet<number>>(() => new Set());
  const [hiddenFeedback, setHiddenFeedback] = useState(false);
  const [mode, setMode] = useState<Mode>({ kind: 'browse' });
  const [general, setGeneral] = useState('');
  const [status, setStatus] = useState<string | null>(null);

  const model = useMemo(
    () =>
      buildModel({
        planId: props.planId,
        versionA: props.versionA,
        versionB: props.versionB,
        mode: props.mode,
        expandedGaps,
        annotations,
        hiddenFeedback,
      }),
    [
      props.planId,
      props.versionA,
      props.versionB,
      props.mode,
      expandedGaps,
      annotations,
      hiddenFeedback,
    ],
  );

  const rows = model.rows;
  const width = stdout?.columns ?? 100;
  const bodyHeight = Math.max(MIN_BODY, (stdout?.rows ?? 24) - CHROME_HEIGHT);

  const move = useCallback(
    (delta: number) => {
      setSelection((s) => {
        const next = reduceSelection(s, { type: 'move', delta }, rows.length);
        setOffset((o) => scrollFor(next.cursor, o, bodyHeight, rows.length));
        return next;
      });
    },
    [bodyHeight, rows.length],
  );

  /* ------------------------------------------------------------- actions */

  /** The comment covering wherever the cursor is, whether that is a document
   *  line or the note itself. */
  function annotationAtCursor(): Annotation | null {
    const row = rows[selection.cursor];
    if (row?.kind === 'feedback') {
      return annotations.find((a) => a.id === row.annotationId) ?? null;
    }
    const span = spanAtCursor(rows, selection);
    if (!span) return null;
    return (
      annotations.find(
        (a) =>
          a.kind === 'comment' &&
          a.anchor.start_line <= span.end &&
          a.anchor.end_line >= span.start,
      ) ?? null
    );
  }

  function startFeedback() {
    // One note per passage. Landing on lines that already carry one edits it,
    // rather than stacking a second note on the same text.
    const existing = annotationAtCursor();
    if (existing) {
      setHiddenFeedback(false);
      return setMode({
        kind: 'editing',
        annotationId: existing.id,
        draft: existing.comment,
        isNew: false,
      });
    }

    const span = spanAtCursor(rows, selection);
    if (!span) {
      return setStatus('nothing to annotate there — that row is a deletion or a collapsed gap');
    }

    const id = `a${annotations.filter((a) => a.kind === 'comment').length + 1}`;
    setAnnotations((current) => [
      ...current,
      buildAnnotation(
        model.docLines,
        'comment',
        span.start,
        span.end,
        '',
        id,
        contextSha(model.docLines, { start: span.start - 1, end: span.end - 1 }),
      ),
    ]);
    setHiddenFeedback(false);
    setSelection((s) => reduceSelection(s, { type: 'clear' }, rows.length));
    setMode({ kind: 'editing', annotationId: id, draft: '', isNew: true });
  }

  function commitFeedback(annotationId: string, draft: string) {
    const text = draft.trim();
    if (!text) {
      // An empty note is nothing. Drop it rather than leaving an empty box
      // bordered onto the document.
      setAnnotations((current) => current.filter((a) => a.id !== annotationId));
    } else {
      setAnnotations((current) =>
        current.map((a) => (a.id === annotationId ? { ...a, comment: text } : a)),
      );
    }
    setMode({ kind: 'browse' });
  }

  /**
   * `l` is a toggle, so a selection that is already locked comes back off.
   * A partly locked selection locks the rest: the intent of pressing lock on
   * something half locked is to end up with it locked.
   */
  function toggleLock() {
    const span = spanAtCursor(rows, selection);
    if (!span) return setStatus('nothing to lock there');

    let allLocked = true;
    for (let line = span.start; line <= span.end; line++) {
      if (!model.lockedLines.has(line)) allLocked = false;
    }
    const kind = allLocked ? 'unlock' : 'lock';
    const id = `${kind === 'lock' ? 'L' : 'u'}${annotations.filter((a) => a.kind === kind).length + 1}`;

    setAnnotations((current) => [
      ...current,
      buildAnnotation(
        model.docLines,
        kind,
        span.start,
        span.end,
        '',
        id,
        contextSha(model.docLines, { start: span.start - 1, end: span.end - 1 }),
      ),
    ]);
    setStatus(`${kind}ed lines ${span.start}–${span.end} (applies on submit)`);
    setSelection((s) => reduceSelection(s, { type: 'clear' }, rows.length));
  }

  function deleteAtCursor() {
    const hit = annotationAtCursor();
    if (!hit) return setStatus('nothing to delete here');
    setAnnotations((current) => current.filter((a) => a.id !== hit.id));
    setStatus(`removed ${hit.id}`);
  }

  function finish(action: ReviewResult['action']) {
    if (action === 'submit' && annotations.length === 0 && !general.trim()) {
      return setStatus('nothing to submit — press f to leave feedback, or x to leave');
    }
    props.onDone({ action, annotations, general });
  }

  /* ---------------------------------------------------------- keyboard */

  useInput(
    (input, key) => {
      setStatus(null);

      if (key.downArrow) return move(1);
      if (key.upArrow) return move(-1);
      if (key.pageDown) return move(Math.floor(bodyHeight / 2));
      if (key.pageUp) return move(-Math.floor(bodyHeight / 2));

      if (key.escape) {
        return setSelection((s) => reduceSelection(s, { type: 'clear' }, rows.length));
      }
      if (input === 'v') {
        return setSelection((s) => reduceSelection(s, { type: 'toggleVisual' }, rows.length));
      }
      if (input === ' ') {
        const gap = rows[selection.cursor]?.gapIndex;
        if (gap === null || gap === undefined) return;
        return setExpandedGaps((set) => new Set(set).add(gap));
      }

      if (input === 'f') return startFeedback();
      if (input === 'l') return toggleLock();
      if (input === 'd') return deleteAtCursor();
      if (input === 'h') return setHiddenFeedback((on) => !on);
      if (input === 'n') return setMode({ kind: 'note', draft: general });
      if (input === 's') return finish('submit');
      if (input === 'a') return setMode({ kind: 'confirm' });
      if (input === '?') return setMode({ kind: 'help' });
      if (input === 'x' || input === 'q') return finish('quit');
    },
    { isActive: mode.kind === 'browse' },
  );

  // Editing swallows everything printable, which is the point: `s` has to be
  // the letter s while a note is being written.
  useInput(
    (input, key) => {
      if (mode.kind !== 'editing' && mode.kind !== 'note') return;

      if (key.escape) {
        if (mode.kind === 'note') setMode({ kind: 'browse' });
        // Discarding a brand new note removes it; discarding an edit to an
        // existing one leaves the original text alone.
        else if (mode.isNew) commitFeedback(mode.annotationId, '');
        else setMode({ kind: 'browse' });
        return;
      }
      if (key.return) {
        if (mode.kind === 'editing') commitFeedback(mode.annotationId, mode.draft);
        else {
          setGeneral(mode.draft.trim());
          setMode({ kind: 'browse' });
        }
        return;
      }
      if (key.backspace || key.delete) {
        return setMode({ ...mode, draft: mode.draft.slice(0, -1) });
      }
      // Ignore the control keys Ink reports as empty input. A pasted chunk
      // arrives whole rather than one keystroke at a time.
      if (input && !key.ctrl && !key.meta) {
        return setMode({ ...mode, draft: mode.draft + input.replace(/[\r\n]+/g, ' ') });
      }
    },
    { isActive: mode.kind === 'editing' || mode.kind === 'note' },
  );

  useInput(
    (input, key) => {
      if (mode.kind === 'help') return setMode({ kind: 'browse' });
      if (mode.kind === 'confirm') {
        if (key.return) return finish('approve');
        if (key.escape || input === 'n') setMode({ kind: 'browse' });
      }
    },
    { isActive: mode.kind === 'help' || mode.kind === 'confirm' },
  );

  useEffect(() => () => exit(), [exit]);

  /* ------------------------------------------------------------ render */

  const visible = rows.slice(offset, offset + bodyHeight);
  const editingId = mode.kind === 'editing' ? mode.annotationId : null;

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
      <Box>
        <Text bold color="cyan">
          planx
        </Text>
        <Text dimColor>{` v${props.version}   `}</Text>
        <Text>{props.planId}</Text>
        <Text dimColor>{'   '}</Text>
        <Text>
          v{props.versionB}
          {props.versionA === null ? '' : ` ← v${props.versionA}`}
        </Text>
        {model.locks.sealed_at ? <Text color="green">{'   sealed'}</Text> : null}
      </Box>

      <Box flexDirection="column" marginTop={1}>
        {visible.map((row, i) => (
          <RowLine
            key={offset + i}
            row={row}
            width={width}
            cursor={offset + i === selection.cursor}
            selected={isRowSelected(selection, offset + i)}
            editing={row.kind === 'feedback' && row.annotationId === editingId}
            draft={mode.kind === 'editing' ? mode.draft : ''}
          />
        ))}
      </Box>

      {mode.kind === 'confirm' ? (
        <Box borderStyle="round" borderColor="green" paddingX={1} flexDirection="column">
          <Text bold>{`Approve v${props.versionB}?`}</Text>
          <Text dimColor>
            {'This seals the plan — every section becomes locked. enter to approve · esc to cancel'}
          </Text>
        </Box>
      ) : null}

      {mode.kind === 'help' ? <HelpOverlay /> : null}

      <Box flexDirection="column" marginTop={1}>
        {status ? <Text color="yellow">{status}</Text> : null}
        {general.trim() ? <Text dimColor>{`note: ${truncate(general, 70)}`}</Text> : null}
        {props.previous.length ? (
          <Text dimColor>
            {`${props.previous.length} earlier note${props.previous.length === 1 ? '' : 's'} already left on this version`}
          </Text>
        ) : null}
        <Text dimColor>{footerFor(mode)}</Text>
      </Box>

      <Box justifyContent="flex-end">
        <Text dimColor>{`★ ${REPO} · bugs and ideas welcome in issues`}</Text>
      </Box>
    </Box>
  );
}

function footerFor(mode: Mode): string {
  if (mode.kind === 'editing') return 'type your note · enter to save · esc to discard';
  if (mode.kind === 'note') {
    return 'a note about the whole plan · enter to save · esc to cancel · press f instead to comment on selected lines';
  }
  // Short enough not to wrap on a narrow terminal; `?` has the full list.
  return 'v select · f feedback · l lock · s submit · a approve · x exit · ? help';
}

interface RowLineProps {
  row: ViewRow;
  width: number;
  cursor: boolean;
  selected: boolean;
  editing: boolean;
  draft: string;
}

/**
 * One drawn line, with the cursor arrow in a gutter of its own.
 *
 * The arrow lives here rather than in the row text so moving it costs a
 * re-render of the visible slice, not a rebuild of the whole document.
 */
function RowLine({ row, width, cursor, selected, editing, draft }: RowLineProps) {
  const arrow = cursor ? '▸' : ' ';

  if (row.kind === 'feedback') {
    if (row.part !== 'body') {
      return (
        <Text>
          <Text color="cyan">{`${arrow} `}</Text>
          <Text color="blue">{row.text}</Text>
        </Text>
      );
    }
    return (
      <Text>
        <Text color="cyan">{`${arrow} `}</Text>
        <Text color="blue">{'┆ '}</Text>
        <Text>{truncate(editing ? draft : row.text, width - 8)}</Text>
        {editing ? <Text inverse> </Text> : null}
      </Text>
    );
  }

  const text = truncate(selected ? stripAnsi(row.text) : row.text, width - 6);
  return (
    <Text>
      <Text color="cyan">{`${arrow} `}</Text>
      <Text inverse={selected}>{text}</Text>
    </Text>
  );
}

function HelpOverlay() {
  const rows: Array<[string, string]> = [
    ['↑ ↓', 'move'],
    ['v', 'start or end a selection, then ↑ ↓ to extend'],
    ['f', 'feedback on the selection, or edit the note under the cursor'],
    ['l', 'lock or unlock the selection'],
    ['d', 'delete the note under the cursor'],
    ['h', 'hide or show the note bodies'],
    ['space', 'expand the collapsed run under the cursor'],
    ['n', 'a note about the whole plan'],
    ['s', 'submit everything at once'],
    ['a', 'approve — seals the plan'],
    ['x', 'leave without submitting'],
  ];
  return (
    <Box borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column">
      <Text bold color="cyan">
        planx review
      </Text>
      {rows.map(([keys, what]) => (
        <Text key={keys}>
          <Text color="yellow">{keys.padEnd(8)}</Text>
          <Text dimColor>{what}</Text>
        </Text>
      ))}
      <Text dimColor>any key to close</Text>
    </Box>
  );
}
