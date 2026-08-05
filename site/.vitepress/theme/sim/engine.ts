/**
 * The review, as a state machine — src/tui/ReviewApp.tsx without the terminal.
 *
 * Every key does here what it does in the CLI: the modes are explicit (so `s`
 * is the letter s while a note is being typed), a note is deleted by emptying
 * it, `a` is refused on a version carrying feedback, and a lock is applied the
 * moment it is made. What is missing is the store — nothing is written to disk,
 * and `s` prints the hand-off it would have printed.
 */

import { hintLines, orderHints, type Hint } from './hints.js';
import {
  addLocks,
  locateLock,
  sealPlan,
  unlockRange,
  type LineSpan,
  type SimLock,
} from './locks.js';
import { sectionOf } from './markdown.js';
import {
  buildModel,
  foldEnd,
  wrapComment,
  type Annotation,
  type ReviewModel,
  type ViewRow,
} from './model.js';
import { fit, len, p, plain, repaint, spaces, type Line } from './text.js';

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
  locks?: SimLock[];
  /** Feedback already on the plan, by version. */
  feedback?: Record<number, Annotation[]>;
  notes?: Record<number, string>;
  /** Headings folded when the review opens. */
  folded?: number[];
  sealed?: boolean;
}

export type Mode =
  | { kind: 'browse' }
  | { kind: 'editing'; annotationId: string; draft: string; isNew: boolean }
  | { kind: 'note'; draft: string }
  | { kind: 'line'; line: number; draft: string; caret: number; queue: number[] }
  | { kind: 'confirm' }
  | { kind: 'leave' }
  | { kind: 'help' }
  | { kind: 'done'; action: 'submit' | 'approve' | 'quit' | 'back' };

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
  locks: SimLock[];
  expandedGaps: Set<number>;
  foldedSections: Set<number>;
  collapsedFeedback: Set<string>;
  hiddenFeedback: boolean;
  sealed: boolean;
  mode: Mode;
  status: string | null;
  pendingJump: string | null;
  /** What the reviewer has tried, for the checklist beside the frame. */
  did: Set<string>;
  /** The markdown the agent is handed, once `s` or `a` has been pressed. */
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
    locks: (plan.locks ?? []).map((lock) => ({ ...lock, lines: [...lock.lines] })),
    expandedGaps: new Set(),
    foldedSections: new Set(plan.folded ?? []),
    collapsedFeedback: new Set(),
    hiddenFeedback: false,
    sealed: Boolean(plan.sealed),
    mode: { kind: 'browse' },
    status: null,
    pendingJump: null,
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
    locks: state.locks,
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
        : { annotationId: draftId, text: (state.mode as { draft: string }).draft },
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

/* --------------------------------------------------------------- keys */

/**
 * One keypress. `key` is a token: a single character, or one of `up`, `down`,
 * `left`, `right`, `enter`, `escape`, `backspace`, `space`, `ctrl+d`, …
 */
export function press(state: SimState, key: string): void {
  switch (state.mode.kind) {
    case 'editing':
    case 'note':
      return typing(state, key);
    case 'line':
      return lineEdit(state, key);
    case 'help':
      state.mode = { kind: 'browse' };
      return;
    case 'confirm':
      if (key === 'enter') return finish(state, 'approve');
      if (key === 'escape' || key === 'n') state.mode = { kind: 'browse' };
      return;
    case 'leave':
      if (key === 'enter') return finish(state, 'back');
      if (key === 'escape' || key === 'n') state.mode = { kind: 'browse' };
      return;
    case 'done':
      if (key === 'r' || key === 'enter') restart(state);
      return;
    default:
      return browse(state, key);
  }
}

