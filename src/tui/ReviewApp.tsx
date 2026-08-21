import { Box, Text, useApp, useInput, useStdout, type Key } from 'ink';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildAnnotation } from '../protocol/submit.js';
import {
  blue,
  bold,
  caretLine,
  dim,
  gray,
  inverse,
  padEnd,
  red,
  signal,
  stripAnsi,
  truncate,
  yellow,
} from '../render/ansi.js';
import type { RenderMode } from '../render/diff.js';
import type { DefaultKey } from '../store/defaults.js';
import type { LineEdit } from '../store/plans.js';
import { contextSha } from '../store/text.js';
import type { Annotation, Feedback } from '../store/types.js';
import { EXIT_PROMPT, useDoubleCtrlC } from './exit.js';
import { bottomRule, brandTitle, frameLine, FRAME_PADDING, REPO_FOOTER, topRule } from './frame.js';
import {
  HIDE_HINTS,
  hintFooter,
  hintLines,
  isHintToggle,
  orderHints,
  typable,
  type Hint,
} from './hints.js';
import {
  BOX_PADDING,
  buildModel,
  caretPosition,
  enclosingHeading,
  foldEnd,
  wrapComment,
  wrapLines,
  type ViewRow,
} from './model.js';
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
  /**
   * Whether the reviewer changed this version's feedback at all.
   *
   * An empty batch is two different things: the version you happened to finish
   * on, which has nothing to announce, and one whose last comment you deleted,
   * which is a write worth reporting — the record was rewritten and the comment
   * is gone for good.
   */
  touched: boolean;
}

/**
 * Per version: the launch line for each intent, or null where planx cannot
 * build one — no session recorded to resume, no agent named on the version.
 *
 * The commands themselves rather than a pair of flags, because they are what
 * the list shows, what the reviewer edits and what planx ends up running. A
 * null is an entry the list does not draw, so there is no second source of
 * truth about what can be started.
 */
export type Commands = Record<
  number,
  {
    revise: string | null;
    execute: string | null;
    /** The stored revise command with its own prompt appended. */
    customRevise: string | null;
    /** The stored execute command with its own prompt appended. */
    customExecute: string | null;
  }
>;

export interface ReviewResult {
  /**
   * What the reviewer picked off the hand-off list. `back` means the plan list
   * again, with nothing submitted; the other three all write everything first
   * and differ only in what happens next to the plan.
   */
  action: 'revise' | 'execute' | 'commands' | 'back';
  /** The launch line, as the reviewer left it. Only on revise and execute. */
  command: string | null;
  /**
   * The default the picked row was composed from, or null on everything planx
   * built itself. It is what the CLI writes an edited command back to — the
   * review names the field and does no reading or writing of its own.
   */
  custom: DefaultKey | null;
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
   * The launch line for each intent, per version, planx's own and yours. Where
   * planx cannot build one — no session recorded to resume, no agent named on
   * the version, no command stored — the entry is not offered at all rather
   * than being drawn and declining a press.
   */
  commands?: Commands;
  /**
   * Whether the hint rows are drawn. The store holds the last answer, so the
   * choice survives the next `planx`; the screen owns the live state and reports
   * every change, which keeps the write on the CLI side of the seam.
   */
  hints?: boolean;
  onHintsChange?: (shown: boolean) => void;
  /** What a second ctrl+c does. Defaults to ending the process with 130. */
  onQuit?: () => void;
  /** How long the ctrl+c guard stays armed. Defaults to two seconds. */
  exitWindowMs?: number;
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
   * `s` asking what happens next to this plan.
   *
   * One vertical list, drawn over the last rows of the plan rather than in a
   * screen of its own, so the document stays visible behind it. `editing` is
   * which side of the list the keyboard is on: the entries, or the command the
   * highlighted one would run.
   */
  | { kind: 'handoff'; entries: HandoffEntry[]; index: number; editing: boolean; caret: number }
  | { kind: 'help' };

type HandoffMode = Extract<Mode, { kind: 'handoff' }>;

/** One thing that can happen next, and the line that would make it happen. */
interface HandoffEntry {
  /** `commands` copies its line to the clipboard instead of running it. */
  action: 'revise' | 'execute' | 'commands';
  label: string;
  /** The launch line as it stands, rewritten in place. */
  command: string;
  /** What planx built, so `esc` in the editor can put it back. */
  original: string;
  /**
   * The default this row was composed from, or null on the rows planx built
   * from the version itself. Editing one of those changes nothing on disk: a
   * `--resume` line is composed per version and has no field to be stored in.
   */
  custom: DefaultKey | null;
}

/**
 * A copy row shows its command and will not open it.
 *
 * Editing a line you are about to put on the clipboard and not run is editing
 * the wrong copy of it — the one you paste is the one you would then have to
 * fix again in the shell. `→` is not offered there, and the hint bar says
 * `enter copy` rather than `enter go`.
 */
function editable(entry: HandoffEntry): boolean {
  return entry.action !== 'commands';
}

/**
 * What `space` would do where the cursor is.
 *
 * `folded` is which way it goes, which is the only thing about it you cannot
 * see — what it acts on is the row you are pointing at.
 */
type SpaceAction =
  | { kind: 'gap'; gap: number }
  | { kind: 'note'; id: string; folded: boolean }
  /** `inside` marks a section reached from one of its own lines, not its heading. */
  | { kind: 'section'; heading: number; folded: boolean; inside?: boolean };

/**
 * Top rule, the blank under it, the blank between the body and its tail, and
 * the bottom rule. The hand-off moves that middle blank below its list instead.
 *
 * The hint bar and whatever the version says about itself are added on top of
 * these four rows. Counting what is actually drawn keeps the last hint against
 * the bottom rule instead of hiding an unused status row underneath it.
 */
const CHROME_AROUND_BODY = 4;
const MIN_BODY = 5;
const MIN_WIDTH = 48;
/** The cursor arrow and the space after it. */
const CURSOR_GUTTER = 2;

const NO_ANNOTATIONS: Annotation[] = [];
const NO_EDITS: ReadonlyMap<number, string> = new Map();
const NO_COMMANDS: Commands[number] = {
  revise: null,
  execute: null,
  customRevise: null,
  customExecute: null,
};

export function ReviewApp(props: ReviewAppProps) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  // Above every mode-scoped handler below, so it fires whatever is being typed.
  const leaving = useDoubleCtrlC({ onExit: props.onQuit, windowMs: props.exitWindowMs });

