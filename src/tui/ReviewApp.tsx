import { Box, Text, useApp, useInput, useStdout } from 'ink';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { contextSha } from '../locks/anchor.js';
import { buildAnnotation } from '../protocol/submit.js';
import {
  bold,
  dim,
  inverse,
  padEnd,
  red,
  signal,
  stripAnsi,
  truncate,
  yellow,
} from '../render/ansi.js';
import type { RenderMode } from '../render/diff.js';
import type { Annotation, Feedback } from '../store/types.js';
import { bottomRule, brandTitle, frameLine, FRAME_PADDING, REPO, topRule } from './frame.js';
import { hintLines, orderHints, type Hint } from './hints.js';
import { lockLines, unlockLines } from './locking.js';
import { BOX_PADDING, buildModel, type ViewRow } from './model.js';
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
  /** `back` means the reviewer wants the list again, with nothing submitted. */
  action: 'submit' | 'approve' | 'reject' | 'quit' | 'back';
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
  /** Every stored version, ascending — what `←`, `→` and `d` can reach. */
  versions: number[];
  mode: RenderMode;
  /** planx's own version, for the frame. */
  version: string;
  /** Feedback already left on this plan, shown so you do not repeat yourself. */
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
  | { kind: 'leave' }
  | { kind: 'help' };

/**
 * Top rule, the gaps above and below the body, the status line, the bottom
 * rule. Five rows, not the seven the old constant claimed — and the extra row
 * it reserved is why the frame stopped one line short of the terminal and Ink
 * added a newline under the bottom border.
 *
 * The hint bar is added on top of this, because it wraps: how many rows it
 * takes is a function of the terminal's width.
 */
const CHROME_WITHOUT_HINTS = 5;
const MIN_BODY = 5;
const MIN_WIDTH = 48;
/** The cursor arrow and the space after it. */
const CURSOR_GUTTER = 2;

const NO_ANNOTATIONS: Annotation[] = [];

