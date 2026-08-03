import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closingBlock, handOffLine } from '../src/cli/commands.js';
import { normalizedLines } from '../src/locks/anchor.js';
import { addLock } from '../src/locks/manage.js';
import { renderSkeleton } from '../src/locks/markers.js';
import { capture, deriveTitle, LockViolationError } from '../src/protocol/capture.js';
import { carriedOver, presentResume } from '../src/protocol/present.js';
import { buildAnnotation, grantUnlock, submitFeedback } from '../src/protocol/submit.js';
import { setColorEnabled } from '../src/render/ansi.js';
import { readLocks, readMeta, readVersionText, updateLocks } from '../src/store/plans.js';
import { listFeedback } from '../src/store/feedback.js';
import { SAMPLE_PLAN, tempStore } from './helpers.js';

let store: ReturnType<typeof tempStore>;

beforeEach(() => {
  store = tempStore();
  setColorEnabled(false);
});
afterEach(() => {
  store.cleanup();
  setColorEnabled(null);
});

function seed() {
  return capture({ text: SAMPLE_PLAN, source: 'test' });
}

function comment(planId: string, version: number, from: number, to: number, body: string) {
  const doc = normalizedLines(readVersionText(planId, version)!);
  return buildAnnotation(doc, 'comment', from, to, body, 'a1');
}

describe('capture', () => {
  it('creates a plan, derives the title from the H1, and writes v1', () => {
    const result = seed();
    expect(result).toMatchObject({ version: 1, created: true, isNewPlan: true });
    expect(result.title).toBe('Guard the clock regression');
    expect(readVersionText(result.planId, 1)).toContain('## Approach');
  });

  it('falls back to the first non-empty line when there is no H1', () => {
    expect(deriveTitle('\n\nJust some prose here.\nMore.\n')).toBe('Just some prose here.');
    expect(deriveTitle('   \n')).toBe('Untitled plan');
  });

  it('is a no-op for byte-identical content, so skills can call it defensively', () => {
    const first = seed();
    const again = capture({ planId: first.planId, text: SAMPLE_PLAN });
    expect(again).toMatchObject({ version: 1, created: false });
  });

  it('refuses to write a version that mutates a locked block, and writes nothing', () => {
    const { planId } = seed();
    updateLocks(planId, (locks) => {
      addLock(locks, {
        docLines: normalizedLines(SAMPLE_PLAN),
        range: { start: 10, end: 11 }, // "## Rollout" and the line under it
        origin: 'user',
        version: 1,
        section: '## Rollout',
      });
    });

    const tampered = SAMPLE_PLAN.replace('Deploy behind', 'Skip the flag and deploy');
    expect(() => capture({ planId, text: tampered })).toThrow(LockViolationError);
    expect(readVersionText(planId, 2)).toBeNull();
    expect(readVersionText(planId, 1)).toContain('Deploy behind');
  });

  it('accepts the same revision once the block arrives as a marker', () => {
    const { planId } = seed();
    updateLocks(planId, (locks) => {
      addLock(locks, {
        docLines: normalizedLines(SAMPLE_PLAN),
        range: { start: 10, end: 11 },
        origin: 'user',
        version: 1,
        section: '## Rollout',
      });
    });

    const skeleton = renderSkeleton(SAMPLE_PLAN, readLocks(planId));
    const revised = skeleton.replace('Clocks can jump backwards', 'Clocks may jump backwards');
    const result = capture({ planId, text: revised, splice: true, parent: 'v1' });

    expect(result.version).toBe(2);
    expect(result.expandedLocks).toEqual(['L1']);
    expect(readVersionText(planId, 2)).toContain('Deploy behind the `ff_clock_guard` flag');
  });
});

