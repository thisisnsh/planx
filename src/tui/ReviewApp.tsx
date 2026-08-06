import { Box, Text, useApp, useInput, useStdout, type Key } from 'ink';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import type { LineEdit } from '../store/plans.js';
import { contextSha } from '../store/text.js';
import type { Annotation, Feedback } from '../store/types.js';
import { EXIT_PROMPT, useDoubleCtrlC } from './exit.js';
import { bottomRule, brandTitle, frameLine, FRAME_PADDING, REPO, topRule } from './frame.js';
import { hintLines, orderHints, type Hint } from './hints.js';
import { BOX_PADDING, buildModel, foldEnd, wrapComment, type ViewRow } from './model.js';
import { pressArrow, type HeldRun } from './repeat.js';
import {
  initialSelection,
  isRowSelected,
  reduceSelection,
  scrollFor,
  settleCursor,
  spanAtCursor,
  type SelectionState,
} from './selection.js';

/** One version's feedback, whole — what that version's record becomes. */
export interface FeedbackBatch {
  version: number;
  annotations: Annotation[];
  /** The note about the whole plan, written on this version. */
  general: string;
}

/** Per version: whether planx could start an agent for each intent. */
export type Launchable = Record<number, { revise: boolean; execute: boolean }>;

export interface ReviewResult {
  /**
   * What the reviewer asked for. `back` means the list again, with nothing
   * submitted; the other two both write everything first and differ only in
   * which command they hand on.
   */
  action: 'submit' | 'execute' | 'back';
  /** Whether planx runs that command itself or prints it for you to paste. */
  handoff: 'agent' | 'command';
  /**
   * Every version the reviewer edited, plus the one they finished on — and the
   * empty ones belong here: a batch with no annotations and no note is how
   * deleting the last comment on a version lands. A version they only stepped
   * through carries no batch, however much feedback is already on it.
   */
  batches: FeedbackBatch[];
  /** The version on screen when the reviewer finished. */
  version: number;
  /**
   * The lines the reviewer rewrote themselves, in line order. Only the latest
   * version can be edited, so `editedVersion` names it and there is never more
   * than one version's worth to apply.
   */
  edits: LineEdit[];
  editedVersion: number | null;
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
  /**
   * Which intents planx could actually start an agent for, per version. Where
   * it could not — no session recorded to fork, no agent named on the version —
   * the prompt is skipped and the command is printed: a choice between one
   * thing and nothing is not a choice.
   */
  launchable?: Launchable;
  /** What a second ctrl+c does. Defaults to ending the process with 130. */
  onQuit?: () => void;
  /**
   * The clock the held-arrow curve is measured against. A test drives it
   * itself; fake timers would fight Ink's render loop for the same one.
   */
  now?: () => number;
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
  | { kind: 'editing'; annotationId: string; draft: string; caret: number; isNew: boolean }
  | { kind: 'note'; draft: string; caret: number }
  /**
   * One line of the document, open for rewriting. `queue` is what is left of a
   * selection being walked — the lines that open, one at a time, behind this one.
   */
  | { kind: 'line'; line: number; draft: string; caret: number; queue: number[] }
  | { kind: 'leave' }
  /**
   * `s` and `x` asking which way the command goes: into an agent planx starts,
   * or onto the terminal for you to paste. It is two rows the frame already
   * has — the status line and the hint bar — rather than a screen of its own,
   * so the plan stays visible behind the question.
   */
  | { kind: 'handoff'; intent: 'revise' | 'execute' }
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
const NO_EDITS: ReadonlyMap<number, string> = new Map();

export function ReviewApp(props: ReviewAppProps) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  // Above every mode-scoped handler below, so it fires whatever is being typed.
  const leaving = useDoubleCtrlC({ onExit: props.onQuit });

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
  // Lines the reviewer rewrote, by line number. One map covers the session:
  // only the latest version can be edited, so there is only ever one version's
  // worth of them. Pending, like a note, until `s` or `a`.
  const [edits, setEdits] = useState<ReadonlyMap<number, string>>(NO_EDITS);
  const [expandedGaps, setExpandedGaps] = useState<ReadonlySet<number>>(() => new Set());
  const [foldedSections, setFoldedSections] = useState<ReadonlySet<number>>(() => new Set());
  const [collapsedFeedback, setCollapsedFeedback] = useState<ReadonlySet<string>>(() => new Set());
  const [hiddenFeedback, setHiddenFeedback] = useState(false);
  const [mode, setMode] = useState<Mode>({ kind: 'browse' });
  const [status, setStatus] = useState<string | null>(null);
  /** An annotation `j` is on its way to, once the rows have caught up. */
  const [pendingJump, setPendingJump] = useState<string | null>(null);
  /**
   * The arrow run in progress. A ref rather than state: it is read on the next
   * keypress and never drawn, and re-rendering the document on every repeat of
   * a held key is exactly what the acceleration exists to avoid.
   */
  const heldArrow = useRef<HeldRun | null>(null);

