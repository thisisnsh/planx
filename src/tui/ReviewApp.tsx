import { Box, Text, useApp, useInput, useStdin, useStdout } from 'ink';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { contextSha } from '../locks/anchor.js';
import { buildAnnotation } from '../protocol/submit.js';
import { bold, dim, inverse, padEnd, signal, stripAnsi, truncate } from '../render/ansi.js';
import type { RenderMode } from '../render/diff.js';
import type { Annotation, Feedback } from '../store/types.js';
import {
  bottomRule,
  brandTitle,
  frameLine,
  FRAME_PADDING,
  REPO,
  topRule,
} from './frame.js';
import { lockLines, unlockLines } from './locking.js';
import { BOX_PADDING, buildModel, feedbackRows, type ViewRow } from './model.js';
import {
  initialSelection,
  isRowSelected,
  reduceSelection,
  scrollFor,
  spanAtCursor,
  type LineSpan,
  type SelectionState,
} from './selection.js';

/** One version's worth of pending notes, submitted together. */
export interface FeedbackBatch {
  version: number;
  annotations: Annotation[];
}

export interface ReviewResult {
  action: 'submit' | 'approve' | 'reject' | 'quit';
  /** Notes belong to the version they were written on, so they leave in groups. */
  batches: FeedbackBatch[];
  /** The version on screen when the reviewer finished. */
  version: number;
  general: string;
}

export interface ReviewAppProps {
  planId: string;
  title: string;
  versionA: number | null;
  versionB: number;
  /** Every stored version, ascending — what `[`, `]` and `d` can reach. */
  versions: number[];
  mode: RenderMode;
  /** planx's own version, for the frame. */
  version: string;
  /** Feedback already left on this plan, shown so you do not repeat yourself. */
  previous: Feedback[];
  /** Opt-in wheel scrolling — off unless `planx config set mouse on`. */
  mouse?: boolean;
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

/** Top rule, the gaps above and below the body, the status and hint lines, the
 *  bottom rule. */
const CHROME_HEIGHT = 7;
const MIN_BODY = 5;
const MIN_WIDTH = 48;
/** The cursor arrow and the space after it. */
const CURSOR_GUTTER = 2;

const NO_ANNOTATIONS: Annotation[] = [];

export function ReviewApp(props: ReviewAppProps) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const { stdin } = useStdin();

  const [versionB, setVersionB] = useState(props.versionB);
  const [versionA, setVersionA] = useState<number | null>(props.versionA);
  const [selection, setSelection] = useState<SelectionState>(initialSelection);
  const [offset, setOffset] = useState(0);
  // Keyed by version: a note is about the words it was written beside, and
  // those words are a property of the version you were looking at.
  const [byVersion, setByVersion] = useState<Record<number, Annotation[]>>({});
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
  /** What is left for the rail, the line gutter and the plan text. */
  const contentWidth = inner - CURSOR_GUTTER;

  const annotations = byVersion[versionB] ?? NO_ANNOTATIONS;
  const draftId = mode.kind === 'editing' ? mode.annotationId : null;
  const draftText = mode.kind === 'editing' ? mode.draft : '';