function browse(state: SimState, key: string): void {
  state.status = null;
  const rows = state.model.rows;

  if (key === 'down') return move(state, 1);
  if (key === 'up') return move(state, -1);
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
  if (key === 'l') return toggleLock(state);
  if (key === 'd' && previousVersion(state) !== null) return toggleDiff(state);
  if (key === 'h') {
    state.hiddenFeedback = !state.hiddenFeedback;
    state.did.add('fold');
    return;
  }
  if (key === 'n') {
    state.mode = { kind: 'note', draft: state.notes[state.versionB] ?? '' };
    return;
  }
  if (key === 's') return finish(state, 'submit');
  if (key === 'a') {
    // Approving is for a version you have nothing to say about: it would
    // otherwise seal the very lines the feedback is asking to change.
    if (carries(state)) {
      state.status = approveBlocked(current(state).length, state.notes[state.versionB] ?? '');
      return;
    }
    state.mode = { kind: 'confirm' };
    return;
  }
  if (key === '?') {
    state.mode = { kind: 'help' };
    state.did.add('help');
    return;
  }
  if (key === 'x' || key === 'q') return finish(state, 'quit');
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
const carries = (state: SimState) =>
  current(state).length > 0 || (state.notes[state.versionB] ?? '').trim().length > 0;

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
      isNew: false,
    };
    return;
  }

  const span = spanAtCursor(state);
  if (!span) {
    state.status = 'Nothing to annotate there — that row is a deletion or a collapsed gap.';
    return;
  }
  // A locked passage is settled: commenting on it would ask for a change to
  // text that cannot change.
  if (isLocked(state, span)) {
    state.status = 'Those lines are locked — press l to unlock them before commenting.';
    return;
  }

  const id = nextAnnotationId(current(state));
  updateAnnotations(state, (list) => [
    ...list,
    { id, start: span.start, end: span.end, comment: '' },
  ]);
  state.hiddenFeedback = false;
  state.selection = { anchor: null, active: false };
  state.mode = { kind: 'editing', annotationId: id, draft: '', isNew: true };
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
  if (key === 'backspace') {
    state.mode = { ...mode, draft: mode.draft.slice(0, -1) };
    return;
  }
  const char = printable(key);
  if (char) state.mode = { ...mode, draft: mode.draft + char };
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
 * reviewer submits is what they meant. It refuses where an edit would mean
 * something other than it says: an older version, a sealed plan, a locked line.
 */