  const frameWidth = Math.max(MIN_WIDTH, (stdout?.columns ?? 100) - 1);
  /** Columns between the two frame edges. */
  const inner = frameWidth - FRAME_PADDING;
  /** What is left for the rail, the line gutter and the plan text. */
  const contentWidth = inner - CURSOR_GUTTER;

  const annotations = byVersion[versionB] ?? NO_ANNOTATIONS;
  const general = generalByVersion[versionB] ?? '';
  /** The one version an edit can land on — rewriting v2 rewrites what v3 was built from. */
  const latest = props.versions[props.versions.length - 1] ?? versionB;
  const shownEdits = versionB === latest ? edits : NO_EDITS;
  /**
   * Is there anything for `s` to write?
   *
   * A comment, the note, or a line rewritten in place — and any version touched
   * this session, because emptying the last comment on one leaves nothing to
   * count and still has to be written for the deletion to stick.
   */
  const canSubmit =
    annotations.length > 0 || general.trim().length > 0 || edits.size > 0 || touched.size > 0;
  const launchable = props.launchable?.[versionB] ?? { revise: false, execute: false };
  const draftId = mode.kind === 'editing' ? mode.annotationId : null;
  const draftText = mode.kind === 'editing' ? mode.draft : '';
  const draftCaret = mode.kind === 'editing' ? mode.caret : 0;

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
        edits: shownEdits,
        // Feeding the half-typed note through the model is what makes the box
        // grow line by line as it is written, instead of the text vanishing off
        // the right edge of a box sized for what was there before.
        draft:
          draftId === null ? null : { annotationId: draftId, text: draftText, caret: draftCaret },
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
      shownEdits,
      draftId,
      draftText,
      draftCaret,
    ],
  );

  const rows = model.rows;
  const textWidth = contentWidth - model.gutterWidth;

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
    () =>
      summaryLines({
        count: annotations.length,
        note: general,
        edits: shownEdits.size,
        width: inner,
      }),
    [annotations.length, general, shownEdits.size, inner],
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
      annotations.find((a) => a.anchor.start_line <= span.end && a.anchor.end_line >= span.start) ??
      null
    );
  }

  function updateAnnotations(fn: (current: Annotation[]) => Annotation[]) {
    setByVersion((map) => ({ ...map, [versionB]: fn(map[versionB] ?? []) }));
  }

  /** This version now differs from what is stored, so a submit has to say so. */
  function touch(version: number) {
    setTouched((set) => new Set(set).add(version));
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
        caret: existing.comment.length,
        isNew: false,
      });
    }

    const span = spanAtCursor(rows, selection);
    if (!span) {
      return setStatus('Nothing to annotate there — that row is a deletion or a collapsed gap.');
    }

    // Past the highest id already on this version, not past the count: the
    // stored ones are `a1`, `a2`, … and a new note beside them must not land on
    // an id one of them already answers to.
    const id = nextAnnotationId(annotations);
    updateAnnotations((current) => [
      ...current,
      buildAnnotation(
        model.docLines,
        span.start,
        span.end,
        '',
        id,
        contextSha(model.docLines, { start: span.start - 1, end: span.end - 1 }),
      ),
    ]);
    setHiddenFeedback(false);
    setSelection((s) => reduceSelection(s, { type: 'clear' }, rows));
    setMode({ kind: 'editing', annotationId: id, draft: '', caret: 0, isNew: true });
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
   * `e` opens the line under the cursor as its raw markdown source.
   *
   * The reviewer rewrites the words themselves and what they submit is what
   * they meant — no round trip through an agent that has to guess which word.
   * It refuses where an edit would mean something other than it says: an older
   * version is the text a newer one was built from, so rewriting it would
   * change what a later version was revised away from.
   */
  function startEdit() {
    const row = rows[selection.cursor];
    if (row?.kind === 'feedback') return setStatus('That is feedback — press f to edit it.');
    if (versionB !== latest) {
      return setStatus(`Only v${latest} can be edited — press → to reach it.`);
    }

    const span = spanAtCursor(rows, selection);
    if (!span) return setStatus('Nothing to edit there.');

    setSelection((s) => reduceSelection(s, { type: 'clear' }, rows));
    // A selection walks: the lines open one at a time, from the top.
    const open: number[] = [];
    for (let line = span.start; line <= span.end; line++) open.push(line);
    openLine(open[0]!, open.slice(1));
  }

  /** Open one line for rewriting, with what is left of the walk behind it. */
  function openLine(line: number, queue: number[]) {
    const draft = edits.get(line) ?? model.docLines[line - 1] ?? '';
    const index = rows.findIndex((r) => r.kind === 'doc' && r.newLine === line);
    if (index !== -1) jumpTo(index);
    setMode({ kind: 'line', line, draft, caret: draft.length, queue });
  }

  /**
   * Committing an edit writes nothing: it joins the pending set, the same place
   * a typed note lives until `s`. A line typed back to what it already said is
   * not an edit and leaves nothing behind.
   */
  function commitLine(line: number, draft: string) {
    const stored = model.docLines[line - 1] ?? '';
    setEdits((map) => {
      const next = new Map(map);
      if (draft === stored) next.delete(line);
      else next.set(line, draft);
      return next;
    });
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
   * the one that needs no explaining. The dim row a folded section leaves
   * behind answers to it too, for the same reason: it is the thing on screen
   * saying the section is there.
   */
  function toggleFold() {
    const row = rows[selection.cursor];
    const heading = foldTarget(row);
    if (heading !== null) {
      return setFoldedSections((set) =>
        set.has(heading) ? withoutLine(set, heading) : new Set(set).add(heading),
      );
    }

    const note = annotationAtCursor();
    if (note) {
      const id = note.id;
      // Folding from inside the box takes it down to one row, so the cursor
      // moves to where the box starts rather than to whatever line happens to
      // slide up underneath it. Unfolding lands there too, and the settling
      // that follows a rebuild carries it onto the note's reopened first line.
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

  /**
   * The heading line `space` would fold or unfold from this row, or null.
   *
   * Two rows answer to the same section: the heading itself, and the dim row
   * standing in for what it hides.
   */
  function foldTarget(row: ViewRow | undefined): number | null {
    if (row?.kind !== 'doc') return null;
    if (row.fold !== null) return row.fold;
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
    const ordered = [...annotations].sort(
      (a, b) => a.anchor.end_line - b.anchor.end_line || a.id.localeCompare(b.id),
    );
    if (!ordered.length) return setStatus('No feedback on this version.');

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
      return setStatus(delta < 0 ? 'This is the first version.' : 'This is the latest version.');
    }
    goToVersion(next, versionA !== null);
  }

  function toggleDiff() {
    if (versionA !== null) return setVersionA(null);
    if (previousVersion === null) return;
    setVersionA(previousVersion);
  }

  /**
   * Hand everything back at once.
   *
   * An empty submit is not refused. Submitting with nothing to say is the
   * ordinary way to say the plan is fine — it is what replaced `a`, and it is
   * what makes the review print the execute command rather than the revise one.
   *
   * The batches are what you edited this session, plus the one you are on. An
   * empty batch is not noise: it is the record that has to be rewritten for a
   * deleted comment to stay deleted, which is why `touched` and not "carries
   * something".
   *
   * A version you only read past is not in here. Every version's feedback is
   * loaded into `byVersion` so you can step to it and see it, and submitting all
   * of that back would rewrite records you never opened — announcing versions
   * you did not touch, and re-dating them.
   *
   * The edited version joins them wherever the reviewer happens to have
   * finished: submitting edits alone still writes that version's record, so
   * `planx revise` has something to report the edits against.
   */
  function finish(action: ReviewResult['action'], handoff: ReviewResult['handoff'] = 'command') {
    const versions = new Set<number>([versionB, ...touched]);
    if (edits.size) versions.add(latest);

    const batches = [...versions]
      .sort((a, b) => a - b)
      .map((version) => ({
        version,
        annotations: byVersion[version] ?? [],
        general: generalByVersion[version] ?? '',
      }));
    props.onDone({
      action,
      handoff,
      batches,
      version: versionB,
      edits: [...edits].sort(([a], [b]) => a - b).map(([line, text]) => ({ line, text })),
      editedVersion: edits.size ? latest : null,
    });
  }

  /**
   * Ask which way the command goes.
   *
   * The prompt is drawn either way. Where planx cannot start anything — a
   * version captured before it recorded sessions, or by an agent it cannot
   * name — the command is the whole list rather than the second half of one,
   * so it answers to `1`. Skipping the prompt entirely made the review look
   * like it had simply ignored the key.
   */
  function handOff(intent: 'revise' | 'execute') {
    setMode({ kind: 'handoff', intent });
  }

  /* ---------------------------------------------------------- keyboard */

  useInput(
    (input, key) => {
      setStatus(null);

      // Held arrows take more rows the longer they are held, so a plan of two
      // hundred rows is not two hundred repeats. It applies while a selection
      // is live too: that is the same arrow extending the same cursor.
      if (key.downArrow || key.upArrow) {
        const clock = props.now ?? Date.now;
        const { run, step } = pressArrow(heldArrow.current, key.upArrow ? 'up' : 'down', clock());
        heldArrow.current = run;
        return move(key.upArrow ? -step : step);
      }
      // Anything else ends the run — a held `↓` that is let go of and pressed
      // again starts back at one row.
      heldArrow.current = null;

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

      if (input === 'e') return startEdit();
      if (input === 'f') return startFeedback();
      if (input === 'j') return nextFeedback();
      if (input === 'd' && previousVersion !== null) return toggleDiff();
      if (input === 'h') return setHiddenFeedback((on) => !on);
      if (input === 'n') return setMode({ kind: 'note', draft: general, caret: general.length });
      if (input === 's') return canSubmit ? handOff('revise') : undefined;
      if (input === '?') return setMode({ kind: 'help' });
      // Executing with feedback still on screen submits it first. Nothing is
      // lost and nothing is warned about: a plan being built with comments on
      // it is a supported thing now, and the execute skill works them into the
      // build rather than bouncing them back.
      if (input === 'x') return handOff('execute');
    },
    { isActive: mode.kind === 'browse' },
  );

  /**
   * The note box, with a caret in it.
   *
   * It was append-only until now: every arrow key fell through to the browse
   * handler, so `←` walked the document under the box you were typing in, and
   * backspace could only take back the last character you typed. The `e` line
   * editor has had a real caret since it was written; this is the same one.
   *
   * Editing still swallows everything printable, which is the point: `s` has to
   * be the letter s while a note is being written.
   */
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

      const moved = caretKey(mode.draft, mode.caret, input, key);
      if (moved !== null) return setMode({ ...mode, caret: moved });

      if (key.backspace || key.delete) {
        if (mode.caret === 0) return;
        return setMode({
          ...mode,
          draft: `${mode.draft.slice(0, mode.caret - 1)}${mode.draft.slice(mode.caret)}`,
          caret: mode.caret - 1,
        });
      }
      // Ignore the control keys Ink reports as empty input. A pasted chunk
      // arrives whole rather than one keystroke at a time.
      if (input && !key.ctrl && !key.meta) {
        const text = input.replace(/[\r\n]+/g, ' ');
        return setMode({
          ...mode,
          draft: `${mode.draft.slice(0, mode.caret)}${text}${mode.draft.slice(mode.caret)}`,
          caret: mode.caret + text.length,
        });
      }
    },
    { isActive: mode.kind === 'editing' || mode.kind === 'note' },
  );

  /**
   * A line editor, not a note box.
   *
   * The line count of the plan never changes: there is no `enter` that splits a
   * line and no backspace that joins two, so `e` rewrites words and nothing
   * else. Every anchor in the document — a comment's, a lock's — keeps the line
   * number it already had.
   */
  useInput(
    (input, key) => {
      if (mode.kind !== 'line') return;

      // The line goes back to what it said; every line already committed in
      // this walk stays, and the walk ends here rather than opening the next.
      if (key.escape) return setMode({ kind: 'browse' });

      if (key.return) {
        commitLine(mode.line, mode.draft);
        const [next, ...rest] = mode.queue;
        if (next === undefined) return setMode({ kind: 'browse' });
        return openLine(next, rest);
      }

      // The caret, not the version: the mode is explicit, which is what already
      // lets `s` be the letter s while a note is being typed.
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
        const text = input.replace(/[\r\n]+/g, ' ');
        return setMode({
          ...mode,
          draft: `${mode.draft.slice(0, mode.caret)}${text}${mode.draft.slice(mode.caret)}`,
          caret: mode.caret + text.length,
        });
      }
    },
    { isActive: mode.kind === 'line' },
  );

  useInput(
    (input, key) => {
      if (mode.kind === 'help') return setMode({ kind: 'browse' });
      if (mode.kind === 'leave') {
        if (key.return) return finish('back');
        if (key.escape || input === 'n') setMode({ kind: 'browse' });
      }
      if (mode.kind === 'handoff') {
        const action = mode.intent === 'revise' ? 'submit' : 'execute';
        // With no agent to start, the command is the only option, and the only
        // option is `1` — the number is the position in the list on screen.
        if (input === '1') return finish(action, launchable[mode.intent] ? 'agent' : 'command');
        if (input === '2' && launchable[mode.intent]) return finish(action, 'command');
        // Back to the plan, not out of planx: `x` is easy to hit, and the way
        // back from it has to be free. Every other key is ignored rather than
        // falling through to the document underneath.
        if (key.escape) return setMode({ kind: 'browse' });
      }
    },
    { isActive: mode.kind === 'help' || mode.kind === 'leave' || mode.kind === 'handoff' },
  );

  // Folding notes takes rows out from under the cursor — `h` can take dozens —
  // and a cursor past the end draws no arrow at all until the next keypress.
  // Unfolding is the same problem from the other side: the row the cursor was
  // on becomes a box edge, which is not a row it may rest on.
  useEffect(() => {
    const index = settleCursor(rows, selection.cursor);
    if (index !== selection.cursor) jumpTo(index);
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
  const headingLine = foldTarget(cursorRow);
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
            line:
              mode.kind === 'line' && row.newLine === mode.line
                ? { draft: mode.draft, caret: mode.caret }
                : null,
            width: textWidth,
            indent: model.railColumn,
          }),
        ),
    bodyHeight,
  );

  // Never bold. Colour carries the weight — red for what destroys something,
  // yellow for everything else — and a bold row inside a frame reads as a
  // heading, which a question is not.
  const message = leaving
    ? red(EXIT_PROMPT)
    : mode.kind === 'leave'
      ? touched.size || edits.size
        ? red(leaveWarning(touched.size > 0, edits.size))
        : yellow('Back to the list?')
      : // Yellow, the colour the review already uses for a question. Not red:
        // nothing here destroys anything, and red is the leave warning's.
        mode.kind === 'handoff'
        ? yellow(
            mode.intent === 'revise'
              ? `Submit and revise ${props.planId} v${versionB}.`
              : `Execute ${props.planId} v${versionB}.`,
          )
        : statusLine({
            status,
            note: mode.kind === 'note' ? mode.draft : '',
            caret: mode.kind === 'note' ? mode.caret : 0,
            typing: mode.kind === 'note',
            width: inner,
          });

  return (
    <Box flexDirection="column">
      <Text>{topRule(frameWidth, headerText(props, versionA, versionB))}</Text>
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
            anyFeedback: annotations.length > 0,
            heading: headingHint,
            noteFolded,
            // Where `e` cannot work it is not offered: a key that declines one
            // press after being advertised teaches the wrong thing.
            canEdit: versionB === latest,
            annotated: Boolean(annotationAtCursor()),
            selecting: selection.active,
            plural: spanSize(rows, selection) > 1,
            diffing: versionA !== null,
            canDiff: previousVersion !== null,
            manyVersions: props.versions.length > 1,
            canSubmit,
            canLaunch: mode.kind === 'handoff' && launchable[mode.intent],
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

function headerText(props: ReviewAppProps, versionA: number | null, versionB: number): string {
  const versions = `v${versionB}${versionA === null ? '' : ` ← v${versionA}`}`;
  return brandTitle(props.version, `${props.planId}  ${dim(versions)}`);
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
 * What `esc` is about to throw away.
 *
 * A rewritten line counts as much as a note: neither is on disk until `s`, and
 * losing one to a warning that names only the other is the kind of surprise a
 * red line exists to prevent.
 */
function leaveWarning(feedback: boolean, edits: number): string {
  const lost: string[] = [];
  if (feedback) lost.push('Your feedback');
  if (edits) lost.push(`${edits} edited line${edits === 1 ? '' : 's'}`);
  const verb = lost.length > 1 || edits > 1 ? 'have' : 'has';
  return `Back to the list? ${lost.join(' and ')} ${verb} not been submitted and will be lost.`;
}

/* ------------------------------------------------------------------ rows */

interface RowOptions {
  cursor: boolean;
  selected: boolean;
  editing: boolean;
  /** This row is the line being rewritten: its draft, and where the caret is. */
  line?: { draft: string; caret: number } | null;
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
    const text =
      opts.editing && row.caret !== null
        ? boxBody(row.text, row.caret, box)
        : padEnd(truncate(row.text, box), box);
    return `${arrow} ${pad}${signal('│')} ${text} ${signal('│')}`;
  }

  const gutter = opts.cursor ? row.gutterActive : row.gutter;
  // The line being rewritten shows its raw markdown source — the `##`, the
  // backticks, the text as it is stored — because that is what is being typed
  // at. Highlighting it would draw one thing and edit another.
  if (opts.line) {
    const rail = row.rail ? signal('│') : ' ';
    return `${arrow} ${gutter}${rail} ${caretLine(opts.line.draft, opts.line.caret, opts.width)}`;
  }
  const text = truncate(opts.selected ? inverse(stripAnsi(row.text)) : row.text, opts.width);
  // A collapsed run and a folded section are not lines of the document — no
  // number, no lock, no note — so they get no rail column either, and their
  // marker starts where a line number would.
  if (row.gapIndex !== null || row.fold !== null) return `${arrow} ${gutter}${text}`;

  const rail = row.rail ? signal('│') : ' ';
  return `${arrow} ${gutter}${rail} ${text}`;
}

/**
 * A row of the note box with the caret drawn on it, padded to the box.
 *
 * The caret goes *over* a column rather than after the text, so the row is the
 * width it would be without one — which is what lets the box wrap to its full
 * width whether or not it is being typed into. A caret past the last character
 * of a row that fills the box holds on that last column rather than scrolling
 * the text out from under it: there is nowhere further right to go, and a note
 * that shifts sideways for one keystroke is worse than a caret that stops.
 */
function boxBody(text: string, caret: number, box: number): string {
  if (text.length > box) return padEnd(caretLine(text, caret, box + 1), box);
  const padded = padEnd(text, box);
  const at = Math.min(caret, box - 1);
  return `${padded.slice(0, at)}${inverse(padded[at] ?? ' ')}${padded.slice(at + 1)}`;
}

/**
 * The line being rewritten, scrolled horizontally under the caret.
 *
 * A line wider than the text column runs off the right edge, and a caret you
 * cannot see is a caret you cannot type at — so the window follows it, pinning
 * it to the last column once there is more line than there is room.
 */
function caretLine(draft: string, caret: number, width: number): string {
  const room = Math.max(1, width - 1);
  const start = Math.max(0, caret - room + 1);
  const visible = draft.slice(start, start + room);
  const at = caret - start;
  return `${visible.slice(0, at)}${inverse(draft[caret] ?? ' ')}${visible.slice(at + 1)}`;
}

/* --------------------------------------------------------------- chrome */

/** The yellow label that says which of the two notes this row is. */
const NOTE_LABEL = 'Global Note: ';

interface StatusOptions {
  status: string | null;
  /** The whole-plan note as it is being typed, while `n` is open. */
  note: string;
  /** Where the caret sits in it. */
  caret: number;
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
    // The window follows the caret rather than pinning to the tail: with the
    // caret movable, the end of a long note is no longer the only place you can
    // be typing.
    const room = Math.max(8, opts.width - NOTE_LABEL.length);
    return yellow(`${NOTE_LABEL}${caretLine(opts.note, opts.caret, room)}`);
  }
  if (opts.status) return signal(truncate(opts.status, opts.width));
  return '';
}

