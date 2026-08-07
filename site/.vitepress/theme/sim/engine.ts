/**
 * The review, as a state machine — src/tui/ReviewApp.tsx without the terminal.
 *
 * Every key does here what it does in the CLI: the modes are explicit (so `s`
 * is the letter s while a note is being typed) and a note is deleted by emptying
 * it. What is missing is the store — nothing is written to disk, and `s` prints
 * the hand-off it would have printed.
 */

import { hintLines, orderHints, type Hint } from './hints.js';
import { sectionOf } from './markdown.js';
import {
  buildModel,
  enclosingHeading,
  foldEnd,
  wrapComment,
  type Annotation,
  type ReviewModel,
  type ViewRow,
} from './model.js';
import { fit, len, p, plain, repaint, spaces, trunc, type Line } from './text.js';

export interface LineSpan {
  /** 1-based, inclusive. */
  start: number;
  end: number;
}

export const PLANX_VERSION = '0.3.0';
export const REPO = 'github.com/thisisnsh/planx';
/** `│ ` on the left and ` │` on the right of every row. */
const FRAME_PADDING = 4;
/** The cursor arrow and the space after it. */
const CURSOR_GUTTER = 2;
const NOTE_LABEL = 'Global Note: ';

export interface SimPlan {
  id: string;
  title: string;
  /** v1 first. */
  versions: string[];
  /** Feedback already on the plan, by version. */
  feedback?: Record<number, Annotation[]>;
  notes?: Record<number, string>;
  /** Headings folded when the review opens. */
  folded?: number[];
}

export type Mode =
  | { kind: 'browse' }
  | { kind: 'editing'; annotationId: string; draft: string; caret: number; isNew: boolean }
  | { kind: 'note'; draft: string; caret: number }
  | { kind: 'line'; line: number; draft: string; caret: number; queue: number[] }
  | { kind: 'leave' }
  /**
   * `s` asking what happens next to this plan: one vertical list, drawn over the
   * last rows of the plan. `editing` is which side of it the keyboard is on —
   * the entries, or the command the highlighted one would run.
   */
  | { kind: 'handoff'; entries: HandoffEntry[]; index: number; editing: boolean; caret: number }
  | { kind: 'help' }
  | { kind: 'done'; action: HandoffAction | 'back'; command: string | null };

export type HandoffAction = 'revise' | 'execute' | 'commands';

/** One thing that can happen next, and the line that would make it happen. */
export interface HandoffEntry {
  action: HandoffAction;
  label: string;
  /** The launch line as it stands, rewritten in place. */
  command: string;
  /** What planx built, so `esc` in the editor can put it back. */
  original: string;
}

export interface SimState {
  plan: SimPlan;
  versions: number[];
  versionB: number;
  versionA: number | null;
  cursor: number;
  offset: number;
  selection: { anchor: number | null; active: boolean };
  annotations: Record<number, Annotation[]>;
  notes: Record<number, string>;
  touched: Set<number>;
  edits: Map<number, string>;
  expandedGaps: Set<number>;
  foldedSections: Set<number>;
  collapsedFeedback: Set<string>;
  hiddenFeedback: boolean;
  mode: Mode;
  status: string | null;
  pendingJump: string | null;
  /** A section just collapsed from inside, whose stand-in row the cursor follows. */
  pendingFold: number | null;
  /** The arrow run in progress, for the acceleration a held key gets. */
  heldArrow: HeldRun | null;
  /** What the reviewer has tried, for the checklist beside the frame. */
  did: Set<string>;
  /** The markdown the agent is handed, once `s` has been pressed. */
  handoff: string | null;
  cols: number;
  bodyRows: number;
  model: ReviewModel;
}

export interface SimOptions {
  plan: SimPlan;
  /** Which version to open. Defaults to the latest. */
  version?: number;
  /** Open as the diff against the previous version. Defaults to true. */
  diff?: boolean;
}

export function createState(opts: SimOptions): SimState {
  const plan = opts.plan;
  const versions = plan.versions.map((_, i) => i + 1);
  const versionB = opts.version ?? versions[versions.length - 1]!;
  const earlier = versions.filter((v) => v < versionB);
  const wantDiff = opts.diff ?? true;

  const state: SimState = {
    plan,
    versions,
    versionB,
    versionA: wantDiff && earlier.length ? Math.max(...earlier) : null,
    cursor: 0,
    offset: 0,
    selection: { anchor: null, active: false },
    annotations: clone(plan.feedback ?? {}),
    notes: { ...(plan.notes ?? {}) },
    touched: new Set(),
    edits: new Map(),
    expandedGaps: new Set(),
    foldedSections: new Set(plan.folded ?? []),
    collapsedFeedback: new Set(),
    hiddenFeedback: false,
    mode: { kind: 'browse' },
    status: null,
    pendingJump: null,
    pendingFold: null,
    heldArrow: null,
    did: new Set(),
    handoff: null,
    cols: 80,
    bodyRows: 14,
    model: null as unknown as ReviewModel,
  };
  layout(state, 80, 14);
  return state;
}

function clone(feedback: Record<number, Annotation[]>): Record<number, Annotation[]> {
  const out: Record<number, Annotation[]> = {};
  for (const [version, list] of Object.entries(feedback))
    out[Number(version)] = list.map((a) => ({ ...a }));
  return out;
}

/* ------------------------------------------------------------- geometry */

const text = (state: SimState, version: number) => state.plan.versions[version - 1] ?? '';

/** Rebuild the rows for the current width, then settle the cursor on them. */
export function layout(state: SimState, cols: number, bodyRows: number): void {
  state.cols = cols;
  state.bodyRows = bodyRows;
  const inner = cols - FRAME_PADDING;
  const contentWidth = inner - CURSOR_GUTTER;
  const draftId = state.mode.kind === 'editing' ? state.mode.annotationId : null;

  state.model = buildModel({
    oldText: state.versionA === null ? null : text(state, state.versionA),
    newText: text(state, state.versionB),
    annotations: state.annotations[state.versionB] ?? [],
    width: contentWidth,
    expandedGaps: state.expandedGaps,
    foldedSections: state.foldedSections,
    hiddenFeedback: state.hiddenFeedback,
    collapsedFeedback: state.collapsedFeedback,
    edits: state.versionB === latest(state) ? state.edits : new Map(),
    draft:
      draftId === null
        ? null
        : {
            annotationId: draftId,
            text: (state.mode as { draft: string }).draft,
            caret: (state.mode as { caret: number }).caret,
          },
  });

  const rows = state.model.rows;
  // `j` names the annotation it is going to rather than a row index, because
  // unfolding a section to reach it moves every row after the fold.
  if (state.pendingJump !== null) {
    const at = (part: string) =>
      rows.findIndex(
        (r) => r.kind === 'feedback' && r.annotationId === state.pendingJump && r.part === part,
      );
    const index = [at('body'), at('collapsed'), at('top')].find((i) => i !== -1);
    state.pendingJump = null;
    if (index !== undefined) state.cursor = index;
  }
  // The row a collapse leaves behind does not exist until the rows are rebuilt,
  // so the cursor is aimed at it here rather than at a guessed index.
  if (state.pendingFold !== null) {
    const index = rows.findIndex((r) => r.kind === 'doc' && r.fold === state.pendingFold);
    state.pendingFold = null;
    if (index !== -1) state.cursor = index;
  }
  // Folding takes rows out from under the cursor; unfolding turns the row it
  // was on into a box edge, which is not a row it may rest on.
  state.cursor = settleCursor(rows, state.cursor);
  state.offset = scrollFor(state.cursor, state.offset, bodyRows, rows.length);
}

