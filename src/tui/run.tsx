import { render } from 'ink';
import type { RenderMode } from '../render/diff.js';
import type { Feedback } from '../store/types.js';
import { Picker, type PickerItem } from './Picker.js';
import { ReviewApp, type ReviewResult } from './ReviewApp.js';

/**
 * Is there a terminal to draw on?
 *
 * Piping implies `--print`, so this is what makes `planx diff <id> | less` do
 * the sensible thing without the user asking (PLAN §8).
 */
export function isInteractive(): boolean {
  return Boolean(process.stdout.isTTY && process.stdin.isTTY);
}

export interface RunReviewOptions {
  planId: string;
  title: string;
  versionA: number | null;
  versionB: number;
  mode: RenderMode;
  previous: Feedback[];
}

export async function runReview(opts: RunReviewOptions): Promise<ReviewResult> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: ReviewResult) => {
      if (settled) return;
      settled = true;
      instance.unmount();
      resolve(result);
    };

    const instance = render(
      <ReviewApp
        planId={opts.planId}
        title={opts.title}
        versionA={opts.versionA}
        versionB={opts.versionB}
        mode={opts.mode}
        previous={opts.previous}
        onDone={finish}
      />,
      // Ink's own exit-on-ctrl-c would skip our mouse-mode teardown and leave
      // the terminal reporting clicks into the user's shell.
      { exitOnCtrlC: false },
    );

    instance.waitUntilExit().then(() => finish({ action: 'quit', annotations: [], general: '' }));
  });
}

export interface RunPickerOptions<T> {
  title: string;
  items: Array<PickerItem<T>>;
  multi?: boolean;
  footer?: string;
}

export async function runPicker<T>(opts: RunPickerOptions<T>): Promise<T[]> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (chosen: T[]) => {
      if (settled) return;
      settled = true;
      instance.unmount();
      resolve(chosen);
    };

    const instance = render(
      <Picker
        title={opts.title}
        items={opts.items}
        multi={opts.multi ?? false}
        footer={opts.footer}
        onDone={finish}
        onCancel={() => finish([])}
      />,
      { exitOnCtrlC: false },
    );

    instance.waitUntilExit().then(() => finish([]));
  });
}

/** Ask one yes/no question outside the TUI, for confirmations in plain commands. */
export async function confirm(question: string): Promise<boolean> {
  if (!isInteractive()) return false;
  const [answer] = await runPicker<boolean>({
    title: question,
    items: [
      { value: false, label: 'no', hint: 'nothing happens' },
      { value: true, label: 'yes', hint: 'go ahead' },
    ],
  });
  return answer === true;
}
