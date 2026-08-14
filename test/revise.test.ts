import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cmdExecute } from '../src/cli/commands.js';
import { capture } from '../src/protocol/capture.js';
import { carriedOver, presentResume } from '../src/protocol/present.js';
import { buildAnnotation, submitFeedback } from '../src/protocol/submit.js';
import { readMeta, readVersions, readVersionText, rewriteVersion } from '../src/store/plans.js';
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
  return resumeText(planId, version, false);
}

/** The same payload `cmdExecute` prints, minus the mark it writes. */
function executeText(planId: string, version: number): string {
  return resumeText(planId, version, true);
}

function resumeText(planId: string, version: number, executing: boolean): string {
  const text = readVersionText(planId, version)!;
  const history = listFeedback(planId);
  return presentResume({
    planId,
    version,
    text,
    feedback: history.filter((f) => f.version === version),
    carried: carriedOver(history, version, text),
    edits: readVersions(planId).versions.find((v) => v.n === version)?.edits ?? [],
    executing,
  });
}

/** The plan back out of the fence `presentResume` wraps it in. */
function fencedBody(out: string): string {
  const lines = out.split('\n');
  const open = lines.findIndex((line) => /^`{3,}markdown$/.test(line));
  const fence = lines[open]!.replace('markdown', '');
  const close = lines.indexOf(fence, open + 1);
  return lines.slice(open + 1, close).join('\n');
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
  it('says nobody has reviewed it, and revises anyway', () => {
    const { planId, version } = capture({ text: PLAN, title: 'p' });
    const out = reviseText(planId, version);

    expect(out).toContain('No review of v1 yet');
    // It does not refuse. What the revision is towards, with no feedback on the
    // version, is whatever the user asked for in the chat.
    expect(out).toContain('user asked for in the chat');
    expect(out).toContain(`planx capture --plan-id ${planId} --parent v1`);
  });

  // An agent revising from the copy in its context retypes the plan, and
  // retyped prose comes back re-wrapped: paragraphs nobody touched land in the
  // reviewer's diff with their line breaks moved. It gets the stored bytes.
  it('sends the plan with the feedback', () => {
    const { planId, version } = capture({ text: PLAN, title: 'p' });
    comment(planId, version, 7, 7, 'Wrong layer.');

    const out = reviseText(planId, version);
    expect(out).toContain('### The plan as it stands (v1)');
    expect(out).toContain('same words, same line breaks, same wrapping');
    expect(out).toContain('Wrong layer.');
    expect(out).toContain(`planx capture --plan-id ${planId} --parent v1`);
  });

  it('reproduces the stored version byte for byte', () => {
    const { planId, version } = capture({ text: PLAN, title: 'p' });
    comment(planId, version, 7, 7, 'Wrong layer.');

    const body = fencedBody(reviseText(planId, version));
    expect(body).toBe(PLAN.replace(/\n$/, ''));
  });

  // A plan of any size has fenced code in it, and a three-backtick fence would
  // close on the first one — handing back a plan that is truncated exactly
  // where it stopped being copyable.
  it('fences wide enough to survive the code blocks inside the plan', () => {
    const withCode = `# Fences\n\n## Approach\n\n\`\`\`ts\nconst n = 1;\n\`\`\`\n\nDone.\n`;
    const { planId, version } = capture({ text: withCode, title: 'p' });
    comment(planId, version, 1, 1, 'Wrong layer.');

    expect(fencedBody(reviseText(planId, version))).toBe(withCode.replace(/\n$/, ''));
  });

  // No feedback still needs the plan: `execute` reaches this same state on an
  // unreviewed version, and that agent is about to build it.
  it('sends the plan even when no one has reviewed it', () => {
    const { planId, version } = capture({ text: PLAN, title: 'p' });

    const out = reviseText(planId, version);
    expect(out).toContain('there is no feedback to work from');
    expect(fencedBody(out)).toBe(PLAN.replace(/\n$/, ''));
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
 * The half `revise` does not have. Merging the read into the mark makes looking
 * a write, which is the whole reason `--no-mark` exists.
 */
describe('execute marks the version it hands over', () => {
  function run(planId: string, version: number, ...flags: string[]): string[] {
    const out: string[] = [];
    cmdExecute({
      args: {
        positionals: [planId, `v${version}`],
        values: new Map(),
        bools: new Set(flags),
        unknown: [],
      },
      json: false,
      mode: 'plain',
      version: '9.9.9',
      out: (line) => out.push(line),
      err: () => {},
    });
    return out;
  }

  it('records the build, and hands over the same payload revise does', () => {
    const { planId, version } = capture({ text: PLAN, title: 'p' });
    comment(planId, version, 7, 7, 'Wrong layer.');

    const printed = run(planId, version).join('\n');
    expect(printed).toBe(executeText(planId, version));
    expect(readMeta(planId)?.executed).toMatchObject({ version: 1 });
  });

  it('leaves the store alone with --no-mark', () => {
    const { planId, version } = capture({ text: PLAN, title: 'p' });

    const printed = run(planId, version, '--no-mark').join('\n');
    expect(printed).toContain('### The plan as it stands (v1)');
    expect(readMeta(planId)?.executed).toBe(null);
  });
});

/**
 * Three states a version can be in, two commands, six closings.
 *
 * The plan, the quoted lines and the carried-over comments are in all six —
 * only the last block differs. Executing a plan that still carries comments is
 * supported, and the last thing an agent about to build it reads must not be an
 * instruction to revise and capture; neither command refuses for want of a
 * review, because there is always the chat to work from.
 */
describe('the six closings', () => {
  /** Comments, edits, or both. */
  describe('with something asked of it', () => {
    it('sends revise to capture', () => {
      const { planId, version } = capture({ text: PLAN, title: 'p' });
      comment(planId, version, 7, 7, 'Wrong layer.');

      const out = reviseText(planId, version);
      expect(out).toContain('Revise the plan addressing every comment.');
      expect(out).toContain(`planx capture --plan-id ${planId} --parent v1 --stdin`);
    });

    it('sends execute to the build, with the same feedback in it', () => {
      const { planId, version } = capture({ text: PLAN, title: 'p' });
      comment(planId, version, 7, 7, 'Wrong layer.');

      const out = executeText(planId, version);
      // Same feedback, quoted against the same lines.
      expect(out).toContain('**Feedback:** Wrong layer.');
      expect(out).toContain('> Extend the guard in poller.ts.');

      expect(out).toContain('Build the plan, addressing every comment as you go.');
      expect(out).toContain('Do not capture a new');
      expect(out).not.toContain('planx capture');
      expect(out).not.toContain('Revise the plan');
    });

    it('says the same to execute when the only review is an edited line', () => {
      const { planId, version } = capture({ text: PLAN, title: 'p' });
      rewriteVersion(planId, version, [
        { line: 7, text: 'Extend the guard on the R2 write path.' },
      ]);

      const out = executeText(planId, version);
      expect(out).toContain('### Edited by the reviewer');
      expect(out).toContain('Build the plan, addressing every comment as you go.');
      expect(out).not.toContain('planx capture');
    });
  });

  /** Nobody has opened it. */
  describe('never reviewed', () => {
    it('tells revise to work from the chat, and still capture', () => {
      const { planId, version } = capture({ text: PLAN, title: 'p' });

      const out = reviseText(planId, version);
      expect(out).toContain('No review of v1 yet, so there is no feedback to work from.');
      expect(out).toContain('user asked for in the chat');
      expect(out).toContain(`planx capture --plan-id ${planId} --parent v1 --stdin`);
    });

    it('tells execute to build what is there', () => {
      const { planId, version } = capture({ text: PLAN, title: 'p' });

      const out = executeText(planId, version);
      expect(out).toContain('No review of v1 yet, so there is no feedback to work from.');
      expect(out).toContain('Build the plan');
      expect(out).toContain('Do not capture a new version.');
      expect(out).not.toContain('planx capture');
    });
  });

  /** Somebody looked and was happy — a different fact from nobody looking. */
  describe('reviewed, and it asked for nothing', () => {
    it('says so to revise, which revises from the chat', () => {
      const { planId, version } = capture({ text: PLAN, title: 'p' });
      submitFeedback({ planId, version, annotations: [] });

      const out = reviseText(planId, version);
      expect(out).toContain('Reviewed with nothing to change — no feedback on v1.');
      expect(out).toContain('user asked for in the chat');
      expect(out).toContain(`planx capture --plan-id ${planId} --parent v1 --stdin`);
      // Not the wording for a version nobody has opened.
      expect(out).not.toContain('No review of v1 yet');
    });

    it('says so to execute, which builds it as written', () => {
      const { planId, version } = capture({ text: PLAN, title: 'p' });
      submitFeedback({ planId, version, annotations: [] });

      const out = executeText(planId, version);
      expect(out).toContain('Reviewed with nothing to change. Build the plan as written.');
      expect(out).not.toContain('planx capture');
      expect(out).not.toContain('No review of v1 yet');
    });
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
