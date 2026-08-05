/**
 * What each page's demo opens on, and what it asks you to try.
 *
 * A demo that opens on an empty plan teaches nothing, so every scenario starts
 * mid-review: feedback already left, a section already locked, versions already
 * behind it. The checklist beside the frame is the page's own argument, one key
 * at a time — it ticks off what you actually did, and nothing is gated on it.
 */

import type { SimOptions } from './engine.js';
import { guardClock, guardClockSealed, lineOf, VERSIONS } from './plans.js';

export interface Task {
  /** An entry the engine records in `did` when the key lands. */
  id: string;
  label: string;
}

export interface Scenario extends SimOptions {
  /** One line under the heading, saying what you are looking at. */
  lede?: string;
  tasks: Task[];
}

const V2 = VERSIONS[1]!;
const V3 = VERSIONS[2]!;

export const SCENARIOS: Record<string, () => Scenario> = {
  /** The front page: everything on at once, opened as the newest diff. */
  playground: () => ({
    plan: guardClock({ folded: [lineOf(V3, '## Context')] }),
    version: 3,
    diff: false,
    lede: 'A real review, mid-flight: v3 of a plan, one comment already on it, the context section folded away, the rollout section frozen. Press d for the diff against v2.',
    tasks: [
      { id: 'move', label: 'Move the cursor with ↑ ↓' },
      { id: 'select', label: 'Select lines with v, then ↑ ↓' },
      { id: 'feedback', label: 'Comment on them with f — type, then enter' },
      { id: 'lock', label: 'Freeze a section with l' },
      { id: 'diff', label: 'Toggle the diff with d' },
      { id: 'fold', label: 'Fold a section or a note with space' },
      { id: 'submit', label: 'Send it all back with s' },
    ],
  }),

  /** The review loop: comment, note, rewrite a line, submit once. */
  review: () => ({
    plan: guardClock(),
    version: 3,
    diff: false,
    lede: 'The latest version, on its own. Everything you leave here — comments, a note, lines you rewrote — goes back in one submit.',
    tasks: [
      { id: 'select', label: 'v selects lines, ↑ ↓ extend the selection' },
      { id: 'feedback', label: 'f writes feedback anchored to them' },
      { id: 'edit', label: 'e rewrites the line yourself' },
      { id: 'note', label: 'n leaves one note about the whole plan' },
      { id: 'jump', label: 'j walks the feedback already on this version' },
      { id: 'submit', label: 's submits, and prints the command to paste back' },
    ],
  }),

  /** Locking: freeze, unlock, and what approval does to the whole plan. */
  locking: () => ({
    plan: guardClock(),
    version: 3,
    diff: false,
    lede: 'The rollout section carries lock L1. The ⚿ in the gutter is what a frozen line looks like.',
    tasks: [
      { id: 'lock', label: 'Select lines and press l to freeze them' },
      { id: 'unlock', label: 'Press l on a frozen line to lift it' },
      { id: 'feedback', label: 'Try f on a locked line — it declines, and says why' },
      { id: 'approve', label: 'Press a to seal the plan: every section locks at once' },
    ],
  }),

  /** Diffing: versions, the diff toggle, collapsed runs. */
  diffing: () => ({
    plan: guardClock(),
    version: 3,
    diff: true,
    lede: 'v3 opens as the diff against v2 — you opened v3 because it is new, and what is new about it is the diff.',
    tasks: [
      { id: 'diff', label: 'd shows the plan on its own, and puts the diff back' },
      { id: 'version', label: '← → walk the history, v1 to v3' },
      { id: 'expand', label: 'space on a ⋯ row opens the unchanged lines it hides' },
      { id: 'move', label: 'Changed lines carry + and −; the words that changed are lit' },
    ],
  }),

  /** After approval: sealed, every section locked, nothing left to edit. */
  sealed: () => ({
    plan: guardClockSealed(),
    version: 3,
    diff: false,
    lede: 'The same plan after a. It is sealed — every line carries a lock, and e refuses.',
    tasks: [
      { id: 'move', label: 'Every section is frozen: ⚿ on every line' },
      { id: 'lock', label: 'l still lifts one, if you have to' },
      { id: 'help', label: '? lists every key' },
    ],
  }),

  /** The agent pages: leave one comment, submit, read the hand-off. */
  agents: () => ({
    plan: guardClock(),
    version: 2,
    diff: true,
    lede: 'What your agent gets back is printed under the frame the moment you submit.',
    tasks: [
      { id: 'feedback', label: 'f leaves a comment on the line under the cursor' },
      { id: 'submit', label: 's prints the one command you paste into the chat' },
      { id: 'approve', label: 'a instead of s, when there is nothing left to say' },
    ],
  }),
};

export function scenario(name: string): Scenario {
  const found = SCENARIOS[name];
  if (!found) throw new Error(`planx demo: no scenario named ${name}`);
  return found();
}

export { lineOf, V2, V3 };
