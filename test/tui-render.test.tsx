import { EventEmitter } from 'node:events';
import { render } from 'ink';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { capture } from '../src/protocol/capture.js';
import { setColorEnabled, stripAnsi } from '../src/render/ansi.js';
import { readLocks } from '../src/store/plans.js';
import { ReviewApp, type ReviewResult } from '../src/tui/ReviewApp.js';
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
): Harness {
  const stdout = new FakeStdout();
  const stdin = new FakeStdin();
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
      previous={[]}
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
const BACKSPACE = '\x7f';
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

  it('offers lowercase shortcuts, with x for exit and no c to collide with ctrl-c', async () => {
    const app = mount(seed(), null, 1);
    await app.ready();

    const frame = app.stdout.lastFrame;
    expect(frame).toContain('f feedback');
    expect(frame).toContain('n note');
    expect(frame).toContain('x exit');
    expect(frame).not.toContain('c comment');
    app.unmount();
  });

  it('offers approve while there is nothing to submit, and submit once there is', async () => {
    const app = mount(seed(), null, 1);
    await app.ready();

    expect(app.stdout.lastFrame).toContain('a approve');
    expect(app.stdout.lastFrame).not.toContain('s submit');

    await app.press('f');
    await app.press('needs work');
    await app.press(ENTER);
    await app.frame('s submit');

    expect(app.stdout.lastFrame).not.toContain('a approve');
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

    await app.press('f');
    await app.press('fold me');
    await app.press(ENTER);
    await app.frame('fold me');
    expect(bodyRows(app.stdout.lastFrame).filter((l) => l.includes('╯'))).toHaveLength(1);

    // From the annotated line itself: the cursor cannot get into the box.
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

    // Off line 1: the box's top edge, then its text.
    await app.press(DOWN);
    await app.press(DOWN);
    await new Promise((r) => setTimeout(r, 120));

    const arrowed = bodyRows(app.stdout.lastFrame).filter((l) => l.includes(ARROW));
    expect(arrowed).toHaveLength(1);
    expect(arrowed[0]).toContain('on line one');
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
    await app.press(DOWN);
    await app.frame('space fold');

    await app.press(SPACE);
    await new Promise((r) => setTimeout(r, 120));

    const rows = bodyRows(app.stdout.lastFrame);
    expect(rows.filter((l) => l.includes('╯'))).toHaveLength(0);
    const folded = rows.find((l) => l.includes('fold from within'))!;
    expect(folded).toContain('├─ ▸ fold from within');
    // Still under the cursor, so space puts it straight back.
    expect(folded).toContain(ARROW);
    app.unmount();
  });
});

describe('locking', () => {
  it('marks the line in the gutter and writes the lock immediately', async () => {
    const id = seed();
    const app = mount(id, null, 1);
    await app.ready();

    await app.press('l');
    await app.frame('⚿');
    // On disk, not queued behind a submit that may never come.
    expect(Object.keys(readLocks(id).locks)).toHaveLength(1);
    app.unmount();
  });

  it('l again lifts the lock it just applied', async () => {
    const id = seed();
    const app = mount(id, null, 1);
    await app.ready();

    await app.press('l');
    await app.frame('⚿');
    await app.press('l');
    await app.frame('unlocked line 1');

    expect(Object.keys(readLocks(id).locks)).toHaveLength(0);
    app.unmount();
  });

  it('refuses feedback on a locked passage and stops offering it', async () => {
    const app = mount(seed(), null, 1);
    await app.ready();

    await app.press('l');
    await app.frame('l unlock');
    expect(app.stdout.lastFrame).not.toContain('f feedback');

    await app.press('f');
    await app.frame('those lines are locked');
    app.unmount();
  });
});

describe('submitting and approving', () => {
  it('refuses an empty submit and says how to leave instead', async () => {
    const app = mount(seed(), null, 1);
    await app.ready();

    await app.press('s');
    await app.frame('nothing to submit');
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

    const result = await app.result;
    expect(result.action).toBe('submit');
    expect(result.batches[0]?.version).toBe(1);
    expect(result.batches[0]?.annotations[0]?.comment).toBe('needs work');
    app.unmount();
  });

  it('asks before approving, and esc backs out', async () => {
    const app = mount(seed(), null, 1);
    await app.ready();

    await app.press('a');
    await app.frame('Approve');
    await app.press(ESC);
    await new Promise((r) => setTimeout(r, 120));
    expect(app.stdout.lastFrame).not.toContain('Approve v');

    await app.press('a');
    await app.press(ENTER);

    expect((await app.result).action).toBe('approve');
    app.unmount();
  });

  it('x leaves without submitting', async () => {
    const app = mount(seed(), null, 1);
    await app.ready();

    await app.press('x');
    expect((await app.result).action).toBe('quit');
    app.unmount();
  });
});

describe('the whole-plan note', () => {
  it('points at f for line feedback while it is open', async () => {
    const app = mount(seed(), null, 1);
    await app.ready();

    await app.press('n');
    await app.frame('press f instead');
    app.unmount();
  });

  it('shows what is being typed, before enter and not only after it', async () => {
    const app = mount(seed(), null, 1);
    await app.ready();

    await app.press('n');
    await app.press('halfway through');
    await app.frame('halfway through');

    // In the same box the inline notes get, hanging off nothing rather than
    // off a rail, and pinned at the foot of the frame above the status line.
    const rows = bodyRows(app.stdout.lastFrame);
    const box = rows.findIndex((l) => l.includes('halfway through'));
    expect(rows[box - 1]).toContain('╭─');
    expect(rows[box + 1]).toContain('╰─');
    app.unmount();
  });
});

describe('the plan, the diff and the versions', () => {
  it('opens on the plan itself, with no sign column to pay for', async () => {
    const app = mount(seedTwoVersions(), null, 2, [1, 2]);
    await app.ready();

    const frame = app.stdout.lastFrame;
    expect(frame).toContain('1% then 10% then 100%');
    expect(frame).not.toContain('10% then 50% then 100%');
    expect(frameRows(frame)[0]).toContain('v2');
    expect(frameRows(frame)[0]).not.toContain('← v1');
    app.unmount();
  });

  it('d brings the diff and d again takes it away', async () => {
    const app = mount(seedTwoVersions(), null, 2, [1, 2]);
    await app.ready();
    expect(app.stdout.lastFrame).toContain('d diff');

    await app.press('d');
    await app.frame('← v1');
    // The removed line is only visible in a diff.
    expect(app.stdout.lastFrame).toContain('10% then 50% then 100%');

    await app.press('d');
    await new Promise((r) => setTimeout(r, 120));
    expect(app.stdout.lastFrame).not.toContain('← v1');
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

  it('[ steps back a version and the header follows', async () => {
    const app = mount(seedTwoVersions(), null, 2, [1, 2]);
    await app.ready();

    await app.press('[');
    await app.frame('10% then 50% then 100%');
    expect(frameRows(app.stdout.lastFrame)[0]).toContain('v1');

    await app.press(']');
    await app.frame('1% then 10% then 100%');
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
    const result = await app.result;
    expect(result.batches.map((b) => b.version)).toEqual([1, 2]);
    expect(result.batches[0]?.annotations[0]?.comment).toBe('about v1');
    expect(result.batches[1]?.annotations[0]?.comment).toBe('about v2');
    expect(result.version).toBe(1);
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
});
