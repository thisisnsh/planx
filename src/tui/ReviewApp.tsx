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
import { BOX_PADDING, buildModel, foldEnd, wrapComment, type ViewRow } from './model.js';
import {
  initialSelection,
  isRowSelected,
  reduceSelection,
  scrollFor,
  spanAtCursor,
  type LineSpan,
  type SelectionState,
} from './selection.js';

/** One version's feedback, whole — what that version's record becomes. */
export interface FeedbackBatch {
  version: number;
  annotations: Annotation[];
  /** The note about the whole plan, written on this version. */
  general: string;
}

export interface ReviewResult {
  /** `back` means the reviewer wants the list again, with nothing submitted. */
  action: 'submit' | 'approve' | 'reject' | 'quit' | 'back';
  /**
   * Every version the reviewer edited, plus the one they finished on — and the
   * empty ones belong here: a batch with no annotations and no note is how
   * deleting the last comment on a version lands. A version they only stepped
   * through carries no batch, however much feedback is already on it.
   */
  batches: FeedbackBatch[];
  /** The version on screen when the reviewer finished. */
  version: number;
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
  /**
   * The feedback stored on this plan. It is loaded into the review, per version
   * and editable — open a version and you see what you left on it, exactly as
   * you left it. There is no such thing as submitted-versus-pending feedback.
   */
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
  // those words are a property of the version you were looking at. Seeded from
  // the store, so stepping to a version shows what is on it.
  const [byVersion, setByVersion] = useState<Record<number, Annotation[]>>(() =>
    storedAnnotations(props.previous),
  );
  const [generalByVersion, setGeneralByVersion] = useState<Record<number, string>>(() =>
    storedNotes(props.previous),
  );
  // Which versions were edited this session. Leaving loses these and only
  // these — everything else is already on disk, unchanged.
  const [touched, setTouched] = useState<ReadonlySet<number>>(() => new Set<number>());
  const [expandedGaps, setExpandedGaps] = useState<ReadonlySet<number>>(() => new Set());
  const [foldedSections, setFoldedSections] = useState<ReadonlySet<number>>(() => new Set());
  const [collapsedFeedback, setCollapsedFeedback] = useState<ReadonlySet<string>>(() => new Set());
  const [hiddenFeedback, setHiddenFeedback] = useState(false);
  // Locks are written the moment they are made, so the model has to be told to
  // read them back. Nothing else in this component changes what is on disk.
  const [lockRevision, setLockRevision] = useState(0);
  const [mode, setMode] = useState<Mode>({ kind: 'browse' });
  const [status, setStatus] = useState<string | null>(null);
  /** An annotation `j` is on its way to, once the rows have caught up. */
  const [pendingJump, setPendingJump] = useState<string | null>(null);

  const frameWidth = Math.max(MIN_WIDTH, (stdout?.columns ?? 100) - 1);
  /** Columns between the two frame edges. */
  const inner = frameWidth - FRAME_PADDING;
  /** What is left for the rail, the line gutter and the plan text. */
  const contentWidth = inner - CURSOR_GUTTER;

  const annotations = byVersion[versionB] ?? NO_ANNOTATIONS;
  const general = generalByVersion[versionB] ?? '';
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
        foldedSections,
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
      foldedSections,
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
  /** What this version carries — which is what `a` is gated on, and what `s` sends. */
  const carries = annotations.length > 0 || general.trim().length > 0;
  // What this version carries, or anything edited this session — the same set
  // `s` sends. A version emptied this session counts, because an empty version
  // is how a deletion lands.
  const anythingToSubmit = carries || touched.size > 0;

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

  // What the version has to say about itself, drawn between the status line and
  // the hints. A function of the version and not of the cursor, so the body does
  // not breathe as you move around inside it.
  const summary = useMemo(
    () => summaryLines({ count: annotations.length, note: general, width: inner }),
    [annotations.length, general, inner],
  );

