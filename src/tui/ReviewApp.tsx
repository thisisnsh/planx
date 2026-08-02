import { Box, Text, useApp, useInput, useStdout } from 'ink';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { contextSha } from '../locks/anchor.js';
import { buildAnnotation } from '../protocol/submit.js';
import { bold, dim, inverse, padEnd, signal, stripAnsi, truncate } from '../render/ansi.js';
import type { RenderMode } from '../render/diff.js';
import type { Annotation, Feedback } from '../store/types.js';
import { lockLines, unlockLines } from './locking.js';
import { buildModel, type ViewRow } from './model.js';
import {
  initialSelection,
  isRowSelected,
  reduceSelection,
  scrollFor,
  spanAtCursor,
  type LineSpan,
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

/** Top rule, the gap under it, the status and hint lines, the bottom rule. */
const CHROME_HEIGHT = 6;
const MIN_BODY = 5;
const MIN_WIDTH = 48;
/** `│ ` on the left and ` │` on the right of every row. */
const FRAME_PADDING = 4;
/** The cursor arrow and the space after it. */
const CURSOR_GUTTER = 2;
/** `│ ` and ` │` of a note box. */
const BOX_PADDING = 4;
const REPO = 'github.com/thisisnsh/planx';

export function ReviewApp(props: ReviewAppProps) {
  const { exit } = useApp();
  const { stdout } = useStdout();

  const [selection, setSelection] = useState<SelectionState>(initialSelection);
  const [offset, setOffset] = useState(0);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [expandedGaps, setExpandedGaps] = useState<ReadonlySet<number>>(() => new Set());
  const [collapsedFeedback, setCollapsedFeedback] = useState<ReadonlySet<string>>(() => new Set());
  const [hiddenFeedback, setHiddenFeedback] = useState(false);
  // Locks are written the moment they are made, so the model has to be told to
  // read them back. Nothing else in this component changes what is on disk.
  const [lockRevision, setLockRevision] = useState(0);
  const [mode, setMode] = useState<Mode>({ kind: 'browse' });
  const [general, setGeneral] = useState('');
  const [status, setStatus] = useState<string | null>(null);

  const frameWidth = Math.max(MIN_WIDTH, (stdout?.columns ?? 100) - 1);
  /** Columns between the two frame edges. */
  const inner = frameWidth - FRAME_PADDING;
  /** What is left for the line gutter and the plan text. */
  const contentWidth = inner - CURSOR_GUTTER;

  const draftId = mode.kind === 'editing' ? mode.annotationId : null;
  const draftText = mode.kind === 'editing' ? mode.draft : '';

  const model = useMemo(
    () =>
      buildModel({
        planId: props.planId,
        versionA: props.versionA,
        versionB: props.versionB,
        mode: props.mode,
        width: contentWidth,
        expandedGaps,
        annotations,
        hiddenFeedback,
        collapsedFeedback,
        // Feeding the half-typed note through the model is what makes the box
        // grow line by line as it is written, instead of the text vanishing off
        // the right edge of a box sized for what was there before.
        draft: draftId === null ? null : { annotationId: draftId, text: draftText },
      }),
    [
      props.planId,
      props.versionA,
      props.versionB,
      props.mode,
      contentWidth,
      expandedGaps,
      annotations,
      hiddenFeedback,
      collapsedFeedback,
      draftId,
      draftText,
      lockRevision,
    ],
  );

  const rows = model.rows;
  const textWidth = contentWidth - model.gutterWidth;
  const bodyHeight = Math.max(MIN_BODY, (stdout?.rows ?? 24) - CHROME_HEIGHT);
  const hasFeedback = annotations.length > 0 || general.trim().length > 0;

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

  /** Does a lock cover any line of this span? */
  function isLocked(span: LineSpan): boolean {
    for (let line = span.start; line <= span.end; line++) {
      if (model.lockedLines.has(line)) return true;
    }
    return false;
  }

  function startFeedback() {
    // One note per passage. Landing on lines that already carry one edits it,
    // rather than stacking a second note on the same text.
    const existing = annotationAtCursor();
    if (existing) {
      setCollapsedFeedback((set) => without(set, existing.id));
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
    // A locked passage is settled. Commenting on it would ask for a change to
    // text that cannot change, so the answer is to unlock it first.
    if (isLocked(span)) {
      return setStatus('those lines are locked — press l to unlock them before commenting');
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
   *
   * Both halves write to the lock file straight away — see ./locking.ts.
   */
  function toggleLock() {
    const span = spanAtCursor(rows, selection);
    if (!span) return setStatus('nothing to lock there');

    let allLocked = true;
    for (let line = span.start; line <= span.end; line++) {
      if (!model.lockedLines.has(line)) allLocked = false;
    }

    if (allLocked) {
      const removed = unlockLines(props.planId, model.docLines, span);
      setStatus(
        removed.length
          ? `unlocked lines ${span.start}–${span.end}`
          : `nothing was locking lines ${span.start}–${span.end}`,
      );
    } else {
      const id = lockLines(props.planId, model.docLines, props.versionB, span);
      setStatus(`locked lines ${span.start}–${span.end} as ${id}`);
    }

    setLockRevision((n) => n + 1);
    setSelection((s) => reduceSelection(s, { type: 'clear' }, rows.length));
  }

  /** Space folds what is under the cursor: a note into its title, a gap open. */
  function toggleFold() {
    const row = rows[selection.cursor];
    if (row?.kind === 'feedback') {
      const id = row.annotationId;
      return setCollapsedFeedback((set) => (set.has(id) ? without(set, id) : withId(set, id)));
    }
    // A gap only expands: once it has, the row that stood for it is gone, and
    // there is nothing left under the cursor to press space on.
    const gap = row?.gapIndex;
    if (gap === null || gap === undefined) return;
    setExpandedGaps((set) => new Set(set).add(gap));
  }

  function deleteAtCursor() {
    const hit = annotationAtCursor();
    if (!hit) return setStatus('nothing to delete here');
    setAnnotations((current) => current.filter((a) => a.id !== hit.id));
    setStatus(`removed ${hit.id}`);
  }

  function finish(action: ReviewResult['action']) {
    if (action === 'submit' && !hasFeedback) {
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
      if (input === ' ') return toggleFold();

      if (input === 'f') return startFeedback();
      if (input === 'l') return toggleLock();
      if (input === 'd') return deleteAtCursor();
      if (input === 'h') return setHiddenFeedback((on) => !on);
      if (input === 'n') return setMode({ kind: 'note', draft: general });
      if (input === 's') return finish('submit');
      if (input === 'a') {
        // Approving is for a plan you have nothing to say about. With feedback
        // pending it would seal the very lines the notes are asking to change.
        if (hasFeedback) return setStatus('you have feedback pending — press s to submit it');
        return setMode({ kind: 'confirm' });
      }
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

  // Help replaces the document rather than sitting on top of it, so a long key
  // list can never push the frame past the bottom of the terminal.
  const body =
    mode.kind === 'help'
      ? helpLines(inner)
      : rows.slice(offset, offset + bodyHeight).map((row, i) =>
          renderRow(row, {
            cursor: offset + i === selection.cursor,
            selected: isRowSelected(selection, offset + i),
            editing: row.kind === 'feedback' && row.annotationId === draftId,
            width: textWidth,
          }),
        );

  const message =
    mode.kind === 'confirm'
      ? bold(
          signal(`Approve v${props.versionB}? This seals the plan — every section becomes locked.`),
        )
      : statusLine(status, general, props.previous.length, inner);

  return (
    <Box flexDirection="column">
      <Text>{topRule(frameWidth, headerText(props, model.locks.sealed_at !== null))}</Text>
      {body.map((line, i) => (
        <Text key={i}>{frameLine(line, inner)}</Text>
      ))}
      <Text>{frameLine('', inner)}</Text>
      <Text>{frameLine(message, inner)}</Text>
      <Text>
        {frameLine(
          dim(
            hintsFor(
              mode,
              rows[selection.cursor],
              hasFeedback,
              isCursorLocked(model, rows, selection),
            ),
          ),
          inner,
        )}
      </Text>
      <Text>{bottomRule(frameWidth, ` ★ ${REPO} `)}</Text>
    </Box>
  );
}

/* ----------------------------------------------------------------- frame */

/**
 * The frame carries the chrome on its own edges.
 *
 * A title bar drawn *inside* a border is two horizontal rules stacked with a
 * line of text between them, spending three rows to say what one edge can. The
 * frame is drawn by hand rather than by Ink's border because Ink has no way to
 * put anything on it.
 */
function topRule(width: number, title: string): string {
  const fill = Math.max(0, width - 3 - visible(title));
  return `${signal('╭─')}${title}${signal(`${'─'.repeat(fill)}╮`)}`;
}

function bottomRule(width: number, footer: string): string {
  const fill = Math.max(0, width - 3 - footer.length);
  return `${signal(`╰${'─'.repeat(fill)}`)}${dim(footer)}${signal('─╯')}`;
}

function frameLine(content: string, inner: number): string {
  return `${signal('│')} ${padEnd(truncate(content, inner), inner)} ${signal('│')}`;
}

function headerText(props: ReviewAppProps, sealed: boolean): string {
  const versions = `v${props.versionB}${props.versionA === null ? '' : ` ← v${props.versionA}`}`;
  return ` ${bold(signal('planx'))}${dim(` v${props.version}`)}  ${props.planId}  ${dim(versions)}${
    sealed ? `  ${bold(signal('sealed'))}` : ''
  } `;
}

function visible(text: string): number {
  return stripAnsi(text).length;
}

/* ------------------------------------------------------------------ rows */

interface RowOptions {
  cursor: boolean;
  selected: boolean;
  editing: boolean;
  /** Columns available to the row's text, after its gutter. */
  width: number;
}

/**
 * One drawn line, with the cursor arrow in a gutter of its own.
 *
 * The arrow lives here rather than in the row text so moving it costs a
 * re-render of the visible slice, not a rebuild of the whole document. The line
 * number lights up with it: an arrow alone in the margin is easy to lose in a
 * wall of dim numbers.
 */
function renderRow(row: ViewRow, opts: RowOptions): string {
  const arrow = opts.cursor ? signal('▸') : ' ';

  if (row.kind === 'feedback') {
    if (row.part !== 'body') return `${arrow} ${row.gutter}${signal(row.text)}`;

    const box = row.boxWidth - BOX_PADDING;
    const caret = opts.editing && row.last;
    const text = truncate(row.text, caret ? box - 1 : box);
    const filled = padEnd(caret ? `${text}${inverse(' ')}` : text, box);
    return `${arrow} ${row.gutter}${signal('│')} ${filled} ${signal('│')}`;
  }

  const gutter = opts.cursor ? row.gutterActive : row.gutter;
  const text = truncate(opts.selected ? inverse(stripAnsi(row.text)) : row.text, opts.width);
  return `${arrow} ${gutter}${text}`;
}

/* --------------------------------------------------------------- chrome */

/**
 * One line for everything transient, in the order it matters.
 *
 * Stacking status, note and history on separate rows made the frame breathe in
 * and out as they came and went, which moves the document under the cursor.
 */
function statusLine(
  status: string | null,
  general: string,
  previous: number,
  width: number,
): string {
  if (status) return signal(truncate(status, width));
  if (general.trim()) return dim(`note: ${truncate(general, width - 8)}`);
  if (previous) {
    return dim(`${previous} earlier note${previous === 1 ? '' : 's'} already left on this version`);
  }
  return '';
}

/**
 * The hints offer what this row can actually do.
 *
 * Feedback and approval are both conditional: you cannot comment on a locked
 * passage, and approving a plan you have notes on would seal the lines the
 * notes are about. Showing keys that refuse to work teaches the wrong thing.
 */
function hintsFor(
  mode: Mode,
  row: ViewRow | undefined,
  hasFeedback: boolean,
  locked: boolean,
): string {
  if (mode.kind === 'editing') return 'type your note · enter to save · esc to discard';
  if (mode.kind === 'note') {
    return 'a note about the whole plan · enter to save · esc to cancel · press f instead to comment on selected lines';
  }
  if (mode.kind === 'confirm') return 'enter to approve and seal · esc to cancel';
  if (mode.kind === 'help') return 'any key to close';

  const verdict = hasFeedback ? 's submit' : 'a approve';
  if (row?.kind === 'feedback') {
    return `space fold · f edit · d delete · n note · ${verdict} · x exit · ? help`;
  }
  if (row?.gapIndex !== null && row?.gapIndex !== undefined) {
    return `space expand · v select · n note · ${verdict} · x exit · ? help`;
  }
  const comment = locked ? 'l unlock' : 'f feedback · l lock';
  return `v select · ${comment} · n note · ${verdict} · x exit · ? help`;
}

function isCursorLocked(
  model: { lockedLines: ReadonlyMap<number, string> },
  rows: readonly ViewRow[],
  selection: SelectionState,
): boolean {
  const span = spanAtCursor(rows, selection);
  if (!span) return false;
  for (let line = span.start; line <= span.end; line++) {
    if (model.lockedLines.has(line)) return true;
  }
  return false;
}

const HELP: Array<[string, string]> = [
  ['↑ ↓', 'move'],
  ['v', 'start or end a selection, then ↑ ↓ to extend'],
  ['f', 'feedback on the selection, or edit the note under the cursor'],
  ['l', 'lock or unlock the selection — applied immediately'],
  ['d', 'delete the note under the cursor'],
  ['space', 'fold the note, or expand the collapsed run, under the cursor'],
  ['h', 'fold or unfold every note at once'],
  ['n', 'a note about the whole plan'],
  ['s', 'submit everything at once'],
  ['a', 'approve — seals the plan, and only when you have no feedback'],
  ['x', 'leave without submitting'],
];

function helpLines(width: number): string[] {
  return [
    bold(signal('planx review')),
    '',
    ...HELP.map(([keys, what]) => `${signal(padEnd(keys, 8))}${dim(truncate(what, width - 8))}`),
  ];
}

/* ------------------------------------------------------------------ sets */

function withId(set: ReadonlySet<string>, id: string): ReadonlySet<string> {
  return new Set(set).add(id);
}

function without(set: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const next = new Set(set);
  next.delete(id);
  return next;
}