  const [showHints, setShowHints] = useState(props.hints ?? true);
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
  /** A section just collapsed from inside, whose stand-in row the cursor follows. */
  const [pendingFold, setPendingFold] = useState<number | null>(null);
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

  // What the version has to say about itself, drawn between the status line and
  // the hints. A function of the version and not of the cursor.
  //
  // The note is typed where it is read: the draft replaces the stored text in
  // the same block, wrapped the same way, with the caret in it. It used to be
  // written on the status row above while the saved note stayed drawn below,
  // so editing showed you the note twice — the old one and the one replacing
  // it — and neither of them where a note lives.
  const noteDraft = mode.kind === 'note' ? mode.draft : null;
  const noteCaret = mode.kind === 'note' ? mode.caret : 0;
  const summary = useMemo(
    () =>
      summaryLines({
        count: annotations.length,
        note: general,
        draft: noteDraft === null ? null : { text: noteDraft, caret: noteCaret },
        edits: shownEdits.size,
        width: inner,
      }),
    [annotations.length, general, noteDraft, noteCaret, shownEdits.size, inner],
  );

  const asking = mode.kind === 'leave' || mode.kind === 'handoff';

  // Never bold. Colour carries the weight — red for what destroys something,
  // yellow for everything else — and a bold row inside a frame reads as a
  // heading, which a question is not.
  const message =
    mode.kind === 'leave'
      ? touched.size || edits.size
        ? red(leaveWarning(touched.size > 0, edits.size))
        : yellow('Back to the list?')
      : // The hand-off list carries its own question, on its own first line, so
        // this row stays empty while the list is up.
        mode.kind === 'handoff'
        ? ''
        : statusLine({ status, width: inner });

  /** What sits under the plan, with empty status rows omitted entirely. */
  const tail = [...(message ? [message] : []), ...(asking ? [] : summary)];

  // What space would do where the cursor is, so the hint says it rather than
  // making you press it to find out.
  const space = spaceAction();
  const hintRows = leaving
    ? [red(EXIT_PROMPT)]
    : !showHints
      ? []
      : hintLines(
          hintsFor(mode, rows[selection.cursor], {
            anyFeedback: annotations.length > 0,
            space,
            // Where `e` cannot work it is not offered: a key that declines one
            // press after being advertised teaches the wrong thing.
            canEdit: versionB === latest,
            canAnnotate: spanAtCursor(rows, selection) !== null,
            annotated: Boolean(annotationAtCursor()),
            hasNote: general.trim().length > 0,
            selecting: selection.active,
            plural: spanSize(rows, selection) > 1,
            diffing: versionA !== null,
            canDiff: previousVersion !== null,
            manyVersions: props.versions.length > 1,
          }),
          inner,
        ).map((line) => (line ? dim(line) : ''));

