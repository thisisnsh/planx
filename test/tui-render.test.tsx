import { EventEmitter } from 'node:events';
import { render } from 'ink';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { capture } from '../src/protocol/capture.js';
import { submitFeedback } from '../src/protocol/submit.js';
import { setColorEnabled, stripAnsi } from '../src/render/ansi.js';
import { readLocks } from '../src/store/plans.js';
import type { AwaitRequest } from '../src/store/types.js';
import { ReviewApp, type ReviewResult } from '../src/tui/ReviewApp.js';
import { SAMPLE_PLAN, tempStore } from './helpers.js';

/**
 * Minimal stand-ins for a terminal.
 *
 * Hand-rolled rather than pulling in ink-testing-library: it is thirty lines,
 * and this suite exists partly to prove the TUI mounts without one.
 */
class FakeStdout extends EventEmitter {
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
   * Ink's render and the app's mouse-mode toggles go to the same stream, so the
   * final write is often just `\x1b[?1002h` — skip anything that carries no
   * visible text.
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

interface Harness {
  stdout: FakeStdout;
  stdin: FakeStdin;
  unmount: () => void;
  result: Promise<ReviewResult>;
  press: (keys: string) => Promise<void>;
}

function mount(
  planId: string,
  versionA: number | null,
  versionB: number,
  pending: AwaitRequest[] = [],
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
      mode="rich"
      pending={pending}
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
      stdin.send(keys);
      // Ink debounces a pending escape before dispatching, so give it room.
      await new Promise((r) => setTimeout(r, 60));
    },
  };
}

function seed(): string {
  return capture({ text: SAMPLE_PLAN, source: 'test' }).planId;
}

describe('the review app renders', () => {
  it('mounts and draws the header, the plan and the key bar', async () => {
    const id = seed();
    const app = mount(id, null, 1);
    await new Promise((r) => setTimeout(r, 50));

    const frame = app.stdout.lastFrame;
    expect(frame).toContain('planx');
    expect(frame).toContain(id);
    expect(frame).toContain('REVIEW');
    expect(frame).toContain('## Approach');
    expect(frame).toContain('c comment');
    expect(frame).toContain('l lock');
    expect(frame).toContain('S submit');

    app.unmount();
  });

  it('shows a diff header when reviewing a revision', async () => {
    const id = seed();
    capture({ planId: id, text: SAMPLE_PLAN.replace('poller.ts', 'r2.ts') });
    const app = mount(id, 1, 2);
    await new Promise((r) => setTimeout(r, 50));

    expect(app.stdout.lastFrame).toContain('v2 ← v1');
    app.unmount();
  });

  it('marks locked lines with the gutter icon and the lock id', async () => {
    const id = seed();
    submitFeedback({ planId: id, version: 1, verdict: 'approve', annotations: [] });
    expect(Object.keys(readLocks(id).locks).length).toBeGreaterThan(0);

    const app = mount(id, null, 1);
    await new Promise((r) => setTimeout(r, 50));

    const frame = app.stdout.lastFrame;
    expect(frame).toContain('🔒');
    expect(frame).toContain('SEALED');
    app.unmount();
  });

  it('surfaces a pending unlock request immediately, with the reason', async () => {
    const id = seed();
    const request: AwaitRequest = {
      format_version: 1,
      id: 'req1',
      kind: 'unlock',
      plan_id: id,
      version: 1,
      lock_id: 'L2',
      reason: 'the flag adds no value here',
      proposed: 'Deploy directly to 100%.',
      created: new Date().toISOString(),
      pid: 1,
      cwd: '/tmp',
      ttl_ms: 60_000,
    };

    const app = mount(id, null, 1, [request]);
    await new Promise((r) => setTimeout(r, 50));

    const frame = app.stdout.lastFrame;
    expect(frame).toContain('agent requests unlock of L2');
    expect(frame).toContain('the flag adds no value here');
    expect(frame).toContain('+ Deploy directly to 100%.');
    expect(frame).toContain('y to grant');
    app.unmount();
  });
});

describe('the review app responds to keys', () => {
  it('opens the comment editor on the selected lines and records the annotation', async () => {
    const id = seed();
    const app = mount(id, null, 1);
    await new Promise((r) => setTimeout(r, 50));

    await app.press('j'); // move off line 1
    await app.press('c');
    expect(app.stdout.lastFrame).toContain('Comment on lines');

    await app.press('Wrong layer.');
    await app.press('\r');
    expect(app.stdout.lastFrame).toContain('Wrong layer.');

    await app.press('S');
    const result = await app.result;
    expect(result.action).toBe('submit');
    expect(result.annotations).toHaveLength(1);
    expect(result.annotations[0]).toMatchObject({ kind: 'comment', comment: 'Wrong layer.' });
    app.unmount();
  });

  it('records a lock over a keyboard visual selection', async () => {
    const id = seed();
    const app = mount(id, null, 1);
    await new Promise((r) => setTimeout(r, 50));

    await app.press('V');
    await app.press('j');
    await app.press('j');
    await app.press('l');
    expect(app.stdout.lastFrame).toContain('locked lines 1–3');

    await app.press('S');
    const result = await app.result;
    expect(result.annotations[0]).toMatchObject({
      kind: 'lock',
      anchor: { start_line: 1, end_line: 3 },
    });
    app.unmount();
  });

  it('refuses to submit nothing rather than sending an empty verdict', async () => {
    const id = seed();
    const app = mount(id, null, 1);
    await new Promise((r) => setTimeout(r, 50));

    await app.press('S');
    expect(app.stdout.lastFrame).toContain('nothing to submit');
    app.unmount();
  });

  it('confirms before approving, because approving seals the plan', async () => {
    const id = seed();
    const app = mount(id, null, 1);
    await new Promise((r) => setTimeout(r, 50));

    await app.press('A');
    expect(app.stdout.lastFrame).toContain('This seals the plan');

    await app.press('y');
    expect((await app.result).action).toBe('approve');
    app.unmount();
  });

  it('answers an unlock request with a single keypress', async () => {
    const id = seed();
    const request: AwaitRequest = {
      format_version: 1,
      id: 'req1',
      kind: 'unlock',
      plan_id: id,
      version: 1,
      lock_id: 'L2',
      reason: 'why not',
      proposed: '',
      created: new Date().toISOString(),
      pid: 1,
      cwd: '/tmp',
      ttl_ms: 60_000,
    };
    const app = mount(id, null, 1, [request]);
    await new Promise((r) => setTimeout(r, 50));

    await app.press('y');
    const result = await app.result;
    expect(result.action).toBe('unlock');
    expect(result.unlock).toMatchObject({ lockId: 'L2', granted: true, requestId: 'req1' });
    app.unmount();
  });

  it('shows help and quits without submitting', async () => {
    const id = seed();
    const app = mount(id, null, 1);
    await new Promise((r) => setTimeout(r, 50));

    await app.press('?');
    expect(app.stdout.lastFrame).toContain('toggle mouse capture');
    await app.press('\x1b');

    await app.press('q');
    const result = await app.result;
    expect(result.action).toBe('quit');
    expect(result.annotations).toHaveLength(0);
    app.unmount();
  });

  it('ignores mouse bytes instead of treating them as commands', async () => {
    const id = seed();
    const app = mount(id, null, 1);
    await new Promise((r) => setTimeout(r, 50));

    // This contains a 'q' and an 'S'; parsed as keys it would quit or submit.
    await app.press('\x1b[<0;12;5M');
    await app.press('\x1b[<0;12;5m');

    await app.press('S');
    expect(app.stdout.lastFrame).toContain('nothing to submit');
    app.unmount();
  });
});