  const model = useMemo(
    () =>
      buildModel({
        planId: props.planId,
        versionA,
        versionB,
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
      versionA,
      versionB,
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
  const hasFeedback =
    Object.values(byVersion).some((list) => list.length > 0) || general.trim().length > 0;

  const previousVersion = useMemo(() => {
    const earlier = props.versions.filter((v) => v < versionB);
    return earlier.length ? Math.max(...earlier) : null;
  }, [props.versions, versionB]);

  const move = useCallback(
    (delta: number) => {
      setSelection((s) => {
        const next = reduceSelection(s, { type: 'move', delta }, rows);
        setOffset((o) => scrollFor(next.cursor, o, bodyHeight, rows.length));
        return next;
      });
    },
    [bodyHeight, rows],
  );

  /**
   * A screenful, or half of one — the viewport moves with the cursor.
   *
   * `move` only scrolls when the cursor would leave the screen, which is right
   * for an arrow key and wrong for a pager: the first ^d from the top of a
   * plan would move the cursor into the middle of an unchanged screen and look
   * like nothing happened.
   */
  const page = useCallback(
    (delta: number) => {
      setSelection((s) => {
        const next = reduceSelection(s, { type: 'move', delta }, rows);
        const travelled = next.cursor - s.cursor;
        setOffset((o) => {
          const shifted = Math.max(0, Math.min(o + travelled, Math.max(0, rows.length - bodyHeight)));
          return scrollFor(next.cursor, shifted, bodyHeight, rows.length);
        });
        return next;
      });
    },
    [bodyHeight, rows],
  );

  const jumpTo = useCallback(
    (index: number) => {
      setSelection((s) => {
        const next = reduceSelection(s, { type: 'moveTo', index }, rows);
        setOffset((o) => scrollFor(next.cursor, o, bodyHeight, rows.length));
        return next;
      });
    },
    [bodyHeight, rows],
  );

  /** Move the viewport without moving the cursor — what the wheel does. */
  const scrollBy = useCallback(
    (delta: number) => {
      setOffset((o) => Math.max(0, Math.min(o + delta, Math.max(0, rows.length - bodyHeight))));
    },
    [bodyHeight, rows.length],
  );

  /* ------------------------------------------------------------- actions */

  /** The comment covering the line, or the selection, under the cursor. */
  function annotationAtCursor(): Annotation | null {
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

  function updateAnnotations(fn: (current: Annotation[]) => Annotation[]) {
    setByVersion((map) => ({ ...map, [versionB]: fn(map[versionB] ?? []) }));
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
    updateAnnotations((current) => [
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
    setSelection((s) => reduceSelection(s, { type: 'clear' }, rows));
    setMode({ kind: 'editing', annotationId: id, draft: '', isNew: true });
  }

  /**
   * Emptying a note is how you delete it.
   *
   * There is no delete key: the cursor cannot reach a note any more, and a
   * second way to destroy something is not worth a letter of the keyboard when
   * `f`, clear, `enter` already does it.
   */
  function commitFeedback(annotationId: string, draft: string) {
    const text = draft.trim();
    if (!text) {
      updateAnnotations((current) => current.filter((a) => a.id !== annotationId));
    } else {
      updateAnnotations((current) =>
        current.map((a) => (a.id === annotationId ? { ...a, comment: text } : a)),
      );
    }
    setMode({ kind: 'browse' });
  }

  /**
   * `l` is a toggle, so a selection that is already locked comes back off.
   * A partly locked selection locks the rest: the intent of pressing lock on
   * something half locked is to end up with it locked. Only the parts that are
   * not locked already get a record — see ../locks/manage.ts.
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
      const result = lockLines(props.planId, model.docLines, versionB, span);
      // Say what happened rather than claiming the whole span: half of it may
      // already have been frozen by an earlier press.
      const parts = result.locked.map((l) => `locked lines ${l.start}–${l.end} as ${l.id}`);
      if (result.skipped.length) {
        const single = result.skipped.length === 1 && result.skipped[0]!.start === result.skipped[0]!.end;
        parts.push(
          `${result.skipped.map(describeSpan).join(', ')} ${single ? 'was' : 'were'} already locked`,
        );
      }
      setStatus(parts.join(' · '));
    }

    setLockRevision((n) => n + 1);
    setSelection((s) => reduceSelection(s, { type: 'clear' }, rows));
  }

  /** Space folds what is under the cursor: a note into its rail, a gap open. */
  function toggleFold() {
    const note = annotationAtCursor();
    if (note) {
      const id = note.id;
      return setCollapsedFeedback((set) => (set.has(id) ? without(set, id) : withId(set, id)));
    }
    // A gap only expands: once it has, the row that stood for it is gone, and
    // there is nothing left under the cursor to press space on.
    const gap = rows[selection.cursor]?.gapIndex;
    if (gap === null || gap === undefined) return;
    setExpandedGaps((set) => new Set(set).add(gap));
  }

  /** Land on another version, with the document reset under the cursor. */
  function goToVersion(next: number, diffing: boolean) {
    setVersionB(next);
    const earlier = props.versions.filter((v) => v < next);
    setVersionA(diffing && earlier.length ? Math.max(...earlier) : null);
    setSelection(initialSelection());
    setOffset(0);
    setExpandedGaps(new Set());
  }

  function stepVersion(delta: number) {
    const index = props.versions.indexOf(versionB);
    const next = props.versions[index + delta];
    if (index === -1 || next === undefined) {
      return setStatus(delta < 0 ? 'this is the first version' : 'this is the latest version');
    }
    goToVersion(next, versionA !== null);
  }

  function toggleDiff() {
    if (versionA !== null) return setVersionA(null);
    if (previousVersion === null) return;
    setVersionA(previousVersion);
  }

  function finish(action: ReviewResult['action']) {
    if (action === 'submit' && !hasFeedback) {
      return setStatus('nothing to submit — press f to leave feedback, or x to leave');
    }
    const batches = Object.entries(byVersion)
      .map(([version, list]) => ({ version: Number(version), annotations: list }))
      .filter((batch) => batch.annotations.length)
      .sort((a, b) => a.version - b.version);
    props.onDone({ action, batches, version: versionB, general });
  }

  /* ---------------------------------------------------------- keyboard */

  useInput(
    (input, key) => {
      setStatus(null);

      if (key.downArrow) return move(1);
      if (key.upArrow) return move(-1);

      // Half a screen and a whole one, the keys every pager already uses. On a
      // Mac keyboard PageUp is fn+arrow, which in practice means it does not
      // exist, and Ink redraws in place so the terminal's own scrollback shows
      // stale frames rather than more plan.
      if (key.ctrl && (input === 'd' || input === 'f')) {
        return page(input === 'd' ? Math.floor(bodyHeight / 2) : bodyHeight);
      }
      if (key.ctrl && (input === 'u' || input === 'b')) {
        return page(input === 'u' ? -Math.floor(bodyHeight / 2) : -bodyHeight);
      }
      if (key.pageDown) return page(Math.floor(bodyHeight / 2));
      if (key.pageUp) return page(-Math.floor(bodyHeight / 2));
      if (input === 'g') return jumpTo(0);
      if (input === 'G') return jumpTo(rows.length - 1);

      if (key.escape) {
        return setSelection((s) => reduceSelection(s, { type: 'clear' }, rows));
      }
      if (input === 'v') {
        return setSelection((s) => reduceSelection(s, { type: 'toggleVisual' }, rows));
      }
      if (input === ' ') return toggleFold();

      if (input === 'f') return startFeedback();
      if (input === 'l') return toggleLock();
      if (input === 'd' && previousVersion !== null) return toggleDiff();
      if (input === '[') return stepVersion(-1);
      if (input === ']') return stepVersion(1);
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

  /**
   * Wheel scrolling, only if it was asked for.
   *
   * Capturing mouse events is what made the terminal stop letting you select
   * and copy a line out of a plan, which is why it was removed. Only the wheel
   * is acted on, and only under `planx config set mouse on`.
   */
  useEffect(() => {
    if (!props.mouse || !stdout || !stdin) return;
    stdout.write('\x1b[?1000h\x1b[?1006h');
    const onData = (data: Buffer | string) => {
      for (const match of String(data).matchAll(/\x1b\[<(\d+);\d+;\d+[Mm]/g)) {
        const button = Number(match[1]);
        if (button === 64) scrollBy(-3);
        else if (button === 65) scrollBy(3);
      }
    };
    stdin.on('data', onData);
    return () => {
      stdin.off('data', onData);
      stdout.write('\x1b[?1006l\x1b[?1000l');
    };
  }, [props.mouse, stdout, stdin, scrollBy]);

  useEffect(() => () => exit(), [exit]);

  /* ------------------------------------------------------------ render */

  // The whole-plan note gets the same box the inline notes get, pinned at the
  // foot of the frame. It used to be typed blind: the draft went into a
  // variable and onto no row of the screen until enter committed it.
  const noteRows =
    mode.kind === 'note'
      ? feedbackRows('general', mode.draft, {
          blockIndex: 0,
          boxWidth: model.boxWidth,
          collapsed: false,
          editing: true,
          attached: false,
        })
      : [];

  const visibleHeight = Math.max(1, bodyHeight - noteRows.length);

  // Help replaces the document rather than sitting on top of it, so a long key
  // list can never push the frame past the bottom of the terminal.
  const body =
    mode.kind === 'help'
      ? helpLines(inner, previousVersion !== null)
      : rows.slice(offset, offset + visibleHeight).map((row, i) =>
          renderRow(row, {
            cursor: offset + i === selection.cursor,
            selected: isRowSelected(selection, offset + i),
            editing: row.kind === 'feedback' && row.annotationId === draftId,
            width: textWidth,
          }),
        );

  const message =
    mode.kind === 'confirm'
      ? bold(signal(`Approve v${versionB}? This seals the plan — every section becomes locked.`))
      : statusLine(status, general, previousOn(props.previous, versionB), inner);

  return (
    <Box flexDirection="column">
      <Text>
        {topRule(frameWidth, headerText(props, versionA, versionB, model.locks.sealed_at !== null))}
      </Text>
      <Text>{frameLine('', inner)}</Text>
      {body.map((line, i) => (
        <Text key={i}>{frameLine(line, inner)}</Text>
      ))}
      {noteRows.map((row, i) => (
        <Text key={`note-${i}`}>
          {frameLine(
            renderRow(row, { cursor: false, selected: false, editing: true, width: textWidth }),
            inner,
          )}
        </Text>
      ))}
      <Text>{frameLine('', inner)}</Text>
      <Text>{frameLine(message, inner)}</Text>
      <Text>
        {frameLine(
          dim(
            hintsFor(mode, rows[selection.cursor], {
              hasFeedback,
              locked: isCursorLocked(model, rows, selection),
              annotated: Boolean(annotationAtCursor()),
              diffing: versionA !== null,
              canDiff: previousVersion !== null,
              manyVersions: props.versions.length > 1,
            }),
          ),
          inner,
        )}
      </Text>
      <Text>{bottomRule(frameWidth, ` ★ ${REPO} `)}</Text>
    </Box>
  );
}

function headerText(
  props: ReviewAppProps,
  versionA: number | null,
  versionB: number,
  sealed: boolean,
): string {
  const versions = `v${versionB}${versionA === null ? '' : ` ← v${versionA}`}`;
  return brandTitle(
    props.version,
    `${props.planId}  ${dim(versions)}${sealed ? `  ${bold(signal('sealed'))}` : ''}`,
  );
}

function previousOn(feedback: readonly Feedback[], version: number): number {
  return feedback.filter((f) => f.version === version).length;
}

function describeSpan(span: LineSpan): string {
  return span.start === span.end ? `${span.start}` : `${span.start}–${span.end}`;
}

/* ------------------------------------------------------------------ rows */

interface RowOptions {
  cursor: boolean;
  selected: boolean;
  editing: boolean;
  /** Columns available to the row's text, after the rail and the gutter. */
  width: number;
}

/**
 * One drawn line, with the cursor arrow in a gutter of its own.
 *
 * The arrow lives here rather than in the row text so moving it costs a
 * re-render of the visible slice, not a rebuild of the whole document. The rail
 * sits *behind* the arrow, at the head of the line numbers, because a rail
 * pressed against the cursor reads as part of the cursor — and the cursor moves
 * while the rail does not.
 */
function renderRow(row: ViewRow, opts: RowOptions): string {
  const arrow = opts.cursor ? signal('▸') : ' ';

  if (row.kind === 'feedback') {
    if (row.part !== 'body') return `${arrow} ${signal(row.text)}`;

    const box = row.boxWidth - BOX_PADDING;
    const caret = opts.editing && row.last;
    const text = truncate(row.text, box);
    const filled = padEnd(caret ? `${text}${inverse(' ')}` : text, box);
    return `${arrow} ${signal('│')} ${filled} ${signal('│')}`;
  }

  const rail = row.rail ? signal('│') : ' ';
  const gutter = opts.cursor ? row.gutterActive : row.gutter;
  const text = truncate(opts.selected ? inverse(stripAnsi(row.text)) : row.text, opts.width);
  return `${arrow} ${rail}${gutter}${text}`;
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

interface HintContext {
  hasFeedback: boolean;
  locked: boolean;
  annotated: boolean;
  diffing: boolean;
  canDiff: boolean;
  manyVersions: boolean;
}

/**
 * The hints offer what this row can actually do.
 *
 * Feedback and approval are both conditional: you cannot comment on a locked
 * passage, and approving a plan you have notes on would seal the lines the
 * notes are about. `d` is missing on v1 rather than bound to an apology.
 * Showing keys that refuse to work teaches the wrong thing.
 */
function hintsFor(mode: Mode, row: ViewRow | undefined, ctx: HintContext): string {
  if (mode.kind === 'editing') return 'type your note · enter to save · esc to discard';
  if (mode.kind === 'note') {
    return 'a note about the whole plan · enter to save · esc to cancel · press f instead to comment on selected lines';
  }
  if (mode.kind === 'confirm') return 'enter to approve and seal · esc to cancel';
  if (mode.kind === 'help') return 'any key to close';

  const parts: string[] = [];
  if (ctx.annotated) parts.push('space fold', 'f edit');
  else if (row?.gapIndex !== null && row?.gapIndex !== undefined) {
    parts.push('space expand', 'v select');
  } else {
    parts.push('v select', ctx.locked ? 'l unlock' : 'f feedback · l lock');
  }
  parts.push('n note');
  if (ctx.canDiff) parts.push(ctx.diffing ? 'd plan' : 'd diff');
  if (ctx.manyVersions) parts.push('[ ] version');
  parts.push('g/G ^d/^u move');
  parts.push(ctx.hasFeedback ? 's submit' : 'a approve', 'x exit', '? help');
  return parts.join(' · ');
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

/** `null` in the third slot means the key only exists on a plan with history. */
const HELP: Array<[string, string, 'always' | 'versioned']> = [
  ['↑ ↓', 'move a line at a time — notes are stepped over', 'always'],
  ['^d ^u', 'half a screen down or up', 'always'],
  ['^f ^b', 'a whole screen down or up', 'always'],
  ['g G', 'the top and the bottom of the plan', 'always'],
  ['v', 'start or end a selection, then ↑ ↓ to extend', 'always'],
  ['f', 'feedback on the selection, or edit the note on this line', 'always'],
  ['l', 'lock or unlock the selection — applied immediately', 'always'],
  ['space', 'fold the note, or expand the collapsed run, on this line', 'always'],
  ['h', 'fold or unfold every note at once', 'always'],
  ['n', 'a note about the whole plan', 'always'],
  ['d', 'show the diff against the previous version, or hide it', 'versioned'],
  ['[ ]', 'the previous and next version of the plan', 'versioned'],
  ['s', 'submit everything at once', 'always'],
  ['a', 'approve — seals the plan, and only when you have no feedback', 'always'],
  ['x', 'leave without submitting', 'always'],
];

function helpLines(width: number, canDiff: boolean): string[] {
  return [
    bold(signal('planx review')),
    '',
    ...HELP.filter(([, , when]) => when === 'always' || canDiff).map(
      ([keys, what]) => `${signal(padEnd(keys, 8))}${dim(truncate(what, width - 8))}`,
    ),
    '',
    dim('a note is deleted by emptying it: f, clear the text, enter.'),
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