const latest = (state: SimState) => state.versions[state.versions.length - 1]!;

function settle(rows: readonly ViewRow[], index: number): number {
  return Math.max(0, Math.min(rows.length - 1, index));
}

function stopNear(rows: readonly ViewRow[], index: number, direction: 1 | -1): number | null {
  for (const step of [direction, -direction] as const) {
    for (let i = index; i >= 0 && i < rows.length; i += step) if (!rows[i]?.skip) return i;
  }
  return null;
}

function settleCursor(rows: readonly ViewRow[], cursor: number): number {
  const clamped = settle(rows, cursor);
  return stopNear(rows, clamped, 1) ?? clamped;
}

function scrollFor(cursor: number, offset: number, height: number, rowCount: number): number {
  const maxOffset = Math.max(0, rowCount - height);
  if (cursor < offset) return Math.min(cursor, maxOffset);
  if (cursor >= offset + height) return Math.min(cursor - height + 1, maxOffset);
  return Math.min(offset, maxOffset);
}

/* ------------------------------------------------------------ selection */

function selectedRange(state: SimState): { from: number; to: number } | null {
  const anchor = state.selection.anchor;
  if (anchor === null) return null;
  return { from: Math.min(anchor, state.cursor), to: Math.max(anchor, state.cursor) };
}

export function isRowSelected(state: SimState, index: number): boolean {
  const range = selectedRange(state);
  return range !== null && index >= range.from && index <= range.to;
}

/**
 * The lines `f`, `l` and `e` act on: the selection, or the cursor's own line.
 *
 * Deleted rows and collapsed gaps contribute nothing — they do not exist in the
 * version being annotated, so there is no line to attach anything to.
 */
function spanAtCursor(state: SimState): LineSpan | null {
  const rows = state.model.rows;
  const range = selectedRange(state);
  if (range) {
    let start = Infinity;
    let end = -Infinity;
    for (let i = range.from; i <= range.to && i < rows.length; i++) {
      const line = rows[i]?.newLine;
      if (line === null || line === undefined) continue;
      start = Math.min(start, line);
      end = Math.max(end, line);
    }
    if (Number.isFinite(start)) return { start, end };
  }
  const line = rows[state.cursor]?.newLine;
  return line === null || line === undefined ? null : { start: line, end: line };
}

function spanSize(state: SimState): number {
  const span = spanAtCursor(state);
  return span ? span.end - span.start + 1 : 1;
}

/* ------------------------------------------------------------- repeats */

/**
 * How far one arrow press moves, given how long the key has been held.
 *
 * A browser repeats a held key the same way a terminal does — a stream of
 * identical events with no key-up between them — so "held" is inferred from
 * their timing: a run of same-direction arrows with no gap long enough to be a
 * release. The first gap is allowed to be wide, because the operating system
 * waits before it starts repeating.
 */
const IDLE_MS = 150;
const START_MS = 700;
const STEPS: ReadonlyArray<readonly [held: number, rows: number]> = [
  [4000, 5],
  [1500, 2],
];

export interface HeldRun {
  key: 'up' | 'down';
  start: number;
  last: number;
  presses: number;
}

export function pressArrow(
  run: HeldRun | null,
  key: 'up' | 'down',
  now: number,
): { run: HeldRun; step: number } {
  const gap = run === null ? Infinity : now - run.last;
  const allowed = run !== null && run.presses === 1 ? START_MS : IDLE_MS;
  const held = run !== null && run.key === key && gap <= allowed ? run : null;
  const next: HeldRun = held
    ? { key, start: held.start, last: now, presses: held.presses + 1 }
    : { key, start: now, last: now, presses: 1 };

  const heldMs = now - next.start;
  for (const [at, rows] of STEPS) if (heldMs >= at) return { run: next, step: rows };
  return { run: next, step: 1 };
}

/* --------------------------------------------------------------- keys */

/**
 * One keypress. `key` is a token: a single character, or one of `up`, `down`,
 * `left`, `right`, `enter`, `escape`, `backspace`, `space`, `ctrl+d`, …
 *
 * `now` is the clock the held-arrow curve is measured against, so a test can
 * drive it rather than holding a key for four seconds.
 */
export function press(state: SimState, key: string, now: number = Date.now()): void {
  switch (state.mode.kind) {
    case 'editing':
    case 'note':
      return typing(state, key);
    case 'line':
      return lineEdit(state, key);
    case 'help':
      state.mode = { kind: 'browse' };
      return;
    case 'leave':
      if (key === 'enter') return finish(state, 'back', null);
      if (key === 'escape' || key === 'n') state.mode = { kind: 'browse' };
      return;
    case 'handoff':
      return handoffKey(state, key);
    case 'done':
      if (key === 'r' || key === 'enter') restart(state);
      return;
    default:
      return browse(state, key, now);
  }
}

function browse(state: SimState, key: string, now: number): void {
  state.status = null;
  const rows = state.model.rows;

  // Held arrows take more rows the longer they are held, so a plan of two
  // hundred rows is not two hundred repeats.
  if (key === 'down' || key === 'up') {
    const { run, step } = pressArrow(state.heldArrow, key, now);
    state.heldArrow = run;
    return move(state, key === 'up' ? -step : step);
  }
  // Anything else ends the run: let go and press again and it is one row.
  state.heldArrow = null;
  if (key === 'ctrl+d' || key === 'pagedown') return page(state, Math.floor(state.bodyRows / 2));
  if (key === 'ctrl+u' || key === 'pageup') return page(state, -Math.floor(state.bodyRows / 2));
  if (key === 'ctrl+f') return page(state, state.bodyRows);
  if (key === 'ctrl+b') return page(state, -state.bodyRows);
  if (key === 'g') return jumpTo(state, 0);
  if (key === 'G') return jumpTo(state, rows.length - 1);

  // Right for newer, left for older, the way the versions are numbered.
  if (key === 'left' || key === '[') return stepVersion(state, -1);
  if (key === 'right' || key === ']') return stepVersion(state, 1);

  if (key === 'escape') {
    state.mode = { kind: 'leave' };
    return;
  }
  if (key === 'v') {
    if (state.selection.anchor !== null) {
      state.selection = { anchor: null, active: false };
    } else {
      state.selection = { anchor: state.cursor, active: true };
      state.did.add('select');
    }
    return;
  }
  if (key === 'space') return toggleFold(state);
  if (key === 'e') return startEdit(state);
  if (key === 'f') return startFeedback(state);
  if (key === 'j') return nextFeedback(state);
  if (key === 'd' && previousVersion(state) !== null) return toggleDiff(state);
  if (key === 'h') {
    state.hiddenFeedback = !state.hiddenFeedback;
    state.did.add('fold');
    return;
  }
  if (key === 'n') {
    const note = state.notes[state.versionB] ?? '';
    state.mode = { kind: 'note', draft: note, caret: note.length };
    return;
  }
  // The one way out with anything to say, on every row. Whatever is pending is
  // submitted whichever entry the list ends on — including with feedback still
  // open on a plan you are about to build, which is supported: the execute
  // branch works the comments into the build.
  if (key === 's') return handOff(state);
  if (key === '?') {
    state.mode = { kind: 'help' };
    state.did.add('help');
    return;
  }
}

