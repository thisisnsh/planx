import { describe, expect, it } from 'vitest';
import { pressArrow, type HeldRun, type RepeatKey } from '../src/tui/repeat.js';

/**
 * The acceleration curve, driven by an injected clock.
 *
 * There is no key-up event to test against: a hold is a run of presses with no
 * gap wide enough to be a release, so every case here is a list of timestamps.
 */

/** Press the same key at each time, and collect how far each press moved. */
function hold(key: RepeatKey, times: readonly number[]): number[] {
  let run: HeldRun | null = null;
  return times.map((now) => {
    const result = pressArrow(run, key, now);
    run = result.run;
    return result.step;
  });
}

/** Repeats at `IDLE_MS` from zero, up to and including `until`. */
function repeats(until: number): number[] {
  const times: number[] = [];
  for (let t = 0; t <= until; t += 150) times.push(t);
  return times;
}

describe('held arrows', () => {
  it('takes one row until the key has been held a second and a half', () => {
    const steps = hold('down', repeats(1350));
    expect(new Set(steps)).toEqual(new Set([1]));
  });

  it('takes two rows past 1.5s and five past 4s', () => {
    const steps = hold('down', repeats(4200));
    expect(steps[0]).toBe(1);
    expect(steps[repeats(4200).indexOf(1500)]).toBe(2);
    expect(steps[repeats(4200).indexOf(3900)]).toBe(2);
    expect(steps[repeats(4200).indexOf(4050)]).toBe(5);
    expect(steps.at(-1)).toBe(5);
  });

  // The key was let go of and pressed again: a new hold starts at one row,
  // however long the last one ran.
  it('starts again after a gap wider than a repeat', () => {
    const times = [...repeats(4200), 4200 + 400];
    const steps = hold('down', times);
    expect(steps.at(-2)).toBe(5);
    expect(steps.at(-1)).toBe(1);
  });

  it('starts again on the opposite arrow', () => {
    let run: HeldRun | null = null;
    for (const now of repeats(4200)) run = pressArrow(run, 'down', now).run;
    expect(pressArrow(run, 'down', 4350).step).toBe(5);
    expect(pressArrow(run, 'up', 4350).step).toBe(1);
  });

  // The operating system waits before it starts repeating. That first wide gap
  // is part of the hold, so the curve is measured from the first press.
  it('allows one wide gap at the head of the run and one only', () => {
    expect(hold('down', [0, 600, 750, 900]).at(-1)).toBe(1);
    // Measured from the first press, so 1.5s of holding is 1.5s on the clock.
    const times = [0, 600];
    for (let t = 750; t <= 1650; t += 150) times.push(t);
    expect(hold('down', times).at(-1)).toBe(2);

    // A second gap that wide is a release, so the run starts over.
    expect(hold('down', [0, 600, 750, 1350, 1500]).at(-1)).toBe(1);
  });

  it('does not accelerate on tapping', () => {
    expect(hold('down', [0, 400, 800, 1200, 1600, 2000, 2400]).at(-1)).toBe(1);
  });
});