interface SummaryOptions {
  count: number;
  note: string;
  /** Lines rewritten on this version and not yet submitted. */
  edits: number;
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
  if (opts.edits) {
    out.push(dim(`${opts.edits} line${opts.edits === 1 ? '' : 's'} edited on this version.`));
  }
  if (opts.note.trim()) {
    out.push(...wrapComment(`${NOTE_LABEL}${opts.note.trim()}`, opts.width).map((l) => yellow(l)));
  }
  return out;
}

interface HintContext {
  /** There is feedback to walk, so `j` has somewhere to go. */
  anyFeedback: boolean;
  /** What `space` would do to the section under the cursor, if it is a heading. */
  heading: 'fold' | 'unfold' | null;
  /** The note under the cursor is already folded, so `space` opens it. */
  noteFolded: boolean;
  /** `e` can work here: the latest version of the plan. */
  canEdit: boolean;
  annotated: boolean;
  /** A selection is live, so `v` ends it rather than starting one. */
  selecting: boolean;
  /** What `l` would act on covers more than one line. */
  plural: boolean;
  diffing: boolean;
  canDiff: boolean;
  manyVersions: boolean;
  /** This version carries something `s` would write. */
  canSubmit: boolean;
  /** planx could start an agent for the intent the prompt is asking about. */
  canLaunch: boolean;
}