/** The session the demo's plan was captured from — src/store/types.ts `session_id`. */
const SIM_SESSION = '01J8XR';

function handOff(state: SimState): void {
  state.mode = {
    kind: 'handoff',
    entries: handoffEntries(state),
    index: 0,
    editing: false,
    caret: 0,
  };
}

/**
 * What can happen next, in order, each dropped where it cannot work.
 *
 * A line rewritten with `e` does not bring `Revise` back. The edit *is* the
 * change — settled text, already in the version — so there is nothing left to
 * ask an agent for. A comment and the note are requests, and a request needs a
 * round.
 *
 * Every command appears twice, once to run and once to copy, which is why the
 * numbers are positional: `1` is whatever is first here, not always Revise.
 */
function handoffEntries(state: SimState): HandoffEntry[] {
  const id = state.plan.id;
  const asking = current(state).length > 0 || (state.notes[state.versionB] ?? '').trim().length > 0;
  const revise = asking
    ? `claude --resume ${SIM_SESSION} --fork-session "/planx revise ${id}"`
    : null;
  const execute = `claude "/planx execute ${id} v${state.versionB}"`;
  const entries: HandoffEntry[] = [];

  if (revise) entries.push(entry('revise', 'Revise plan in the session that wrote it', revise));
  entries.push(entry('execute', 'Execute plan in a new session', execute));
  if (revise) entries.push(entry('commands', 'Copy revise command', revise));
  entries.push(entry('commands', 'Copy execute command', execute));
  return entries;
}

function entry(action: HandoffAction, label: string, command: string): HandoffEntry {
  return { action, label, command, original: command };
}

/** A copy row shows its command and will not open it — see the CLI's `editable`. */
function editable(item: HandoffEntry): boolean {
  return item.action !== 'commands';
}

/**
 * The list, and the command editor inside it.
 *
 * Anything unbound is ignored rather than falling through to the document
 * underneath, and there are no numbers: the list is walked, not indexed.
 */
function handoffKey(state: SimState, key: string): void {
  const mode = state.mode as Extract<Mode, { kind: 'handoff' }>;
  const here = mode.entries[mode.index];
  if (!here) return;

  if (!mode.editing) {
    // The number picks and fires in one press: it is the whole point of
    // numbering the rows.
    const picked = /^[1-9]$/.test(key) ? mode.entries[Number(key) - 1] : undefined;
    if (picked) return finish(state, picked.action, picked.command);
    if (key === 'up') state.mode = { ...mode, index: Math.max(0, mode.index - 1) };
    else if (key === 'down')
      state.mode = { ...mode, index: Math.min(mode.entries.length - 1, mode.index + 1) };
    // Into the line itself, to change the model, add a directory, rewrite the
    // prompt, or replace the command outright.
    else if (key === 'right' && editable(here))
      state.mode = { ...mode, editing: true, caret: here.command.length };
    else if (key === 'enter') finish(state, here.action, here.command);
    // Back to the plan, on the row you were on — not out of planx.
    else if (key === 'escape') state.mode = { kind: 'browse' };
    return;
  }

  const command = here.command;
  // The edit survives arrowing away to another entry and back; `esc` is what
  // throws it away, and it puts back the line planx built.
  if (key === 'escape') {
    state.mode = { ...withCommand(mode, here.original), editing: false, caret: 0 };
    return;
  }
  if (key === 'up' || key === 'down') {
    state.mode = { ...mode, editing: false };
    return;
  }
  // Nothing to run, so nothing happens. The list is still there.
  if (key === 'enter') {
    if (command.trim()) finish(state, here.action, command);
    return;
  }
  // `←` at the start of the line is the way back out of it, which is the same
  // key that got you here, reversed.
  if (key === 'left' && mode.caret === 0) {
    state.mode = { ...mode, editing: false };
    return;
  }

  const moved = caretKey(command, mode.caret, key);
  if (moved !== null) {
    state.mode = { ...mode, caret: moved };
    return;
  }
  if (key === 'backspace') {
    if (mode.caret === 0) return;
    state.mode = {
      ...withCommand(mode, `${command.slice(0, mode.caret - 1)}${command.slice(mode.caret)}`),
      caret: mode.caret - 1,
    };
    return;
  }
  const char = printable(key);
  if (char) {
    state.mode = {
      ...withCommand(mode, `${command.slice(0, mode.caret)}${char}${command.slice(mode.caret)}`),
      caret: mode.caret + char.length,
    };
  }
}

/** The list with the highlighted entry's command replaced by what was typed. */
function withCommand(
  mode: Extract<Mode, { kind: 'handoff' }>,
  command: string,
): Extract<Mode, { kind: 'handoff' }> {
  return {
    ...mode,
    entries: mode.entries.map((e, i) => (i === mode.index ? { ...e, command } : e)),
  };
}

function move(state: SimState, delta: number): void {
  const rows = state.model.rows;
  const next = stopNear(rows, settle(rows, state.cursor + delta), delta < 0 ? -1 : 1);
  if (next === null) return;
  state.cursor = next;
  state.offset = scrollFor(state.cursor, state.offset, state.bodyRows, rows.length);
  state.did.add('move');
}

/** A screenful, or half of one — the viewport moves with the cursor. */
function page(state: SimState, delta: number): void {
  const rows = state.model.rows;
  const before = state.cursor;
  const next = stopNear(rows, settle(rows, state.cursor + delta), delta < 0 ? -1 : 1) ?? before;
  state.cursor = next;
  const shifted = Math.max(
    0,
    Math.min(state.offset + (next - before), Math.max(0, rows.length - state.bodyRows)),
  );
  state.offset = scrollFor(next, shifted, state.bodyRows, rows.length);
  state.did.add('move');
}

function jumpTo(state: SimState, index: number): void {
  const rows = state.model.rows;
  state.cursor = settleCursor(rows, index);
  state.offset = scrollFor(state.cursor, state.offset, state.bodyRows, rows.length);
}

const current = (state: SimState): Annotation[] => state.annotations[state.versionB] ?? [];

function previousVersion(state: SimState): number | null {
  const earlier = state.versions.filter((v) => v < state.versionB);
  return earlier.length ? Math.max(...earlier) : null;
}