describe('the review loop', () => {
  it('retires feedback when the next version lands, so the loop terminates', () => {
    const { planId } = seed();
    submitFeedback({
      planId,
      version: 1,
      verdict: 'revise',
      annotations: [comment(planId, 1, 6, 6, 'Rework this.')],
    });

    const revised = capture({ planId, text: `${SAMPLE_PLAN}\n## Risks\nNone.\n`, parent: 'v1' });
    expect(revised.closedFeedback).toBe(1);
    expect(listFeedback(planId)[0]!.addressed_by).toBe(2);
    // Nothing is outstanding against the new version until someone reviews it.
    expect(listFeedback(planId).filter((f) => f.version === 2)).toHaveLength(0);
  });
});

describe('approval', () => {
  it('seals every section and records the approval on the plan', () => {
    const { planId } = seed();
    const result = submitFeedback({ planId, version: 1, verdict: 'approve', annotations: [] });

    expect(result.sealedLocks.length).toBeGreaterThan(0);
    const locks = readLocks(planId);
    expect(locks.sealed_at).not.toBeNull();
    expect(Object.values(locks.locks).map((l) => l.section)).toContain('## Rollout');

    const meta = readMeta(planId)!;
    expect(meta.approved_version).toBe(1);
    expect(meta.approved_at).not.toBeNull();
  });

  it('makes any later edit fail until a lock is lifted', () => {
    const { planId } = seed();
    submitFeedback({ planId, version: 1, verdict: 'approve', annotations: [] });
    expect(() =>
      capture({ planId, text: SAMPLE_PLAN.replace('Deploy behind', 'Deploy straight') }),
    ).toThrow(LockViolationError);
  });

  it('lets the reviewer carve a hole in a sealed plan', () => {
    const { planId } = seed();
    submitFeedback({ planId, version: 1, verdict: 'approve', annotations: [] });

    const doc = normalizedLines(readVersionText(planId, 1)!);
    submitFeedback({
      planId,
      version: 1,
      verdict: 'revise',
      annotations: [buildAnnotation(doc, 'unlock', 12, 12, '', 'u1')],
    });

    const edited = SAMPLE_PLAN.replace('Deploy behind', 'Deploy straight');
    expect(capture({ planId, text: edited }).version).toBe(2);
  });
});

describe('unlocking a block', () => {
  it('grants exactly one capture, then re-arms', () => {
    const { planId } = seed();
    submitFeedback({ planId, version: 1, verdict: 'approve', annotations: [] });
    const lockId = Object.values(readLocks(planId).locks).find(
      (l) => l.section === '## Rollout',
    )!.id;

    grantUnlock({ planId, lockId, reason: 'the flag adds no value here' });

    const edited = SAMPLE_PLAN.replace('Deploy behind', 'Deploy straight');
    expect(capture({ planId, text: edited }).version).toBe(2);

    // Burned: the same block cannot be edited again without asking afresh.
    expect(() =>
      capture({ planId, text: edited.replace('Deploy straight', 'Deploy sideways') }),
    ).toThrow(LockViolationError);
  });

  it('records the stated reason, which is the whole audit trail', () => {
    const { planId } = seed();
    submitFeedback({ planId, version: 1, verdict: 'approve', annotations: [] });
    const lockId = Object.values(readLocks(planId).locks)[0]!.id;

    grantUnlock({ planId, lockId, reason: 'superseded by the R2 path' });

    const [grant] = Object.values(readLocks(planId).grants);
    expect(grant!.reason).toBe('superseded by the R2 path');
    expect(grant!.lock_id).toBe(lockId);
  });

  it('refuses to grant against a lock that does not exist', () => {
    const { planId } = seed();
    expect(() => grantUnlock({ planId, lockId: 'L99', reason: 'x' })).toThrow(/no lock L99/);
    expect(Object.keys(readLocks(planId).grants)).toHaveLength(0);
  });
});