  const bodyHeight = Math.max(
    MIN_BODY,
    (stdout?.rows ?? 24) - CHROME_AROUND_BODY - hintRows.length - tail.length,
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
   * for an arrow key and wrong for a pager: the first ctrl+j from the top of a
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
   * Space acts on what is under the cursor, and the bar says which way it goes.
   *
   * The key is one function so the hint and the keypress cannot disagree about
   * whether space does anything here — the bar reads this, and so does the
   * handler.
   */
  function spaceAction(): SpaceAction | null {
    const row = rows[selection.cursor];

    // Where something is hidden under the cursor, space brings it back. That
    // reading wins over every other: the dim row a fold left behind, and the
    // row standing in for a collapsed run, are on screen saying what they hide.
    if (row?.kind === 'doc') {
      if (row.fold !== null) return { kind: 'section', heading: row.fold, folded: true };
      if (row.gapIndex !== null) return { kind: 'gap', gap: row.gapIndex };
    }

    // The heading wins over a note that happens to cover it. A heading is the
    // row you press space on to move past a whole section, and that reading has
    // to hold whether or not somebody left a comment on the heading line — the
    // note still has its own box, one row down, where space folds the note.
    if (row?.kind === 'doc' && row.newLine !== null && canFold(row.newLine)) {
      return { kind: 'section', heading: row.newLine, folded: foldedSections.has(row.newLine) };
    }

    // Any row of the box does it, not only the line it hangs off — the cursor
    // can reach the box now, and a key that works on the thing you are pointing
    // at is the one that needs no explaining.
    const note = annotationAtCursor();
    if (note) {
      return {
        kind: 'note',
        id: note.id,
        folded: hiddenFeedback || collapsedFeedback.has(note.id),
      };
    }

    // Anywhere else in the document: the section you are standing in. Folding
    // what you have just read used to mean scrolling back to its heading first,
    // which is a trip up the plan to do something to the part you are looking at.
    if (row?.kind === 'doc' && row.newLine !== null) {
      const heading = enclosingHeading(model.docLines, row.newLine);
      if (heading !== null) {
        return { kind: 'section', heading, folded: foldedSections.has(heading), inside: true };
      }
    }
    return null;
  }

  function toggleFold() {
    const action = spaceAction();
    if (action === null) return;

    if (action.kind === 'gap') {
      // A gap only expands: once it has, the row that stood for it is gone, and
      // there is nothing left under the cursor to press space on.
      return setExpandedGaps((set) => new Set(set).add(action.gap));
    }

    if (action.kind === 'note') {
      const id = action.id;
      // Folding from inside the box takes it down to one row, so the cursor
      // moves to where the box starts rather than to whatever line happens to
      // slide up underneath it. Unfolding lands there too, and the settling
      // that follows a rebuild carries it onto the note's reopened first line.
      if (rows[selection.cursor]?.kind === 'feedback') {
        jumpTo(rows.findIndex((r) => r.kind === 'feedback' && r.annotationId === id));
      }
      return setCollapsedFeedback((set) => (set.has(id) ? without(set, id) : withId(set, id)));
    }

    const heading = action.heading;
    // Collapsing from inside takes the cursor's own rows away with the section,
    // so it follows the collapse onto the row that now stands for where it was.
    // The jump is explicit because settling only clamps: it would leave the
    // cursor wherever the rows below the fold happened to slide up to.
    if (action.inside && !action.folded) setPendingFold(heading);
    setFoldedSections((set) =>
      set.has(heading) ? withoutLine(set, heading) : new Set(set).add(heading),
    );
  }

  /** Is there a section rooted at this line for `space` to hide? */
  function canFold(line: number): boolean {
    return foldEnd(model.docLines, line) !== null;
  }

  /**
   * The line the cursor is over, looking back past the rows that carry none.
   *
   * A collapsed run, a folded section and a note box all stand for lines
   * without being one, and the nearest line above is where each of them sits in
   * the document. Answering 0 for them instead would send `j` back to the top
   * of the plan from halfway down it.
   */
  function lineAtCursor(): number {
    for (let i = Math.min(selection.cursor, rows.length - 1); i >= 0; i--) {
      const line = rows[i]?.newLine;
      if (line !== null && line !== undefined) return line;
    }
    return 0;
  }

  /**
   * `j` walks the feedback, forward, wrapping at the end.
   *
   * Forward only: with a wrap there is nothing a backward key would reach that
   * pressing this one again does not, and a second key for the same walk is a
   * letter of the keyboard spent on symmetry.
   *
   * A comment hidden inside a folded section or a collapsed run of unchanged
   * lines is opened up on the way — the alternative is a key that silently
   * declines to visit feedback you cannot see, which is exactly the feedback
   * worth being taken to. Silently, because a note nothing has drawn is a note
   * the jump below cannot find a row for: leaving the run shut is what made the
   * wrap at the end of a diff look like a dead key.
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
        ? (ordered.find((a) => a.anchor.end_line > lineAtCursor()) ?? ordered[0]!)
        : ordered[(index + 1) % ordered.length]!;

    for (const line of foldedSections) {
      const end = foldEnd(model.docLines, line);
      if (end !== null && target.anchor.end_line > line && target.anchor.end_line <= end) {
        setFoldedSections((set) => withoutLine(set, line));
      }
    }
    // A note hangs off the last line it covers, so the run to open is the one
    // holding that line.
    const gap = model.blocks.findIndex(
      (block, at) =>
        block.kind === 'gap' &&
        !expandedGaps.has(at) &&
        block.rows.some((r) => r.newLine === target.anchor.end_line),
    );
    if (gap !== -1) setExpandedGaps((set) => new Set(set).add(gap));

    // The row it lands on may not exist until the fold and the run above are
    // gone, so the jump waits for the rows to be rebuilt rather than guessing
    // an index.
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
  function finish(
    action: ReviewResult['action'],
    command: string | null = null,
    custom: DefaultKey | null = null,
  ) {
    const versions = new Set<number>([versionB, ...touched]);
    if (edits.size) versions.add(latest);

    const batches = [...versions]
      .sort((a, b) => a - b)
      .map((version) => ({
        version,
        annotations: byVersion[version] ?? [],
        general: generalByVersion[version] ?? '',
        touched: touched.has(version),
      }));
    props.onDone({
      action,
      command,
      custom,
      batches,
      version: versionB,
      edits: [...edits].sort(([a], [b]) => a - b).map(([line, text]) => ({ line, text })),
      editedVersion: edits.size ? latest : null,
    });
  }

  /**
   * Open the list of what can happen next to this plan.
   *
   * From any row of any version, whether or not there is anything to submit.
   * By the time you are done reading a plan the question is not which key you
   * pressed but what happens to it next, so there is one key that asks it.
   */
  function handOff() {
    setMode({ kind: 'handoff', entries: handoffEntries(), index: 0, editing: false, caret: 0 });
  }

  /**
   * What can happen next, in order, each dropped where it cannot work.
   *
   * A line rewritten with `e` does not bring `Revise` back. The edit *is* the
   * change — settled text, already in the version — so there is nothing left to
   * ask an agent for. A comment and the note are requests, and a request needs
   * a round.
   *
   * Where planx cannot start something it is not offered: a version captured
   * before planx recorded sessions shows `Execute` and the command, one that
   * names no agent shows neither. Nothing greyed out, nothing that declines a
   * press after advertising itself — which is why the numbers are positional
   * and not fixed: `1` is whatever is first here, not always Revise.
   *
   * Every intent planx can build appears twice, once to run and once to hand
   * its slash command to an agent — and above all of them, the commands you
   * stored yourself, which survive a version planx can start nothing for.
   * A version with nothing to start still has one row, because the way back
   * into the review is a command too and a list you cannot answer is not a
   * question.
   */
  function handoffEntries(): HandoffEntry[] {
    const lines = props.commands?.[versionB] ?? NO_COMMANDS;
    const asking = annotations.length > 0 || general.trim().length > 0;
    const revise = asking ? lines.revise : null;
    // Custom revise still waits for something to revise: without a comment or a
    // note there is no request to send, whichever agent would receive it.
    const customRevise = asking ? lines.customRevise : null;
    const entries: HandoffEntry[] = [];

    // Yours first, so a reviewer who set one gets it at `1`. They answer to
    // less than planx's own rows do — the command names its own agent, so it
    // needs neither the recorded session nor a launcher planx knows about.
    if (customRevise) {
      entries.push(entry('revise', 'Revise using custom command', customRevise, 'revise_command'));
    }
    if (lines.customExecute) {
      entries.push(
        entry('execute', 'Execute using custom command', lines.customExecute, 'execute_command'),
      );
    }

    if (revise) entries.push(entry('revise', 'Revise plan in the session that wrote it', revise));
    if (lines.execute) {
      entries.push(entry('execute', 'Execute plan in a new session', lines.execute));
    }
    if (revise) {
      entries.push(
        entry('commands', 'Copy revise command for agent', `/planx revise ${props.planId}`),
      );
    }
    // The skill, not the launch line: these are pasted into an agent that is
    // already running, where `claude` and its flags are the wrong half of the
    // command. The rows above are the terminal launch lines.
    if (lines.execute) {
      entries.push(
        entry(
          'commands',
          'Copy execute skill for agent',
          `/planx execute ${props.planId} v${versionB}`,
        ),
      );
    }

    // Not `no entries at all`: a version planx cannot start keeps its way back
    // into the review even when custom rows have given the list something to
    // answer. What the fallback is about is the rows planx built from the
    // version itself, and those are exactly these two.
    if (!revise && !lines.execute) {
      entries.push(entry('commands', 'Copy reopen command', `planx ${props.planId} v${versionB}`));
    }
    return entries;
  }

  /* ---------------------------------------------------------- keyboard */

  /**
   * The hint rows, away and back — above every mode-scoped handler below, so it
   * fires while a note or a line is being typed as well as on the plan.
   *
   * Except on the help screen, whose bar says `any key to close` and whose next
   * press is a key: one press, one effect.
   */
  useInput((input, key) => {
    if (mode.kind === 'help' || !isHintToggle(input, key)) return;
    const next = !showHints;
    setShowHints(next);
    props.onHintsChange?.(next);
  });

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

      // A screen at a time, on the two letters that sit next to each other and
      // already mean down and up. On a Mac keyboard PageUp is fn+arrow, which in
      // practice means it does not exist, and Ink redraws in place so the
      // terminal's own scrollback shows stale frames rather than more plan.
      //
      // ctrl+j is a linefeed on the wire, which Ink reports as a bare `\n` with
      // no ctrl flag; enter is a carriage return and stays its own key, so the
      // two do not collide. Terminals that speak the kitty protocol send the
      // modified letter instead, so both spellings are taken.
      if (input === '\n' || (key.ctrl && input === 'j')) return page(bodyHeight);
      if (key.ctrl && input === 'k') return page(-bodyHeight);
      if (key.pageDown) return page(bodyHeight);
      if (key.pageUp) return page(-bodyHeight);
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
      // The one way out with something to say, on every row. Whatever is pending
      // is submitted whichever entry the list ends on — including with feedback
      // still open on a plan you are about to build, which is supported: the
      // execute skill works the comments into the build.
      if (input === 's') return handOff();
      if (input === '?') return setMode({ kind: 'help' });
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
      //
      // `0x1f` reaches here with `key.ctrl` false, so the toggle would type
      // itself into the draft. It is filtered after the newlines are folded to
      // spaces, so a pasted chunk keeps its word breaks.
      if (input && !key.ctrl && !key.meta) {
        const text = typable(input.replace(/[\r\n]+/g, ' '));
        if (!text) return;
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
        const text = typable(input.replace(/[\r\n]+/g, ' '));
        if (!text) return;
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
    },
    { isActive: mode.kind === 'help' || mode.kind === 'leave' },
  );

