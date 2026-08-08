import { render } from 'ink';
import type { StepRunner } from '../install/install.js';
import type { RenderMode } from '../render/diff.js';
import type { DefaultKey } from '../store/defaults.js';
import type { Defaults as DefaultValues, Feedback } from '../store/types.js';
import { Defaults } from './Defaults.js';
import { terminalWidth } from './frame.js';
import { Picker, type PickerItem } from './Picker.js';
import { ReviewApp, type Commands, type ReviewResult } from './ReviewApp.js';
import { Steps, stepLine, type StepRow } from './Steps.js';
import { UpdatePrompt, type UpdateChoice } from './UpdatePrompt.js';

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

/**
 * Put the cursor back on a line of its own after Ink lets go of the screen.
 *
 * Ink's last frame does not always end in a newline, so the cursor can be left
 * sitting at the end of the bottom border. Whatever printed next — the closing
 * block, most visibly — put its first character in the border's last column and
 * wrapped the rest, which is how `Reopen it with:` reached the screen as
 * `eopen it with:`. One newline of our own makes the handoff the same at every
 * width instead of depending on where Ink happened to stop.
 */
export function endFrame(): void {
  if (process.stdout.isTTY) process.stdout.write('\n');
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
  /** Every note left on this plan; the review loads the ones for the version
   *  you are on, editable, and rewrites them on submit. */
  previous: Feedback[];
  /** The launch line for each intent, per version — what the hand-off list shows. */
  commands?: Commands;
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
      endFrame();
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
        commands={opts.commands}
        onDone={finish}
      />,
      // ctrl+c is the review's own, twice — see `useDoubleCtrlC`. Ink killing
      // the process on the first press would take a plan's worth of unsubmitted
      // notes with it.
      { exitOnCtrlC: false },
    );

    // An unmount nobody asked for lands back on the list, which is the one
    // ending that writes nothing and loses nothing.
    instance.waitUntilExit().then(() =>
      finish({
        action: 'back',
        command: null,
        custom: null,
        batches: [],
        version: opts.versionB,
        edits: [],
        editedVersion: null,
      }),
    );
  });
}

/**
 * Long enough that a step is a thing you saw happen.
 *
 * Copying four directories takes single-digit milliseconds, so without this the
 * screen would draw once, finished, and the step-by-step would be a lie told at
 * 60fps. The hold is on the near side of each step's work — nothing is reported
 * done before it is done — which is the difference between pacing and theatre.
 */
const STEP_HOLD_MS = 100;

export interface StepsController {
  /** Hand to `runInstall`; it reports each step through here. */
  onStep: StepRunner;
  /**
   * Ask on the same screen, answered by typing `word`. Always false when there
   * is no terminal: nobody is there to type, and the answer this would have to
   * assume cannot be undone.
   */
  confirm: (question: string, word: string) => Promise<boolean>;
  /** The last line, drawn under everything else. */
  close: (line: string) => Promise<void>;
}

export interface RunStepsOptions {
  /** Where the plain-text form goes when there is no terminal to draw on. */
  out: (line: string) => void;
  /** `--json` and a pipe both mean: print lines, draw nothing. */
  plain: boolean;
}

/**
 * Drive a multi-step command, drawn live or printed flat.
 *
 * Not a TTY, or `--json`: the same steps go out as sequential lines and scroll,
 * so a CI log keeps everything a person watching the screen would have seen.
 */