function updateAnnotations(state: SimState, fn: (list: Annotation[]) => Annotation[]): void {
  state.annotations = { ...state.annotations, [state.versionB]: fn(current(state)) };
}

/* ------------------------------------------------------------ feedback */

function annotationAtCursor(state: SimState): Annotation | null {
  const row = state.model.rows[state.cursor];
  if (row?.kind === 'feedback')
    return current(state).find((a) => a.id === row.annotationId) ?? null;
  const span = spanAtCursor(state);
  if (!span) return null;
  return current(state).find((a) => a.start <= span.end && a.end >= span.start) ?? null;
}

function startFeedback(state: SimState): void {
  // One note per passage. Landing on lines that already carry one edits it.
  const existing = annotationAtCursor(state);
  if (existing) {
    state.collapsedFeedback.delete(existing.id);
    state.hiddenFeedback = false;
    state.mode = {
      kind: 'editing',
      annotationId: existing.id,
      draft: existing.comment,
      caret: existing.comment.length,
      isNew: false,
    };
    return;
  }

  const span = spanAtCursor(state);
  if (!span) {
    state.status = 'Nothing to annotate there — that row is a deletion or a collapsed gap.';
    return;
  }

  const id = nextAnnotationId(current(state));
  updateAnnotations(state, (list) => [
    ...list,
    { id, start: span.start, end: span.end, comment: '' },
  ]);
  state.hiddenFeedback = false;
  state.selection = { anchor: null, active: false };
  state.mode = { kind: 'editing', annotationId: id, draft: '', caret: 0, isNew: true };
}

