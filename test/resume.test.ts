import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { capture } from '../src/protocol/capture.js';
import { carriedOver, presentResume } from '../src/protocol/present.js';
import { buildAnnotation, submitFeedback } from '../src/protocol/submit.js';
import { normalizedLines } from '../src/locks/anchor.js';
import { renderSkeleton } from '../src/locks/markers.js';
import { readLocks, readVersionText } from '../src/store/plans.js';
import { listFeedback } from '../src/store/queue.js';
import { tempStore } from './helpers.js';

const PLAN = `# Guard the clock

## Context
The poller reads a snapshot every 15 seconds.

## Approach
Extend the guard in poller.ts.

## Rollout
Deploy behind ff_clock_guard.
`;

let store: ReturnType<typeof tempStore>;

beforeEach(() => {
  store = tempStore();
});
afterEach(() => {
  store.cleanup();
});

/** What `cmdResume` assembles, without going through the CLI. */
function resumeText(planId: string, version: number): string {
  const text = readVersionText(planId, version)!;
  const history = listFeedback(planId);
  return presentResume({
    planId,
    version,
    feedback: history.filter((f) => f.version === version),
    carried: carriedOver(history, version, text),
    skeleton: renderSkeleton(text, readLocks(planId)),
    locks: readLocks(planId),
    docLines: normalizedLines(text),
  });
}

function comment(planId: string, version: number, from: number, to: number, body: string) {
  const doc = normalizedLines(readVersionText(planId, version)!);
  submitFeedback({
    planId,
    version,
    verdict: 'revise',
    annotations: [buildAnnotation(doc, 'comment', from, to, body, 'a1')],
  });
}

describe('resume', () => {
  it('says there is nothing to revise towards before any review', () => {
    const { planId, version } = capture({ text: PLAN, title: 'p' });
    const out = resumeText(planId, version);

    expect(out).toContain('No review of v1 yet');
    // Must not invite a revision when no one has asked for one.
    expect(out).not.toContain('planx capture');
  });

  it('carries the plan text so a cold session can revise it', () => {
    const { planId, version } = capture({ text: PLAN, title: 'p' });
    comment(planId, version, 7, 7, 'Wrong layer.');

    const out = resumeText(planId, version);
    expect(out).toContain('The plan as it stands');
    expect(out).toContain('Extend the guard in poller.ts.');
    expect(out).toContain('Wrong layer.');
    expect(out).toContain(`planx capture --plan-id ${planId} --parent v1`);
  });

  it('is a pure read — running it twice changes nothing', () => {
    const { planId, version } = capture({ text: PLAN, title: 'p' });
    comment(planId, version, 7, 7, 'Wrong layer.');

    const first = resumeText(planId, version);
    const before = JSON.stringify(listFeedback(planId));
    const second = resumeText(planId, version);

    expect(second).toBe(first);
    expect(JSON.stringify(listFeedback(planId))).toBe(before);
  });
});

/**
 * Capturing a new version silently retires the previous version's feedback,
 * addressed or not. Nothing records the difference, so `resume` infers it from
 * whether the quoted lines survived.
 */
describe('resume flags feedback that was never addressed', () => {
  it('reports a comment whose quoted text is still present verbatim', () => {
    const { planId } = capture({ text: PLAN, title: 'p' });
    comment(planId, 1, 7, 7, 'Wrong layer. Use the R2 write path.');

    // v2 edits Rollout and leaves the quoted Approach line untouched.
    capture({ planId, text: PLAN.replace('ff_clock_guard.', 'ff_clock_guard, staged.') });

    const out = resumeText(planId, 2);
    expect(out).toContain('Still unaddressed from earlier versions');
    expect(out).toContain('Use the R2 write path');
  });

  it('stays quiet once the quoted text actually changes', () => {
    const { planId } = capture({ text: PLAN, title: 'p' });
    comment(planId, 1, 7, 7, 'Wrong layer. Use the R2 write path.');

    capture({
      planId,
      text: PLAN.replace('Extend the guard in poller.ts.', 'Extend the guard in the R2 writer.'),
    });

    const out = resumeText(planId, 2);
    expect(out).not.toContain('Still unaddressed');
  });

  it('does not flag feedback on the version being resumed', () => {
    const { planId, version } = capture({ text: PLAN, title: 'p' });
    comment(planId, version, 7, 7, 'Wrong layer.');

    // The quote is trivially still present — it is the current version.
    expect(carriedOver(listFeedback(planId), version, PLAN)).toEqual([]);
  });

  it('reports each distinct comment once, not once per later version', () => {
    const { planId } = capture({ text: PLAN, title: 'p' });
    comment(planId, 1, 7, 7, 'Wrong layer.');
    capture({ planId, text: PLAN.replace('every 15 seconds.', 'every 15s.') });
    capture({ planId, text: PLAN.replace('every 15 seconds.', 'every 15 s.') });

    const carried = carriedOver(listFeedback(planId), 3, readVersionText(planId, 3)!);
    expect(carried).toHaveLength(1);
    expect(carried[0]!.version).toBe(1);
  });
});
