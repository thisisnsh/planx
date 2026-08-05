/**
 * The demos on the website are the review, re-implemented for the browser.
 *
 * They are a port rather than a screenshot, which is the point — a reader
 * learns the keys by pressing them — and a port is exactly the thing that goes
 * quietly out of date. These tests hold the visible parts of the CLI's screen
 * against the simulator's: the gutter, the rail, the note box, the lock glyph,
 * the hint bar, and the markdown a submit hands the agent.
 */

import { describe, expect, it } from 'vitest';
import {
  createState,
  frameText,
  hintsFor,
  layout,
  press,
  type SimState,
} from '../site/.vitepress/theme/sim/engine.js';
import { scenario } from '../site/.vitepress/theme/sim/scenarios.js';

function open(name: string, cols = 92, rows = 24): SimState {
  const state = createState(scenario(name));
  layout(state, cols, rows);
  return state;
}

function type(state: SimState, keys: string): void {
  for (const key of keys) press(state, key === ' ' ? 'space' : key);
}

/** Every key, then the rows, so the frame under test is the one on screen. */
function send(state: SimState, ...keys: string[]): void {
  for (const key of keys) {
    press(state, key);
    layout(state, state.cols, state.bodyRows);
  }
}

describe('the website demo', () => {
  it('draws the frame the CLI draws', () => {
    const screen = frameText(open('playground'));
    expect(screen).toContain('╭─ planx v0.3.0  guard-clock-a3f9  v3');
    expect(screen).toContain('★ github.com/thisisnsh/planx ─╯');
    expect(screen).toContain('# Guard the clock regression');
    // The folded section says what it is hiding, on a row of its own.
    expect(screen).toMatch(/⋯ \d+ lines \(space to expand\)/);
  });

  it('hangs a note off the rail beside the lines it is about', () => {
    const screen = frameText(open('playground'));
    expect(screen).toContain('├─');
    expect(screen).toContain('Say which function.');
    expect(screen).toContain('This version has 2 feedbacks.');
  });

  it('marks locked lines with the glyph and refuses feedback on them', () => {
    const state = open('locking');
    send(state, 'G');
    expect(frameText(state)).toContain('⚿');

    // Onto a locked line, then f — the review says why rather than opening a box.
    send(state, 'f');
    expect(state.status).toContain('locked');
    expect(hintsFor(state).map((hint) => hint[0])).not.toContain('f');
  });

  it('takes feedback on a selection and quotes it back to the agent', () => {
    const state = open('review');
    send(state, 'down', 'down', 'v', 'down', 'f');
    type(state, 'Name the function.');
    send(state, 'enter');

    expect(frameText(state)).toContain('Name the function.');

    send(state, 's');
    expect(state.handoff).toContain('## planx — guard-clock-a3f9 v3 (verdict: revise)');
    expect(state.handoff).toContain('**Feedback:** Name the function.');
    expect(state.handoff).toContain('planx capture --plan-id guard-clock-a3f9 --parent v3');
    expect(frameText(state)).toContain('/planx revise guard-clock-a3f9');
  });

  it('refuses to approve a version carrying feedback', () => {
    const state = open('playground');
    send(state, 'a');
    expect(state.status).toContain('press s to submit');
    expect(state.mode.kind).toBe('browse');
  });

  it('seals every section on approve', () => {
    const state = open('sealed');
    send(state, 'a', 'enter');
    expect(state.sealed).toBe(true);
    expect(state.handoff).toContain('Approved and sealed');
    expect(frameText(state)).toContain('/planx execute guard-clock-a3f9 v3');
  });

  it('opens a diff, and puts it away again', () => {
    const state = open('diffing');
    expect(frameText(state)).toContain('v3 ← v2');
    send(state, 'd');
    expect(frameText(state)).not.toContain('v3 ← v2');
    send(state, 'left');
    expect(frameText(state)).toContain('guard-clock-a3f9  v2');
  });

  it('rewrites a line in place, and reports it as settled text', () => {
    const state = open('review');
    send(state, 'down', 'down', 'e');
    send(state, 'ctrl+e');
    type(state, ' (v2)');
    send(state, 'enter', 's');
    expect(state.handoff).toContain('### Edited by the reviewer');
    expect(state.handoff).toContain('(v2)');
  });
});