/**
 * The hints offer what this row can actually do, in the one order.
 *
 * Approval is conditional — approving a plan you have notes on would say the
 * plan is settled while asking for it to change — and `d` is missing on v1
 * rather than bound to an apology. Showing keys that refuse to work teaches the
 * wrong thing.
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
  if (mode.kind === 'line')
    return [
      ['enter', 'save line'],
      ['esc', 'discard'],
    ];
  if (mode.kind === 'leave')
    return [
      ['enter', 'back'],
      ['esc', 'stay'],
    ];
  // Where planx can start something, the command is the second option; where it
  // cannot, the command is the only one and takes the first number. The prompt
  // is drawn either way — the question is still worth asking, and a key that
  // silently did nothing read as a bug.
  if (mode.kind === 'handoff')
    return ctx.canLaunch
      ? [
          ['1', mode.intent === 'revise' ? 'revise in the agent' : 'execute in a new agent'],
          ['2', 'give me the command'],
          ['esc', 'back'],
        ]
      : [
          ['1', 'give me the command'],
          ['esc', 'back'],
        ];
  if (mode.kind === 'help') return [['any key', 'to close']];

  const hints: Hint[] = [
    ['n', 'note'],
    ['x', 'execute'],
    ['esc', 'back'],
  ];

  // Folding is offered on the box, which the cursor can now reach — a document
  // line beside a note is a line, and the note has a row of its own. `space`
  // names what it folds rather than saying `fold`, because there are two kinds
  // of fold now and the cursor is what decides between them.
  if (row?.kind === 'feedback') {
    hints.push(['space', ctx.noteFolded ? 'unfold feedback' : 'fold feedback'], ['f', 'edit']);
  } else if (standsInForHiddenLines(row)) {
    // Nothing on a stand-in row can be commented on, so `f` is not offered.
    // `space` is the only key that means anything here.
    hints.push(
      ['space', ctx.heading ? 'unfold section' : 'expand'],
      ['v', ctx.selecting ? 'unselect lines' : 'select lines'],
    );
  } else {
    const lines = ctx.plural ? 'lines' : 'line';
    if (ctx.heading) hints.push(['space', `${ctx.heading} section`]);
    hints.push(['v', ctx.selecting ? 'unselect lines' : 'select lines']);
    hints.push(['f', ctx.annotated ? 'edit' : 'feedback']);
    if (ctx.canEdit) hints.push(['e', `rewrite ${lines}`]);
  }

  if (ctx.anyFeedback) hints.push(['j', 'next feedback']);
  if (ctx.canDiff) hints.push(['d', ctx.diffing ? 'hide diff' : 'show diff']);
  if (ctx.manyVersions) hints.push(['←→', 'version']);
  // Submitting is offered where there is something to submit. An empty submit
  // used to be how you said the plan was fine; `x` is that now.
  if (ctx.canSubmit) hints.push(['s', 'submit']);
  hints.push(['?', 'help']);
  return hints;
}

/** A collapsed run or a folded section: a row that stands in for hidden lines. */
function standsInForHiddenLines(row: ViewRow | undefined): boolean {
  return row?.kind === 'doc' && (row.gapIndex !== null || row.fold !== null);
}