export function ReviewApp(props: ReviewAppProps) {
  const { exit } = useApp();
  const { stdout } = useStdout();

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
  const hasFeedback =
    Object.values(byVersion).some((list) => list.length > 0) || general.trim().length > 0;

  const previousVersion = useMemo(() => {
    const earlier = props.versions.filter((v) => v < versionB);
    return earlier.length ? Math.max(...earlier) : null;
  }, [props.versions, versionB]);

  // Reserve, do not react. The hint set changes with the row under the cursor,
  // so a body sized to whatever the bar happens to need right now would grow
  // and shrink as the cursor moved — visibly worse than the truncation this
  // replaces. The frame keeps room for the widest bar and pads the rest.
  const reserveRows = hintLines(
    widestHints({
      canDiff: previousVersion !== null,
      manyVersions: props.versions.length > 1,
    }),
    inner,
  ).length;
  const bodyHeight = Math.max(MIN_BODY, (stdout?.rows ?? 24) - CHROME_WITHOUT_HINTS - reserveRows);

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
          const shifted = Math.max(
            0,
            Math.min(o + travelled, Math.max(0, rows.length - bodyHeight)),
          );
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

  /* ------------------------------------------------------------- actions */

  /** The comment under the cursor — the box itself, or the lines it covers. */
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
   * There is no delete key: a second way to destroy something is not worth a
   * letter of the keyboard when `f`, clear, `enter` already does it.
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
          ? `unlocked line${span.start === span.end ? '' : 's'} ${describeSpan(span)}`
          : `nothing was locking line${span.start === span.end ? '' : 's'} ${describeSpan(span)}`,
      );
    } else {
      const result = lockLines(props.planId, model.docLines, versionB, span);
      // Say what happened rather than claiming the whole span: half of it may
      // already have been frozen by an earlier press. Not which lock it became:
      // the id is an internal handle, `planx locks` prints it, and the ⚿ in the
      // gutter has already said the line is frozen.
      const parts = result.locked.map(
        (l) => `locked line${l.start === l.end ? '' : 's'} ${describeSpan(l)}`,
      );
      if (result.skipped.length) {
        const single =
          result.skipped.length === 1 && result.skipped[0]!.start === result.skipped[0]!.end;
        parts.push(
          `${result.skipped.map(describeSpan).join(', ')} ${single ? 'was' : 'were'} already locked`,
        );
      }
      setStatus(parts.join(' · '));
    }

    setLockRevision((n) => n + 1);
    setSelection((s) => reduceSelection(s, { type: 'clear' }, rows));
  }

  /**
   * Space folds what is under the cursor: a note into its rail, a gap open.
   *
   * Any row of the box does it, not only the line it hangs off — the cursor can
   * reach the box now, and a key that works on the thing you are pointing at is
   * the one that needs no explaining.
   */
  function toggleFold() {
    const note = annotationAtCursor();
    if (note) {
      const id = note.id;
      // Folding from inside the box takes four rows down to one, so the cursor
      // moves to the row the box is about to become rather than to whatever
      // line happens to slide up underneath it.
      if (rows[selection.cursor]?.kind === 'feedback') {
        jumpTo(rows.findIndex((r) => r.kind === 'feedback' && r.annotationId === id));
      }
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

      // Right for newer, left for older, the way the versions are numbered.
      if (key.leftArrow) return stepVersion(-1);
      if (key.rightArrow) return stepVersion(1);
      // The brackets that used to do it still work, undocumented, because
      // fingers that learned them should not have to unlearn them.
      if (input === '[') return stepVersion(-1);
      if (input === ']') return stepVersion(1);

      // `v` is what clears a selection now, so esc is free to mean back.
      if (key.escape) return setMode({ kind: 'leave' });
      if (input === 'v') {
        return setSelection((s) => reduceSelection(s, { type: 'toggleVisual' }, rows));
      }
      if (input === ' ') return toggleFold();

      if (input === 'f') return startFeedback();
      if (input === 'l') return toggleLock();
      if (input === 'd' && previousVersion !== null) return toggleDiff();
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
      if (mode.kind === 'leave') {
        if (key.return) return finish('back');
        if (key.escape || input === 'n') setMode({ kind: 'browse' });
      }
    },
    { isActive: mode.kind === 'help' || mode.kind === 'confirm' || mode.kind === 'leave' },
  );

  // Folding notes takes rows out from under the cursor — `h` can take dozens —
  // and a cursor past the end draws no arrow at all until the next keypress.
  useEffect(() => {
    if (selection.cursor < rows.length) return;
    jumpTo(rows.length - 1);
  }, [rows, selection.cursor, jumpTo]);

  useEffect(() => () => exit(), [exit]);

  /* ------------------------------------------------------------ render */

  // Help replaces the document rather than sitting on top of it, so a long key
  // list can never push the frame past the bottom of the terminal.
  //
  // Both are then held to exactly `bodyHeight`. A plan shorter than the
  // viewport would otherwise draw a frame shorter than the terminal, and Ink
  // adds a newline under any frame that does not reach the bottom — the same
  // gap the chrome constant was leaving.
  const body = fit(
    mode.kind === 'help'
      ? helpLines(inner, previousVersion !== null)
      : rows.slice(offset, offset + bodyHeight).map((row, i) =>
          renderRow(row, {
            cursor: offset + i === selection.cursor,
            selected: isRowSelected(selection, offset + i),
            editing: row.kind === 'feedback' && row.annotationId === draftId,
            width: textWidth,
            indent: model.railColumn,
          }),
        ),
    bodyHeight,
  );

  const message =
    mode.kind === 'confirm'
      ? bold(signal(`Approve v${versionB}? This seals the plan — every section becomes locked.`))
      : mode.kind === 'leave'
        ? bold(
            red(
              hasFeedback
                ? 'Back to the list? Your feedback has not been submitted and will be lost.'
                : 'Back to the list?',
            ),
          )
        : statusLine({
            status,
            note: mode.kind === 'note' ? mode.draft : general,
            typing: mode.kind === 'note',
            previous: previousOn(props.previous, versionB),
            width: inner,
          });

  return (
    <Box flexDirection="column">
      <Text>
        {topRule(frameWidth, headerText(props, versionA, versionB, model.locks.sealed_at !== null))}
      </Text>
      <Text>{frameLine('', inner)}</Text>
      {body.map((line, i) => (
        <Text key={i}>{frameLine(line, inner)}</Text>
      ))}
      <Text>{frameLine('', inner)}</Text>
      <Text>{frameLine(message, inner)}</Text>
      {fit(
        hintLines(
          hintsFor(mode, rows[selection.cursor], {
            hasFeedback,
            locked: isCursorLocked(model, rows, selection),
            annotated: Boolean(annotationAtCursor()),
            selecting: selection.active,
            plural: spanSize(rows, selection) > 1,
            diffing: versionA !== null,
            canDiff: previousVersion !== null,
            manyVersions: props.versions.length > 1,
          }),
          inner,
        ),
        reserveRows,
      ).map((line, i) => (
        <Text key={i}>{frameLine(line ? dim(line) : '', inner)}</Text>
      ))}
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
  /** Columns available to the row's text, after the gutter and the rail. */
  width: number;
  /** The rail's column, which is where a note box opens. */
  indent: number;
}

