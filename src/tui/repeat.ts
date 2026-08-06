/**
 * How far one arrow press moves, given how long the key has been held.
 *
 * A terminal has no key-up event. Auto-repeat arrives as a stream of identical
 * escape sequences, indistinguishable from somebody pressing the key that fast,
 * so "held" has to be inferred from the timing of the presses: a run of
 * same-direction arrows with no gap long enough to be a release.
 *
 * Everything here is a pure function of (previous run, key, now). The clock is
 * the caller's, which is what lets a test drive the curve without fake timers
 * fighting Ink's render loop.
 */

/** The longest gap between repeats of an established run. */
export const IDLE_MS = 150;

/**
 * The gap allowed between the first press and the second, and only there.
 *
 * The operating system waits before it starts repeating — around 500ms on a
 * Mac, up to a second elsewhere. Measuring the run from the second press would
 * make "1.5 seconds of holding" mean two seconds of holding; allowing one wide
 * gap at the head of the run and a narrow one after keeps the wall clock
 * honest.
 *
 * The narrow gap is what tells a hold apart from fast tapping: sustaining 150ms
 * intervals by hand for a second and a half is not something that happens by
 * accident, and a slow key-repeat setting still clears it.
 */
export const START_MS = 700;

/** How long the key has to have been held, and what a repeat takes then. */
const STEPS: ReadonlyArray<readonly [held: number, rows: number]> = [
  [4000, 5],
  [1500, 2],
];

/** The two keys that accelerate. `←→` step versions, one version at a time. */
export type RepeatKey = 'up' | 'down';

export interface HeldRun {
  key: RepeatKey;
  /** When the run started, which is what the curve is measured from. */
  start: number;
  /** The last press in it, which is what the next gap is measured against. */
  last: number;
  /** How many presses in, so the wide first gap is allowed exactly once. */
  presses: number;
}

export interface Repeat {
  /** The run this press belongs to — the caller keeps it for the next one. */
  run: HeldRun;
  /** Rows to take. */
  step: number;
}

/**
 * Fold one arrow press into the run, and say how far it moves.
 *
 * A different key ends the run, so `↑` after a held `↓` starts again at one
 * row: the two directions are separate holds, and carrying speed across the
 * turn would overshoot the row you were slowing down to reach.
 */
export function pressArrow(run: HeldRun | null, key: RepeatKey, now: number): Repeat {
  const gap = run === null ? Infinity : now - run.last;
  const allowed = run !== null && run.presses === 1 ? START_MS : IDLE_MS;
  const held = run !== null && run.key === key && gap <= allowed ? run : null;

  const next: HeldRun = held
    ? { key, start: held.start, last: now, presses: held.presses + 1 }
    : { key, start: now, last: now, presses: 1 };

  return { run: next, step: stepFor(now - next.start) };
}

/** Rows per repeat, for a key held this long. */
export function stepFor(heldMs: number): number {
  for (const [held, rows] of STEPS) if (heldMs >= held) return rows;
  return 1;
}