/**
 * The widest bar browse mode can produce, for the height to be reserved from.
 *
 * It is one real hint set rather than the union of all of them: a heading on a
 * version carrying feedback, with every either/or resolved to the longer side.
 * That branch offers the most keys of any row — `space` for the section on top
 * of the ones a document line always has — and `j` rides along with it, so
 * nothing the cursor can land on needs more rows than this.
 */
function widestHints(ctx: Pick<HintContext, 'canDiff' | 'manyVersions'>): Hint[] {
  const hints: Hint[] = [
    ['n', 'note'],
    ['x', 'execute'],
    ['esc', 'back'],
    ['space', 'unfold section'],
    ['v', 'unselect lines'],
    ['e', 'rewrite lines'],
    ['f', 'feedback'],
    ['j', 'next feedback'],
  ];
  if (ctx.canDiff) hints.push(['d', 'show diff']);
  if (ctx.manyVersions) hints.push(['←→', 'version']);
  hints.push(['s', 'submit'], ['?', 'help']);
  return hints;
}

/**
 * Where a keypress moves the caret, or null when it is not a caret key.
 *
 * Option+arrow reaches the process two ways depending on how the terminal is
 * configured: `\x1b[1;3D`, which Ink reports as an arrow with `meta` set, and
 * `\x1bb`, which arrives as the input `b` with `meta` set. Both are bound,
 * because which one you get is a setting nobody remembers changing.
 *
 * Cmd+arrow is not here and cannot be: Terminal.app and iTerm both consume it
 * before it reaches the process, so there is no escape sequence to bind.
 */
