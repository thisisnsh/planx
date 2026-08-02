import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { normalizedLines } from '../src/locks/anchor.js';
import { addLock } from '../src/locks/manage.js';
import { renderSkeleton } from '../src/locks/markers.js';
import {
  awaitFeedback,
  awaitUnlockDecision,
  pendingRequests,
  timeoutMessage,
} from '../src/protocol/await.js';
import { capture, deriveTitle, LockViolationError } from '../src/protocol/capture.js';
import { presentFeedback, presentUnlockDecision } from '../src/protocol/present.js';
import { buildAnnotation, respondToUnlock, submitFeedback } from '../src/protocol/submit.js';
import { setColorEnabled } from '../src/render/ansi.js';
import { readLocks, readMeta, readVersionText, updateLocks } from '../src/store/plans.js';
import { listFeedback, openFeedback } from '../src/store/queue.js';
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
  it('delivers feedback left before anyone was waiting', async () => {
    const { planId } = seed();
    submitFeedback({
      planId,
      version: 1,
      verdict: 'revise',
      annotations: [comment(planId, 1, 6, 7, 'Wrong layer.')],
      general: 'Direction is fine.',
    });

    const outcome = await awaitFeedback({ planId, version: 1, timeoutSec: 5 });
    expect(outcome.kind).toBe('ready');
    expect(outcome.kind === 'ready' && outcome.value[0]!.annotations[0]!.comment).toBe(
      'Wrong layer.',
    );
  });

  it('unblocks a waiting await when the reviewer submits', async () => {
    const { planId } = seed();
    const waiting = awaitFeedback({ planId, version: 1, timeoutSec: 10 });

    // Give the await a moment to register, then answer it out of band.
    await new Promise((r) => setTimeout(r, 150));
    expect(pendingRequests(planId)).toHaveLength(1);
    submitFeedback({
      planId,
      version: 1,
      verdict: 'revise',
      annotations: [comment(planId, 1, 6, 6, 'Move it.')],
    });

    const outcome = await waiting;
    expect(outcome.kind).toBe('ready');
    expect(pendingRequests(planId)).toHaveLength(0);
  });

  it('returns a resumable message instead of dying at the timeout ceiling', async () => {
    const { planId } = seed();
    const outcome = await awaitFeedback({ planId, version: 1, timeoutSec: 1 });
    expect(outcome.kind).toBe('timeout');
    expect(timeoutMessage(480)).toBe(
      'PLANX: no feedback yet (waited 480s) — run the same command again to keep waiting',
    );
    expect(pendingRequests(planId)).toHaveLength(0);
  });

  it('gives two concurrent awaits the same feedback', async () => {
    const { planId } = seed();
    const a = awaitFeedback({ planId, version: 1, timeoutSec: 10 });
    const b = awaitFeedback({ planId, version: 1, timeoutSec: 10 });
    await new Promise((r) => setTimeout(r, 150));
    submitFeedback({
      planId,
      version: 1,
      verdict: 'revise',
      annotations: [comment(planId, 1, 6, 6, 'Same note for both.')],
    });

    const [first, second] = await Promise.all([a, b]);
    expect(first.kind).toBe('ready');
    expect(second.kind).toBe('ready');
    const idOf = (o: typeof first) => (o.kind === 'ready' ? o.value.map((f) => f.id) : []);
    expect(idOf(first)).toEqual(idOf(second));
  });

  it('closes feedback when the next version lands, so the loop terminates', async () => {
    const { planId } = seed();
    submitFeedback({
      planId,
      version: 1,
      verdict: 'revise',
      annotations: [comment(planId, 1, 6, 6, 'Rework this.')],
    });
    expect(openFeedback(planId)).toHaveLength(1);

    const revised = capture({ planId, text: `${SAMPLE_PLAN}\n## Risks\nNone.\n`, parent: 'v1' });
    expect(revised.closedFeedback).toBe(1);
    expect(openFeedback(planId)).toHaveLength(0);
    expect(listFeedback(planId)[0]!.addressed_by).toBe(2);

    const outcome = await awaitFeedback({ planId, version: 2, timeoutSec: 1 });
    expect(outcome.kind).toBe('timeout');
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

describe('the unlock handshake', () => {
  it('blocks the agent until the reviewer decides, then grants one capture', async () => {
    const { planId } = seed();
    submitFeedback({ planId, version: 1, verdict: 'approve', annotations: [] });
    const lockId = Object.values(readLocks(planId).locks).find(
      (l) => l.section === '## Rollout',
    )!.id;

    const waiting = awaitUnlockDecision({
      planId,
      version: 1,
      lockId,
      reason: 'the flag adds no value here',
      timeoutSec: 10,
    });

    await new Promise((r) => setTimeout(r, 150));
    expect(pendingRequests(planId)[0]).toMatchObject({ kind: 'unlock', lock_id: lockId });
    respondToUnlock({ planId, version: 1, lockId, granted: true, note: 'agreed' });

    const outcome = await waiting;
    expect(outcome).toMatchObject({ kind: 'ready', value: { granted: true, note: 'agreed' } });

    const edited = SAMPLE_PLAN.replace('Deploy behind', 'Deploy straight');
    expect(capture({ planId, text: edited }).version).toBe(2);

    // Burned: the same block cannot be edited again without asking afresh.
    expect(() =>
      capture({ planId, text: edited.replace('Deploy straight', 'Deploy sideways') }),
    ).toThrow(LockViolationError);
  });

  it('reports a denial without issuing a grant', async () => {
    const { planId } = seed();
    submitFeedback({ planId, version: 1, verdict: 'approve', annotations: [] });
    const lockId = Object.values(readLocks(planId).locks)[0]!.id;

    const waiting = awaitUnlockDecision({
      planId,
      version: 1,
      lockId,
      reason: 'x',
      timeoutSec: 10,
    });
    await new Promise((r) => setTimeout(r, 150));
    respondToUnlock({ planId, version: 1, lockId, granted: false, note: 'no, that was the point' });

    const outcome = await waiting;
    expect(outcome).toMatchObject({ kind: 'ready', value: { granted: false } });
    expect(Object.keys(readLocks(planId).grants)).toHaveLength(0);
  });
});

describe('what the agent sees', () => {
  it('quotes each annotation and ends with the exact next command', () => {
    const { planId } = seed();
    submitFeedback({
      planId,
      version: 1,
      verdict: 'revise',
      annotations: [comment(planId, 1, 7, 8, 'Wrong layer. Guard belongs in the R2 write path.')],
      general: 'Direction is fine, but see the comment.',
    });

    const text = presentFeedback({
      planId,
      version: 1,
      feedback: openFeedback(planId),
      locks: readLocks(planId),
      docLines: normalizedLines(readVersionText(planId, 1)!),
    });

    expect(text).toContain(`## planx feedback — ${planId} v1 (verdict: revise)`);
    expect(text).toContain('under "## Approach"');
    expect(text).toContain('> ## Approach');
    expect(text).toContain('**Feedback:** Wrong layer.');
    expect(text).toContain('### General');
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

    const text = presentFeedback({
      planId,
      version: 1,
      feedback: openFeedback(planId),
      locks: readLocks(planId),
      docLines: normalizedLines(readVersionText(planId, 1)!),
    });

    expect(text).toContain('### 🔒 Locked');
    expect(text).toContain('— do not modify');
    expect(text).toContain('[[planx:keep L1]]` markers — do not re-emit their text');
  });

  it('tells the agent to stop when the verdict is approve', () => {
    const { planId } = seed();
    submitFeedback({ planId, version: 1, verdict: 'approve', annotations: [] });
    const text = presentFeedback({
      planId,
      version: 1,
      feedback: openFeedback(planId),
      locks: readLocks(planId),
      docLines: normalizedLines(readVersionText(planId, 1)!),
    });
    expect(text).toContain('(verdict: approve)');
    expect(text).toContain('The plan is sealed — every section is now locked.');
    expect(text).not.toContain('planx capture --plan-id');
  });

  it('explains a granted and a denied unlock differently', () => {
    expect(presentUnlockDecision('p', 'L2', true, 'agreed')).toContain('granted (single use)');
    expect(presentUnlockDecision('p', 'L2', false, 'no')).toContain('stays locked');
  });
});