/**
 * One drawn line, with the cursor arrow in a gutter of its own.
 *
 * The arrow lives here rather than in the row text so moving it costs a
 * re-render of the visible slice, not a rebuild of the whole document.
 *
 * The rail runs *between* the line number and the text, in a column of its own,
 * and a note box opens off it there. Out in the left margin — behind the
 * numbers, where it used to be — the box was indented past nothing and the
 * note's words shared no left edge with the words they were about.
 */
function renderRow(row: ViewRow, opts: RowOptions): string {
  const arrow = opts.cursor ? signal('▸') : ' ';
  const pad = ' '.repeat(opts.indent);

  if (row.kind === 'feedback') {
    if (row.part !== 'body') return `${arrow} ${pad}${signal(row.text)}`;

    const box = row.boxWidth - BOX_PADDING;
    const caret = opts.editing && row.last;
    const text = truncate(row.text, box);
    const filled = padEnd(caret ? `${text}${inverse(' ')}` : text, box);
    return `${arrow} ${pad}${signal('│')} ${filled} ${signal('│')}`;
  }

  const gutter = opts.cursor ? row.gutterActive : row.gutter;
  const text = truncate(opts.selected ? inverse(stripAnsi(row.text)) : row.text, opts.width);
  // A collapsed run is not a line of the document — no number, no lock, no note
  // — so it gets no rail column either, and its marker starts where a line
  // number would.
  if (row.gapIndex !== null) return `${arrow} ${gutter}${text}`;

  const rail = row.rail ? signal('│') : ' ';
  return `${arrow} ${gutter}${rail} ${text}`;
}

/* --------------------------------------------------------------- chrome */

/** The yellow label that says which of the two notes this row is. */
const NOTE_LABEL = 'Global Note: ';

interface StatusOptions {
  status: string | null;
  /** The whole-plan note: the committed one, or the draft while `n` is open. */
  note: string;
  typing: boolean;
  previous: number;
  width: number;
}

/**
 * One line for everything transient, in the order it matters.
 *
 * Stacking status, note and history on separate rows made the frame breathe in
 * and out as they came and went, which moves the document under the cursor.
 *
 * The whole-plan note lives here too, written and read on the same row. It used
 * to get the box an inline comment gets and then collapse into a dim line on
 * this one — two presentations of one thing, and three rows spent saying what a
 * spare row was already there to say. The yellow label is what tells the two
 * kinds of note apart, so the sentence explaining it is gone with the box.
 *
 * Status wins while it is showing, because it is the thing that just happened;
 * the note comes back underneath when it clears.
 */
function statusLine(opts: StatusOptions): string {
  if (opts.typing) {
    // The tail, not the head: the caret has to stay beside the words being
    // typed, and a note long enough to overflow is one you are still writing.
    const room = Math.max(8, opts.width - NOTE_LABEL.length - 1);
    return `${yellow(`${NOTE_LABEL}${opts.note.slice(-room)}`)}${inverse(' ')}`;
  }
  if (opts.status) return signal(truncate(opts.status, opts.width));
  if (opts.note.trim()) {
    return yellow(`${NOTE_LABEL}${truncate(opts.note, opts.width - NOTE_LABEL.length)}`);
  }
  if (opts.previous) {
    const n = opts.previous;
    return dim(`${n} earlier note${n === 1 ? '' : 's'} already left on this version`);
  }
  return '';
}

interface HintContext {
  hasFeedback: boolean;
  locked: boolean;
  annotated: boolean;
  /** A selection is live, so `v` ends it rather than starting one. */
  selecting: boolean;
  /** What `l` would act on covers more than one line. */
  plural: boolean;
  diffing: boolean;
  canDiff: boolean;
  manyVersions: boolean;
}

/**
 * The hints offer what this row can actually do, in the one order.
 *
 * Feedback and approval are both conditional: you cannot comment on a locked
 * passage, and approving a plan you have notes on would seal the lines the
 * notes are about. `d` is missing on v1 rather than bound to an apology.
 * Showing keys that refuse to work teaches the wrong thing.
 *
 * `g G ^d ^u` are gone from here and stay in `?`. They are the keys you already
 * know from every pager, and they were the third of the line that never
 * changed — a hint that is always true is a hint nobody is reading. `h` joins
 * them for the same reason: folding every note at once is a thing you do once
 * a session, and it was costing a hint on every row of every plan.
 */