function caretKey(draft: string, caret: number, input: string, key: Key): number | null {
  const word = key.meta || input === 'b' || input === 'f';
  if (key.leftArrow || (key.meta && input === 'b')) {
    return word ? wordStartBefore(draft, caret) : Math.max(0, caret - 1);
  }
  if (key.rightArrow || (key.meta && input === 'f')) {
    return word ? wordStartAfter(draft, caret) : Math.min(draft.length, caret + 1);
  }
  if (key.ctrl && input === 'a') return 0;
  if (key.ctrl && input === 'e') return draft.length;
  return null;
}

/** The start of the run of non-whitespace before the caret. */
function wordStartBefore(text: string, caret: number): number {
  let i = caret;
  while (i > 0 && /\s/.test(text[i - 1]!)) i--;
  while (i > 0 && !/\s/.test(text[i - 1]!)) i--;
  return i;
}

/** The start of the next run of non-whitespace after the caret. */
function wordStartAfter(text: string, caret: number): number {
  let i = caret;
  while (i < text.length && !/\s/.test(text[i]!)) i++;
  while (i < text.length && /\s/.test(text[i]!)) i++;
  return i;
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

/**
 * Every key, in the same order the hint line puts them.
 *
 * `versioned` marks the ones that only exist on a plan with history. The list
 * is sorted through `orderHints` rather than written in order, so `?` and the
 * hints cannot drift apart.
 */
const HELP: Array<[Hint, 'always' | 'versioned']> = [
  [['←→', 'the previous and next version of the plan'], 'versioned'],
  [['↑↓', 'a row at a time — held, 2 rows after 1.5s and 5 after 4s'], 'always'],
  [['d', 'show the diff against the previous version, or hide it'], 'versioned'],
  [['e', 'rewrite the line, or every line of the selection, in place'], 'always'],
  [['f', 'feedback on the selection, or edit the note under the cursor'], 'always'],
  [['g G', 'the top and the bottom of the plan'], 'always'],
  [['^d ^u', 'half a screen down or up'], 'always'],
  [['^f ^b', 'a whole screen down or up'], 'always'],
  [['h', 'fold or unfold every note at once'], 'always'],
  [['j', 'the next feedback on this version, wrapping at the end'], 'always'],
  [['n', 'a note about the whole plan'], 'always'],
  [['s', 'submit everything at once'], 'always'],
  [['space', 'fold the section or the note, or expand the run, under the cursor'], 'always'],
  [['v', 'start or end a selection, then ↑ ↓ to extend'], 'always'],
  [['x', 'execute this plan, in a new agent or as a command'], 'always'],
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
    dim('a note box is one stop for the cursor, on its first line of text.'),
    dim('inside a note or a line: ← → ⌥← ⌥→ move the caret, ^a ^e reach its ends.'),
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