  /**
   * The hand-off list, and the command editor inside it.
   *
   * Anything unbound is ignored rather than falling through to the document
   * underneath. The rows are numbered, so the numbers answer: a list that
   * prints `1.` beside a row and then only moves for `↑↓` is teaching a key
   * that does not exist.
   */
  useInput(
    (input, key) => {
      if (mode.kind !== 'handoff') return;
      const here = mode.entries[mode.index];
      if (!here) return;

      if (!mode.editing) {
        if (key.upArrow) return setMode({ ...mode, index: Math.max(0, mode.index - 1) });
        if (key.downArrow) {
          return setMode({ ...mode, index: Math.min(mode.entries.length - 1, mode.index + 1) });
        }
        // The number picks and fires in one press: it is the whole point of
        // numbering the rows, and walking to a row you can already name is
        // work the list invented for itself.
        const picked = /^[1-9]$/.test(input) ? mode.entries[Number(input) - 1] : undefined;
        if (picked) return finish(picked.action, picked.command, picked.custom);
        // Into the line itself, to change the model, add a directory, rewrite
        // the prompt, or replace the command outright.
        if (key.rightArrow && editable(here)) {
          return setMode({ ...mode, editing: true, caret: here.command.length });
        }
        if (key.return) return finish(here.action, here.command, here.custom);
        // Back to the plan, on the row you were on — not out of planx.
        if (key.escape) return setMode({ kind: 'browse' });
        return;
      }

      const command = here.command;
      // The edit survives arrowing away to another entry and back; `esc` is what
      // throws it away, and it puts back the line planx built.
      if (key.escape) {
        return setMode({ ...withCommand(mode, here.original), editing: false, caret: 0 });
      }
      if (key.upArrow || key.downArrow) return setMode({ ...mode, editing: false });
      if (key.return) {
        // Nothing to run, so nothing happens. The list is still there.
        if (!command.trim()) return;
        return finish(here.action, command, here.custom);
      }
      // `←` at the start of the line is the way back out of it, which is the
      // same key that got you here, reversed.
      if (key.leftArrow && !key.meta && mode.caret === 0) {
        return setMode({ ...mode, editing: false });
      }

      const moved = caretKey(command, mode.caret, input, key);
      if (moved !== null) return setMode({ ...mode, caret: moved });

      if (key.backspace || key.delete) {
        if (mode.caret === 0) return;
        return setMode({
          ...withCommand(mode, `${command.slice(0, mode.caret - 1)}${command.slice(mode.caret)}`),
          caret: mode.caret - 1,
        });
      }
      if (input && !key.ctrl && !key.meta) {
        const text = typable(input.replace(/[\r\n]+/g, ' '));
        if (!text) return;
        return setMode({
          ...withCommand(
            mode,
            `${command.slice(0, mode.caret)}${text}${command.slice(mode.caret)}`,
          ),
          caret: mode.caret + text.length,
        });
      }
    },
    { isActive: mode.kind === 'handoff' },
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

  // The row it lands on does not exist until the fold has been built, so this
  // waits for the rows rather than guessing an index.
  useEffect(() => {
    if (pendingFold === null) return;
    const index = rows.findIndex((r) => r.kind === 'doc' && r.fold === pendingFold);
    setPendingFold(null);
    if (index !== -1) jumpTo(index);
  }, [rows, pendingFold, jumpTo]);

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

  /**
   * One array rather than groups of rows, because the hand-off list has to be
   * able to reach into the bottom of the body. Its separating blank belongs
   * below the list, immediately above the hints; the other screens put theirs
   * between the document and the summary or question.
   */
  const frameRows = (() => {
    if (mode.kind !== 'handoff') return [...body, '', ...tail];

    // On a page too short to hold the whole block the question is what goes:
    // the answers are the part you cannot act without.
    const block = [
      '',
      ...handoffLines(mode, {
        question: `Submit ${props.planId} v${versionB}`,
        width: inner,
      }),
    ].slice(-bodyHeight);
    const above = bodyHeight - block.length;
    return [...body.slice(0, above), ...Array(Math.max(0, above - body.length)).fill(''), ...block];
  })();

  return (
    <Box flexDirection="column">
      <Text>{topRule(frameWidth, headerText(props, versionA, versionB))}</Text>
      <Text>{frameLine('', inner)}</Text>
      {frameRows.map((line, i) => (
        <Text key={i}>{frameLine(line, inner)}</Text>
      ))}
      {mode.kind === 'handoff' ? <Text>{frameLine('', inner)}</Text> : null}
      {/*
        An armed ctrl+c takes the hint bar rather than a row of its own. The
        row it used to have was reserved on every frame and empty on almost all
        of them, which is a line of the plan spent on a question nobody has
        asked yet — and the hints are the one thing on screen it is safe to
        interrupt, because `ctrl+c exit` is what they were saying anyway.
      */}
      {hintRows.map((line, i) => (
        <Text key={i}>{frameLine(line, inner)}</Text>
      ))}
      <Text>{bottomRule(frameWidth, REPO_FOOTER, hintFooter(showHints))}</Text>
    </Box>
  );
}

function entry(
  action: HandoffEntry['action'],
  label: string,
  command: string,
  custom: DefaultKey | null = null,
): HandoffEntry {
  return { action, label, command, original: command, custom };
}

/** The list with the highlighted entry's command replaced by what was typed. */
function withCommand(mode: HandoffMode, command: string): HandoffMode {
  return {
    ...mode,
    entries: mode.entries.map((e, i) => (i === mode.index ? { ...e, command } : e)),
  };
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

/* ------------------------------------------------------- the hand-off */

/** Columns between the longest label and the command column. */
const COMMAND_GAP = 3;
/** `1. ` — the number every row is answerable by. */
const NUMBER_WIDTH = 3;

interface HandoffOptions {
  /** The block's first line, in the yellow every planx question is already in. */
  question: string;
  width: number;
}

/**
 * The list of what happens next, as rows to draw over the plan.
 *
 * The question is the block's first line and the rows start on the next one:
 * the air used to sit between the two things that belong together, while the
 * list itself floated above a stack of reserved rows. The block's one blank is
 * above the question, separating it from the plan.
 *
 * Every row draws its command — the whole launch line, flags and all, in a
 * column past the widest label — because a row you can pick by number is a row
 * you may never highlight, and a copy row that will not show you what it copies
 * is asking to be trusted. The highlighted entry is blue, the rest grey, and
 * while the command is being typed the entry goes grey too, so which side of
 * the list you are on is visible without reading a hint.
 */
function handoffLines(mode: HandoffMode, opts: HandoffOptions): string[] {
  const labelWidth = Math.max(...mode.entries.map((e) => e.label.length));
  const room = Math.max(1, opts.width - CURSOR_GUTTER - NUMBER_WIDTH - labelWidth - COMMAND_GAP);

  return [
    signal(truncate(opts.question, opts.width)),
    ...mode.entries.map((item, i) => {
      const active = i === mode.index;
      const label = `${active ? '▸' : ' '} ${i + 1}. ${padEnd(item.label, labelWidth)}`;
      const painted = active && !mode.editing ? blue(label) : gray(label);
      // The caret is the lit block the note and the line editor already use.
      const command =
        active && mode.editing
          ? caretLine(item.command, mode.caret, room)
          : gray(truncate(item.command, room));
      return `${painted}${' '.repeat(COMMAND_GAP)}${command}`;
    }),
  ];
}

/* --------------------------------------------------------------- chrome */

/** The yellow label that says which of the two notes this row is. */
const NOTE_LABEL = 'Global Note: ';

interface StatusOptions {
  status: string | null;
  width: number;
}

/**
 * One row, for whatever just happened.
 *
 * It is transient by construction: a message, and nothing when there is none.
 * What the version *holds* — its feedback count, its edits, its note — is drawn
 * underneath, in the summary block, and the note is now typed there too. This
 * row is where a message that has to be read right now goes, and it cannot be
 * that if something permanent is sitting on it.
 */
function statusLine(opts: StatusOptions): string {
  if (opts.status) return signal(truncate(opts.status, opts.width));
  return '';
}

interface SummaryOptions {
  count: number;
  note: string;
  /**
   * The note as it is being typed, which stands in for the stored one until
   * `enter` or `esc` settles it.
   */
  draft?: { text: string; caret: number } | null;
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
  // The draft is drawn untrimmed: a trailing space is a keystroke, and a note
  // that swallows it looks like a keyboard that dropped it.
  if (opts.draft) {
    out.push(...noteRows(opts.draft.text, opts.draft.caret, opts.width));
  } else if (opts.note.trim()) {
    out.push(...wrapComment(`${NOTE_LABEL}${opts.note.trim()}`, opts.width).map((l) => yellow(l)));
  }
  return out;
}

/**
 * The note being typed, wrapped where the saved one is read, with the caret in
 * it.
 *
 * Same wrap as the box a comment gets, so the note grows a row at a time as it
 * is written and the words never run off the right edge. The label is wrapped
 * with the text rather than printed beside it, which is what lets the caret sit
 * at any offset in the note and still land on a real column.
 */
function noteRows(text: string, caret: number, width: number): string[] {
  const wrapped = wrapLines(`${NOTE_LABEL}${text}`, width);
  const at = caretPosition(wrapped, NOTE_LABEL.length + caret);
  return wrapped.map((line, i) =>
    yellow(i === at.row ? caretRow(line.text, at.column, width) : line.text),
  );
}

/**
 * One wrapped row with the caret lit on it.
 *
 * A caret past the last character of a row that fills the whole width holds on
 * that last column, the way the note box already does: there is nowhere further
 * right to go, and a row that shifts sideways for one keystroke is worse than a
 * caret that stops.
 */
function caretRow(text: string, column: number, width: number): string {
  const padded = padEnd(text, Math.min(column + 1, width));
  const at = Math.min(column, width - 1);
  return `${padded.slice(0, at)}${inverse(padded[at] ?? ' ')}${padded.slice(at + 1)}`;
}

interface HintContext {
  /** There is feedback to walk, so `j` has somewhere to go. */
  anyFeedback: boolean;
  /** What `space` would do here, or null where it would do nothing. */
  space: SpaceAction | null;
  /** `e` can work here: the latest version of the plan. */
  canEdit: boolean;
  /** The cursor covers at least one line of this version, so `f` and `e` have a target. */
  canAnnotate: boolean;
  annotated: boolean;
  /** This version already carries a note, so `n` edits rather than adds. */
  hasNote: boolean;
  /** A selection is live, so `v` ends it rather than starting one. */
  selecting: boolean;
  /** What `l` would act on covers more than one line. */
  plural: boolean;
  diffing: boolean;
  canDiff: boolean;
  manyVersions: boolean;
}

/**
 * The bar the screen offers, and the entry that puts the bar away.
 *
 * The help screen is the exception: its bar is not hints — it says `any key to
 * close`, and the press that would toggle is a key, so one press stays one
 * effect. Every other bar carries the entry, and `rank` seats it after `esc`
 * and `ctrl+c` and before `?`, so each of them ends the same way.
 */
function hintsFor(mode: Mode, row: ViewRow | undefined, ctx: HintContext): Hint[] {
  if (mode.kind === 'help') return [['any key', 'to close']];
  return [...screenHints(mode, row, ctx), HIDE_HINTS];
}

/**
 * The hints offer what this row can actually do, in the one order.
 *
 * Approval is conditional — approving a plan you have notes on would say the
 * plan is settled while asking for it to change — and `d` is missing on v1
 * rather than bound to an apology. Showing keys that refuse to work teaches the
 * wrong thing.
 *
 * `g G ctrl+j ctrl+k` are gone from here and stay in `?`. They are the keys you
 * already know from every pager, and they were the third of the line that
 * never changed — a hint that is always true is a hint nobody is reading. `h`
 * joins them for the same reason: folding every note at once is a thing you do
 * once a session, and it was costing a hint on every row of every plan.
 */
function screenHints(mode: Mode, row: ViewRow | undefined, ctx: HintContext): Hint[] {
  if (mode.kind === 'editing')
    return [
      ['enter', 'save'],
      ['esc', 'discard'],
    ];
  // The yellow `Global Note:` label on the block below says what is being typed,
  // and the caret is sitting in it, so the hint has nothing left to explain.
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
  // The list is walked *or* indexed, so its bar says both. Inside the command
  // the keys are the editor's, plus the one that gets back out.
  if (mode.kind === 'handoff') {
    if (mode.editing)
      return [
        ['enter', 'run'],
        ['esc', 'discard'],
        ['↑↓', 'back to the list'],
      ];
    const here = mode.entries[mode.index];
    const hints: Hint[] = [['↑↓', 'choose']];
    if (mode.entries.length > 1) hints.push([`1-${mode.entries.length}`, 'pick']);
    if (here && editable(here)) hints.push(['→', 'edit the command']);
    // What `enter` does on the row you are on: a copy row does not go anywhere.
    return [...hints, ['enter', here && !editable(here) ? 'copy' : 'go'], ['esc', 'back']];
  }
  const hints: Hint[] = [
    // The wording follows what the key would do, because that is the half of it
    // you cannot see: `n` writes the version's one note either way.
    ['n', ctx.hasNote ? 'edit note' : 'add note'],
  ];

  // `v` goes wherever `f` and `e` go. On a deletion or a gap the cursor is on
  // no line of this version, so a selection anchored there has nothing to
  // comment on or rewrite — and every range that does contain such a line can
  // be anchored on the line itself and extended the other way, so offering the
  // key here only advertises a selection the next press would decline.
  // It stays on while one is live, because `v` is the press that ends it.
  if (ctx.selecting || ctx.canAnnotate)
    hints.push(['v', ctx.selecting ? 'unselect lines' : 'select lines']);

  hints.push(
    ['esc', 'back'],
    // The one key that ends the session, and the only one that used to be
    // nowhere on screen.
    ['ctrl+c', 'exit'],
  );

  // Space is offered wherever it does something, which the same function the
  // key itself reads has already worked out. What it acts on is under the
  // cursor and needs no naming; which way it goes is the only thing you cannot
  // see from the row.
  if (ctx.space) hints.push(['space', spaceHint(ctx.space)]);

  if (row?.kind === 'feedback') {
    hints.push(['f', 'edit feedback']);
  } else if (ctx.canAnnotate) {
    // Dropped where the cursor covers no line of this version at all — a pure
    // deletion in a diff, or a row standing in for hidden lines. Neither has a
    // line for a comment to hang off or for `e` to rewrite.
    hints.push(['f', ctx.annotated ? 'edit feedback' : 'add feedback']);
    if (ctx.canEdit) hints.push(['e', ctx.plural ? 'edit lines' : 'edit line']);
  }

  if (ctx.anyFeedback) hints.push(['j', 'next feedback']);
  if (ctx.canDiff) hints.push(['d', ctx.diffing ? 'hide diff' : 'show diff']);
  if (ctx.manyVersions) hints.push(['←→', 'version']);
  // Unconditional: `s` is the one way out with anything to say, and on a version
  // carrying nothing it still opens the list that says what happens next.
  hints.push(['s', 'submit'], ['?', 'help']);
  return hints;
}

/** Which way `space` goes here. A gap only ever opens. */
function spaceHint(action: SpaceAction): string {
  return action.kind === 'gap' || action.folded ? 'expand' : 'collapse';
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
  [['e', 'edit the line, or every line of the selection, in place'], 'always'],
  [['f', 'add feedback on the selection, or edit the note under the cursor'], 'always'],
  [['g G', 'the top and the bottom of the plan'], 'always'],
  [['ctrl+j ctrl+k', 'a whole screen down or up'], 'always'],
  [['h', 'fold or unfold every note at once'], 'always'],
  [['j', 'the next feedback on this version, wrapping at the end'], 'always'],
  [['n', 'add or edit the note about the whole plan'], 'always'],
  [['s', 'submit everything at once, then pick what happens to the plan next'], 'always'],
  [['space', 'collapse the section you are in, or the note — or expand what is hidden'], 'always'],
  [['v', 'start or end a selection, then ↑ ↓ to extend'], 'always'],
  [['esc', 'back to the list'], 'always'],
  [['ctrl+_', 'hide the hint rows, or show them again'], 'always'],
  [['?', 'this list'], 'always'],
];

/**
 * The way out, last.
 *
 * On the bar `?` is pinned last because it is the key that recovers whatever
 * the width dropped, so it cannot be the entry that goes. Nothing is dropped
 * from this list — you are reading it — so it ends on the key that ends the
 * session, which is the last thing you would look for here.
 */
const HELP_EXIT: Hint = ['ctrl+c', 'leave planx — twice'];

/** Wide enough for `ctrl+j ctrl+k`, the longest key column, plus a gap. */
const HELP_KEY_WIDTH = 15;

function helpLines(width: number, canDiff: boolean): string[] {
  const shown = HELP.filter(([, when]) => when === 'always' || canDiff).map(([hint]) => hint);
  return [
    bold(signal('planx review')),
    '',
    ...[...orderHints(shown), HELP_EXIT].map(
      ([keys, what]) =>
        `${signal(padEnd(keys, HELP_KEY_WIDTH))}${dim(truncate(what, width - HELP_KEY_WIDTH))}`,
    ),
    '',
    dim('a note box is one stop for the cursor, on its first line of text.'),
    dim('inside a note or a line: ← → ⌥← ⌥→ move the caret, ctrl+a ctrl+e reach its ends.'),
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
