import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { capture } from '../src/protocol/capture.js';
import { carriedOver, presentResume } from '../src/protocol/present.js';
import { buildAnnotation, submitFeedback } from '../src/protocol/submit.js';
import { readVersions, readVersionText, rewriteVersion } from '../src/store/plans.js';
import { normalizedLines } from '../src/store/text.js';
import { listFeedback } from '../src/store/feedback.js';
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

/** What `cmdRevise` assembles, without going through the CLI. */
function reviseText(planId: string, version: number): string {
  const text = readVersionText(planId, version)!;
  const history = listFeedback(planId);
  return presentResume({
    planId,
    version,
    feedback: history.filter((f) => f.version === version),
    carried: carriedOver(history, version, text),
    edits: readVersions(planId).versions.find((v) => v.n === version)?.edits ?? [],
  });
}

function comment(planId: string, version: number, from: number, to: number, body: string) {
  const doc = normalizedLines(readVersionText(planId, version)!);
  submitFeedback({
    planId,
    version,
    annotations: [buildAnnotation(doc, from, to, body, 'a1')],
  });
}

describe('revise', () => {
  it('says there is nothing to revise towards before any review', () => {
    const { planId, version } = capture({ text: PLAN, title: 'p' });
    const out = reviseText(planId, version);

    expect(out).toContain('No review of v1 yet');
    // Must not invite a revision when no one has asked for one.
    expect(out).not.toContain('planx capture');
  });

  // The agent that wrote the plan already has it, and for a plan of any size
  // re-sending it dwarfs the feedback this exists to deliver.
  it('sends the feedback and not the plan', () => {
    const { planId, version } = capture({ text: PLAN, title: 'p' });
    comment(planId, version, 7, 7, 'Wrong layer.');

    const out = reviseText(planId, version);
    expect(out).not.toContain('The plan as it stands');
    expect(out).not.toContain('````');
    expect(out).toContain('Wrong layer.');
    expect(out).toContain(`planx capture --plan-id ${planId} --parent v1`);
  });

  // The quoted lines are what make a line number mean anything once a revision
  // has moved it, so they stay — dropping them would force the `planx show`
  // this is trying to avoid.
  it('still quotes the lines every comment is anchored to', () => {
    const { planId, version } = capture({ text: PLAN, title: 'p' });
    comment(planId, version, 7, 7, 'Wrong layer.');

    const out = reviseText(planId, version);
    expect(out).toContain('> Extend the guard in poller.ts.');
    expect(out).toContain('(line 7)');
  });

  it('is a pure read — running it twice changes nothing', () => {
    const { planId, version } = capture({ text: PLAN, title: 'p' });
    comment(planId, version, 7, 7, 'Wrong layer.');

    const first = reviseText(planId, version);
    const before = JSON.stringify(listFeedback(planId));
    const second = reviseText(planId, version);

    expect(second).toBe(first);
    expect(JSON.stringify(listFeedback(planId))).toBe(before);
  });
});

/**
 * A line the reviewer rewrote is not a request. It is text they have already
 * settled, and the only thing the agent has to do with it is carry it through.
 */
describe('revise reports what the reviewer edited', () => {
  it('names the line, what it was, and what it now says', () => {
    const { planId, version } = capture({ text: PLAN, title: 'p' });
    rewriteVersion(planId, version, [{ line: 7, text: 'Extend the guard on the R2 write path.' }]);

    const out = reviseText(planId, version);
    expect(out).toContain('### Edited by the reviewer');
    expect(out).toContain('This is settled text, not a request');
    expect(out).toContain('- **line 7**');
    expect(out).toContain('  - was: `Extend the guard in poller.ts.`');
    expect(out).toContain('  - now: `Extend the guard on the R2 write path.`');
  });

  it('reads as one change when the same line was edited twice', () => {
    const { planId, version } = capture({ text: PLAN, title: 'p' });
    rewriteVersion(planId, version, [{ line: 7, text: 'Extend the guard in the writer.' }]);
    rewriteVersion(planId, version, [{ line: 7, text: 'Extend the guard on the R2 write path.' }]);

    const out = reviseText(planId, version);
    expect(out.match(/- \*\*line 7\*\*/g)).toHaveLength(1);
    expect(out).toContain('  - was: `Extend the guard in poller.ts.`');
    expect(out).not.toContain('in the writer');
  });

  // A line that is nothing but backticks would otherwise close the inline code
  // span in the middle of itself.
  it('fences a rewritten line around the backticks it contains', () => {
    const { planId, version } = capture({ text: PLAN, title: 'p' });
    rewriteVersion(planId, version, [{ line: 9, text: 'Deploy behind `ff_clock_guard`' }]);

    expect(reviseText(planId, version)).toContain('  - now: `` Deploy behind `ff_clock_guard` ``');
  });

  it('is above what was asked, and leaves no empty heading when nothing was', () => {
    const { planId, version } = capture({ text: PLAN, title: 'p' });
    rewriteVersion(planId, version, [{ line: 7, text: 'Extend the guard in the writer.' }]);
    // Submitting edits alone writes an empty record — that is what this is.
    submitFeedback({ planId, version, annotations: [] });

    const out = reviseText(planId, version);
    expect(out).not.toContain('### What was asked');
    expect(out).toContain('### Edited by the reviewer');
    // The capture instruction follows as usual, without sending the agent
    // looking for a comment that was never left.
    expect(out).toContain(`planx capture --plan-id ${planId} --parent v1`);
    expect(out).toContain('keeping every edited line exactly as it now reads');

    comment(planId, version, 4, 4, 'Say how often.');
    const withBoth = reviseText(planId, version);
    expect(withBoth.indexOf('### Edited by the reviewer')).toBeLessThan(
      withBoth.indexOf('### What was asked'),
    );
    expect(withBoth).toContain('addressing every comment');
  });

  it('is a review in itself — no version carrying one is reported as unreviewed', () => {
    const { planId, version } = capture({ text: PLAN, title: 'p' });
    rewriteVersion(planId, version, [{ line: 7, text: 'Extend the guard in the writer.' }]);

    const out = reviseText(planId, version);
    expect(out).not.toContain('No review of v1 yet');
    expect(out).toContain('### Edited by the reviewer');
  });
});

/**
 * Capturing a new version silently retires the previous version's feedback,
 * addressed or not. Nothing records the difference, so `revise` infers it from
 * whether the quoted lines survived.
 */
describe('revise flags feedback that was never addressed', () => {
  it('reports a comment whose quoted text is still present verbatim', () => {
    const { planId } = capture({ text: PLAN, title: 'p' });
    comment(planId, 1, 7, 7, 'Wrong layer. Use the R2 write path.');

    // v2 edits Rollout and leaves the quoted Approach line untouched.
    capture({ planId, text: PLAN.replace('ff_clock_guard.', 'ff_clock_guard, staged.') });

    const out = reviseText(planId, 2);
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

    const out = reviseText(planId, 2);
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
