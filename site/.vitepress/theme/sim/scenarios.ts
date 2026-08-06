/**
 * What each page's demo opens on, and what it asks you to try.
 *
 * A demo that opens on an empty plan teaches nothing, so every scenario starts
 * mid-review: feedback already left, versions already behind it. The checklist
 * beside the frame is the page's own argument, one key at a time — it ticks off
 * what you actually did, and nothing is gated on it.
 */

import type { SimOptions } from './engine.js';
import { guardClock, lineOf, VERSIONS } from './plans.js';

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
    lede: 'A real review, mid-flight: v3 of a plan, one comment already on it, the context section folded away. Press d for the diff against v2.',
    tasks: [
      { id: 'move', label: 'Move the cursor with ↑ ↓' },
      { id: 'select', label: 'Select lines with v, then ↑ ↓' },
      { id: 'feedback', label: 'Comment on them with f — type, then enter' },
      { id: 'edit', label: 'Rewrite a line yourself with e' },
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

  /** Executing: a version you have nothing left to say about. */
  executing: () => ({
    plan: { ...guardClock(), feedback: {}, notes: {} },
    version: 3,
    diff: false,
    lede: 'v3 with nothing left on it. Submitting an empty review is how you say the plan is fine — and what prints is the one command that builds it.',
    tasks: [
      { id: 'submit', label: 's submits with nothing, and prints /planx execute' },
      { id: 'move', label: '↑ ↓ read it through once more first' },
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