function hintsFor(mode: Mode, row: ViewRow | undefined, ctx: HintContext): Hint[] {
  if (mode.kind === 'editing')
    return [
      ['enter', 'save'],
      ['esc', 'discard'],
    ];
  // The yellow `Global Note:` label on the row above says what is being typed,
  // so the hint has nothing left to explain.
  if (mode.kind === 'note')
    return [
      ['enter', 'save'],
      ['esc', 'cancel'],
    ];
  if (mode.kind === 'confirm')
    return [
      ['enter', 'approve'],
      ['esc', 'cancel'],
    ];
  if (mode.kind === 'leave')
    return [
      ['enter', 'back'],
      ['esc', 'stay'],
    ];
  if (mode.kind === 'help') return [['any key', 'to close']];

  const lines = ctx.plural ? 'lines' : 'line';
  const hints: Hint[] = [
    ['n', 'note'],
    ['x', 'exit'],
    ['esc', 'back'],
  ];

  // Folding is offered on the box, which the cursor can now reach — a document
  // line beside a note is a line, and the note has a row of its own.
  if (row?.kind === 'feedback') {
    hints.push(['space', 'fold'], ['f', 'edit']);
  } else if (row?.gapIndex !== null && row?.gapIndex !== undefined) {
    hints.push(['space', 'expand'], ['v', ctx.selecting ? 'unselect lines' : 'select lines']);
  } else {
    hints.push(['v', ctx.selecting ? 'unselect lines' : 'select lines']);
    if (ctx.locked) hints.push(['l', `unlock ${lines}`]);
    else hints.push(['f', ctx.annotated ? 'edit' : 'feedback'], ['l', `lock ${lines}`]);
  }

  if (ctx.canDiff) hints.push(['d', ctx.diffing ? 'hide diff' : 'show diff']);
  if (ctx.manyVersions) hints.push(['←→', 'version']);
  hints.push(ctx.hasFeedback ? ['s', 'submit'] : ['a', 'approve'], ['?', 'help']);
  return hints;
}

/**
 * The widest bar browse mode can produce, for the height to be reserved from.
 *
 * It is one real hint set rather than the union of all of them: a document
 * line that is not locked, with every either/or resolved to the longer side.
 * That branch offers three keys of its own where the note and the collapsed
 * run offer two, and it carries the longest labels — so nothing the cursor can
 * land on needs more rows than this.
 */
function widestHints(ctx: Pick<HintContext, 'canDiff' | 'manyVersions'>): Hint[] {
  const hints: Hint[] = [
    ['n', 'note'],
    ['x', 'exit'],
    ['esc', 'back'],
    ['v', 'unselect lines'],
    ['f', 'feedback'],
    ['l', 'lock lines'],
  ];
  if (ctx.canDiff) hints.push(['d', 'show diff']);
  if (ctx.manyVersions) hints.push(['←→', 'version']);
  hints.push(['a', 'approve'], ['?', 'help']);
  return hints;
}

/** Exactly `height` lines: the tail cut, or blank rows added. */
function fit(lines: readonly string[], height: number): string[] {
  const out = lines.slice(0, height);
  while (out.length < height) out.push('');
  return out;
}

/** How many lines `f` and `l` would act on, for singular against plural. */
function spanSize(rows: readonly ViewRow[], selection: SelectionState): number {
  const span = spanAtCursor(rows, selection);
  return span ? span.end - span.start + 1 : 1;
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

/**
 * Every key, in the same order the hint line puts them.
 *
 * `versioned` marks the ones that only exist on a plan with history. The list
 * is sorted through `orderHints` rather than written in order, so `?` and the
 * hints cannot drift apart.
 */
const HELP: Array<[Hint, 'always' | 'versioned']> = [
  [['←→', 'the previous and next version of the plan'], 'versioned'],
  [['↑↓', 'move a row at a time, notes included'], 'always'],
  [['a', 'approve — seals the plan, and only when you have no feedback'], 'always'],
  [['d', 'show the diff against the previous version, or hide it'], 'versioned'],
  [['f', 'feedback on the selection, or edit the note under the cursor'], 'always'],
  [['g G', 'the top and the bottom of the plan'], 'always'],
  [['^d ^u', 'half a screen down or up'], 'always'],
  [['^f ^b', 'a whole screen down or up'], 'always'],
  [['h', 'fold or unfold every note at once'], 'always'],
  [['l', 'lock or unlock the selection — applied immediately'], 'always'],
  [['n', 'a note about the whole plan'], 'always'],
  [['s', 'submit everything at once'], 'always'],
  [['space', 'fold the note, or expand the collapsed run, under the cursor'], 'always'],
  [['v', 'start or end a selection, then ↑ ↓ to extend'], 'always'],
  [['x', 'leave without submitting'], 'always'],
  [['esc', 'back to the list'], 'always'],
  [['?', 'this list'], 'always'],
];

function helpLines(width: number, canDiff: boolean): string[] {
  const shown = HELP.filter(([, when]) => when === 'always' || canDiff).map(([hint]) => hint);
  return [
    bold(signal('planx review')),
    '',
    ...orderHints(shown).map(
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
