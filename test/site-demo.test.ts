/**
 * The demos on the website are the review, re-implemented for the browser.
 *
 * They are a port rather than a screenshot, which is the point — a reader
 * learns the keys by pressing them — and a port is exactly the thing that goes
 * quietly out of date. These tests hold the visible parts of the CLI's screen
 * against the simulator's: the gutter, the rail, the note box, the hint bar,
 * and the markdown a submit hands the agent.
 */

import { describe, expect, it } from 'vitest';
import {
  createState,
  frameText,
  layout,
  press,
  type SimState,
} from '../site/.vitepress/theme/sim/engine.js';
import { scenario } from '../site/.vitepress/theme/sim/scenarios.js';
import {
  createPicker,
  demoPlans,
  pickerFrame,
  pickerPress,
} from '../site/.vitepress/theme/sim/picker.js';
import { plain } from '../site/.vitepress/theme/sim/text.js';

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

  it('takes feedback on a selection and quotes it back to the agent', () => {
    const state = open('review');
    send(state, 'down', 'down', 'v', 'down', 'f');
    type(state, 'Name the function.');
    send(state, 'enter');

    expect(frameText(state)).toContain('Name the function.');

    // `s` asks which way the command goes; `2` is the one you paste yourself.
    send(state, 's');
    expect(frameText(state)).toContain('Submit and revise guard-clock-a3f9 v3.');
    send(state, '2');
    expect(state.handoff).toContain('## planx — guard-clock-a3f9 v3');
    expect(state.handoff).toContain('**Feedback:** Name the function.');
    expect(state.handoff).toContain('planx capture --plan-id guard-clock-a3f9 --parent v3');
    expect(frameText(state)).toContain('/planx revise guard-clock-a3f9');
  });

  it('tells the agent to build it when the review asked for nothing', () => {
    const state = open('executing');
    // Nothing to submit, so there is no `s` — `x` is how a review that asked
    // for nothing ends.
    expect(frameText(state)).not.toContain('s submit');
    send(state, 'x', '2');
    expect(state.handoff).toContain('Reviewed with nothing to change. Implement it as written.');
    expect(frameText(state)).toContain('/planx execute guard-clock-a3f9 v3');
    expect(frameText(state)).not.toContain('/planx revise');
  });

  it('starts the agent itself when 1 is pressed, and says what it ran', () => {
    const state = open('executing');
    send(state, 'x');
    expect(frameText(state)).toContain('Execute guard-clock-a3f9 v3.');
    expect(frameText(state)).toContain('1 execute in a new agent');
    expect(frameText(state)).toContain('2 give me the command');

    send(state, '1');
    expect(frameText(state)).toContain('Running');
    expect(frameText(state)).toContain('claude "/planx execute guard-clock-a3f9 v3"');
  });

  it('takes esc back to the plan rather than out of planx', () => {
    const state = open('executing');
    send(state, 'x');
    expect(frameText(state)).toContain('give me the command');
    send(state, 'escape');
    expect(frameText(state)).toContain('x execute');
    expect(frameText(state)).not.toContain('give me the command');
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
    send(state, 'enter', 's', '2');
    expect(state.handoff).toContain('### Edited by the reviewer');
    expect(state.handoff).toContain('(v2)');
  });
});

describe('the website picker', () => {
  function screen(state: ReturnType<typeof createPicker>, height = 10): string[] {
    return pickerFrame(state, height).map((line) => plain(line));
  }

  it('says which version was built, in words as well as in green', () => {
    const state = createPicker(demoPlans());
    pickerPress(state, 'down');
    pickerPress(state, 'right');
    const rows = screen(state);
    expect(rows.find((r) => r.includes('v2'))).toContain('executed');
  });

  it('opens the delete confirmation under its own row, at the same height', () => {
    const state = createPicker(demoPlans());
    const before = screen(state).length;

    pickerPress(state, 'ctrl+d');
    const rows = screen(state);
    expect(rows).toHaveLength(before);

    const target = rows.findIndex((r) => r.includes('❯'));
    expect(rows[target + 1]).toContain('delete guard-clock-a3f9? this cannot be undone');
  });
});