  const bodyHeight = Math.max(
    MIN_BODY,
    (stdout?.rows ?? 24) - CHROME_WITHOUT_HINTS - reserveRows - summary.length,
  );

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

  /** This version now differs from what is stored, so a submit has to say so. */
  function touch(version: number) {
    setTouched((set) => new Set(set).add(version));
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

    // Past the highest id already on this version, not past the count: the
    // stored ones are `a1`, `a2`, … and a new note beside them must not land on
    // an id one of them already answers to.
    const id = nextAnnotationId(annotations);
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
    const before = annotations.find((a) => a.id === annotationId);
    if (!text) {
      updateAnnotations((current) => current.filter((a) => a.id !== annotationId));
    } else {
      updateAnnotations((current) =>
        current.map((a) => (a.id === annotationId ? { ...a, comment: text } : a)),
      );
    }
    // Opening a note and closing it unchanged is not an edit — and neither is
    // abandoning a new one, which leaves the version exactly as it was found.
    if ((before?.comment ?? '') !== text) touch(versionB);
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
   * Space folds what is under the cursor: a section away, a note into its rail,
   * a gap open.
   *
   * The heading wins over a note that happens to cover it. A heading is the row
   * you press space on to move past a whole section, and that reading has to
   * hold whether or not somebody left a comment on the heading line — the note
   * still has its own box, one row down, where space folds the note.
   *
   * Any row of the box does it, not only the line it hangs off — the cursor can
   * reach the box now, and a key that works on the thing you are pointing at is
   * the one that needs no explaining.
   */
  function toggleFold() {
    const row = rows[selection.cursor];
    const heading = row?.kind === 'doc' ? foldableHeading(row) : null;
    if (heading !== null) {
      return setFoldedSections((set) =>
        set.has(heading) ? withoutLine(set, heading) : new Set(set).add(heading),
      );
    }

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
    const gap = row?.gapIndex;
    if (gap === null || gap === undefined) return;
    setExpandedGaps((set) => new Set(set).add(gap));
  }

  /** The line this row heads a foldable section from, or null. */
  function foldableHeading(row: ViewRow): number | null {
    if (row.newLine === null) return null;
    return foldEnd(model.docLines, row.newLine) === null ? null : row.newLine;
  }

  /**
   * `j` walks the feedback, forward, wrapping at the end.
   *
   * Forward only: with a wrap there is nothing a backward key would reach that
   * pressing this one again does not, and a second key for the same walk is a
   * letter of the keyboard spent on symmetry.
   *
   * A comment inside a folded section unfolds it on the way — the alternative
   * is a key that silently declines to visit feedback you cannot see, which is
   * exactly the feedback worth being taken to.
   */
  function nextFeedback() {
    const ordered = [...annotations]
      .filter((a) => a.kind === 'comment')
      .sort((a, b) => a.anchor.end_line - b.anchor.end_line || a.id.localeCompare(b.id));
    if (!ordered.length) return setStatus('no feedback on this version');

    const row = rows[selection.cursor];
    const here = row?.kind === 'feedback' ? row.annotationId : null;
    const index = here === null ? -1 : ordered.findIndex((a) => a.id === here);
    const target =
      index === -1
        ? (ordered.find((a) => a.anchor.end_line > (row?.newLine ?? 0)) ?? ordered[0]!)
        : ordered[(index + 1) % ordered.length]!;

    for (const line of foldedSections) {
      const end = foldEnd(model.docLines, line);
      if (end !== null && target.anchor.end_line > line && target.anchor.end_line <= end) {
        setFoldedSections((set) => withoutLine(set, line));
      }
    }
    // The row it lands on may not exist until the fold above is gone, so the
    // jump waits for the rows to be rebuilt rather than guessing an index.
    setPendingJump(target.id);
  }

  /** Land on another version, with the document reset under the cursor. */
  function goToVersion(next: number, diffing: boolean) {
    setVersionB(next);
    const earlier = props.versions.filter((v) => v < next);
    setVersionA(diffing && earlier.length ? Math.max(...earlier) : null);
    setSelection(initialSelection());
    setOffset(0);
    setExpandedGaps(new Set());
    // Folds are line numbers in the version they were made on, and line 40 of
    // v2 is not line 40 of v3.
    setFoldedSections(new Set());
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
    if (action === 'submit' && !anythingToSubmit) {
      return setStatus('nothing to submit — press f to leave feedback, or x to leave');
    }
    // What you edited this session, plus the one you are on. An empty batch is
    // not noise: it is the record that has to be rewritten for a deleted comment
    // to stay deleted, which is why `touched` and not "carries something".
    //
    // A version you only read past is not in here. Every version's feedback is
    // loaded into `byVersion` so you can step to it and see it, and submitting
    // all of that back would rewrite records you never opened — announcing
    // versions you did not touch, and re-dating them.
    const versions = new Set<number>([versionB, ...touched]);

    const batches = [...versions]
      .sort((a, b) => a - b)
      .map((version) => ({
        version,
        annotations: byVersion[version] ?? [],
        general: generalByVersion[version] ?? '',
      }));
    props.onDone({ action, batches, version: versionB });
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
      if (input === 'j') return nextFeedback();
      if (input === 'l') return toggleLock();
      if (input === 'd' && previousVersion !== null) return toggleDiff();
      if (input === 'h') return setHiddenFeedback((on) => !on);
      if (input === 'n') return setMode({ kind: 'note', draft: general });
      if (input === 's') return finish('submit');
      if (input === 'a') {
        // Approving is for a version you have nothing to say about: it would
        // otherwise seal the very lines the feedback is asking to change. The
        // bar has already said so by offering `s` instead, so what is left here
        // is naming what is in the way.
        if (carries) return setStatus(approveBlocked(annotations.length, general));
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
          const note = mode.draft.trim();
          setGeneralByVersion((map) => ({ ...map, [versionB]: note }));
          if (note !== general) touch(versionB);
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

  // `j` names the annotation it is going to rather than a row index, because
  // unfolding a section to reach it moves every row after the fold.
  useEffect(() => {
    if (pendingJump === null) return;
    // The words, not the box's top edge: `j` is for reading the comment, and
    // landing on a rule with the text one row below is a keypress short.
    const at = (part: string) =>
      rows.findIndex(
        (r) => r.kind === 'feedback' && r.annotationId === pendingJump && r.part === part,
      );
    const index = [at('body'), at('collapsed'), at('top')].find((i) => i !== -1);
    setPendingJump(null);
    if (index !== undefined) jumpTo(index);
  }, [rows, pendingJump, jumpTo]);

  useEffect(() => () => exit(), [exit]);

  /* ------------------------------------------------------------ render */

  // Help replaces the document rather than sitting on top of it, so a long key
  // list can never push the frame past the bottom of the terminal.
  //
  // Both are then held to exactly `bodyHeight`. A plan shorter than the
  // viewport would otherwise draw a frame shorter than the terminal, and Ink
  // adds a newline under any frame that does not reach the bottom — the same
  // gap the chrome constant was leaving.
  // What space would do where the cursor is, so the hint says it rather than
  // making you press it to find out.
  const cursorRow = rows[selection.cursor];
  const headingLine = cursorRow ? foldableHeading(cursorRow) : null;
  const headingHint =
    headingLine === null ? null : foldedSections.has(headingLine) ? 'unfold' : 'fold';
  const noteFolded =
    cursorRow?.kind === 'feedback' &&
    (hiddenFeedback || collapsedFeedback.has(cursorRow.annotationId));

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

  // Never bold. Colour carries the weight — red for what destroys something,
  // yellow for everything else — and a bold row inside a frame reads as a
  // heading, which a question is not.
  const message =
    mode.kind === 'confirm'
      ? signal(`Approve v${versionB}? This seals the plan — every section becomes locked.`)
      : mode.kind === 'leave'
        ? touched.size
          ? red('Back to the list? Your feedback has not been submitted and will be lost.')
          : yellow('Back to the list?')
        : statusLine({
            status,
            note: mode.kind === 'note' ? mode.draft : '',
            typing: mode.kind === 'note',
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
      {summary.map((line, i) => (
        <Text key={i}>{frameLine(line, inner)}</Text>
      ))}
      {fit(
        hintLines(
          hintsFor(mode, rows[selection.cursor], {
            carries,
            anyFeedback: annotations.length > 0,
            heading: headingHint,
            noteFolded,
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

/* ------------------------------------------------------- what is stored */

/**
 * The feedback on this plan, per version, as the review's own state.
 *
 * There is no submitted-versus-pending distinction to preserve: a version's
 * feedback is one thing, and opening the version is how you get at it. Only
 * comments come back — locks and unlocks were applied to the store the moment
 * they were made, and replaying them out of a record would apply them twice.
 */
function storedAnnotations(feedback: readonly Feedback[]): Record<number, Annotation[]> {
  const out: Record<number, Annotation[]> = {};
  for (const record of feedback) {
    const comments = record.annotations.filter((a) => a.kind === 'comment');
    if (comments.length) out[record.version] = [...(out[record.version] ?? []), ...comments];
  }
  return out;
}

function storedNotes(feedback: readonly Feedback[]): Record<number, string> {
  const out: Record<number, string> = {};
  for (const record of feedback) {
    if (record.general.trim()) out[record.version] = record.general.trim();
  }
  return out;
}

/** One past the highest `aN` on this version, so a new note cannot collide. */
function nextAnnotationId(annotations: readonly Annotation[]): string {
  let highest = 0;
  for (const annotation of annotations) {
    const match = /^a(\d+)$/.exec(annotation.id);
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return `a${highest + 1}`;
}

/**
 * Why `a` did not open the confirmation, naming what is in the way.
 *
 * The rule is that a plan is approved only when it carries nothing — so the
 * answer to pressing `a` anyway is the count, not a restatement of the rule.
 */
function approveBlocked(count: number, note: string): string {
  const has: string[] = [];
  if (count) has.push(`${count} feedback${count === 1 ? '' : 's'}`);
  if (note.trim()) has.push('a note');
  const single = count + (note.trim() ? 1 : 0) === 1;
  return `This version has ${has.join(' and ')}. Delete ${single ? 'it' : 'them'} or press s to submit.`;
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
  /** The whole-plan note as it is being typed, while `n` is open. */
  note: string;
  typing: boolean;
  width: number;
}

/**
 * One row, for whatever just happened.
 *
 * It is transient by construction: a status message, or the note while it is
 * being typed, and nothing when neither. What the version *holds* is drawn
 * underneath, in the summary block, where a long note can have as many rows as
 * it needs — this row is where a message that has to be read right now goes,
 * and it cannot be that if something permanent is sitting on it.
 *
 * The whole-plan note is still written here, on one line, with the yellow
 * `Global Note:` label saying which of the two kinds of note it is.
 */
function statusLine(opts: StatusOptions): string {
  if (opts.typing) {
    // The tail, not the head: the caret has to stay beside the words being
    // typed, and a note long enough to overflow is one you are still writing.
    const room = Math.max(8, opts.width - NOTE_LABEL.length - 1);
    return `${yellow(`${NOTE_LABEL}${opts.note.slice(-room)}`)}${inverse(' ')}`;
  }
  if (opts.status) return signal(truncate(opts.status, opts.width));
  return '';
}

interface SummaryOptions {
  count: number;
  note: string;
  width: number;
}

/**
 * What this version holds, above the hints: how much feedback, and the note.
 *
 * It replaces the dim `N earlier notes already left on this version` line,
 * which counted feedback that was nowhere on screen. The feedback is in the
 * document now, so the count is a summary of what you can see rather than a
 * rumour about what you cannot.
 *
 * The note is drawn in full, wrapped, however many rows that takes. It is the
 * one piece of feedback with nowhere else to live — an inline comment has a box
 * beside the lines it is about — and a note truncated to one row is a note you
 * have to open an editor to finish reading.
 *
 * Nothing is drawn when there is nothing to say, so the block costs no rows on
 * a version nobody has commented on.
 */
function summaryLines(opts: SummaryOptions): string[] {
  const out: string[] = [];
  if (opts.count) {
    out.push(dim(`This version has ${opts.count} feedback${opts.count === 1 ? '' : 's'}.`));
  }
  if (opts.note.trim()) {
    out.push(...wrapComment(`${NOTE_LABEL}${opts.note.trim()}`, opts.width).map((l) => yellow(l)));
  }
  return out;
}

interface HintContext {
  /** This version carries feedback or a note, so `s` replaces `a`. */
  carries: boolean;
  /** There is feedback to walk, so `j` has somewhere to go. */
  anyFeedback: boolean;
  /** What `space` would do to the section under the cursor, if it is a heading. */
  heading: 'fold' | 'unfold' | null;
  /** The note under the cursor is already folded, so `space` opens it. */
  noteFolded: boolean;
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
  // line beside a note is a line, and the note has a row of its own. `space`
  // names what it folds rather than saying `fold`, because there are two kinds
  // of fold now and the cursor is what decides between them.
  if (row?.kind === 'feedback') {
    hints.push(['space', ctx.noteFolded ? 'unfold feedback' : 'fold feedback'], ['f', 'edit']);
  } else if (row?.gapIndex !== null && row?.gapIndex !== undefined) {
    hints.push(['space', 'expand'], ['v', ctx.selecting ? 'unselect lines' : 'select lines']);
  } else {
    if (ctx.heading) hints.push(['space', `${ctx.heading} section`]);
    hints.push(['v', ctx.selecting ? 'unselect lines' : 'select lines']);
    if (ctx.locked) hints.push(['l', `unlock ${lines}`]);
    else hints.push(['f', ctx.annotated ? 'edit' : 'feedback'], ['l', `lock ${lines}`]);
  }

  if (ctx.anyFeedback) hints.push(['j', 'next feedback']);
  if (ctx.canDiff) hints.push(['d', ctx.diffing ? 'hide diff' : 'show diff']);
  if (ctx.manyVersions) hints.push(['←→', 'version']);
  hints.push(ctx.carries ? ['s', 'submit'] : ['a', 'approve'], ['?', 'help']);
  return hints;
}

/**
 * The widest bar browse mode can produce, for the height to be reserved from.
 *
 * It is one real hint set rather than the union of all of them: an unlocked
 * heading on a version carrying feedback, with every either/or resolved to the
 * longer side. That branch offers the most keys of any row — `space` for the
 * section on top of the three a document line always has — and `j` rides along
 * with it, so nothing the cursor can land on needs more rows than this.
 */
function widestHints(ctx: Pick<HintContext, 'canDiff' | 'manyVersions'>): Hint[] {
  const hints: Hint[] = [
    ['n', 'note'],
    ['x', 'exit'],
    ['esc', 'back'],
    ['space', 'unfold section'],
    ['v', 'unselect lines'],
    ['f', 'feedback'],
    ['j', 'next feedback'],
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
  [['j', 'the next feedback on this version, wrapping at the end'], 'always'],
  [['l', 'lock or unlock the selection — applied immediately'], 'always'],
  [['n', 'a note about the whole plan'], 'always'],
  [['s', 'submit everything at once'], 'always'],
  [['space', 'fold the section or the note, or expand the run, under the cursor'], 'always'],
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

function withoutLine(set: ReadonlySet<number>, line: number): ReadonlySet<number> {
  const next = new Set(set);
  next.delete(line);
  return next;
}