export async function runSteps<T>(
  opts: RunStepsOptions,
  body: (controller: StepsController) => Promise<T>,
): Promise<T> {
  const rows: StepRow[] = [];
  let closing: string | null = null;
  let prompt: StepsProps['prompt'] = null;

  if (opts.plain) {
    const controller: StepsController = {
      onStep: async (step, work) => {
        const outcome = work();
        opts.out(stepLine({ ...blank(step), note: outcome.note, ok: outcome.ok !== false }));
      },
      confirm: async () => false,
      close: async (line) => opts.out(line),
    };
    return body(controller);
  }

  // No `clearScreen()`. `add-skills` is a handful of lines and has no reason to
  // take the screen — wiping the scrollback took whatever the user was reading
  // when they decided to run it. Ink redraws its own frame in place, so the
  // steps still tick over as they happen; they just do it below what is already
  // there.
  const width = terminalWidth();
  const draw = () =>
    instance.rerender(<Steps rows={[...rows]} closing={closing} prompt={prompt} width={width} />);

  const instance = render(<Steps rows={[]} closing={null} prompt={null} width={width} />, {
    exitOnCtrlC: false,
  });

  try {
    return await body({
      onStep: async (step, work) => {
        const row = { ...blank(step), note: '', ok: true };
        rows.push(row);
        draw();
        await hold();
        const outcome = work();
        row.note = outcome.note;
        row.ok = outcome.ok !== false;
        draw();
      },
      confirm: (question, word) =>
        new Promise<boolean>((resolve) => {
          const answer = (yes: boolean) => {
            prompt = null;
            draw();
            resolve(yes);
          };
          // What has been typed lives here, so `Steps` can stay a pure view of
          // it the way it already is for the rows.
          const retype = (typed: string) => {
            prompt = { question, word, typed, onType: retype, onAnswer: answer };
            draw();
          };
          retype('');
        }),
      close: async (line) => {
        closing = line;
        draw();
        await hold();
      },
    });
  } finally {
    instance.unmount();
    endFrame();
  }
}

type StepsProps = Parameters<typeof Steps>[0];

function blank(step: { group: string; label?: string; path?: string }): StepRow {
  return { group: step.group, label: step.label ?? '', path: step.path ?? '', note: '', ok: true };
}

function hold(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, STEP_HOLD_MS));
}

export interface RunPickerOptions<T> {
  title: string;
  /** One dim line under the heading, saying what picking one does. */
  subtitle?: string;
  items: Array<PickerItem<T>>;
  /** Delete the highlighted row, and return the list as it stands afterwards. */
  onDelete?: (item: PickerItem<T>) => Array<PickerItem<T>>;
  /** What the hint bar says enter does. Defaults to `open`. */
  enterLabel?: string;
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
      endFrame();
      resolve(chosen);
    };

    const instance = render(
      <Picker
        title={opts.title}
        subtitle={opts.subtitle}
        items={opts.items}
        onDelete={opts.onDelete}
        enterLabel={opts.enterLabel}
        version={opts.version}
        onDone={finish}
      />,
      { exitOnCtrlC: false },
    );

    instance.waitUntilExit().then(() => finish([]));
  });
}

export interface RunDefaultsOptions {
  /** The block as it stands on disk. */
  values: DefaultValues;
  /** planx's own version, for the frame. */
  version?: string;
  /** Write one field. The screen names the key; the store is the caller's. */
  onSave: (key: DefaultKey, value: string | null) => void;
}

/**
 * The defaults screen, until `esc`.
 *
 * It takes the screen the way the review does. Every commit is already on disk
 * by the time this comes back, so there is nothing to return.
 */
export async function runDefaults(opts: RunDefaultsOptions): Promise<void> {
  clearScreen();

  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      instance.unmount();
      endFrame();
      resolve();
    };

    const instance = render(
      <Defaults values={opts.values} version={opts.version} onSave={opts.onSave} onDone={finish} />,
      // ctrl+c is the screen's own, twice — the same guard every planx frame
      // wears, so leaving means the same keystroke wherever you are.
      { exitOnCtrlC: false },
    );

    instance.waitUntilExit().then(finish);
  });
}

/** Ask about a cached update before opening a review. No answer means skip. */
export async function runUpdatePrompt(latest: string, current: string): Promise<UpdateChoice> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (chosen: UpdateChoice[]) => {
      if (settled) return;
      settled = true;
      instance.unmount();
      endFrame();
      resolve(chosen[0] ?? 'skip');
    };

    const instance = render(<UpdatePrompt latest={latest} current={current} onDone={finish} />, {
      exitOnCtrlC: false,
    });

    instance.waitUntilExit().then(() => finish([]));
  });
}
