import { EventEmitter } from 'node:events';
import { render } from 'ink';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { capture } from '../src/protocol/capture.js';
import { buildAnnotation, submitFeedback } from '../src/protocol/submit.js';
import { setColorEnabled, stripAnsi } from '../src/render/ansi.js';
import { listFeedback } from '../src/store/feedback.js';
import { readVersionText } from '../src/store/plans.js';
import type { Feedback } from '../src/store/types.js';
import { Picker, type PickerItem } from '../src/tui/Picker.js';
import { ReviewApp, type Launchable, type ReviewResult } from '../src/tui/ReviewApp.js';
import { brandTitle, MIN_FRAME_WIDTH, topRule } from '../src/tui/frame.js';
import { Steps, stepLines } from '../src/tui/Steps.js';
import { noticeFor, setUpdateNotice } from '../src/update/check.js';
import { SAMPLE_PLAN, tempStore } from './helpers.js';

/**
 * Minimal stand-ins for a terminal.
 *
 * Hand-rolled rather than pulling in ink-testing-library: it is thirty lines,
 * and this suite exists partly to prove the TUI mounts without one.
 */
class FakeStdout extends EventEmitter {
  // Ink treats a non-TTY stream as "not worth drawing to" and withholds
  // frames, the same way it does in CI. A review UI is only ever mounted on a
  // real terminal, so claiming to be one is what makes this a fake terminal
  // rather than a fake pipe.
  isTTY = true;
  columns = 100;
  rows = 30;
  frames: string[] = [];

  write(data: string): boolean {
    this.frames.push(data);
    return true;
  }

  /**
   * The last frame with actual content.
   *
   * Ink writes control sequences to the same stream, so the final write is
   * sometimes just a cursor move — skip anything carrying no visible text.
   */
  get lastFrame(): string {
    for (let i = this.frames.length - 1; i >= 0; i--) {
      const text = plain(this.frames[i] ?? '');
      if (text.trim()) return text;
    }
    return '';
  }
}

/** Strip every escape sequence, not only the SGR ones `stripAnsi` handles. */
function plain(text: string): string {
  return stripAnsi(text)
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
    .replace(/\x1b\][^\x07]*\x07/g, '');
}

/**
 * Ink reads stdin with a `readable` listener plus `read()`, not `data` — so a
 * fake that only emits `data` silently delivers nothing. Mirroring the real
 * protocol is the whole point of this harness.
 */
class FakeStdin extends EventEmitter {
  isTTY = true;
  private queue: string[] = [];

  setRawMode(): void {}
  setEncoding(): void {}
  resume(): void {}
  pause(): void {}
  ref(): void {}
  unref(): void {}

  read(): string | null {
    return this.queue.shift() ?? null;
  }

  send(data: string): void {
    this.queue.push(data);
    this.emit('readable');
  }
}

let store: ReturnType<typeof tempStore>;

beforeEach(() => {
  store = tempStore();
  setColorEnabled(false);
});
afterEach(() => {
  store.cleanup();
  setColorEnabled(null);
});

/**
 * Poll until `predicate` holds, rather than sleeping a fixed span.
 *
 * Ink renders asynchronously, so "has it drawn yet" is a question about the
 * runner's load, not about elapsed time. A fixed sleep that covers a quiet
 * laptop is not a bound on a contended CI runner, and overrunning it reads as
 * an empty frame — an assertion failure indistinguishable from a real break.
 */
async function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) return false;
    await new Promise((r) => setTimeout(r, 10));
  }
  return true;
}

interface Harness {
  stdout: FakeStdout;
  stdin: FakeStdin;
  /** How many times a second ctrl+c asked to end the process. */
  quits: number[];
  unmount: () => void;
  result: Promise<ReviewResult>;
  press: (keys: string) => Promise<void>;
  /** Resolve once the app has drawn anything at all. */
  ready: () => Promise<void>;
  /** Wait for `text` to appear, then assert it — so a timeout shows the frame. */
  frame: (text: string) => Promise<void>;
}

function mount(
  planId: string,
  versionA: number | null,
  versionB: number,
  versions: number[] = [versionB],
  columns = 100,
  rows = 30,
  previous: Feedback[] = [],
  launchable?: Launchable,
  /** The clocks the review runs on: the held-arrow one, and the exit guard's. */
  timing: { now?: () => number; exitWindowMs?: number } = {},
): Harness {
  const stdout = new FakeStdout();
  stdout.columns = columns;
  stdout.rows = rows;
  const stdin = new FakeStdin();
  const quits: number[] = [];
  let resolve!: (value: ReviewResult) => void;
  const result = new Promise<ReviewResult>((r) => (resolve = r));

  const instance = render(
    <ReviewApp
      planId={planId}
      title="Guard the clock regression"
      versionA={versionA}
      versionB={versionB}
      versions={versions}
      mode="rich"
      version="9.9.9"
      previous={previous}
      launchable={launchable}
      now={timing.now}
      exitWindowMs={timing.exitWindowMs}
      onQuit={() => quits.push(Date.now())}
      onDone={resolve}
    />,
    {
      stdout: stdout as unknown as NodeJS.WriteStream,
      stdin: stdin as unknown as NodeJS.ReadStream,
      exitOnCtrlC: false,
      patchConsole: false,
    },
  );

  return {
    stdout,
    stdin,
    quits,
    unmount: () => instance.unmount(),
    result,
    press: async (keys: string) => {
      const before = stdout.frames.length;
      stdin.send(keys);
      // Ink debounces a pending escape before dispatching, so give it room.
      await new Promise((r) => setTimeout(r, 60));
      // Not every key redraws (an unknown key is dropped), so this is a best
      // effort nudge past a slow render, not a requirement.
      await waitFor(() => stdout.frames.length > before, 1_000);
    },
    ready: async () => {
      // A silent give-up here surfaces later as `expected '' to contain ...`,
      // which reads as a rendering bug rather than an app that never mounted.
      if (!(await waitFor(() => stdout.lastFrame.trim().length > 0))) {
        throw new Error(`the app never drew a frame (${stdout.frames.length} raw writes)`);
      }
    },
    frame: async (text: string) => {
      await waitFor(() => stdout.lastFrame.includes(text));
      expect(stdout.lastFrame).toContain(text);
    },
  };
}

function seed(): string {
  return capture({ text: SAMPLE_PLAN, source: 'test' }).planId;
}

/** A plan on v2, so there is a diff to toggle and a version to step back to. */
function seedTwoVersions(): string {
  const id = seed();
  capture({
    text: SAMPLE_PLAN.replace('10% then 50% then 100%', '1% then 10% then 100%'),
    planId: id,
    source: 'test',
  });
  return id;
}

/** A plan taller than the fake terminal, for the scroll keys. */
function seedLongPlan(): string {
  const body = Array.from({ length: 80 }, (_, i) => `- step ${i + 1}`).join('\n');
  return capture({ text: `# A long plan\n\n## Steps\n${body}\n\nTHE LAST LINE\n`, source: 'test' })
    .planId;
}

const ESC = '\x1b';
const ENTER = '\r';
const SPACE = ' ';
const DOWN = '\x1b[B';
const LEFT = '\x1b[D';
const RIGHT = '\x1b[C';
const BACKSPACE = '\x7f';
const CTRL_D = '\x04';
const CTRL_C = '\x03';
/** Option+arrow, as Terminal.app and iTerm each send it. */
const ALT_LEFT = '\x1b[1;3D';
const ALT_RIGHT = '\x1b[1;3C';
const META_B = '\x1bb';
const ARROW = '▸';
/** The closing corner of a note box — the thing that used to be missing. */
const BOX_CLOSE = '╮';

/** Every line of the drawn frame, blank ones dropped. */
function frameRows(frame: string): string[] {
  return frame.split('\n').filter((line) => line.trim());
}

/** Rows inside the frame — the top and bottom rules carry corners of their own. */
function bodyRows(frame: string): string[] {
  return frameRows(frame).filter((line) => line.startsWith('│'));
}

/**
 * Where a note box opens — the tee is in the rail's column by construction.
 *
 * Taken from the drawn frame rather than hard-coded, so the assertions below
 * are about the rail and the box sharing a column rather than about which
 * column that happens to be for this plan's line-number width.
 */
function boxColumn(rows: string[]): number {
  return rows.find((line) => line.includes('├─'))!.indexOf('├');
}

/**
 * The rail's column on one row, counted from the frame edge.
 *
 * The gutter is `│ ` then the arrow gutter then the line number, and the rail
 * sits between the number and the text — so it is wherever the run of digits
 * ends, whatever width this plan's line numbers happen to need.
 */
function boxColumnOf(row: string): number {
  return /^\S\s+\S?\s*\d+ /.exec(row)![0].length;
}

describe('the review frame', () => {
  it('names itself and its version, and points at the repo', async () => {
    const id = seed();
    const app = mount(id, null, 1);
    await app.ready();

    const frame = app.stdout.lastFrame;
    expect(frame).toContain('planx');
    expect(frame).toContain('9.9.9');
    expect(frame).toContain(id);
    expect(frame).toContain('github.com/thisisnsh/planx');
    app.unmount();
  });

  it('carries the header and the repo on the border itself, not on rows inside it', async () => {
    const id = seed();
    const app = mount(id, null, 1);
    await app.ready();

    const lines = frameRows(app.stdout.lastFrame);
    expect(lines[0]).toContain('╭─');
    expect(lines[0]).toContain(id);
    expect(lines.at(-1)).toContain('github.com/thisisnsh/planx');
    expect(lines.at(-1)).toContain('╯');
    app.unmount();
  });

  it('fills the terminal exactly, so Ink adds no newline under the bottom rule', async () => {
    // Short enough that the plan does not reach the bottom on its own: the
    // frame has to be padded to the terminal, not merely allowed to overflow.
    const app = mount(seed(), null, 1, [1], 100, 24);
    await app.ready();

    const frame = app.stdout.lastFrame;
    expect(frameRows(frame)).toHaveLength(24);
    expect(frame.split('\n')).toHaveLength(24);
    app.unmount();
  });

  it('does not change height as the cursor moves between kinds of row', async () => {
    const app = mount(seedTwoVersions(), 1, 2, [1, 2]);
    await app.ready();

    // A note, so the walk below crosses all three kinds of row: the collapsed
    // run the diff opens on, a line of the plan, and a feedback box.
    await app.press(DOWN);
    await app.press('f');
    await app.press('height check');
    await app.press(ENTER);
    await app.press('g');

    const heights = new Set<number>();
    const bars = new Set<string>();
    for (let i = 0; i < 6; i++) {
      const rows = bodyRows(app.stdout.lastFrame);
      heights.add(rows.length);
      // What the bar offers is how the row under the cursor names itself.
      bars.add(rows.slice(-2).map(inner).join(' · '));
      await app.press(DOWN);
    }

    expect([...bars].some((bar) => bar.includes('space expand'))).toBe(true);
    expect([...bars].some((bar) => bar.includes('space fold'))).toBe(true);
    expect([...bars].some((bar) => bar.includes('f feedback'))).toBe(true);
    expect(heights.size).toBe(1);
    app.unmount();
  });

  it('closes the frame in the same column on every row', async () => {
    const app = mount(seed(), null, 1);
    await app.ready();

    const widths = new Set(frameRows(app.stdout.lastFrame).map((line) => line.length));
    expect(widths.size).toBe(1);
    app.unmount();
  });

  it('leaves a blank row under the top rule, matching the one above the status', async () => {
    const app = mount(seed(), null, 1);
    await app.ready();

    const rows = frameRows(app.stdout.lastFrame);
    expect(rows[1]).toMatch(/^│\s+│$/);
    // The first line of the plan is on the row after it, not jammed against
    // the header.
    expect(rows[2]).toContain('# Guard the clock regression');
    app.unmount();
  });

  it('marks the current line with an arrow in the left gutter', async () => {
    const app = mount(seed(), null, 1);
    await app.frame(ARROW);
    app.unmount();
  });

  it('offers lowercase shortcuts, with x for execute and no c to collide with ctrl-c', async () => {
    const app = mount(seed(), null, 1);
    await app.ready();

    const frame = app.stdout.lastFrame;
    expect(frame).toContain('f feedback');
    expect(frame).toContain('n note');
    expect(frame).toContain('x execute');
    expect(frame).not.toContain('x exit');
    expect(frame).not.toContain('c comment');
    app.unmount();
  });

  /**
   * An empty submit used to be how you said the plan was fine, and `s` was on
   * the bar whether or not there was anything to send. `x` is that now, so `s`
   * appears when the version carries something it would write.
   */
  it('offers submit only once the version carries something', async () => {
    const app = mount(seed(), null, 1);
    await app.ready();

    expect(app.stdout.lastFrame).not.toContain('s submit');
    expect(app.stdout.lastFrame).not.toContain('a approve');

    await app.press('f');
    await app.press('needs work');
    await app.press(ENTER);
    await app.frame('s submit');
    app.unmount();
  });

  it('offers submit for a rewritten line, which nothing else would save', async () => {
    const app = mount(seed(), null, 1);
    await app.ready();

    await app.press('e');
    await app.press(' now');
    await app.press(ENTER);
    await app.frame('s submit');
    app.unmount();
  });
});