function startEdit(state: SimState): void {
  const row = state.model.rows[state.cursor];
  if (row?.kind === 'feedback') {
    state.status = 'That is feedback — press f to edit it.';
    return;
  }
  if (state.sealed) {
    state.status = 'This plan is sealed — approving locked every section.';
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

  const open: number[] = [];
  let locked = 0;
  for (let line = span.start; line <= span.end; line++) {
    if (state.model.lockedLines.has(line)) locked++;
    else open.push(line);
  }
  if (!open.length) {
    state.status = 'That line is locked — press l to unlock it before editing.';
    return;
  }
  state.selection = { anchor: null, active: false };
  // A selection walks: the lines open one at a time from the top, and the ones
  // a lock covers are stepped over rather than silently included.
  if (locked) state.status = `Skipped ${locked} locked line${locked === 1 ? '' : 's'}.`;
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

/* ---------------------------------------------------------------- locks */

function isLocked(state: SimState, span: LineSpan): boolean {
  for (let line = span.start; line <= span.end; line++)
    if (state.model.lockedLines.has(line)) return true;
  return false;
}

/**
 * `l` is a toggle, so a selection that is already locked comes back off. A
 * partly locked selection locks the rest: the intent of pressing lock on
 * something half locked is to end up with it locked.
 */
function toggleLock(state: SimState): void {
  const span = spanAtCursor(state);
  if (!span) {
    state.status = 'Nothing to lock there.';
    return;
  }
  const docLines = state.model.docLines;

  let allLocked = true;
  for (let line = span.start; line <= span.end; line++) {
    if (!state.model.lockedLines.has(line)) allLocked = false;
  }

  if (allLocked) {
    const removed = unlockRange(state.locks, docLines, span);
    const lines = `line${span.start === span.end ? '' : 's'} ${describeSpan(span)}`;
    state.status = removed.length ? `Unlocked ${lines}.` : `Nothing was locking ${lines}.`;
    state.did.add('unlock');
  } else {
    const result = addLocks(state.locks, docLines, span);
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
    state.status = sentence(parts.join(' · '));
    state.did.add('lock');
  }
  state.selection = { anchor: null, active: false };
}

function describeSpan(span: LineSpan): string {
  return span.start === span.end ? `${span.start}` : `${span.start}–${span.end}`;
}

function sentence(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) return trimmed;
  const capital = `${trimmed[0]!.toUpperCase()}${trimmed.slice(1)}`;
  return /[.!?…]$/.test(capital) ? capital : `${capital}.`;
}

/* --------------------------------------------------------------- folding */

/**
 * Space folds what is under the cursor: a section away, a note into its rail, a
 * gap open. The heading wins over a note that happens to cover it.
 */
function toggleFold(state: SimState): void {
  const row = state.model.rows[state.cursor];
  const heading = foldTarget(state, row);
  if (heading !== null) {
    if (state.foldedSections.has(heading)) state.foldedSections.delete(heading);
    else state.foldedSections.add(heading);
    state.did.add('fold');
    return;
  }

  const note = annotationAtCursor(state);
  if (note) {
    // Folding from inside the box takes it down to one row, so the cursor moves
    // to where the box starts rather than to whatever slides up underneath it.
    if (row?.kind === 'feedback') {
      jumpTo(
        state,
        state.model.rows.findIndex((r) => r.kind === 'feedback' && r.annotationId === note.id),
      );
    }
    if (state.collapsedFeedback.has(note.id)) state.collapsedFeedback.delete(note.id);
    else state.collapsedFeedback.add(note.id);
    state.did.add('fold');
    return;
  }

  const gap = row?.gapIndex;
  if (gap === null || gap === undefined) return;
  state.expandedGaps.add(gap);
  state.did.add('expand');
}

/** The heading line `space` would fold or unfold from this row, or null. */
function foldTarget(state: SimState, row: ViewRow | undefined): number | null {
  if (row?.kind !== 'doc') return null;
  if (row.fold !== null) return row.fold;
  if (row.newLine === null) return null;
  return foldEnd(state.model.docLines, row.newLine) === null ? null : row.newLine;
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

function finish(state: SimState, action: 'submit' | 'approve' | 'quit' | 'back'): void {
  if (action === 'submit' && !carries(state) && !state.touched.size && !state.edits.size) {
    state.status = 'Nothing to submit — press f to leave feedback, or x to leave.';
    return;
  }
  if (action === 'approve') {
    sealPlan(state.locks, state.model.docLines);
    state.sealed = true;
  }
  state.handoff = action === 'submit' || action === 'approve' ? handoffText(state, action) : null;
  state.did.add(action);
  state.mode = { kind: 'done', action };
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
export function handoffText(state: SimState, action: 'submit' | 'approve'): string {
  const verdict = action === 'approve' ? 'approve' : 'revise';
  const docLines = state.model.docLines;
  const out: string[] = [
    `## planx — ${state.plan.id} v${state.versionB} (verdict: ${verdict})`,
    '',
  ];

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

  const locked = state.locks
    .map((lock) => {
      const at = locateLock(docLines, lock);
      const where = at
        ? at.start === at.end
          ? `(line ${at.start})`
          : `(lines ${at.start}–${at.end})`
        : '(not located in this version)';
      return `- **${lock.id}** ${lock.section ? `${JSON.stringify(lock.section)} ` : ''}${where} — do not modify`;
    })
    .sort();
  if (locked.length) out.push('### Locked', ...locked, '');

  if (verdict === 'approve') {
    out.push('---', 'Approved and sealed — every section is locked. Implement it as written.', '');
    return out.join('\n');
  }

  out.push('---');
  const lead = asked.length
    ? 'Revise the plan addressing every comment.'
    : 'Revise the plan, keeping every edited line exactly as it now reads.';
  if (locked.length) {
    out.push(
      `${lead} Locked blocks must be reproduced`,
      'as `[[planx:keep L1]]` markers — do not re-emit their text. Then run:',
    );
  } else {
    out.push(`${lead} Then run:`);
  }
  out.push(
    `  planx capture --plan-id ${state.plan.id} --parent v${state.versionB} --splice --stdin`,
    '',
  );
  return out.join('\n');
}

function approveBlocked(count: number, note: string): string {
  const has: string[] = [];
  if (count) has.push(`${count} feedback${count === 1 ? '' : 's'}`);
  if (note.trim()) has.push('a note');
  const single = count + (note.trim() ? 1 : 0) === 1;
  return `This version has ${has.join(' and ')}. Delete ${single ? 'it' : 'them'} or press s to submit.`;
}

/* ----------------------------------------------------------------- hints */

/**
 * The hints offer what this row can actually do, in the one order. Showing keys
 * that refuse to work teaches the wrong thing, so `d` is missing on v1 and `f`
 * is missing on a locked passage.
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
  if (mode.kind === 'done') return [['r', 'review it again']];

  const row = state.model.rows[state.cursor];
  const heading = foldTarget(state, row);
  const plural = spanSize(state) > 1;
  const lines = plural ? 'lines' : 'line';
  const hints: Hint[] = [
    ['n', 'note'],
    ['x', 'exit'],
    ['esc', 'back'],
  ];

  if (row?.kind === 'feedback') {
    const folded = state.hiddenFeedback || state.collapsedFeedback.has(row.annotationId);
    hints.push(['space', folded ? 'unfold feedback' : 'fold feedback'], ['f', 'edit']);
  } else if (row?.kind === 'doc' && (row.gapIndex !== null || row.fold !== null)) {
    hints.push(
      ['space', heading !== null ? 'unfold section' : 'expand'],
      ['v', state.selection.active ? 'unselect lines' : 'select lines'],
    );
  } else {
    if (heading !== null) {
      hints.push(['space', state.foldedSections.has(heading) ? 'unfold section' : 'fold section']);
    }
    hints.push(['v', state.selection.active ? 'unselect lines' : 'select lines']);
    const span = spanAtCursor(state);
    if (span && isLocked(state, span)) hints.push(['l', `unlock ${lines}`]);
    else {
      hints.push(['f', annotationAtCursor(state) ? 'edit' : 'feedback'], ['l', `lock ${lines}`]);
      if (!state.sealed && state.versionB === latest(state)) hints.push(['e', `rewrite ${lines}`]);
    }
  }

  if (current(state).length) hints.push(['j', 'next feedback']);
  if (previousVersion(state) !== null)
    hints.push(['d', state.versionA !== null ? 'hide diff' : 'show diff']);
  if (state.versions.length > 1) hints.push(['←→', 'version']);
  hints.push(carries(state) ? ['s', 'submit'] : ['a', 'approve'], ['?', 'help']);
  return hints;
}

/** The widest bar browse mode can produce, for the height to reserve. */
function widestHints(state: SimState): Hint[] {
  const hints: Hint[] = [
    ['n', 'note'],
    ['x', 'exit'],
    ['esc', 'back'],
    ['space', 'unfold section'],
    ['v', 'unselect lines'],
    ['e', 'rewrite lines'],
    ['f', 'feedback'],
    ['j', 'next feedback'],
    ['l', 'lock lines'],
  ];
  if (previousVersion(state) !== null) hints.push(['d', 'show diff']);
  if (state.versions.length > 1) hints.push(['←→', 'version']);
  hints.push(['a', 'approve'], ['?', 'help']);
  return hints;
}

/* ---------------------------------------------------------------- render */

/** Every row of the frame, top rule to bottom rule, at the current width. */
export function frame(state: SimState): Line[] {
  const width = state.cols;
  const inner = width - FRAME_PADDING;
  const model = state.model;
  const textWidth = inner - CURSOR_GUTTER - model.gutterWidth;

  const body =
    state.mode.kind === 'help'
      ? helpLines(inner, previousVersion(state) !== null)
      : state.mode.kind === 'done'
        ? doneLines(state)
        : model.rows
            .slice(state.offset, state.offset + state.bodyRows)
            .map((row, i) => renderRow(state, row, state.offset + i, textWidth, model.railColumn));

  const message =
    state.mode.kind === 'confirm'
      ? [p(approveMessage(state), 'sig')]
      : state.mode.kind === 'leave'
        ? state.touched.size || state.edits.size
          ? [p(leaveWarning(state), 'red')]
          : [p('Back to the list?', 'warn')]
        : statusLine(state, inner);

  const summary = summaryLines(state, inner);
  const hints = hintLines(hintsFor(state), inner);
  const reserve =
    state.mode.kind === 'browse' ? hintLines(widestHints(state), inner).length : hints.length;

  return [
    topRule(width, headerLine(state)),
    frameLine([], inner),
    ...pad2(body, state.bodyRows).map((line) => frameLine(line, inner)),
    frameLine([], inner),
    frameLine(message, inner),
    ...summary.map((line) => frameLine(line, inner)),
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
    ...(state.sealed ? [p('  sealed', 'sig bold')] : []),
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
      state.mode.kind === 'editing' && state.mode.annotationId === row.annotationId && row.last;
    const body: Line = [p(row.text), ...(editing ? [p(' ', 'caret')] : [])];
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
    const room = Math.max(8, width - NOTE_LABEL.length - 1);
    return [p(`${NOTE_LABEL}${state.mode.draft.slice(-room)}`, 'warn'), p(' ', 'caret')];
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

function approveMessage(state: SimState): string {
  const seals = state.edits.size
    ? `This saves ${state.edits.size} edited line${state.edits.size === 1 ? '' : 's'}, then seals`
    : 'This seals';
  return `Approve v${state.versionB}? ${seals} the plan — every section becomes locked.`;
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
 * How a review signs off: what happened, what to do next, how to get back.
 *
 * The agent command is the next step; the reopen line is the fallback, and it
 * is on every exit — a review that ended successfully should not leave you
 * without a way back to what you were just looking at.
 */
function doneLines(state: SimState): Line[] {
  const mode = state.mode as Extract<Mode, { kind: 'done' }>;
  const id = state.plan.id;
  const version = state.versionB;
  const out: Line[] = [];

  if (mode.action === 'approve') {
    out.push([
      p(`Approved & sealed — `, 'green'),
      p(id, 'green bold'),
      p(` v${version}.`, 'green'),
    ]);
  }
  if (mode.action === 'submit') {
    const count = current(state).length;
    const note = (state.notes[version] ?? '').trim() ? ' and a note' : '';
    out.push([
      p(`Submitted ${count} feedback${count === 1 ? '' : 's'}${note} on v${version}.`, 'green'),
    ]);
  }
  if (mode.action !== 'quit' && mode.action !== 'back') {
    out.push([
      p('Paste to your agent:  '),
      p(
        mode.action === 'approve' ? `/planx execute ${id} v${version}` : `/planx revise ${id}`,
        'warn',
      ),
    ]);
  }
  if (mode.action === 'quit' || mode.action === 'back') {
    out.push([p('Left without submitting. Nothing was written.', 'dim')]);
  }
  out.push([p('Reopen it with:  '), p(`planx ${id} v${version}`, 'warn')]);
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
  [['↑↓', 'move a row at a time — a note box is one stop, on its first line'], 'always'],
  [['a', 'approve — seals the plan, and only when you have no feedback'], 'always'],
  [['d', 'show the diff against the previous version, or hide it'], 'versioned'],
  [['e', 'rewrite the line, or every line of the selection, in place'], 'always'],
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

function helpLines(width: number, canDiff: boolean): Line[] {
  const shown = HELP.filter(([, when]) => when === 'always' || canDiff).map(([hint]) => hint);
  return [
    [p('planx review', 'sig bold')],
    [],
    ...orderHints(shown).map(([keys, what]) => [
      p(keys.padEnd(8, ' '), 'sig'),
      ...fit([p(what, 'dim')], Math.max(8, width - 8)),
    ]),
    [],
    [p('a note is deleted by emptying it: f, clear the text, enter.', 'dim')],
  ];
}

/** The plain text of a frame, for tests and for copying. */
export function frameText(state: SimState): string {
  return frame(state)
    .map((line) => plain(line))
    .join('\n');
}
