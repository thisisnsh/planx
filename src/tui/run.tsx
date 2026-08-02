import { render } from 'ink';
import type { RenderMode } from '../render/diff.js';
import { readConfig } from '../store/config.js';
import type { Feedback } from '../store/types.js';
import { Picker, type PickerItem } from './Picker.js';
import { ReviewApp, type ReviewResult } from './ReviewApp.js';

/**
 * Is there a terminal to draw on?
 *
 * Piping implies `--print`, so this is what makes `planx diff <id> | less` do
 * the sensible thing without the user asking.
 */
export function isInteractive(): boolean {
  return Boolean(process.stdout.isTTY && process.stdin.isTTY);
}

/** Wipe the screen and the scrollback above it. */
export function clearScreen(): void {
  if (process.stdout.isTTY) process.stdout.write('\x1b[2J\x1b[3J\x1b[H');
}

export interface RunReviewOptions {
  planId: string;
  title: string;
  versionA: number | null;
  versionB: number;
  /** Every stored version, ascending — what `[`, `]` and `d` can reach. */
  versions: number[];
  mode: RenderMode;
  /** planx's own version, for the frame. */
  version: string;
  /** Every note left on this plan; the review shows the ones for the version
   *  you are on, which is a thing that changes while you are in there. */
  previous: Feedback[];
}

export async function runReview(opts: RunReviewOptions): Promise<ReviewResult> {
  // The picker that chose this plan is still on screen. Clear it, so the review
  // is the whole screen rather than something scrolled underneath a list of
  // options that no longer applies.
  clearScreen();

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
        versions={opts.versions}
        mode={opts.mode}
        version={opts.version}
        previous={opts.previous}
        mouse={readConfig().mouse === 'on'}
        onDone={finish}
      />,
      // ctrl-c should leave, the same as x. Wheel tracking, when it is on at
      // all, is turned off by the effect that turned it on.
      { exitOnCtrlC: true },
    );

    instance
      .waitUntilExit()
      .then(() => finish({ action: 'quit', batches: [], version: opts.versionB, general: '' }));
  });
}

export interface RunPickerOptions<T> {
  title: string;
  /** One dim line under the heading, saying what picking one does. */
  subtitle?: string;
  items: Array<PickerItem<T>>;
  multi?: boolean;
  footer?: string;
  /** planx's own version, for the frame's top edge. */
  version?: string;
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
        subtitle={opts.subtitle}
        items={opts.items}
        multi={opts.multi ?? false}
        footer={opts.footer}
        version={opts.version}
        onDone={finish}
        onCancel={() => finish([])}
      />,
      { exitOnCtrlC: false },
    );

    instance.waitUntilExit().then(() => finish([]));
  });
}

/** Ask one yes/no question outside the TUI, for confirmations in plain commands. */
export async function confirm(question: string, version?: string): Promise<boolean> {
  if (!isInteractive()) return false;
  const [answer] = await runPicker<boolean>({
    title: question,
    version,
    items: [
      { value: false, label: 'no', hint: 'nothing happens' },
      { value: true, label: 'yes', hint: 'go ahead' },
    ],
  });
  return answer === true;
}
