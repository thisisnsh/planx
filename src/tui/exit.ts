import { useApp, useInput } from 'ink';
import { useState } from 'react';

/**
 * Leaving planx, from anywhere: ctrl+c, twice.
 *
 * `x` used to be the way out, and it is execute now — so the exit has to be a
 * key that means the same thing in every mode, including the ones that swallow
 * every printable character. ctrl+c is that key, and doubling it is what keeps
 * a plan you have been annotating for ten minutes from going on one keystroke.
 *
 * It is mounted above the mode-scoped handlers, with `isActive: true`, so it
 * fires while a note is being typed, while a line is open, while the delete
 * confirmation is waiting for the word, and on the hand-off prompt.
 */

/** 128 + SIGINT, which is what a shell reports for an interrupted program. */
export const INTERRUPTED = 130;

export interface DoubleCtrlCOptions {
  /**
   * What the second press does. The default unmounts and ends the process;
   * a test passes its own so the suite survives being interrupted.
   */
  onExit?: () => void;
}

/**
 * True once ctrl+c has been pressed and is waiting for its second.
 *
 * There is no timer. A guard that expires on a clock is a guard that behaves
 * differently depending on how fast you type — any other key disarms it
 * instead, which is a rule you can see happening.
 */
export function useDoubleCtrlC(opts: DoubleCtrlCOptions = {}): boolean {
  const { exit } = useApp();
  const [armed, setArmed] = useState(false);

  useInput(
    (input, key) => {
      if (key.ctrl && input === 'c') {
        if (!armed) return setArmed(true);
        if (opts.onExit) return opts.onExit();
        // Nothing is printed and nothing is submitted: this is leaving, not
        // finishing. Ink restores the terminal as it unmounts.
        exit();
        process.exit(INTERRUPTED);
      }
      if (armed) setArmed(false);
    },
    { isActive: true },
  );

  return armed;
}

/** The red row an armed guard draws on whatever frame you are in. */
export const EXIT_PROMPT = 'Press ctrl+c again to exit.';