describe('what the agent sees', () => {
  function resumeOf(planId: string, version: number) {
    const text = readVersionText(planId, version)!;
    const history = listFeedback(planId);
    return presentResume({
      planId,
      version,
      feedback: history.filter((f) => f.version === version),
      carried: carriedOver(history, version, text),
      locks: readLocks(planId),
      docLines: normalizedLines(text),
    });
  }

  it('quotes each annotation and ends with the exact next command', () => {
    const { planId } = seed();
    submitFeedback({
      planId,
      version: 1,
      verdict: 'revise',
      annotations: [comment(planId, 1, 7, 8, 'Wrong layer. Guard belongs in the R2 write path.')],
      general: 'Direction is fine, but see the comment.',
    });

    const text = resumeOf(planId, 1);
    expect(text).toContain(`## planx — ${planId} v1 (verdict: revise)`);
    expect(text).toContain('under "## Approach"');
    expect(text).toContain('> ## Approach');
    expect(text).toContain('**Feedback:** Wrong layer.');
    expect(text).toContain('#### General');
    expect(text).toContain(`planx capture --plan-id ${planId} --parent v1 --splice --stdin`);
  });

  it('lists locked blocks as an instruction and demands markers', () => {
    const { planId } = seed();
    submitFeedback({ planId, version: 1, verdict: 'approve', annotations: [] });
    submitFeedback({
      planId,
      version: 1,
      verdict: 'revise',
      annotations: [comment(planId, 1, 8, 8, 'One more thing.')],
    });

    const text = resumeOf(planId, 1);
    expect(text).toContain('### 🔒 Locked');
    expect(text).toContain('— do not modify');
    expect(text).toContain('[[planx:keep L1]]` markers — do not re-emit their text');
  });

  it('tells the agent to stop when the verdict is approve', () => {
    const { planId } = seed();
    submitFeedback({ planId, version: 1, verdict: 'approve', annotations: [] });

    const text = resumeOf(planId, 1);
    expect(text).toContain('(verdict: approve)');
    expect(text).toContain('Approved and sealed');
    expect(text).not.toContain('planx capture --plan-id');
  });
});

/**
 * The command the reviewer carries back out. Without one the round dead-ends
 * exactly where it is meant to continue, which is what used to happen after a
 * submit — so these are pinned verbatim.
 */
describe('the review hand-off', () => {
  it('sends a slash command to the agent and a bare command to the terminal', () => {
    setColorEnabled(false);
    expect(handOffLine('agent', '/planx revise guard-clock-a3f9').trim()).toBe(
      'Paste to your agent:  /planx revise guard-clock-a3f9',
    );
    expect(handOffLine('agent', '/planx execute guard-clock-a3f9 v3').trim()).toBe(
      'Paste to your agent:  /planx execute guard-clock-a3f9 v3',
    );
    expect(handOffLine('terminal', 'planx guard-clock-a3f9 v3').trim()).toBe(
      'Reopen it with:  planx guard-clock-a3f9 v3',
    );
  });

  it('is a block: nothing blank inside it, one blank after it', () => {
    setColorEnabled(false);
    for (const action of ['quit', 'revise', 'approve'] as const) {
      const block = closingBlock(action, 'guard-clock-a3f9', 4, 6);
      expect(block.slice(0, -1).every((line) => line.trim())).toBe(true);
      expect(block.at(-1)).toBe('');
    }
  });

  it('always offers the way back in, last, whichever way the review ended', () => {
    setColorEnabled(false);
    for (const action of ['quit', 'revise', 'approve'] as const) {
      const block = closingBlock(action, 'guard-clock-a3f9', 4, 6);
      expect(block.at(-2)).toContain('Reopen it with:  planx guard-clock-a3f9 v4');
      expect(block.join('\n')).not.toContain('nothing submitted');
    }

    expect(closingBlock('quit', 'guard-clock-a3f9', 4).join('\n')).not.toContain('Paste');
    expect(closingBlock('revise', 'guard-clock-a3f9', 4)[0]).toContain(
      '/planx revise guard-clock-a3f9',
    );
    expect(closingBlock('approve', 'guard-clock-a3f9', 4, 6)).toEqual([
      '✓ Approved & sealed — guard-clock-a3f9 v4 (6 sections locked).',
      '  Paste to your agent:  /planx execute guard-clock-a3f9 v4',
      '  Reopen it with:  planx guard-clock-a3f9 v4',
      '',
    ]);
  });
});