function nextAnnotationId(annotations: readonly Annotation[]): string {
  let highest = 0;
  for (const annotation of annotations) {
    const match = /^a(\d+)$/.exec(annotation.id);
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return `a${highest + 1}`;
}

/**
 * Emptying a note is how you delete it. There is no delete key: a second way to
 * destroy something is not worth a letter of the keyboard.
 */
function commitFeedback(state: SimState, annotationId: string, draft: string): void {
  const body = draft.trim();
  const before = current(state).find((a) => a.id === annotationId);
  if (!body) updateAnnotations(state, (list) => list.filter((a) => a.id !== annotationId));
  else
    updateAnnotations(state, (list) =>
      list.map((a) => (a.id === annotationId ? { ...a, comment: body } : a)),
    );
  if ((before?.comment ?? '') !== body) {
    state.touched.add(state.versionB);
    if (body) state.did.add('feedback');
  }
  state.mode = { kind: 'browse' };
}

function typing(state: SimState, key: string): void {
  const mode = state.mode as Extract<Mode, { kind: 'editing' } | { kind: 'note' }>;
  if (key === 'escape') {
    // Discarding a brand new note removes it; discarding an edit to an
    // existing one leaves the original text alone.
    if (mode.kind === 'editing' && mode.isNew) commitFeedback(state, mode.annotationId, '');
    else state.mode = { kind: 'browse' };
    return;
  }
  if (key === 'enter') {
    if (mode.kind === 'editing') return commitFeedback(state, mode.annotationId, mode.draft);
    const note = mode.draft.trim();
    if (note !== (state.notes[state.versionB] ?? '')) {
      state.touched.add(state.versionB);
      if (note) state.did.add('note');
    }
    state.notes = { ...state.notes, [state.versionB]: note };
    state.mode = { kind: 'browse' };
    return;
  }
  const moved = caretKey(mode.draft, mode.caret, key);
  if (moved !== null) {
    state.mode = { ...mode, caret: moved };
    return;
  }
  if (key === 'backspace') {
    if (mode.caret === 0) return;
    state.mode = {
      ...mode,
      draft: `${mode.draft.slice(0, mode.caret - 1)}${mode.draft.slice(mode.caret)}`,
      caret: mode.caret - 1,
    };
    return;
  }
  const char = printable(key);
  if (char) {
    state.mode = {
      ...mode,
      draft: `${mode.draft.slice(0, mode.caret)}${char}${mode.draft.slice(mode.caret)}`,
      caret: mode.caret + char.length,
    };
  }
}

/** Where a keypress moves the caret, or null when it is not a caret key. */
function caretKey(draft: string, caret: number, key: string): number | null {
  if (key === 'left') return Math.max(0, caret - 1);
  if (key === 'right') return Math.min(draft.length, caret + 1);
  if (key === 'alt+left') return wordStartBefore(draft, caret);
  if (key === 'alt+right') return wordStartAfter(draft, caret);
  if (key === 'ctrl+a') return 0;
  if (key === 'ctrl+e') return draft.length;
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

/** `space` arrives as a token; everything else printable is its own character. */
function printable(key: string): string | null {
  if (key === 'space') return ' ';
  if (key.length === 1) return key;
  if (key.startsWith('text:')) return key.slice(5);
  return null;
}

/* ------------------------------------------------------------ rewriting */

/**
 * `e` opens the line under the cursor as its raw markdown source, so what the
 * reviewer submits is what they meant. It refuses on any version but the
 * latest: an older version is the text a newer one was built from.
 */
function startEdit(state: SimState): void {
  const row = state.model.rows[state.cursor];
  if (row?.kind === 'feedback') {
    state.status = 'That is feedback — press f to edit it.';
    return;
  }
  if (state.versionB !== latest(state)) {
    state.status = `Only v${latest(state)} can be edited — press → to reach it.`;
    return;
  }
  const span = spanAtCursor(state);
  if (!span) {
    state.status = 'Nothing to edit there.';
    return;
  }

  state.selection = { anchor: null, active: false };
  // A selection walks: the lines open one at a time, from the top.
  const open: number[] = [];
  for (let line = span.start; line <= span.end; line++) open.push(line);
  openLine(state, open[0]!, open.slice(1));
}

function openLine(state: SimState, line: number, queue: number[]): void {
  const draft = state.edits.get(line) ?? state.model.docLines[line - 1] ?? '';
  const index = state.model.rows.findIndex((r) => r.kind === 'doc' && r.newLine === line);
  if (index !== -1) jumpTo(state, index);
  state.mode = { kind: 'line', line, draft, caret: draft.length, queue };
}

/**
 * A line editor, not a note box. The line count of the plan never changes, so
 * every anchor in the document keeps the line number it already had.
 */
function lineEdit(state: SimState, key: string): void {
  const mode = state.mode as Extract<Mode, { kind: 'line' }>;
  if (key === 'escape') {
    state.mode = { kind: 'browse' };
    return;
  }
  if (key === 'enter') {
    const stored = state.model.docLines[mode.line - 1] ?? '';
    if (mode.draft === stored) state.edits.delete(mode.line);
    else {
      state.edits.set(mode.line, mode.draft);
      state.did.add('edit');
    }
    const [next, ...rest] = mode.queue;
    if (next === undefined) state.mode = { kind: 'browse' };
    else openLine(state, next, rest);
    return;
  }
  if (key === 'left') {
    state.mode = { ...mode, caret: Math.max(0, mode.caret - 1) };
    return;
  }
  if (key === 'right') {
    state.mode = { ...mode, caret: Math.min(mode.draft.length, mode.caret + 1) };
    return;
  }
  if (key === 'ctrl+a') {
    state.mode = { ...mode, caret: 0 };
    return;
  }
  if (key === 'ctrl+e') {
    state.mode = { ...mode, caret: mode.draft.length };
    return;
  }
  if (key === 'backspace') {
    if (mode.caret === 0) return;
    state.mode = {
      ...mode,
      draft: `${mode.draft.slice(0, mode.caret - 1)}${mode.draft.slice(mode.caret)}`,
      caret: mode.caret - 1,
    };
    return;
  }
  const char = printable(key);
  if (char) {
    state.mode = {
      ...mode,
      draft: `${mode.draft.slice(0, mode.caret)}${char}${mode.draft.slice(mode.caret)}`,
      caret: mode.caret + char.length,
    };
  }
}

/* --------------------------------------------------------------- folding */

/**
 * What `space` would do where the cursor is.
 *
 * Where something is hidden under the cursor it comes back; then a heading,
 * which wins over a note that happens to cover it; then the note; then, from
 * anywhere else in the document, the section you are standing in.
 */
export type SpaceAction =
  | { kind: 'gap'; gap: number }
  | { kind: 'note'; id: string; folded: boolean }
  /** `inside` marks a section reached from one of its own lines, not its heading. */
  | { kind: 'section'; heading: number; folded: boolean; inside?: boolean };

export function spaceAction(state: SimState): SpaceAction | null {
  const row = state.model.rows[state.cursor];

  if (row?.kind === 'doc') {
    if (row.fold !== null) return { kind: 'section', heading: row.fold, folded: true };
    if (row.gapIndex !== null) return { kind: 'gap', gap: row.gapIndex };
  }
  if (
    row?.kind === 'doc' &&
    row.newLine !== null &&
    foldEnd(state.model.docLines, row.newLine) !== null
  ) {
    return {
      kind: 'section',
      heading: row.newLine,
      folded: state.foldedSections.has(row.newLine),
    };
  }

  const note = annotationAtCursor(state);
  if (note) {
    return {
      kind: 'note',
      id: note.id,
      folded: state.hiddenFeedback || state.collapsedFeedback.has(note.id),
    };
  }

  if (row?.kind === 'doc' && row.newLine !== null) {
    const heading = enclosingHeading(state.model.docLines, row.newLine);
    if (heading !== null) {
      return { kind: 'section', heading, folded: state.foldedSections.has(heading), inside: true };
    }
  }
  return null;
}

function toggleFold(state: SimState): void {
  const action = spaceAction(state);
  if (action === null) return;

  if (action.kind === 'gap') {
    state.expandedGaps.add(action.gap);
    state.did.add('expand');
    return;
  }

  if (action.kind === 'note') {
    // Folding from inside the box takes it down to one row, so the cursor moves
    // to where the box starts rather than to whatever slides up underneath it.
    if (state.model.rows[state.cursor]?.kind === 'feedback') {
      jumpTo(
        state,
        state.model.rows.findIndex((r) => r.kind === 'feedback' && r.annotationId === action.id),
      );
    }
    if (state.collapsedFeedback.has(action.id)) state.collapsedFeedback.delete(action.id);
    else state.collapsedFeedback.add(action.id);
    state.did.add('fold');
    return;
  }

  // Collapsing from inside takes the cursor's own rows with the section, so it
  // follows the collapse onto the row that now stands for where it was.
  if (action.inside && !action.folded) state.pendingFold = action.heading;
  if (action.folded) state.foldedSections.delete(action.heading);
  else state.foldedSections.add(action.heading);
  state.did.add('fold');
}

/** Which way `space` goes here. A gap only ever opens. */
export function spaceHint(action: SpaceAction): string {
  return action.kind === 'gap' || action.folded ? 'expand' : 'collapse';
}

/** `j` walks the feedback, forward, wrapping at the end, unfolding on the way. */
function nextFeedback(state: SimState): void {
  const ordered = [...current(state)].sort((a, b) => a.end - b.end || a.id.localeCompare(b.id));
  if (!ordered.length) {
    state.status = 'No feedback on this version.';
    return;
  }
  const row = state.model.rows[state.cursor];
  const here = row?.kind === 'feedback' ? row.annotationId : null;
  const index = here === null ? -1 : ordered.findIndex((a) => a.id === here);
  const target =
    index === -1
      ? (ordered.find((a) => a.end > (row?.newLine ?? 0)) ?? ordered[0]!)
      : ordered[(index + 1) % ordered.length]!;

  for (const line of [...state.foldedSections]) {
    const end = foldEnd(state.model.docLines, line);
    if (end !== null && target.end > line && target.end <= end) state.foldedSections.delete(line);
  }
  state.pendingJump = target.id;
  state.did.add('jump');
}

/* -------------------------------------------------------------- versions */

function goToVersion(state: SimState, next: number, diffing: boolean): void {
  state.versionB = next;
  const earlier = state.versions.filter((v) => v < next);
  state.versionA = diffing && earlier.length ? Math.max(...earlier) : null;
  state.cursor = 0;
  state.offset = 0;
  state.selection = { anchor: null, active: false };
  state.expandedGaps = new Set();
  // Folds are line numbers in the version they were made on, and line 40 of v2
  // is not line 40 of v3.
  state.foldedSections = new Set();
}

function stepVersion(state: SimState, delta: number): void {
  const index = state.versions.indexOf(state.versionB);
  const next = state.versions[index + delta];
  if (index === -1 || next === undefined) {
    state.status = delta < 0 ? 'This is the first version.' : 'This is the latest version.';
    return;
  }
  goToVersion(state, next, state.versionA !== null);
  state.did.add('version');
}

function toggleDiff(state: SimState): void {
  if (state.versionA !== null) {
    state.versionA = null;
  } else {
    const previous = previousVersion(state);
    if (previous === null) return;
    state.versionA = previous;
  }
  state.did.add('diff');
}

/* -------------------------------------------------------------- finishing */

function finish(state: SimState, action: HandoffAction | 'back', command: string | null): void {
  // The agent that is about to build the plan reads the same feedback with a
  // different last line — `planx revise --executing`.
  state.handoff = action === 'back' ? null : handoffText(state, action === 'execute');
  // One key opens the list, so one task is ticked whichever entry answers it.
  if (action !== 'back') state.did.add('submit');
  state.did.add(action);
  state.mode = { kind: 'done', action, command };
}

function restart(state: SimState): void {
  const fresh = createState({
    plan: state.plan,
    version: state.versionB,
    diff: state.versionA !== null,
  });
  Object.assign(state, { ...fresh, did: state.did });
  layout(state, state.cols, state.bodyRows);
}

/**
 * The markdown `planx revise` hands the agent — src/protocol/present.ts.
 *
 * Not the plan itself: the agent that wrote it already has it. What survives is
 * the quoted lines each comment is anchored to, which is the only thing that
 * makes a line number mean anything after a revision has moved it.
 */
export function handoffText(state: SimState, executing = false): string {
  const docLines = state.model.docLines;
  const out: string[] = [`## planx — ${state.plan.id} v${state.versionB}`, ''];

  const edits = [...state.edits].sort(([a], [b]) => a - b);
  if (edits.length) {
    out.push(
      '### Edited by the reviewer',
      '',
      `They rewrote these lines of v${state.versionB} themselves. This is settled text, not a request —`,
      'reproduce it exactly in the next version.',
      '',
    );
    for (const [line, after] of edits) {
      out.push(
        `- **line ${line}**`,
        `  - was: \`${docLines[line - 1] ?? ''}\``,
        `  - now: \`${after}\``,
      );
    }
    out.push('');
  }

  const asked: string[] = [];
  for (const annotation of [...current(state)].sort((a, b) => a.start - b.start)) {
    const where = sectionOf(docLines, annotation.start - 1);
    const lines =
      annotation.start === annotation.end
        ? `line ${annotation.start}`
        : `lines ${annotation.start}–${annotation.end}`;
    asked.push(
      `#### [${annotation.id}]${where ? ` under ${JSON.stringify(where)}` : ''} (${lines})`,
    );
    for (let line = annotation.start; line <= annotation.end; line++)
      asked.push(`> ${docLines[line - 1] ?? ''}`);
    asked.push('');
    if (annotation.comment.trim()) asked.push(`**Feedback:** ${annotation.comment.trim()}`, '');
  }
  const note = (state.notes[state.versionB] ?? '').trim();
  if (note) asked.push('#### General', '', note, '');
  if (asked.length) out.push('### What was asked', '', ...asked);

  // Reviewed, and it asked for nothing: the reviewer saying the version is fine.
  if (!asked.length && !edits.length) {
    out.push('---', 'Reviewed with nothing to change. Implement it as written.', '');
    return out.join('\n');
  }

  out.push('---');
  // The reader is about to build it, not revise it, so the closing says so and
  // never names `planx capture`.
  if (executing) {
    out.push(
      'Build the plan, addressing every comment as you go. Do not capture a new',
      'version: the plan is what was reviewed, and the comments are instructions on',
      'top of it for this build.',
      '',
    );
    return out.join('\n');
  }

  const lead = asked.length
    ? 'Revise the plan addressing every comment.'
    : 'Revise the plan, keeping every edited line exactly as it now reads.';
  out.push(`${lead} Then run:`);
  out.push(`  planx capture --plan-id ${state.plan.id} --parent v${state.versionB} --stdin`, '');
  return out.join('\n');
}

/* ----------------------------------------------------------------- hints */

/**
 * The hints offer what this row can actually do, in the one order. Showing keys
 * that refuse to work teaches the wrong thing, so `d` is missing on v1 and `e`
 * is missing on any version but the latest.
 */
export function hintsFor(state: SimState): Hint[] {
  const mode = state.mode;
  if (mode.kind === 'editing')
    return [
      ['enter', 'save'],
      ['esc', 'discard'],
    ];
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
  if (mode.kind === 'help') return [['any key', 'to close']];
  if (mode.kind === 'done') return [['r', 'review it again']];

  const row = state.model.rows[state.cursor];
  const space = spaceAction(state);
  const hints: Hint[] = [
    ['n', (state.notes[state.versionB] ?? '').trim() ? 'edit note' : 'add note'],
    ['v', state.selection.active ? 'unselect lines' : 'select lines'],
    ['esc', 'back'],
    ['^c', 'exit'],
  ];

  // What space acts on is under the cursor and needs no naming; which way it
  // goes is the only thing you cannot see from the row.
  if (space) hints.push(['space', spaceHint(space)]);

  if (row?.kind === 'feedback') {
    hints.push(['f', 'edit feedback']);
  } else if (spanAtCursor(state) !== null) {
    // Dropped where the cursor covers no line of this version at all — a pure
    // deletion in a diff, or a row standing in for hidden lines.
    hints.push(['f', annotationAtCursor(state) ? 'edit feedback' : 'add feedback']);
    if (state.versionB === latest(state)) {
      hints.push(['e', spanSize(state) > 1 ? 'edit lines' : 'edit line']);
    }
  }

  if (current(state).length) hints.push(['j', 'next feedback']);
  if (previousVersion(state) !== null)
    hints.push(['d', state.versionA !== null ? 'hide diff' : 'show diff']);
  if (state.versions.length > 1) hints.push(['←→', 'version']);
  // Unconditional: `s` is the one way out with anything to say, and on a version
  // carrying nothing it still opens the list that says what happens next.
  hints.push(['s', 'submit'], ['?', 'help']);
  return hints;
}

/** The widest bar browse mode can produce, for the height to reserve. */
function widestHints(state: SimState): Hint[] {
  const hints: Hint[] = [
    ['n', 'edit note'],
    ['esc', 'back'],
    ['^c', 'exit'],
    ['space', 'collapse'],
    ['v', 'unselect lines'],
    ['e', 'edit lines'],
    ['f', 'edit feedback'],
    ['j', 'next feedback'],
  ];
  if (previousVersion(state) !== null) hints.push(['d', 'show diff']);
  if (state.versions.length > 1) hints.push(['←→', 'version']);
  hints.push(['s', 'submit'], ['?', 'help']);
  return hints;
}

/* ---------------------------------------------------------------- render */

/** Every row of the frame, top rule to bottom rule, at the current width. */
export function frame(state: SimState): Line[] {
  const width = state.cols;
  const inner = width - FRAME_PADDING;
  const model = state.model;
  const textWidth = inner - CURSOR_GUTTER - model.gutterWidth;

  const body = pad2(
    state.mode.kind === 'help'
      ? helpLines(inner, previousVersion(state) !== null)
      : state.mode.kind === 'done'
        ? doneLines(state)
        : model.rows
            .slice(state.offset, state.offset + state.bodyRows)
            .map((row, i) => renderRow(state, row, state.offset + i, textWidth, model.railColumn)),
    state.bodyRows,
  );

  const message =
    state.mode.kind === 'leave'
      ? state.touched.size || state.edits.size
        ? [p(leaveWarning(state), 'red')]
        : [p('Back to the list?', 'warn')]
      : // The hand-off list carries its own question, on its own first line, so
        // this row stays empty while the list is up.
        state.mode.kind === 'handoff'
        ? []
        : statusLine(state, inner);

  // A question stands alone: while a prompt is up, what the version holds is
  // not drawn. The rows stay, blank, so the document does not reflow under it.
  const asking = state.mode.kind === 'leave' || state.mode.kind === 'handoff';
  const summary = summaryLines(state, inner).map((line) => (asking ? ([] as Line) : line));
  const hints = hintLines(hintsFor(state), inner);
  const reserve =
    state.mode.kind === 'browse' ? hintLines(widestHints(state), inner).length : hints.length;

  // Everything between the top gap and the hint bar, as one block — see the
  // CLI's `frameRows`. The hand-off list is anchored to the bottom of it with
  // its one blank row on top, rather than drawn over the body alone and left
  // floating above however many reserved rows this version happens to have.
  const rest: Line[] = [...body, [], message, ...summary, []];
  const page = (() => {
    if (state.mode.kind !== 'handoff') return rest;
    const block = [[] as Line, ...handoffLines(state, state.mode, inner), [] as Line].slice(
      -rest.length,
    );
    const room = rest.length - block.length;
    return [
      ...body.slice(0, room),
      ...Array.from({ length: Math.max(0, room - body.length) }, (): Line => []),
      ...block,
    ];
  })();

  return [
    topRule(width, headerLine(state)),
    frameLine([], inner),
    ...page.map((line) => frameLine(line, inner)),
    ...pad2(
      hints.map((line) => [p(line, 'dim')] as Line),
      reserve,
    ).map((line) => frameLine(line, inner)),
    bottomRule(width, ` ★ ${REPO} `),
  ];
}

function pad2(lines: Line[], height: number): Line[] {
  const out = lines.slice(0, height);
  while (out.length < height) out.push([]);
  return out;
}

function frameLine(content: Line, inner: number): Line {
  return [p('│', 'sig'), p(' '), ...fit(content, inner), p(' '), p('│', 'sig')];
}

function topRule(width: number, title: Line): Line {
  const fill = Math.max(0, width - 3 - len(title));
  return [p('╭─', 'sig'), ...title, p(`${'─'.repeat(fill)}╮`, 'sig')];
}

function bottomRule(width: number, footer: string): Line {
  const fill = Math.max(0, width - 3 - footer.length);
  return [p(`╰${'─'.repeat(fill)}`, 'sig'), p(footer, 'dim'), p('─╯', 'sig')];
}

/** ` planx v0.3.0  guard-clock-a3f9  v2 ← v1 ` — the frame's top edge. */
function headerLine(state: SimState): Line {
  const versions = `v${state.versionB}${state.versionA === null ? '' : ` ← v${state.versionA}`}`;
  return [
    p(' '),
    p('planx', 'sig bold'),
    p(` v${PLANX_VERSION}`, 'dim'),
    p(`  ${state.plan.id}  `),
    p(versions, 'dim'),
    p(' '),
  ];
}

/**
 * One drawn line, with the cursor arrow in a gutter of its own, and the rail
 * running between the line number and the text.
 */
function renderRow(
  state: SimState,
  row: ViewRow,
  index: number,
  width: number,
  indent: number,
): Line {
  // The arrow and the space after it: every row starts past the same two
  // columns, which is what puts a note box in the rail's own column rather than
  // one to the right of it.
  const lead: Line = [index === state.cursor ? p('▸', 'sig') : p(' '), p(' ')];

  if (row.kind === 'feedback') {
    const gap = [...lead, spaces(indent)];
    if (row.part !== 'body') return [...gap, p(row.text, 'sig')];
    const box = row.boxWidth - 4;
    const editing =
      state.mode.kind === 'editing' &&
      state.mode.annotationId === row.annotationId &&
      row.caret !== null;
    // The caret goes *over* a column rather than after the text, so the row is
    // the width it would be without one — which is what lets the box wrap to its
    // full width whether or not it is being typed into.
    const body: Line = editing ? boxBody(row.text, row.caret!, box) : [p(row.text)];
    return [...gap, p('│', 'sig'), p(' '), ...fit(body, box), p(' '), p('│', 'sig')];
  }

  const gutter = index === state.cursor ? row.gutterActive : row.gutter;
  // The line being rewritten shows its raw markdown source, because that is
  // what is being typed at. Highlighting it would draw one thing and edit
  // another.
  if (state.mode.kind === 'line' && row.newLine === state.mode.line) {
    const rail: Line = row.rail ? [p('│', 'sig')] : [p(' ')];
    return [
      ...lead,
      ...gutter,
      ...rail,
      p(' '),
      ...caretLine(state.mode.draft, state.mode.caret, width),
    ];
  }

  const text = isRowSelected(state, index) ? repaint(row.text, 'inv') : row.text;
  // A collapsed run and a folded section are not lines of the document, so they
  // get no rail column and their marker starts where a line number would.
  if (row.gapIndex !== null || row.fold !== null) return [...lead, ...gutter, ...text];

  const rail: Line = row.rail ? [p('│', 'sig')] : [p(' ')];
  return [...lead, ...gutter, ...rail, p(' '), ...text];
}

/** Columns between the longest label and the command column. */
const COMMAND_GAP = 3;
/** `1. ` — the number every row is answerable by. */
const NUMBER_WIDTH = 3;

/**
 * The list of what happens next, as rows to draw over the plan.
 *
 * The question is the block's first line and the rows start on the next one;
 * the block's one blank row is above the question, separating it from the plan.
 *
 * Every row draws its command — the whole launch line, flags and all, in a
 * column past the widest label — because a row you can pick by number is a row
 * you may never highlight, and a copy row that will not show you what it copies
 * is asking to be trusted. The highlighted entry is blue, the rest grey, and
 * while the command is being typed the entry goes grey too.
 */
function handoffLines(
  state: SimState,
  mode: Extract<Mode, { kind: 'handoff' }>,
  width: number,
): Line[] {
  const question = `Submit ${state.plan.id} v${state.versionB}`;
  const labelWidth = Math.max(...mode.entries.map((e) => e.label.length));
  const room = Math.max(1, width - CURSOR_GUTTER - NUMBER_WIDTH - labelWidth - COMMAND_GAP);

  return [
    trunc([p(question, 'sig')], width),
    ...mode.entries.map((item, i): Line => {
      const active = i === mode.index;
      const label = `${active ? '▸' : ' '} ${i + 1}. ${item.label.padEnd(labelWidth, ' ')}`;
      const painted = p(label, active && !mode.editing ? 'blue' : 'gray');
      // The caret is the lit block the note and the line editor already use.
      const command: Line =
        active && mode.editing
          ? caretLine(item.command, mode.caret, room)
          : trunc([p(item.command, 'gray')], room);
      return [painted, spaces(COMMAND_GAP), ...command];
    }),
  ];
}

/**
 * A row of the note box with the caret drawn on it.
 *
 * The caret goes *over* a column rather than after the text, so the row is the
 * width it would be without one — which is what lets the box wrap to its full
 * width whether or not it is being typed into. A caret past the last character
 * of a row that fills the box holds on that last column rather than scrolling
 * the text out from under it.
 */
function boxBody(text: string, caret: number, box: number): Line {
  if (text.length > box) return caretLine(text, caret, box + 1);
  const padded = text.padEnd(box, ' ');
  const at = Math.min(caret, box - 1);
  return [p(padded.slice(0, at)), p(padded[at] ?? ' ', 'caret'), p(padded.slice(at + 1))];
}

/** The line being rewritten, scrolled horizontally under the caret. */
function caretLine(draft: string, caret: number, width: number): Line {
  const room = Math.max(1, width - 1);
  const start = Math.max(0, caret - room + 1);
  const visible = draft.slice(start, start + room);
  const at = caret - start;
  return [p(visible.slice(0, at)), p(draft[caret] ?? ' ', 'caret'), p(visible.slice(at + 1))];
}

/**
 * One row for whatever just happened — transient by construction. What the
 * version holds is drawn underneath, in the summary.
 */
function statusLine(state: SimState, width: number): Line {
  if (state.mode.kind === 'note') {
    // The window follows the caret rather than pinning to the tail: with the
    // caret movable, the end is no longer the only place you can be typing.
    const room = Math.max(8, width - NOTE_LABEL.length);
    const { draft, caret } = state.mode;
    const start = Math.max(0, caret - room + 1);
    const visible = draft.slice(start, start + room);
    const at = caret - start;
    return [
      p(`${NOTE_LABEL}${visible.slice(0, at)}`, 'warn'),
      p(draft[caret] ?? ' ', 'caret'),
      p(visible.slice(at + 1), 'warn'),
    ];
  }
  if (state.status) return fit([p(state.status, 'sig')], width);
  return [];
}

/** What this version holds, above the hints: how much feedback, and the note. */
function summaryLines(state: SimState, width: number): Line[] {
  if (state.mode.kind === 'done' || state.mode.kind === 'help') return [];
  const out: Line[] = [];
  const count = current(state).length;
  if (count) out.push([p(`This version has ${count} feedback${count === 1 ? '' : 's'}.`, 'dim')]);
  if (state.edits.size && state.versionB === latest(state)) {
    out.push([
      p(
        `${state.edits.size} line${state.edits.size === 1 ? '' : 's'} edited on this version.`,
        'dim',
      ),
    ]);
  }
  const note = (state.notes[state.versionB] ?? '').trim();
  if (note) {
    for (const line of wrapComment(`${NOTE_LABEL}${note}`, width)) out.push([p(line, 'warn')]);
  }
  return out;
}

function leaveWarning(state: SimState): string {
  const lost: string[] = [];
  if (state.touched.size) lost.push('Your feedback');
  if (state.edits.size)
    lost.push(`${state.edits.size} edited line${state.edits.size === 1 ? '' : 's'}`);
  const verb = lost.length > 1 || state.edits.size > 1 ? 'have' : 'has';
  return `Back to the list? ${lost.join(' and ')} ${verb} not been submitted and will be lost.`;
}

/**
 * How a review signs off — src/cli/commands.ts `closingBlock`.
 *
 * Every line says where its command runs, reopening comes first on every exit,
 * and there is one blank line between each entry.
 */
function doneLines(state: SimState): Line[] {
  const mode = state.mode as Extract<Mode, { kind: 'done' }>;
  const id = state.plan.id;
  const version = state.versionB;
  const out: Line[] = [];
  const carried = current(state).length > 0 || (state.notes[version] ?? '').trim().length > 0;

  if (mode.action !== 'back') {
    const count = current(state).length;
    const note = (state.notes[version] ?? '').trim() ? ' and a note' : '';
    out.push([
      p(`Submitted ${count} feedback${count === 1 ? '' : 's'}${note} on v${version}.`, 'green'),
    ]);
    out.push([]);
  } else {
    out.push([p('Left without submitting. Nothing was written.', 'dim')]);
    out.push([]);
  }

  // An entry that starts something: planx runs the line the reviewer left, and
  // prints what it ran on the way.
  if (mode.action === 'revise' || mode.action === 'execute') {
    out.push([p('Running  '), p(mode.command ?? '', 'warn')]);
    out.push([]);
    out.push([p('press r to review it again', 'dim')]);
    return out;
  }

  // The closing block prints either way: a clipboard that could not be reached
  // would otherwise leave the reviewer with a promise and no command.
  if (mode.action === 'commands') {
    out.push([p('Copied to your clipboard.', 'green')]);
    out.push([]);
  }

  // No blank lines between the entries: four adjacent lines read as one block,
  // which is what they are. The way back is grey throughout — it is not the
  // next step — and the two next steps carry a colour each.
  out.push([p('Reopen it in your terminal:  ', 'dim'), p(`planx ${id} v${version}`, 'dim')]);
  if (mode.action === 'commands') {
    if (carried) {
      out.push([p('Revise this plan in your agent:  ', 'dim'), p(`/planx revise ${id}`, 'warn')]);
      out.push([
        p('Execute it in your agent:  ', 'dim'),
        p(`/planx execute ${id} v${version}`, 'blue'),
      ]);
    } else {
      out.push([
        p('Execute this plan in your agent:  ', 'dim'),
        p(`/planx execute ${id} v${version}`, 'blue'),
      ]);
    }
  }
  out.push([]);
  out.push([p('press r to review it again', 'dim')]);
  return out;
}

/**
 * Every key, in the same order the hint line puts them. `versioned` marks the
 * ones that only exist on a plan with history.
 */
const HELP: Array<[Hint, 'always' | 'versioned']> = [
  [['←→', 'the previous and next version of the plan'], 'versioned'],
  [['↑↓', 'a row at a time — held, 2 rows after 1.5s and 5 after 4s'], 'always'],
  [['d', 'show the diff against the previous version, or hide it'], 'versioned'],
  [['e', 'edit the line, or every line of the selection, in place'], 'always'],
  [['f', 'add feedback on the selection, or edit the note under the cursor'], 'always'],
  [['g G', 'the top and the bottom of the plan'], 'always'],
  [['^d ^u', 'half a screen down or up'], 'always'],
  [['^f ^b', 'a whole screen down or up'], 'always'],
  [['h', 'fold or unfold every note at once'], 'always'],
  [['j', 'the next feedback on this version, wrapping at the end'], 'always'],
  [['n', 'add or edit the note about the whole plan'], 'always'],
  [['s', 'submit everything at once, then pick what happens to the plan next'], 'always'],
  [['space', 'collapse the section you are in, or the note — or expand what is hidden'], 'always'],
  [['v', 'start or end a selection, then ↑ ↓ to extend'], 'always'],
  [['esc', 'back to the list'], 'always'],
  [['?', 'this list'], 'always'],
];

/**
 * The way out, last: `?` ends the hint bar because it recovers what the width
 * dropped, and nothing is dropped from a list you are already reading.
 */
const HELP_EXIT: Hint = ['^c', 'leave planx — twice'];

function helpLines(width: number, canDiff: boolean): Line[] {
  const shown = HELP.filter(([, when]) => when === 'always' || canDiff).map(([hint]) => hint);
  return [
    [p('planx review', 'sig bold')],
    [],
    ...[...orderHints(shown), HELP_EXIT].map(([keys, what]) => [
      p(keys.padEnd(8, ' '), 'sig'),
      ...fit([p(what, 'dim')], Math.max(8, width - 8)),
    ]),
    [],
    [p('a note box is one stop for the cursor, on its first line of text.', 'dim')],
    [p('inside a note or a line: ← → ⌥← ⌥→ move the caret, ^a ^e reach its ends.', 'dim')],
    [p('a note is deleted by emptying it: f, clear the text, enter.', 'dim')],
  ];
}

/** The plain text of a frame, for tests and for copying. */
export function frameText(state: SimState): string {
  return frame(state)
    .map((line) => plain(line))
    .join('\n');
}