describe('feedback lives in the document', () => {
  it('opens an editable box on f, and typed keys stop being commands', async () => {
    const app = mount(seed(), null, 1);
    await app.ready();

    await app.press('f');
    // `s` submits in browse mode; here it has to be a letter.
    await app.press('slow start');
    await app.frame('slow start');
    app.unmount();
  });

  it('shows the space you just typed, mid-note', async () => {
    const app = mount(seed(), null, 1);
    await app.ready();

    await app.press('f');
    await app.press('a');
    await app.press(SPACE);
    await app.press('b');
    // Without a trailing space surviving the wrap, `a` and `a ` render
    // identically and the caret never moves as you type the space.
    await app.frame('a b');
    app.unmount();
  });

  /**
   * The box was append-only: every arrow fell through to the browse handler, so
   * `←` walked the document under the note you were typing in.
   */
  it('walks the caret through the note rather than the document', async () => {
    const app = mount(seed(), null, 1);
    await app.ready();

    await app.press('f');
    await app.press('the flag');
    await app.press(LEFT);
    await app.press(LEFT);
    await app.press(LEFT);
    await app.press(LEFT);
    await app.press('X');
    await app.frame('the Xflag');
    app.unmount();
  });

  it('deletes before the caret, not off the end', async () => {
    const app = mount(seed(), null, 1);
    await app.ready();

    await app.press('f');
    await app.press('abcd');
    await app.press(LEFT);
    await app.press(LEFT);
    await app.press(BACKSPACE);
    await app.frame('acd');
    app.unmount();
  });

  it('reaches the ends of the note with ^a and ^e', async () => {
    const app = mount(seed(), null, 1);
    await app.ready();

    await app.press('f');
    await app.press('flag');
    await app.press('\x01'); // ctrl+a
    await app.press('the ');
    await app.frame('the flag');
    await app.press('\x05'); // ctrl+e
    await app.press('!');
    await app.frame('the flag!');
    app.unmount();
  });

  /**
   * Option+arrow arrives two ways depending on how the terminal is configured,
   * and which one you get is a setting nobody remembers changing.
   */
  it('walks a word with option+arrow, in both encodings', async () => {
    const app = mount(seed(), null, 1);
    await app.ready();

    await app.press('f');
    await app.press('guard the write path');
    await app.press(ALT_LEFT);
    await app.press('R2 ');
    await app.frame('guard the write R2 path');

    await app.press(META_B);
    await app.press(META_B);
    await app.press('X');
    await app.frame('guard the Xwrite R2 path');

    await app.press(ALT_RIGHT);
    await app.press(ALT_RIGHT);
    await app.press('!');
    await app.frame('guard the Xwrite R2 !path');
    app.unmount();
  });

  /**
   * The box used to wrap a column narrower while it was being typed, to reserve
   * one for a caret sitting past the last character — so the text re-wrapped a
   * column wider the moment you pressed enter and visibly shifted.
   */
  it('lays the note out where it will sit once committed', async () => {
    const app = mount(seed(), null, 1);
    await app.ready();

    await app.press('f');
    await app.press('the poller reads a snapshot every fifteen seconds and writes it back');
    await new Promise((r) => setTimeout(r, 200));
    const typing = noteBox(app.stdout.lastFrame);

    await app.press(ENTER);
    await new Promise((r) => setTimeout(r, 200));

    expect(noteBox(app.stdout.lastFrame)).toEqual(typing);
    expect(typing.length).toBeGreaterThan(2);
    app.unmount();
  });

  it('wraps a word wider than the box instead of ending it in an ellipsis', async () => {
    const app = mount(seed(), null, 1);
    await app.ready();

    await app.press('f');
    await app.press('x'.repeat(90));
    await new Promise((r) => setTimeout(r, 160));

    const box = bodyRows(app.stdout.lastFrame).filter((l) => l.includes('xxx'));
    expect(box.length).toBeGreaterThan(1);
    expect(box.some((l) => l.includes('…'))).toBe(false);
    app.unmount();
  });

  it('keeps the note after enter, in a box closed on all four sides', async () => {
    const app = mount(seed(), null, 1);
    await app.ready();

    await app.press('f');
    await app.press('wrong layer');
    await app.press(ENTER);
    await app.frame('wrong layer');

    const box = frameRows(app.stdout.lastFrame).find((line) => line.includes('wrong layer'))!;
    // `│ wrong layer … │` — the right-hand edge is the whole point.
    expect(box).toMatch(/│\s+│\s+wrong layer\s+│\s+│/);
    app.unmount();
  });

  it('discards a new note left empty rather than leaving an empty box', async () => {
    const app = mount(seed(), null, 1);
    await app.ready();

    await app.press('f');
    await app.press(ESC);
    await new Promise((r) => setTimeout(r, 120));

    expect(bodyRows(app.stdout.lastFrame).some((l) => l.includes(BOX_CLOSE))).toBe(false);
    app.unmount();
  });

  it('space folds the note on this line down to its rail, and back', async () => {
    const app = mount(seed(), null, 1);
    await app.ready();

    // Off the H1 and onto a line of prose: on a heading, space folds the
    // section, which is what the row under the cursor says it will do.
    for (let i = 0; i < 3; i++) await app.press(DOWN);
    await app.press('f');
    await app.press('fold me');
    await app.press(ENTER);
    await app.frame('fold me');
    expect(bodyRows(app.stdout.lastFrame).filter((l) => l.includes('╯'))).toHaveLength(1);

    // From the annotated line itself, without stepping into the box.
    await app.press(SPACE);
    await new Promise((r) => setTimeout(r, 120));
    // One row left, still naming itself so a folded note is not a mystery, and
    // still on the rail rather than boxed off from the line it belongs to.
    expect(bodyRows(app.stdout.lastFrame).filter((l) => l.includes('╯'))).toHaveLength(0);
    const folded = bodyRows(app.stdout.lastFrame).find((l) => l.includes('fold me'))!;
    expect(folded).toContain('├─ ▸ fold me');
    expect(folded).not.toContain('╮');

    await app.press(SPACE);
    await new Promise((r) => setTimeout(r, 120));
    expect(bodyRows(app.stdout.lastFrame).filter((l) => l.includes('╯'))).toHaveLength(1);
    app.unmount();
  });

  it('h folds every note at once, keeping the plan readable', async () => {
    const app = mount(seed(), null, 1);
    await app.ready();

    await app.press('f');
    await app.press('hidden please');
    await app.press(ENTER);
    await app.frame('hidden please');

    await app.press('h');
    await new Promise((r) => setTimeout(r, 120));
    const lines = frameRows(app.stdout.lastFrame).filter((l) => l.includes('hidden please'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('▸ hidden please');
    app.unmount();
  });

  it('emptying a note deletes it, and no key claims to', async () => {
    const app = mount(seed(), null, 1);
    await app.ready();

    await app.press('f');
    await app.press('delete me');
    await app.press(ENTER);
    await app.frame('delete me');
    expect(app.stdout.lastFrame).not.toContain('d delete');

    // f reopens it on the line it is attached to; clearing it and committing
    // is the whole gesture.
    await app.press('f');
    for (let i = 0; i < 'delete me'.length; i++) await app.press(BACKSPACE);
    await app.press(ENTER);
    await new Promise((r) => setTimeout(r, 120));

    expect(app.stdout.lastFrame).not.toContain('delete me');
    app.unmount();
  });

  it('runs a rail down the annotated lines and hangs the box off it', async () => {
    const app = mount(seed(), null, 1);
    await app.ready();

    // Line 1 and line 2, so the rail has more than one row to span.
    await app.press('v');
    await app.press(DOWN);
    await app.press('f');
    await app.press('two lines');
    await app.press(ENTER);
    await app.frame('two lines');

    const rows = bodyRows(app.stdout.lastFrame);
    const first = rows.findIndex((l) => l.includes('# Guard the clock regression'));
    const rail = boxColumn(rows);

    // Lines 1 and 2 are both covered, so the rail runs down both of them, then
    // the box opens off it with `├` — a `╭` there would read as two separate
    // objects that happen to be adjacent.
    expect(rows[first]![rail]).toBe('│');
    expect(rows[first + 1]![rail]).toBe('│');
    expect(rows[first + 2]).toContain('├─');

    // …and nowhere else: an unannotated line keeps its blank rail column.
    expect(rows.find((l) => l.includes('## Context'))![rail]).toBe(' ');
    app.unmount();
  });

  it('puts the rail between the line number and the text, not out in the margin', async () => {
    const app = mount(seed(), null, 1);
    await app.ready();

    await app.press('f');
    await app.press('beside it');
    await app.press(ENTER);
    await app.frame('beside it');

    const rows = bodyRows(app.stdout.lastFrame);
    const rail = boxColumn(rows);
    const annotated = rows[rows.findIndex((l) => l.includes('# Guard the clock regression'))]!;

    // The line number is behind the rail and the text is in front of it, so the
    // note's words and the plan's words start on the same column.
    expect(annotated.slice(0, rail)).toMatch(/1\s*$/);
    expect(annotated.indexOf('# Guard')).toBe(rail + 2);
    expect(rows.find((l) => l.includes('beside it'))!.indexOf('beside it')).toBe(rail + 2);
    app.unmount();
  });

  it('steps into the note, so the box is a thing the cursor can point at', async () => {
    const app = mount(seed(), null, 1);
    await app.ready();

    await app.press('f');
    await app.press('on line one');
    await app.press(ENTER);
    await app.frame('on line one');

    // One press off line 1 lands on the note's own line. The box's top edge is
    // drawn between them and passed over: a cursor beside `├───╮` points at a
    // corner, and getting to the words cost a second press to say so.
    await app.press(DOWN);
    await new Promise((r) => setTimeout(r, 120));
    expect(cursorRow(bodyRows(app.stdout.lastFrame))).toContain('on line one');

    // And one more press is out the other side, however tall the box is.
    await app.press(DOWN);
    await new Promise((r) => setTimeout(r, 120));
    const out = cursorRow(bodyRows(app.stdout.lastFrame))!;
    expect(out).not.toContain('on line one');
    expect(out).not.toContain('╯');
    app.unmount();
  });

  it('walks over a folded note in one press, and back out again', async () => {
    const app = mount(seed(), null, 1);
    await app.ready();

    await app.press('f');
    await app.press('folded');
    await app.press(ENTER);
    await app.frame('folded');
    await app.press('h'); // fold every note — the box is one row now
    await app.frame('▸ folded');

    // Line 1, the folded rail, line 2.
    await app.press(DOWN);
    await new Promise((r) => setTimeout(r, 120));
    expect(cursorRow(bodyRows(app.stdout.lastFrame))).toContain('folded');

    await app.press(DOWN);
    await new Promise((r) => setTimeout(r, 120));
    expect(cursorRow(bodyRows(app.stdout.lastFrame))).not.toContain('folded');
    app.unmount();
  });

  it('folds the note from inside the box, and the cursor stays on it', async () => {
    const app = mount(seed(), null, 1);
    await app.ready();

    await app.press('f');
    await app.press('fold from within');
    await app.press(ENTER);
    await app.frame('fold from within');

    await app.press(DOWN);
    await app.frame('space fold');

    await app.press(SPACE);
    await new Promise((r) => setTimeout(r, 120));

    const rows = bodyRows(app.stdout.lastFrame);
    expect(rows.filter((l) => l.includes('╯'))).toHaveLength(0);
    const folded = rows.find((l) => l.includes('fold from within'))!;
    expect(folded).toContain('├─ ▸ fold from within');
    // Still under the cursor, so space puts it straight back.
    expect(cursorRow(rows)).toBe(folded);

    // And back: the box reopens under a cursor that cannot rest on its top
    // edge, so the note's first line is where it ends up.
    await app.press(SPACE);
    await new Promise((r) => setTimeout(r, 120));
    expect(cursorRow(bodyRows(app.stdout.lastFrame))).toContain('fold from within');
    expect(cursorRow(bodyRows(app.stdout.lastFrame))).toContain('│');
    app.unmount();
  });
});

/**
 * A review could only *ask* for a change before this: the reviewer wrote a note,
 * the agent rewrote, a new version landed, and a wrong word cost a whole round
 * trip through an agent that had to guess which word was meant.
 */
describe('rewriting a line in place', () => {
  it('opens the line under the cursor, and typed keys stop being commands', async () => {
    const app = mount(seed(), null, 1);
    await app.ready();

    await app.press('e');
    await app.frame('enter save line');
    // `s` submits in browse mode; here it has to be a letter, at the caret.
    await app.press(' says so');
    await app.frame('# Guard the clock regression says so');
    app.unmount();
  });

  it('marks the committed line in the sign column and counts it', async () => {
    const id = seed();
    const app = mount(id, null, 1);
    await app.ready();
    // A plan with no diff on screen pays for no sign column at all.
    expect(app.stdout.lastFrame).not.toContain('~');

    await app.press('e');
    await app.press(' now');
    await app.press(ENTER);
    await app.frame('1 line edited on this version.');

    const row = bodyRows(app.stdout.lastFrame).find((l) => l.includes('# Guard'))!;
    expect(row).toContain('# Guard the clock regression now');
    expect(row).toMatch(/~\s*1\s/);
    // Nothing is on disk until it is submitted.
    expect(readVersionText(id, 1)).toContain('# Guard the clock regression\n');
    app.unmount();
  });

  it('esc puts the line back as it was', async () => {
    const app = mount(seed(), null, 1);
    await app.ready();

    await app.press('e');
    await app.press(' oops');
    await app.frame('# Guard the clock regression oops');

    await app.press(ESC);
    await new Promise((r) => setTimeout(r, 120));
    expect(app.stdout.lastFrame).not.toContain('oops');
    expect(app.stdout.lastFrame).not.toContain('line edited on this version');
    app.unmount();
  });

  it('types at the caret — ← moves it, not the version, and ^a goes to the start', async () => {
    const app = mount(seedTwoVersions(), null, 2, [1, 2]);
    await app.ready();

    await app.press('e');
    await app.press(LEFT);
    await app.press('!');
    await app.press(ENTER);
    await app.frame('# Guard the clock regressio!n');
    // Still v2: the mode is explicit, so ← never stepped a version.
    expect(frameRows(app.stdout.lastFrame)[0]).toContain('v2');

    await app.press('e');
    await app.press('\x01'); // ^a
    await app.press('> ');
    await app.press(ENTER);
    await app.frame('> # Guard the clock regressio!n');
    app.unmount();
  });

  it('walks a selection, one line at a time from the top', async () => {
    const app = mount(seed(), null, 1);
    await app.ready();

    await app.press('v');
    await app.press(DOWN);
    await app.press('e');
    await app.press(' one');
    await app.press(ENTER);
    // enter commits and opens the next line of the span rather than browsing.
    await app.frame('enter save line');
    await app.press('two');
    await app.press(ENTER);

    await app.frame('2 lines edited on this version.');
    expect(app.stdout.lastFrame).toContain('# Guard the clock regression one');
    expect(app.stdout.lastFrame).toContain('two');
    app.unmount();
  });

  it('refuses any version but the latest, and says which one that is', async () => {
    const app = mount(seedTwoVersions(), null, 2, [1, 2]);
    await app.ready();
    await app.frame('e rewrite line');

    await app.press(LEFT);
    await app.frame('10% then 50% then 100%');
    expect(app.stdout.lastFrame).not.toContain('e rewrite line');

    await app.press('e');
    await app.frame('Only v2 can be edited — press → to reach it.');
    app.unmount();
  });

  it('sends you to f on a note, and declines a row that is not a line', async () => {
    const app = mount(seed(), null, 1);
    await app.ready();

    await app.press('f');
    await app.press('not a line');
    await app.press(ENTER);
    await app.frame('not a line');

    await app.press(DOWN);
    await app.press('e');
    await app.frame('That is feedback — press f to edit it.');
    app.unmount();
  });

  it('declines a collapsed run, which stands for lines rather than being one', async () => {
    const app = mount(seedTwoVersions(), 1, 2, [1, 2]);
    await app.ready();
    await app.frame('unchanged lines');

    await app.press('e');
    await app.frame('Nothing to edit there.');
    app.unmount();
  });

  it('counts as something to submit, and something to lose', async () => {
    const app = mount(seed(), null, 1);
    await app.ready();

    await app.press('e');
    await app.press(' rewritten');
    await app.press(ENTER);
    await app.frame('1 line edited on this version.');

    // Leaving names them: an edit is on disk no sooner than a note is.
    await app.press(ESC);
    await app.frame('1 edited line has not been submitted and will be lost.');
    await app.press(ESC);

    await app.press('s');
    // The prompt is always drawn, so finishing takes its answer too.
    await app.press('1');
    const result = await app.result;
    expect(result.editedVersion).toBe(1);
    expect(result.edits).toEqual([{ line: 1, text: '# Guard the clock regression rewritten' }]);
    // The edited version is submitted too, so `planx revise` has a record to
    // report the edits against even when nothing was commented on.
    expect(result.batches.map((b) => b.version)).toEqual([1]);
    app.unmount();
  });

  it('follows the version it belongs to, not the one you finished on', async () => {
    const app = mount(seedTwoVersions(), null, 2, [1, 2]);
    await app.ready();

    await app.press('e');
    await app.press(' rewritten');
    await app.press(ENTER);
    await app.frame('1 line edited on this version.');

    // v1 is not the version that was edited, so it says nothing about them.
    await app.press(LEFT);
    await app.frame('10% then 50% then 100%');
    expect(app.stdout.lastFrame).not.toContain('line edited on this version');

    await app.press('s');
    // The prompt is always drawn, so finishing takes its answer too.
    await app.press('1');
    const result = await app.result;
    expect(result.editedVersion).toBe(2);
    expect(result.batches.map((b) => b.version)).toEqual([1, 2]);
    app.unmount();
  });
});

describe('folding a section', () => {
  it('space on a heading hides what is under it, and says how much', async () => {
    const app = mount(seed(), null, 1);
    await app.ready();

    // Onto `## Context`, which runs to the line before `## Approach`.
    await app.press(DOWN);
    await app.press(DOWN);
    await app.frame('space fold section');

    await app.press(SPACE);
    await app.frame('⋯ 3 lines');
    expect(app.stdout.lastFrame).not.toContain('The poller reads a snapshot');
    // Its own heading stays, and so does everything after the section.
    expect(app.stdout.lastFrame).toContain('## Context');
    expect(app.stdout.lastFrame).toContain('## Approach');

    await app.press(SPACE);
    await app.frame('The poller reads a snapshot');
    app.unmount();
  });

  it('says so on a row of its own, the way a collapsed run does', async () => {
    const app = mount(seed(), null, 1);
    await app.ready();

    await app.press(DOWN);
    await app.press(DOWN);
    await app.frame('space fold section');
    await app.press(SPACE);
    await app.frame('(space to expand)');

    const rows = bodyRows(app.stdout.lastFrame);
    const heading = rows.find((l) => l.includes('## Context'))!;
    const summary = rows.find((l) => l.includes('lines (space to expand)'))!;
    // The heading is its own text again, with what it hides on the next row —
    // left of the rail column, where a line number would be.
    expect(heading).not.toContain('⋯');
    expect(rows.indexOf(summary)).toBe(rows.indexOf(heading) + 1);
    expect(summary.indexOf('⋯')).toBeLessThan(boxColumnOf(heading));
    app.unmount();
  });

  it('expands from the summary row as well as from the heading', async () => {
    const app = mount(seed(), null, 1);
    await app.ready();

    await app.press(DOWN);
    await app.press(DOWN);
    await app.press(SPACE);
    await app.frame('(space to expand)');

    // Down onto the summary row itself, which offers the key it names.
    await app.press(DOWN);
    await app.frame('space unfold section');
    expect(cursorRow(bodyRows(app.stdout.lastFrame))).toContain('(space to expand)');
    // Nothing on it to comment on, so the key is not offered.
    expect(app.stdout.lastFrame).not.toContain('f feedback');

    await app.press(SPACE);
    await app.frame('The poller reads a snapshot');
    expect(app.stdout.lastFrame).not.toContain('(space to expand)');
    app.unmount();
  });

  it('takes the subsections with it, and never folds the deepest headings', async () => {
    const id = capture({
      text: [
        '# Deep',
        '',
        '## One',
        'a',
        '',
        '### Under one',
        'b',
        '',
        '##### Too deep',
        'c',
        '',
        '## Two',
        'd',
        '',
      ].join('\n'),
      source: 'test',
    }).planId;
    const app = mount(id, null, 1);
    await app.ready();

    await app.press(DOWN);
    await app.press(DOWN);
    await app.frame('space fold section');
    await app.press(SPACE);
    await app.frame('⋯');

    // `## One` swallowed its `###`, and stopped at the next `##`.
    expect(app.stdout.lastFrame).not.toContain('### Under one');
    expect(app.stdout.lastFrame).toContain('## Two');

    // `#####` is a paragraph with a title on it; folding it saves nothing, so
    // the section it is standing in is what space takes. Unfolding first,
    // because it is buried in the section that was just folded away.
    await app.press(SPACE);
    await app.frame('### Under one');
    await app.press('g');
    for (let i = 0; i < 8; i++) await app.press(DOWN);
    expect(cursorRow(bodyRows(app.stdout.lastFrame))).toContain('##### Too deep');

    await app.press(SPACE);
    await app.frame('⋯');
    expect(app.stdout.lastFrame).toContain('### Under one');
    expect(app.stdout.lastFrame).not.toContain('##### Too deep');
    // `## One` is still open around it: the `###` is the nearest thing to fold.
    expect(app.stdout.lastFrame).toContain('## One');
    app.unmount();
  });

  /**
   * Folding what you have just read used to mean scrolling back up to its
   * heading first. Space now takes the section you are standing in.
   */
  it('collapses the enclosing section from a line inside it', async () => {
    const app = mount(seed(), null, 1);
    await app.ready();

    // Three rows down: inside `## Context`, not on its heading.
    await app.press(DOWN);
    await app.press(DOWN);
    await app.press(DOWN);
    await app.frame('The poller reads a snapshot');
    expect(cursorRow(bodyRows(app.stdout.lastFrame))).not.toContain('## Context');

    await app.press(SPACE);
    await app.frame('(space to expand)');
    expect(app.stdout.lastFrame).not.toContain('The poller reads a snapshot');
    expect(app.stdout.lastFrame).toContain('## Context');

    // The rows it was on are gone, so the cursor lands on the one that now
    // stands for where it was.
    expect(cursorRow(bodyRows(app.stdout.lastFrame))).toContain('(space to expand)');

    // And on that row space expands rather than collapsing again.
    await app.press(SPACE);
    await app.frame('The poller reads a snapshot');
    app.unmount();
  });

  it('does nothing, and offers nothing, above the first heading', async () => {
    const id = capture({
      text: ['a line before anything', '', '## One', 'a', 'b', ''].join('\n'),
      source: 'test',
    }).planId;
    const app = mount(id, null, 1);
    await app.ready();

    // There is no heading above this line for space to reach.
    expect(cursorRow(bodyRows(app.stdout.lastFrame))).toContain('a line before anything');
    expect(app.stdout.lastFrame).not.toContain('space ');

    const before = bodyRows(app.stdout.lastFrame);
    await app.press(SPACE);
    await new Promise((r) => setTimeout(r, 120));
    expect(bodyRows(app.stdout.lastFrame)).toEqual(before);
    app.unmount();
  });

  it('keeps feedback findable: the count on the fold, the rail beside it', async () => {
    const app = mount(seed(), null, 1);
    await app.ready();

    // A note on the line under `## Context`, then fold the section over it.
    await app.press(DOWN);
    await app.press(DOWN);
    await app.press(DOWN);
    await app.press('f');
    await app.press('buried');
    await app.press(ENTER);
    await app.frame('buried');

    await app.press('\x1b[A'); // back up onto the heading
    await app.press(SPACE);
    await app.frame('· 1 feedback');
    expect(app.stdout.lastFrame).not.toContain('buried');

    const folded = bodyRows(app.stdout.lastFrame).find((l) => l.includes('## Context'))!;
    expect(folded[boxColumnOf(folded)]).toBe('│');
    app.unmount();
  });
});

describe('j walks the feedback', () => {
  it('steps forward in document order, wrapping at the end', async () => {
    const app = mount(seed(), null, 1);
    await app.ready();

    await app.press(DOWN);
    await app.press('f');
    await app.press('first');
    await app.press(ENTER);
    for (let i = 0; i < 4; i++) await app.press(DOWN);
    await app.press('f');
    await app.press('second');
    await app.press(ENTER);
    await app.frame('second');

    await app.press('g');
    await app.press('j');
    await app.frame('j next feedback');
    expect(cursorRow(bodyRows(app.stdout.lastFrame))).toContain('first');

    await app.press('j');
    await new Promise((r) => setTimeout(r, 120));
    expect(cursorRow(bodyRows(app.stdout.lastFrame))).toContain('second');

    // Forward only, so the last one leads back to the first.
    await app.press('j');
    await new Promise((r) => setTimeout(r, 120));
    expect(cursorRow(bodyRows(app.stdout.lastFrame))).toContain('first');
    app.unmount();
  });

  it('unfolds a section to reach the feedback inside it', async () => {
    const app = mount(seed(), null, 1);
    await app.ready();

    await app.press(DOWN);
    await app.press(DOWN);
    await app.press(DOWN);
    await app.press('f');
    await app.press('inside');
    await app.press(ENTER);
    await app.frame('inside');

    await app.press('\x1b[A');
    await app.press(SPACE);
    await app.frame('⋯');
    expect(app.stdout.lastFrame).not.toContain('inside');

    await app.press('j');
    await app.frame('inside');
    expect(cursorRow(bodyRows(app.stdout.lastFrame))).toContain('inside');
    app.unmount();
  });

  it('is offered only where there is feedback to walk', async () => {
    const app = mount(seed(), null, 1);
    await app.ready();
    expect(app.stdout.lastFrame).not.toContain('j next feedback');

    await app.press(DOWN);
    await app.press('f');
    await app.press('something');
    await app.press(ENTER);
    await app.frame('j next feedback');
    app.unmount();
  });
});

describe('submitting', () => {
  // A review that asked for nothing ends in `x`: the plan is fine, so build it.
  it('executes a version nobody had anything to say about', async () => {
    const app = mount(seed(), null, 1);
    await app.ready();

    await app.press('x');
    // The prompt is always drawn, so finishing takes its answer too.
    await app.press('1');
    const result = await app.result;
    expect(result.action).toBe('execute');
    expect(result.batches).toEqual([{ version: 1, annotations: [], general: '' }]);
    app.unmount();
  });

  it('ignores s when there is nothing to submit', async () => {
    const app = mount(seed(), null, 1);
    await app.ready();

    await app.press('s');
    await new Promise((r) => setTimeout(r, 120));
    // Still on the plan: no prompt, no hand-off, nothing resolved.
    expect(app.stdout.lastFrame).toContain('# Guard the clock regression');
    expect(app.stdout.lastFrame).not.toContain('Submit feedback for');
    app.unmount();
  });

  it('submits the note with s', async () => {
    const app = mount(seed(), null, 1);
    await app.ready();

    await app.press('f');
    await app.press('needs work');
    await app.press(ENTER);
    await app.frame('needs work');
    await app.press('s');
    // The prompt is always drawn, so finishing takes its answer too.
    await app.press('1');

    const result = await app.result;
    expect(result.action).toBe('submit');
    expect(result.batches[0]?.version).toBe(1);
    expect(result.batches[0]?.annotations[0]?.comment).toBe('needs work');
    app.unmount();
  });

  /**
   * A plan being built with comments still on it is a supported thing now, so
   * `x` writes them on the way out rather than warning about them.
   */
  it('x submits what is on screen and then executes', async () => {
    const app = mount(seed(), null, 1);
    await app.ready();

    await app.press('f');
    await app.press('one thing');
    await app.press(ENTER);
    await app.frame('one thing');

    await app.press('x');
    // The prompt is always drawn, so finishing takes its answer too.
    await app.press('1');
    const result = await app.result;
    expect(result.action).toBe('execute');
    expect(result.batches[0]?.annotations[0]?.comment).toBe('one thing');
    app.unmount();
  });

  it('esc asks before going back to the list, and esc again stays', async () => {
    const app = mount(seed(), null, 1);
    await app.ready();

    await app.press(ESC);
    await app.frame('Back to the list?');
    await app.press(ESC);
    await new Promise((r) => setTimeout(r, 120));
    expect(app.stdout.lastFrame).not.toContain('Back to the list?');

    await app.press(ESC);
    await app.press(ENTER);
    expect((await app.result).action).toBe('back');
    app.unmount();
  });

  it('warns that pending feedback goes with you', async () => {
    const app = mount(seed(), null, 1);
    await app.ready();

    await app.press('f');
    await app.press('unsent');
    await app.press(ENTER);
    await app.frame('unsent');

    await app.press(ESC);
    await app.frame('will be lost');
    app.unmount();
  });
});

/**
 * planx knows which plan, which version and which session wrote it, so it can
 * run the command it would otherwise have printed. The question is two rows the
 * frame already has, not a screen of its own.
 */
describe('the hand-off prompt', () => {
  const CAN: Launchable = { 1: { revise: true, execute: true } };

  it('asks on x, and again on s, naming what it is about to do', async () => {
    const id = seed();
    const app = mount(id, null, 1, [1], 100, 30, [], CAN);
    await app.ready();

    await app.press('x');
    await app.frame(`Execute ${id} v1?`);
    expect(app.stdout.lastFrame).toContain('1 execute in a new agent');
    expect(app.stdout.lastFrame).toContain('2 give me the command');
    expect(app.stdout.lastFrame).toContain('esc back');
    // The plan is still behind the question.
    expect(app.stdout.lastFrame).toContain('# Guard the clock regression');

    await app.press(ESC);
    await app.frame('x execute');

    await app.press('f');
    await app.press('one more thing');
    await app.press(ENTER);
    await app.press('s');
    await app.frame(`Submit feedback for ${id} v1?`);
    expect(app.stdout.lastFrame).toContain('1 revise in the agent');
    app.unmount();
  });

  it('does not change the height of the frame while it is up', async () => {
    const app = mount(seed(), null, 1, [1], 100, 30, [], CAN);
    await app.ready();
    const before = bodyRows(app.stdout.lastFrame).length;

    await app.press('x');
    await app.frame('give me the command');
    expect(bodyRows(app.stdout.lastFrame)).toHaveLength(before);
    app.unmount();
  });

  it('takes 1 as the agent and 2 as the command, and ignores everything else', async () => {
    const app = mount(seed(), null, 1, [1], 100, 30, [], CAN);
    await app.ready();

    await app.press('x');
    await app.frame('give me the command');
    // A key the prompt does not answer to falls through to nothing, rather than
    // reaching the document underneath.
    await app.press('g');
    await new Promise((r) => setTimeout(r, 120));
    expect(app.stdout.lastFrame).toContain('give me the command');

    await app.press('2');
    const result = await app.result;
    expect(result).toMatchObject({ action: 'execute', handoff: 'command' });
    app.unmount();
  });

  it('hands the agent the work when 1 is pressed', async () => {
    const app = mount(seed(), null, 1, [1], 100, 30, [], CAN);
    await app.ready();

    await app.press('f');
    await app.press('needs work');
    await app.press(ENTER);
    await app.press('s');
    await app.frame('1 revise in the agent');
    await app.press('1');

    expect(await app.result).toMatchObject({ action: 'submit', handoff: 'agent' });
    app.unmount();
  });

  /**
   * A version captured before planx recorded sessions has nothing to start, so
   * the command is the whole list rather than the second half of one — and it
   * answers to `1`, because the number is the position on screen. The prompt is
   * still drawn: a key that silently did nothing read as a bug.
   */
  it('offers the command as the only option when there is no agent to start', async () => {
    const app = mount(seed(), null, 1, [1], 100, 30, [], { 1: { revise: false, execute: false } });
    await app.ready();

    await app.press('x');
    await app.frame('1 give me the command');
    expect(app.stdout.lastFrame).toContain('Execute ');
    expect(app.stdout.lastFrame).not.toContain('2 give me the command');
    expect(app.stdout.lastFrame).not.toContain('execute in a new agent');

    await app.press('1');
    expect(await app.result).toMatchObject({ action: 'execute', handoff: 'command' });
    app.unmount();
  });

  it('asks per intent: no session to fork, but an agent to execute in', async () => {
    const app = mount(seed(), null, 1, [1], 100, 30, [], { 1: { revise: false, execute: true } });
    await app.ready();

    // Execute can start something, so the agent is option 1.
    await app.press('x');
    await app.frame('1 execute in a new agent');
    await app.press(ESC);

    await app.press('f');
    await app.press('needs work');
    await app.press(ENTER);
    await app.press('s');
    await app.frame('1 give me the command');
    await app.press('1');
    expect(await app.result).toMatchObject({ action: 'submit', handoff: 'command' });
    app.unmount();
  });

  it('ignores 2 where there is no second option', async () => {
    const app = mount(seed(), null, 1, [1], 100, 30, [], { 1: { revise: false, execute: false } });
    await app.ready();

    await app.press('x');
    await app.frame('1 give me the command');
    await app.press('2');
    await new Promise((r) => setTimeout(r, 120));
    expect(app.stdout.lastFrame).toContain('1 give me the command');
    app.unmount();
  });
});

/**
 * `x` is execute now, so the way out is a key that means the same thing in
 * every mode — including the ones that swallow every printable character.
 */
describe('ctrl+c, twice', () => {
  it('arms on the first press and leaves on the second', async () => {
    const app = mount(seed(), null, 1);
    await app.ready();

    await app.press(CTRL_C);
    await app.frame('Press ctrl+c again to exit.');
    expect(app.quits).toEqual([]);

    await app.press(CTRL_C);
    await waitFor(() => app.quits.length > 0);
    expect(app.quits).toHaveLength(1);
    app.unmount();
  });

  it('disarms on any other key', async () => {
    const app = mount(seed(), null, 1);
    await app.ready();

    await app.press(CTRL_C);
    await app.frame('Press ctrl+c again to exit.');
    await app.press(DOWN);
    await new Promise((r) => setTimeout(r, 120));
    expect(app.stdout.lastFrame).not.toContain('Press ctrl+c again');

    await app.press(CTRL_C);
    await app.frame('Press ctrl+c again to exit.');
    expect(app.quits).toEqual([]);
    app.unmount();
  });

  it('fires while a note is being typed, where every letter is a letter', async () => {
    const app = mount(seed(), null, 1);
    await app.ready();

    await app.press('f');
    await app.press('half a thought');
    await app.press(CTRL_C);
    await app.frame('Press ctrl+c again to exit.');

    await app.press(CTRL_C);
    await waitFor(() => app.quits.length > 0);
    expect(app.quits).toHaveLength(1);
    app.unmount();
  });

  /**
   * The window is the prop rather than the real two seconds: a test that waits
   * out a timer is a test that either sleeps for two seconds or flakes.
   */
  it('exits on a second press inside the window', async () => {
    const app = mount(seed(), null, 1, [1], 100, 30, [], undefined, { exitWindowMs: 400 });
    await app.ready();

    await app.press(CTRL_C);
    await app.frame('Press ctrl+c again to exit.');
    await app.press(CTRL_C);
    await waitFor(() => app.quits.length > 0);
    expect(app.quits).toHaveLength(1);
    app.unmount();
  });

  it('disarms on its own once the window has passed, and re-arms on the next press', async () => {
    const app = mount(seed(), null, 1, [1], 100, 30, [], undefined, { exitWindowMs: 200 });
    await app.ready();
    await app.press(DOWN);
    await app.press('f');
    await app.press('a note');
    await app.press(ENTER);
    await app.frame('This version has 1 feedback.');

    await app.press(CTRL_C);
    await app.frame('Press ctrl+c again to exit.');
    // The question stands alone while it is up.
    expect(app.stdout.lastFrame).not.toContain('This version has 1 feedback.');

    await waitFor(() => !app.stdout.lastFrame.includes('Press ctrl+c again'));
    expect(app.stdout.lastFrame).not.toContain('Press ctrl+c again');
    // And what the version holds is back underneath.
    expect(app.stdout.lastFrame).toContain('This version has 1 feedback.');

    // Past the window, so this is a first press again rather than a second.
    await app.press(CTRL_C);
    await app.frame('Press ctrl+c again to exit.');
    expect(app.quits).toEqual([]);
    app.unmount();
  });

  it('does the same in the picker, over the delete confirmation', async () => {
    const app = mountPicker(planRows(), () => []);
    await app.ready();

    await app.press(CTRL_D);
    await app.frame('cannot be undone');
    await app.press(CTRL_C);
    await app.frame('Press ctrl+c again to exit.');
    // The confirmation is still there, and still unanswered.
    expect(app.stdout.lastFrame).toContain('cannot be undone');

    await app.press(CTRL_C);
    await waitFor(() => app.quits.length > 0);
    expect(app.quits).toHaveLength(1);
    app.unmount();
  });
});

/** The text between the frame's two edges. */
/** The note box, top edge to bottom, as it is drawn inside the frame. */
function noteBox(frame: string): string[] {
  const rows = bodyRows(frame).map((row) => inner(row));
  const top = rows.findIndex((row) => row.includes('├'));
  const bottom = rows.findIndex((row) => row.includes('╯'));
  return top === -1 || bottom === -1 ? [] : rows.slice(top, bottom + 1);
}

function inner(row: string): string {
  return row.replace(/^│\s*/, '').replace(/\s*│$/, '').trimEnd();
}

/**
 * The row the cursor is on.
 *
 * By column, not by searching for the glyph: a folded note draws `▸` inside its
 * own title, so `includes(ARROW)` finds a row the cursor is nowhere near.
 */
function cursorRow(rows: string[]): string | undefined {
  return rows.find((row) => row[2] === ARROW);
}

// Wide enough that nothing is cut, so these are about the order rather than
// about what happens to fall off the end of a narrow terminal.
describe('the keys, and where they sit', () => {
  it('puts the hints in one order: arrows, then a to z, then esc, then ?', async () => {
    const app = mount(seedTwoVersions(), 1, 2, [1, 2], 200);
    await app.ready();
    // Off the collapsed run the diff opens on, onto a line of the plan.
    await app.press(DOWN);
    await app.frame('f feedback');
    // Something to submit, so `s` is on the bar to be ordered.
    await app.press('f');
    await app.press('a note');
    await app.press(ENTER);
    await app.frame('s submit');

    const keys = inner(bodyRows(app.stdout.lastFrame).at(-1)!)
      .split(' · ')
      .map((part) => part.split(' ')[0]!);
    expect(keys).toEqual(['←→', 'd', 'e', 'f', 'j', 'n', 's', 'space', 'v', 'x', 'esc', '?']);
    app.unmount();
  });

  it('keeps h out of the bar, and in the help', async () => {
    const app = mount(seedTwoVersions(), 1, 2, [1, 2], 200);
    await app.ready();
    await app.press(DOWN);
    await app.frame('f feedback');
    expect(app.stdout.lastFrame).not.toContain('h fold notes');

    await app.press('?');
    await app.frame('planx review');
    expect(app.stdout.lastFrame).toContain('fold or unfold every note at once');
    app.unmount();
  });

  it('folds the bar at 80 columns instead of cutting the keys that end it', async () => {
    const app = mount(seedTwoVersions(), 1, 2, [1, 2], 80);
    await app.ready();
    await app.press(DOWN);
    await app.frame('f feedback');
    await app.press('f');
    await app.press('a note');
    await app.press(ENTER);
    await app.frame('s submit');

    // The five the fixed order always put last, and so always lost.
    const bar = bodyRows(app.stdout.lastFrame).slice(-3).map(inner).join(' · ');
    for (const pair of ['s submit', 'v select lines', 'x execute', 'esc back', '? help']) {
      expect(bar).toContain(pair);
    }
    app.unmount();
  });

  it('lists the same keys in the same order under ?', async () => {
    const app = mount(seedTwoVersions(), 1, 2, [1, 2], 200);
    await app.ready();

    await app.press('?');
    await app.frame('planx review');

    const keys = bodyRows(app.stdout.lastFrame)
      .map((row) =>
        inner(row)
          .split(/\s{2,}/)[0]!
          .trim(),
      )
      // Prose rows — the heading, the closing note, the hint line — have no
      // key column, so they come out as a whole sentence.
      .filter((key) => key.length > 0 && key.length <= 5);
    expect(keys).toEqual([
      '←→',
      '↑↓',
      'd',
      '^d ^u',
      'e',
      'f',
      '^f ^b',
      'g G',
      'h',
      'j',
      'n',
      's',
      'space',
      'v',
      'x',
      'esc',
      '?',
    ]);
    app.unmount();
  });

  it('agrees with the size of what e would act on', async () => {
    const app = mount(seed(), null, 1);
    await app.ready();
    await app.frame('e rewrite line');
    expect(app.stdout.lastFrame).not.toContain('e rewrite lines');

    await app.press('v');
    await app.press(DOWN);
    await app.frame('e rewrite lines');
    // And `v` now says how to undo itself, since esc no longer does.
    expect(app.stdout.lastFrame).toContain('v unselect lines');
    app.unmount();
  });

  it('says show diff and hide diff, not diff and plan', async () => {
    const app = mount(seedTwoVersions(), 1, 2, [1, 2]);
    await app.ready();
    await app.frame('d hide diff');

    await app.press('d');
    await app.frame('d show diff');
    app.unmount();
  });
});

describe('the whole-plan note', () => {
  it('is one labelled row, not a box, and shows what is being typed', async () => {
    const app = mount(seed(), null, 1);
    await app.ready();
    const before = bodyRows(app.stdout.lastFrame).length;

    await app.press('n');
    await app.press('halfway through');
    await app.frame('Global Note: halfway through');

    // Written on one row, and the frame is exactly as tall as it was — the
    // three-row box used to eat the plan.
    const rows = bodyRows(app.stdout.lastFrame);
    expect(rows).toHaveLength(before);
    expect(rows.some((l) => l.includes('Global Note: halfway through'))).toBe(true);
    expect(rows.some((l) => l.includes('enter save · esc cancel'))).toBe(true);
    expect(rows.some((l) => l.includes(BOX_CLOSE))).toBe(false);
    app.unmount();
  });

  it('keeps the note on that row after enter, and takes esc as a discard', async () => {
    const app = mount(seed(), null, 1);
    await app.ready();

    await app.press('n');
    await app.press('ship it behind the flag');
    await app.press(ENTER);
    await app.frame('Global Note: ship it behind the flag');

    await app.press('n');
    await app.press(' and then some');
    await app.press(ESC);
    await new Promise((r) => setTimeout(r, 120));
    expect(app.stdout.lastFrame).toContain('Global Note: ship it behind the flag');
    expect(app.stdout.lastFrame).not.toContain('and then some');
    app.unmount();
  });

  it('keeps its own row when a status message arrives, rather than yielding it', async () => {
    const app = mount(seed(), null, 1);
    await app.ready();

    await app.press('n');
    await app.press('a standing note');
    await app.press(ENTER);
    await app.frame('Global Note: a standing note');

    // A plan on v1 has nothing to step back to — the cheapest real status. The
    // note is what the version holds and the status is what just happened, so
    // they are two rows and neither has to wait for the other.
    await app.press('[');
    await app.frame('This is the first version.');
    expect(app.stdout.lastFrame).toContain('Global Note: a standing note');
    app.unmount();
  });

  it('is shown in full, wrapped, rather than truncated to one row', async () => {
    const app = mount(seed(), null, 1, [1], 60);
    await app.ready();

    await app.press('n');
    await app.press('the rollout section needs to name the flag, and the migration step');
    await app.press(ENTER);
    await app.frame('Global Note: the rollout');

    // Two rows, and the first of them does not end in an ellipsis: the note is
    // the one piece of feedback with nowhere else to live.
    const rows = bodyRows(app.stdout.lastFrame);
    expect(rows.find((l) => l.includes('Global Note:'))).not.toContain('…');
    expect(rows.some((l) => l.includes('migration'))).toBe(true);
    app.unmount();
  });
});

describe('what the version has to say about itself', () => {
  it('counts the feedback on it, above the hints, and says nothing at zero', async () => {
    const app = mount(seed(), null, 1);
    await app.ready();
    expect(app.stdout.lastFrame).not.toContain('This version has');

    await app.press(DOWN);
    await app.press('f');
    await app.press('one');
    await app.press(ENTER);
    await app.frame('This version has 1 feedback.');

    // Past the box the first note opened, onto a line of its own.
    for (let i = 0; i < 4; i++) await app.press(DOWN);
    await app.press('f');
    await app.press('two');
    await app.press(ENTER);
    await app.frame('This version has 2 feedbacks.');
    app.unmount();
  });

  it('loads the feedback already stored on the version, editable', async () => {
    const id = seed();
    const doc = readVersionText(id, 1)!.split('\n');
    submitFeedback({
      planId: id,
      version: 1,
      annotations: [buildAnnotation(doc, 4, 4, 'left last time', 'a1')],
      general: 'and a standing note',
    });

    const app = mount(id, null, 1, [1], 100, 30, listFeedback(id));
    await app.ready();

    await app.frame('left last time');
    expect(app.stdout.lastFrame).toContain('This version has 1 feedback.');
    expect(app.stdout.lastFrame).toContain('Global Note: and a standing note');
    // Editable, exactly as it was left: no separate pending state to reconcile.
    expect(app.stdout.lastFrame).toContain('s submit');
    app.unmount();
  });

  /**
   * A prompt is a question, and nothing sits under it. The rows are reserved
   * rather than removed, or the document would reflow under the question and
   * backing out would land somewhere else in the plan.
   */
  it('says nothing about the version while a prompt is up', async () => {
    const id = seed();
    const app = mount(id, null, 1, [1], 100, 30, [], { 1: { revise: true, execute: true } });
    await app.ready();

    await app.press(DOWN);
    await app.press('f');
    await app.press('one');
    await app.press(ENTER);
    await app.press('n');
    await app.press('and a note about the whole thing');
    await app.press(ENTER);
    await app.frame('This version has 1 feedback.');
    expect(app.stdout.lastFrame).toContain('Global Note: and a note about the whole thing');
    const height = bodyRows(app.stdout.lastFrame).length;

    for (const [key, question] of [
      ['x', `Execute ${id} v1?`],
      ['s', `Submit feedback for ${id} v1?`],
      [ESC, 'Back to the list?'],
    ] as const) {
      await app.press(key);
      await app.frame(question);
      const frame = app.stdout.lastFrame;
      expect(frame).not.toContain('This version has 1 feedback.');
      expect(frame).not.toContain('Global Note:');
      expect(bodyRows(frame)).toHaveLength(height);
      // And back, with everything under it again.
      await app.press(ESC);
      await app.frame('This version has 1 feedback.');
    }
    app.unmount();
  });
});

describe('the plan, the diff and the versions', () => {
  it('shows the plan alone, with no sign column to pay for, once the diff is off', async () => {
    const app = mount(seedTwoVersions(), null, 2, [1, 2]);
    await app.ready();

    const frame = app.stdout.lastFrame;
    expect(frame).toContain('1% then 10% then 100%');
    expect(frame).not.toContain('10% then 50% then 100%');
    expect(frameRows(frame)[0]).toContain('v2');
    expect(frameRows(frame)[0]).not.toContain('← v1');
    app.unmount();
  });

  it('d takes the diff away and d again brings it back', async () => {
    // How `planx <id>` opens a version that has a predecessor.
    const app = mount(seedTwoVersions(), 1, 2, [1, 2]);
    await app.ready();
    await app.frame('← v1');
    // The removed line is only visible in a diff.
    expect(app.stdout.lastFrame).toContain('10% then 50% then 100%');

    await app.press('d');
    await new Promise((r) => setTimeout(r, 120));
    expect(app.stdout.lastFrame).not.toContain('← v1');
    expect(app.stdout.lastFrame).not.toContain('10% then 50% then 100%');

    await app.press('d');
    await app.frame('← v1');
    app.unmount();
  });

  it('paints an added line’s number in its own colour', async () => {
    setColorEnabled(true);
    const app = mount(seedTwoVersions(), 1, 2, [1, 2]);
    await app.ready();

    // The raw frame, escapes intact. The digits have to be inside the coloured
    // run, not merely next to a coloured sign: `\x1b[32m+12\x1b[39m` passes,
    // and the old `\x1b[32m+\x1b[39m\x1b[2m12\x1b[22m` does not.
    const raw = app.stdout.frames.join('');
    expect(raw).toMatch(/\x1b\[32m\+\s*\d+\x1b\[39m/);
    expect(raw).toMatch(/\x1b\[31m-\s*\d+\x1b\[39m/);
    // A context line is still dim — the colour is the signal, so it has to
    // mean something.
    expect(raw).toMatch(/\x1b\[2m\s*\d+\x1b\[22m/);
    setColorEnabled(false);
    app.unmount();
  });

  it('← steps back a version, → forward, and the header follows', async () => {
    const app = mount(seedTwoVersions(), null, 2, [1, 2]);
    await app.ready();

    await app.press(LEFT);
    await app.frame('10% then 50% then 100%');
    expect(frameRows(app.stdout.lastFrame)[0]).toContain('v1');

    await app.press(RIGHT);
    await app.frame('1% then 10% then 100%');
    app.unmount();
  });

  it('still answers to the brackets, which the hints no longer mention', async () => {
    const app = mount(seedTwoVersions(), null, 2, [1, 2]);
    await app.ready();
    expect(app.stdout.lastFrame).toContain('←→ version');
    expect(app.stdout.lastFrame).not.toContain('[ ]');

    await app.press('[');
    await app.frame('10% then 50% then 100%');
    app.unmount();
  });

  it('sends a note left on each version as its own submission', async () => {
    const app = mount(seedTwoVersions(), null, 2, [1, 2]);
    await app.ready();

    await app.press('f');
    await app.press('about v2');
    await app.press(ENTER);
    await app.frame('about v2');

    await app.press('[');
    await new Promise((r) => setTimeout(r, 120));
    await app.press('f');
    await app.press('about v1');
    await app.press(ENTER);
    await app.frame('about v1');

    await app.press('s');
    // The prompt is always drawn, so finishing takes its answer too.
    await app.press('1');
    const result = await app.result;
    expect(result.batches.map((b) => b.version)).toEqual([1, 2]);
    expect(result.batches[0]?.annotations[0]?.comment).toBe('about v1');
    expect(result.batches[1]?.annotations[0]?.comment).toBe('about v2');
    expect(result.version).toBe(1);
    app.unmount();
  });

  /**
   * Loading every version's feedback in is what lets you step to a version and
   * see what is on it. It is not a claim that you are resubmitting all of it:
   * a version you only read past has to stay out of the batches, or one submit
   * on v2 announces v1 as well and re-dates a record nobody opened.
   */
  it('leaves an untouched version out of the submission', async () => {
    const id = seedTwoVersions();
    const doc = readVersionText(id, 1)!.split('\n');
    submitFeedback({
      planId: id,
      version: 1,
      annotations: [
        buildAnnotation(doc, 4, 4, 'left on v1 last time', 'a1'),
        buildAnnotation(doc, 5, 5, 'and another', 'a2'),
      ],
    });

    const app = mount(id, null, 2, [1, 2], 100, 30, listFeedback(id));
    await app.ready();

    await app.press('f');
    await app.press('only about v2');
    await app.press(ENTER);
    await app.frame('only about v2');

    await app.press('s');
    // The prompt is always drawn, so finishing takes its answer too.
    await app.press('1');
    const result = await app.result;
    expect(result.batches.map((b) => b.version)).toEqual([2]);
    app.unmount();
  });
});

describe('getting around a long plan', () => {
  it('G reaches the last row of a plan taller than the screen', async () => {
    const app = mount(seedLongPlan(), null, 1);
    await app.ready();
    expect(app.stdout.lastFrame).not.toContain('THE LAST LINE');

    await app.press('G');
    await app.frame('THE LAST LINE');

    await app.press('g');
    await app.frame('# A long plan');
    app.unmount();
  });

  it('^d moves half a screen without leaving the plan', async () => {
    const app = mount(seedLongPlan(), null, 1);
    await app.ready();

    await app.press('\x04'); // ctrl-d
    await new Promise((r) => setTimeout(r, 120));
    expect(app.stdout.lastFrame).not.toContain('# A long plan');
    expect(app.stdout.lastFrame).toContain('step ');
    app.unmount();
  });

  /**
   * A held arrow is a run of presses with no gap wide enough to be a release,
   * so the clock is driven from here rather than by holding a key for real.
   */
  it('takes more rows the longer the arrow is held', async () => {
    let clock = 0;
    const app = mount(seedLongPlan(), null, 1, [1], 100, 30, [], undefined, {
      now: () => clock,
    });
    await app.ready();

    const lineNow = () => Number(/\d+/.exec(cursorRow(bodyRows(app.stdout.lastFrame))!)![0]);
    // The first press starts the run, and the operating system's own pause
    // before it repeats is the one wide gap the run allows.
    for (const at of [0, 600, 750, 900, 1050, 1200]) {
      clock = at;
      await app.press(DOWN);
    }
    const before = lineNow();

    // Still inside 1.5s: one row.
    clock = 1350;
    await app.press(DOWN);
    expect(lineNow()).toBe(before + 1);

    // Past it: two.
    clock = 1500;
    await app.press(DOWN);
    expect(lineNow()).toBe(before + 3);

    // Let go, press again: back to one, however long the last hold ran.
    clock = 4000;
    await app.press(DOWN);
    expect(lineNow()).toBe(before + 4);
    app.unmount();
  });
});

/* ------------------------------------------------------------------- steps */

describe('the step-by-step screen', () => {
  const rows = [
    {
      group: 'Detecting agents',
      label: 'claude',
      path: '/home/you/.claude',
      note: 'found',
      ok: true,
    },
    {
      group: 'Writing skills',
      label: 'planx',
      path: '/home/you/.claude/skills',
      note: '',
      ok: true,
    },
  ];

  it('groups the steps, and marks the one still running', () => {
    const lines = stepLines(rows, 60).map(stripAnsi);

    expect(lines[0]).toBe('  Detecting agents');
    expect(lines[1]).toContain('claude');
    expect(lines[1]).toContain('found');
    expect(lines[2]).toBe('');
    expect(lines[3]).toBe('  Writing skills');
    // Started, not finished: it says so rather than claiming an outcome.
    expect(lines[4]!.trimEnd().endsWith('…')).toBe(true);
  });

  it('gives up path, not outcome, when the frame is narrow', () => {
    const long = rows.map((r) => ({ ...r, path: `/very/long/prefix${r.path}`, note: 'written' }));
    const lines = stepLines(long, 44).map(stripAnsi);

    for (const line of lines.filter((l) => l.includes('written'))) {
      expect(line).toContain('…');
      expect(line.trimEnd().endsWith('written')).toBe(true);
    }
  });

  /**
   * These two commands are the ones npm runs during an install, where the
   * output is already inside npm's. A box drawn around part of somebody else's
   * log is worse than no box — and with no border there is nowhere for the
   * wordmark to ride, so it is not printed at all rather than echoed back as a
   * line under the command the user just typed.
   */
  it('draws no border and no header at any width', async () => {
    for (const width of [40, 80, 200]) {
      const stdout = new FakeStdout();
      const instance = render(
        <Steps
          rows={rows}
          closing="Done. /planx is available in claude."
          prompt={null}
          width={width}
        />,
        { stdout: stdout as never, stdin: new FakeStdin() as never, patchConsole: false },
      );
      await waitFor(() => stdout.lastFrame.includes('Detecting agents'));
      const frame = stdout.lastFrame;
      instance.unmount();

      for (const edge of ['╭', '╮', '╰', '╯', '│']) {
        expect(frame, `${edge} at ${width}`).not.toContain(edge);
      }
      expect(frame).not.toMatch(/planx v\d/);
      expect(frame.trimStart().startsWith('Detecting agents')).toBe(true);
      expect(frame).toContain('Done. /planx is available in claude.');
    }
  });

  it('takes the word before enter deletes the store', async () => {
    const stdout = new FakeStdout();
    const stdin = new FakeStdin();
    const answers: boolean[] = [];
    let typed = '';

    const draw = () =>
      instance.rerender(
        <Steps
          rows={rows}
          closing={null}
          width={80}
          prompt={{
            question: 'Delete the store too? ~/.planx holds 7 plans. This cannot be undone.',
            word: 'delete',
            typed,
            onType: (next) => {
              typed = next;
              draw();
            },
            onAnswer: (yes) => answers.push(yes),
          }}
        />,
      );

    const instance = render(<Steps rows={rows} closing={null} prompt={null} width={80} />, {
      stdout: stdout as never,
      stdin: stdin as never,
      patchConsole: false,
    });
    draw();

    await waitFor(() => stdout.lastFrame.includes('type delete to confirm:'));
    expect(stdout.lastFrame).not.toContain('enter delete');

    // Enter is not an answer until the word is.
    stdin.send('\r');
    await waitFor(() => false, 100);
    expect(answers).toEqual([]);

    for (const character of 'delete') stdin.send(character);
    await waitFor(() => stdout.lastFrame.includes('enter delete · esc keep'));
    expect(stdout.lastFrame).toContain('enter delete · esc keep');

    stdin.send('\r');
    await waitFor(() => answers.length > 0);
    expect(answers).toEqual([true]);

    instance.unmount();
  });

  it('takes esc as keep, whatever has been typed', async () => {
    const stdout = new FakeStdout();
    const stdin = new FakeStdin();
    const answers: boolean[] = [];
    let typed = '';

    const draw = () =>
      instance.rerender(
        <Steps
          rows={rows}
          closing={null}
          width={80}
          prompt={{
            question: 'Delete the store too?',
            word: 'delete',
            typed,
            onType: (next) => {
              typed = next;
              draw();
            },
            onAnswer: (yes) => answers.push(yes),
          }}
        />,
      );

    const instance = render(<Steps rows={rows} closing={null} prompt={null} width={80} />, {
      stdout: stdout as never,
      stdin: stdin as never,
      patchConsole: false,
    });
    draw();
    await waitFor(() => stdout.lastFrame.includes('type delete to confirm:'));

    for (const character of 'delete') stdin.send(character);
    await waitFor(() => stdout.lastFrame.includes('enter delete'));

    stdin.send(ESC);
    await waitFor(() => answers.length > 0);
    expect(answers).toEqual([false]);

    instance.unmount();
  });
});

/* ------------------------------------------------------------ update notice */

describe('the update notice on the border', () => {
  const notice = noticeFor('0.5.0');
  const title = brandTitle('0.4.0');

  it('is absent until there is something to say', () => {
    const rule = stripAnsi(topRule(80, title, null));
    expect(rule).not.toContain('is available');
    expect(rule).toHaveLength(80);
    expect(rule.endsWith('╮')).toBe(true);
  });

  /**
   * It used to be right-aligned at the far end of the rule, which on a wide
   * terminal put it a screen's width away from the version it is about.
   */
  it('sits directly after the wordmark, and the rule keeps its width', () => {
    const rule = stripAnsi(topRule(90, title, notice));
    expect(rule).toContain('planx v0.4.0 · v0.5.0 is available · run planx update ─');
    expect(rule).toHaveLength(90);
    expect(rule.endsWith('─╮')).toBe(true);
  });

  /**
   * The wordmark keeps the corner. A rule choosing between saying which planx
   * this is and saying a newer one exists says the former.
   */
  it('falls back to the short form, then drops out entirely', () => {
    const short = stripAnsi(topRule(50, title, notice));
    expect(short).toContain('v0.5.0 is available');
    expect(short).not.toContain('run planx update');
    expect(short).toHaveLength(50);

    // The review's rule already carries a plan id and two version numbers, so
    // it is the one that runs out of room first. Two dashes past it is a rule
    // with nowhere left to put anything.
    const busy = brandTitle('0.4.0', 'guard-the-clock-regression-0e67  v3 ◂ v2');
    const tight = stripAnsi(busy).length + 6;
    const none = stripAnsi(topRule(tight, busy, notice));
    expect(none).not.toContain('is available');
    expect(none).toContain('planx v0.4.0');
    expect(none).toHaveLength(tight);
  });

  it('holds its width at every size, whatever it decided to draw', () => {
    const busy = brandTitle('0.4.0', 'guard-the-clock-regression-0e67  v3 ◂ v2');
    const floor = stripAnsi(busy).length + 4;
    for (let width = MIN_FRAME_WIDTH; width <= 160; width++) {
      expect(stripAnsi(topRule(width, title, notice)), `width ${width}`).toHaveLength(width);
      if (width < floor) continue;
      expect(stripAnsi(topRule(width, busy, notice)), `busy ${width}`).toHaveLength(width);
    }
  });

  it('reaches every bordered layout through the process-wide notice', async () => {
    setUpdateNotice(notice);
    const app = mountPicker(planRows());
    await app.ready();
    await app.frame('v0.5.0 is available');
    app.unmount();

    setUpdateNotice(null);
    const quiet = mountPicker(planRows());
    await quiet.ready();
    await quiet.frame('Which plan?');
    expect(quiet.stdout.lastFrame).not.toContain('is available');
    quiet.unmount();
  });

  it('reaches the review the same way', async () => {
    setUpdateNotice(notice);
    const app = mount(seed(), null, 1);
    await app.ready();
    await app.frame('v0.5.0 is available');
    app.unmount();
  });
});

/* ------------------------------------------------------------------ picker */

interface PickerHarness<T> {
  stdout: FakeStdout;
  quits: number[];
  chosen: Promise<T[]>;
  press: (keys: string) => Promise<void>;
  ready: () => Promise<void>;
  frame: (text: string) => Promise<void>;
  unmount: () => void;
}

function mountPicker<T>(
  items: Array<PickerItem<T>>,
  onDelete?: (item: PickerItem<T>) => Array<PickerItem<T>>,
): PickerHarness<T> {
  const stdout = new FakeStdout();
  const stdin = new FakeStdin();
  const quits: number[] = [];
  let resolve!: (value: T[]) => void;
  const chosen = new Promise<T[]>((r) => (resolve = r));

  const instance = render(
    <Picker
      title="Which plan?"
      subtitle="Pick one to review, → for its versions, or type to filter."
      items={items}
      version="9.9.9"
      onDelete={onDelete}
      onQuit={() => quits.push(Date.now())}
      onDone={resolve}
      onCancel={() => resolve([])}
    />,
    {
      stdout: stdout as unknown as NodeJS.WriteStream,
      stdin: stdin as unknown as NodeJS.ReadStream,
      exitOnCtrlC: false,
      patchConsole: false,
    },
  );

  return {
    stdout,
    quits,
    chosen,
    unmount: () => instance.unmount(),
    press: async (keys: string) => {
      const before = stdout.frames.length;
      stdin.send(keys);
      await new Promise((r) => setTimeout(r, 60));
      await waitFor(() => stdout.frames.length > before, 1_000);
    },
    ready: async () => {
      if (!(await waitFor(() => stdout.lastFrame.trim().length > 0))) {
        throw new Error('the picker never drew a frame');
      }
    },
    frame: async (text: string) => {
      await waitFor(() => stdout.lastFrame.includes(text));
      expect(stdout.lastFrame).toContain(text);
    },
  };
}

type Pick = { id: string; version: number; row: 'plan' | 'version' };

/** Two plans, one of them three versions deep. */
function planRows(): Array<PickerItem<Pick>> {
  return [
    {
      value: { id: 'guard-clock', version: 3, row: 'plan' },
      label: 'Guard the clock regression',
      hint: '1h ago   guard-clock',
      searchable: 'guard-clock',
      deleteAs: 'guard-clock',
      children: [
        { value: { id: 'guard-clock', version: 3, row: 'version' }, label: 'v3', hint: '1h ago' },
        {
          value: { id: 'guard-clock', version: 2, row: 'version' },
          label: 'v2',
          hint: '2h ago',
          deleteAs: 'guard-clock v2',
        },
        {
          value: { id: 'guard-clock', version: 1, row: 'version' },
          label: 'v1',
          hint: '3h ago',
          deleteAs: 'guard-clock v1',
        },
      ],
    },
    {
      value: { id: 'rail-frame', version: 1, row: 'plan' },
      label: 'The annotation rail',
      hint: '2d ago   rail-frame',
      searchable: 'rail-frame',
      deleteAs: 'rail-frame',
      children: [
        { value: { id: 'rail-frame', version: 1, row: 'version' }, label: 'v1', hint: '2d ago' },
      ],
    },
  ];
}

describe('the picker as a version tree', () => {
  it('leads with the time, then the id, and shows no version on a plan row', async () => {
    const app = mountPicker(planRows());
    await app.ready();

    const row = bodyRows(app.stdout.lastFrame).find((l) => l.includes('Guard the clock'))!;
    expect(row).toContain('1h ago   guard-clock');
    expect(row).not.toContain('v3');
    expect(row).not.toContain('✓');
    app.unmount();
  });

  it('obeys the same key order the review does', async () => {
    const app = mountPicker(planRows(), () => []);
    await app.ready();

    const keys = inner(bodyRows(app.stdout.lastFrame).at(-1)!)
      .split(' · ')
      .map((part) => part.split(' ')[0]!);
    expect(keys).toEqual(['→', '↑↓', '^d', 'enter', 'esc']);
    app.unmount();
  });

  it('says which way the tree goes, on the rows it goes there from', async () => {
    const app = mountPicker(planRows());
    await app.ready();
    expect(app.stdout.lastFrame).toContain('→ versions');

    await app.press(RIGHT);
    await app.frame('← collapse');
    expect(app.stdout.lastFrame).not.toContain('→ versions');

    // On a version row it is still the parent that collapses, so the hint
    // stays; and a filtered list draws everything collapsed with neither arrow
    // doing anything, so it offers neither.
    await app.press(DOWN);
    await app.frame('← collapse');

    await app.press('rail');
    await app.frame('The annotation rail');
    expect(app.stdout.lastFrame).not.toContain('→ versions');
    expect(app.stdout.lastFrame).not.toContain('← collapse');
    app.unmount();
  });

  it('→ opens a plan into its versions, newest first, and ← closes it', async () => {
    const app = mountPicker(planRows());
    await app.ready();
    expect(app.stdout.lastFrame).not.toContain('v3');

    await app.press(RIGHT);
    await app.frame('v3');
    const rows = bodyRows(app.stdout.lastFrame).filter((l) => /\bv[123]\b/.test(l));
    expect(rows.map((l) => /v[123]/.exec(l)![0])).toEqual(['v3', 'v2', 'v1']);

    await app.press(LEFT);
    await new Promise((r) => setTimeout(r, 120));
    expect(app.stdout.lastFrame).not.toContain('v3');
    app.unmount();
  });

  it('walks down into the versions and back out into the next plan', async () => {
    const app = mountPicker(planRows());
    await app.ready();
    await app.press(RIGHT);
    await app.frame('v3');

    // The plan row, then v3, v2, v1, then the next plan.
    for (let i = 0; i < 4; i++) await app.press(DOWN);
    await app.frame('The annotation rail');
    const marked = bodyRows(app.stdout.lastFrame).find((l) => l.includes('❯'))!;
    expect(marked).toContain('The annotation rail');
    app.unmount();
  });

  it('opens the latest from a plan row and that version from a child row', async () => {
    const app = mountPicker(planRows());
    await app.ready();
    await app.press(RIGHT);
    await app.frame('v3');
    await app.press(DOWN);
    await app.press(DOWN);
    await app.press(ENTER);

    expect(await app.chosen).toEqual([{ id: 'guard-clock', version: 2, row: 'version' }]);
    app.unmount();
  });

  it('collapses everything when you type, and matches plans only', async () => {
    const app = mountPicker(planRows());
    await app.ready();
    await app.press(RIGHT);
    await app.frame('v3');

    await app.press('rail');
    await app.frame('The annotation rail');
    expect(app.stdout.lastFrame).not.toContain('Guard the clock');
    // The expanded versions are gone with the rest of the tree.
    expect(app.stdout.lastFrame).not.toContain('v3');
    app.unmount();
  });
});

describe('the picker says what was built', () => {
  /** The plan row goes green with its latest, and the version says the word. */
  function builtRows(): Array<PickerItem<Pick>> {
    const items = planRows();
    items[0]!.tone = 'executed';
    items[0]!.children![0]!.tone = 'executed';
    items[0]!.children![0]!.hint = '1h ago · executed';
    return items;
  }

  it('says it in words on the version row, not only in colour', async () => {
    const app = mountPicker(builtRows());
    await app.ready();

    await app.press(RIGHT);
    await app.frame('v3');
    const row = bodyRows(app.stdout.lastFrame).find((l) => /\bv3\b/.test(l))!;
    expect(row).toContain('1h ago · executed');
    // The version that was not built says nothing.
    expect(bodyRows(app.stdout.lastFrame).find((l) => /\bv2\b/.test(l))).not.toContain('executed');
    app.unmount();
  });

  it('keeps the green under the cursor, where the highlight would swallow it', async () => {
    setColorEnabled(true);
    const app = mountPicker(builtRows());
    await app.ready();
    await app.frame('Guard the clock');

    // The highlighted row is inverse *and* green — `signal` over it would paint
    // the executed row the same yellow as every other.
    const raw = app.stdout.frames.join('');
    expect(raw).toMatch(/\x1b\[7m\x1b\[32m/);
    setColorEnabled(false);
    app.unmount();
  });
});

describe('deleting from the picker', () => {
  /** The word, one character at a time, the way a person types it. */
  async function typeWord(app: { press: (input: string) => Promise<void> }, word = 'delete') {
    for (const character of word) await app.press(character);
  }

  /**
   * Drawn after the whole list, the red line was nowhere near the plan it
   * named — and the frame grew a row the moment it appeared.
   */
  it('opens directly under its target, without changing the height', async () => {
    const app = mountPicker(planRows(), () => []);
    await app.ready();
    await app.press(RIGHT);
    await app.press(DOWN);
    await app.press(DOWN);
    await app.frame('v2');
    const before = bodyRows(app.stdout.lastFrame).length;

    await app.press(CTRL_D);
    await app.frame('delete guard-clock v2? this cannot be undone');

    const rows = bodyRows(app.stdout.lastFrame);
    expect(rows).toHaveLength(before);
    const target = rows.findIndex((l) => l.includes('❯'));
    expect(rows[target + 1]).toContain('delete guard-clock v2?');
    expect(rows[target + 2]).toContain('type delete to confirm:');
    app.unmount();
  });

  it('names the target in full and takes esc as a no', async () => {
    const app = mountPicker(planRows(), () => []);
    await app.ready();

    await app.press(CTRL_D);
    await app.frame('delete guard-clock? this cannot be undone');
    await app.frame('type delete to confirm:');
    // Nothing is typed yet, so enter is not on offer.
    expect(app.stdout.lastFrame).not.toContain('enter delete');

    await app.press(ESC);
    await new Promise((r) => setTimeout(r, 120));
    expect(app.stdout.lastFrame).not.toContain('cannot be undone');
    expect(app.stdout.lastFrame).toContain('Guard the clock');
    app.unmount();
  });

  it('deletes the whole plan once the word is typed', async () => {
    const deleted: string[] = [];
    const app = mountPicker(planRows(), (item) => {
      deleted.push(`${item.value.id}:${item.value.row}`);
      return planRows().slice(1);
    });
    await app.ready();

    await app.press(CTRL_D);
    await app.frame('cannot be undone');
    await typeWord(app);
    // The bar says the gate has what it wanted.
    await app.frame('enter delete');
    await app.press(ENTER);
    await new Promise((r) => setTimeout(r, 120));

    expect(deleted).toEqual(['guard-clock:plan']);
    expect(app.stdout.lastFrame).not.toContain('Guard the clock');
    app.unmount();
  });

  it('does nothing on enter until the word is complete', async () => {
    const deleted: string[] = [];
    const app = mountPicker(planRows(), (item) => {
      deleted.push(item.value.id);
      return [];
    });
    await app.ready();

    await app.press(CTRL_D);
    await app.frame('cannot be undone');
    await typeWord(app, 'del');
    await app.press(ENTER);
    await new Promise((r) => setTimeout(r, 120));

    expect(deleted).toEqual([]);
    expect(app.stdout.lastFrame).toContain('cannot be undone');
    expect(app.stdout.lastFrame).toContain('Guard the clock');
    app.unmount();
  });

  it('takes esc as a no even once the word is typed', async () => {
    const deleted: string[] = [];
    const app = mountPicker(planRows(), (item) => {
      deleted.push(item.value.id);
      return [];
    });
    await app.ready();

    await app.press(CTRL_D);
    await app.frame('cannot be undone');
    await typeWord(app);
    await app.frame('enter delete');
    await app.press(ESC);
    await new Promise((r) => setTimeout(r, 120));

    expect(deleted).toEqual([]);
    expect(app.stdout.lastFrame).toContain('Guard the clock');
    app.unmount();
  });

  it('deletes just that version from a child row', async () => {
    const deleted: Pick[] = [];
    const app = mountPicker(planRows(), (item) => {
      deleted.push(item.value);
      return planRows();
    });
    await app.ready();

    await app.press(RIGHT);
    await app.frame('v3');
    await app.press(DOWN);
    await app.press(DOWN);
    await app.press(CTRL_D);
    await app.frame('delete guard-clock v2? this cannot be undone');
    await typeWord(app);
    await app.press(ENTER);
    await new Promise((r) => setTimeout(r, 120));

    expect(deleted).toEqual([{ id: 'guard-clock', version: 2, row: 'version' }]);
    app.unmount();
  });

  /**
   * The whole reason the key moved: `d` opened the confirmation before the
   * filter ever saw it, so no plan whose name starts with `d` could be found.
   */
  it('sends d to the filter, so a plan named with one is findable', async () => {
    const app = mountPicker(
      [
        {
          value: { id: 'deploy-queue', version: 1, row: 'plan' },
          label: 'Drain the deploy queue',
          searchable: 'deploy-queue',
          deleteAs: 'deploy-queue',
        },
        {
          value: { id: 'guard-clock', version: 1, row: 'plan' },
          label: 'Guard the clock regression',
          searchable: 'guard-clock',
          deleteAs: 'guard-clock',
        },
      ],
      () => [],
    );
    await app.ready();

    await app.press('d');
    await app.frame('filter: d');
    expect(app.stdout.lastFrame).not.toContain('cannot be undone');

    await app.press('eploy');
    await app.frame('filter: deploy');
    expect(app.stdout.lastFrame).not.toContain('Guard the clock');
    app.unmount();
  });

  it('offers ^d only where the row can actually be deleted', async () => {
    const app = mountPicker(planRows(), () => []);
    await app.ready();
    await app.frame('^d delete');

    // v3 is the latest, so it cannot go and the hint stops offering it.
    await app.press(RIGHT);
    await app.press(DOWN);
    await new Promise((r) => setTimeout(r, 120));
    expect(app.stdout.lastFrame).not.toContain('^d delete');

    // Pressing it anyway does nothing at all.
    await app.press(CTRL_D);
    await new Promise((r) => setTimeout(r, 120));
    expect(app.stdout.lastFrame).not.toContain('cannot be undone');
    app.unmount();
  });
});
