import { describe, expect, it } from 'vitest';
import {
  contextSha,
  findOccurrences,
  locateLock,
  needleLines,
  normalizedLines,
} from '../src/locks/anchor.js';
import {
  activeGrant,
  addLock,
  consumeGrant,
  issueGrant,
  lockedLineMap,
  rearmLocks,
  sealPlan,
  uncoveredRuns,
  unlockRange,
} from '../src/locks/manage.js';
import { hasMarkers, MarkerError, renderSkeleton, splice } from '../src/locks/markers.js';
import { splitSections } from '../src/locks/sections.js';
import { formatViolations, verifyLocks } from '../src/locks/verify.js';
import { setColorEnabled } from '../src/render/ansi.js';
import { LocksFileSchema, type LocksFile } from '../src/store/types.js';

setColorEnabled(false);

const PLAN = [
  '# Guard the clock regression',
  '',
  '## Context',
  'The poller reads a snapshot every 15 seconds.',
  '',
  '## Approach',
  'Extend the snapshot-regression guard in the poller.',
  '',
  '## Rollout',
  'Deploy behind the `ff_clock_guard` flag, 10% then 50% then 100%.',
  'Hold at each step for a day.',
].join('\n');

function emptyLocks(): LocksFile {
  return LocksFileSchema.parse({});
}

/** Lock the `## Rollout` section of PLAN and return the store plus its id. */
function withRolloutLocked() {
  const locks = emptyLocks();
  const lines = normalizedLines(PLAN);
  const lock = addLock(locks, {
    docLines: lines,
    range: { start: 8, end: 10 },
    origin: 'user',
    version: 1,
    section: '## Rollout',
  });
  return { locks, lock };
}

describe('sections', () => {
  it('splits on ## headings with a preamble block', () => {
    expect(splitSections(normalizedLines(PLAN)).map((s) => [s.heading, s.start, s.end])).toEqual([
      [null, 0, 1],
      ['## Context', 2, 4],
      ['## Approach', 5, 7],
      ['## Rollout', 8, 10],
    ]);
  });

  it('ignores ## lines inside a fenced code block', () => {
    const lines = ['## Real', 'a', '```', '## Fake', '```', '## Also real'];
    expect(splitSections(lines).map((s) => s.heading)).toEqual(['## Real', '## Also real']);
  });

  it('treats a plan with no headings as one block', () => {
    const lines = ['just', 'some', 'prose'];
    expect(splitSections(lines)).toEqual([{ heading: null, start: 0, end: 2 }]);
  });
});

describe('anchoring', () => {
  it('finds every occurrence of a multi-line run', () => {
    expect(findOccurrences(['a', 'b', 'c', 'a', 'b'], ['a', 'b'])).toEqual([
      { start: 0, end: 1 },
      { start: 3, end: 4 },
    ]);
  });

  it('disambiguates two identical blocks by surrounding context', () => {
    const doc = ['head', 'DUP', 'mid', 'DUP', 'tail'];
    const locks = emptyLocks();
    const lock = addLock(locks, {
      docLines: doc,
      range: { start: 3, end: 3 },
      origin: 'user',
      version: 1,
    });
    expect(lock.context_sha).toBe(contextSha(doc, { start: 3, end: 3 }));

    const found = locateLock(doc, lock);
    expect(found).toEqual({ ok: true, range: { start: 3, end: 3 } });
  });

  it('refuses to guess when context cannot break the tie', () => {
    // Both copies of DUP sit between an identical pair of context lines, so
    // context_sha matches in two places and there is nothing left to decide on.
    const doc = ['x', 'y', 'DUP', 'a', 'b', 'x', 'y', 'DUP', 'a', 'b'];
    const locks = emptyLocks();
    const lock = addLock(locks, {
      docLines: doc,
      range: { start: 2, end: 2 },
      origin: 'user',
      version: 1,
    });
    expect(contextSha(doc, { start: 2, end: 2 })).toBe(contextSha(doc, { start: 7, end: 7 }));

    const found = locateLock(doc, lock);
    expect(found.ok).toBe(false);
    expect(found).toMatchObject({ reason: 'ambiguous', candidates: [{ start: 2 }, { start: 7 }] });
  });
});

describe('lock enforcement — the adversarial cases', () => {
  it('rejects a reworded locked block', () => {
    const { locks } = withRolloutLocked();
    const next = PLAN.replace(
      'Deploy behind the `ff_clock_guard` flag, 10% then 50% then 100%.',
      'Deploy directly to 100%; the flag adds no value here.',
    );

    const result = verifyLocks({ locks, previousText: PLAN, nextText: next });
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]).toMatchObject({ lockId: 'L1', reason: 'modified' });
    expect(result.violations[0]!.removed.join('\n')).toContain('ff_clock_guard');
    expect(result.violations[0]!.added.join('\n')).toContain('Deploy directly to 100%');
  });

  it('rejects a deleted locked block — deletion is a modification', () => {
    const { locks } = withRolloutLocked();
    const next = PLAN.split('\n').slice(0, 8).join('\n');
    const result = verifyLocks({ locks, previousText: PLAN, nextText: next });
    expect(result.violations.map((v) => v.reason)).toEqual(['modified']);
  });

  it('rejects a leading-whitespace change', () => {
    const { locks } = withRolloutLocked();
    const next = PLAN.replace('Hold at each step', '  Hold at each step');
    expect(verifyLocks({ locks, previousText: PLAN, nextText: next }).violations).toHaveLength(1);
  });

  it('tolerates a trailing-whitespace-only change, the one documented normalization', () => {
    const { locks } = withRolloutLocked();
    const next = PLAN.replace('Hold at each step for a day.', 'Hold at each step for a day.   ');
    expect(verifyLocks({ locks, previousText: PLAN, nextText: next }).violations).toHaveLength(0);
  });

  it('accepts a version that leaves the locked block alone', () => {
    const { locks } = withRolloutLocked();
    const next = PLAN.replace(
      'Extend the snapshot-regression guard in the poller.',
      'Extend it in the R2 write path instead.',
    );
    expect(verifyLocks({ locks, previousText: PLAN, nextText: next }).violations).toHaveLength(0);
  });

  it('rejects when the locked text is duplicated into a second copy', () => {
    const { locks } = withRolloutLocked();
    const next = `${PLAN}\n\n## Rollout\nDeploy behind the \`ff_clock_guard\` flag, 10% then 50% then 100%.\nHold at each step for a day.\n`;
    const result = verifyLocks({ locks, previousText: PLAN, nextText: next });
    expect(result.violations.map((v) => v.reason)).toEqual(['ambiguous']);
  });

  it('names the exact unblocking command in the rejection', () => {
    const { locks } = withRolloutLocked();
    const next = PLAN.replace('Hold at each step for a day.', 'Ship it all at once.');
    const { violations } = verifyLocks({ locks, previousText: PLAN, nextText: next });
    const message = formatViolations('guard-clock-a3f9', violations);
    expect(message).toContain('planx unlock guard-clock-a3f9 L1 --reason');
    expect(message).toContain('Nothing was written.');
    expect(message).toContain('- Hold at each step for a day.');
    expect(message).toContain('+ Ship it all at once.');
  });
});

describe('the unlock handshake', () => {
  it('lets exactly one capture through, then re-arms on the new text', () => {
    const { locks } = withRolloutLocked();
    const grant = issueGrant(locks, 'L1', 'the flag is redundant', '');
    expect(activeGrant(locks, 'L1')).toEqual(grant);

    const next = PLAN.replace('Hold at each step for a day.', 'Ship it all at once.');
    const first = verifyLocks({ locks, previousText: PLAN, nextText: next });
    expect(first.violations).toHaveLength(0);
    expect(first.grantsToConsume).toEqual([grant]);

    consumeGrant(locks, grant, 2);
    rearmLocks(locks, normalizedLines(next), 2);
    expect(activeGrant(locks, 'L1')).toBeNull();
    expect(locks.locks['L1']!.text).toContain('Ship it all at once.');

    // The grant is spent — a second edit to the same block is rejected again.
    const third = PLAN.replace('Hold at each step for a day.', 'Actually, roll back.');
    expect(verifyLocks({ locks, previousText: next, nextText: third }).violations).toHaveLength(1);
  });

  it('drops a lock it cannot relocate rather than re-arming on the wrong lines', () => {
    const locks = emptyLocks();
    addLock(locks, {
      docLines: normalizedLines(PLAN),
      range: { start: 0, end: 0 },
      origin: 'user',
      version: 1,
      section: null,
    });
    const result = rearmLocks(locks, ['completely', 'different', 'document'], 2);
    expect(result.dropped).toEqual(['L1']);
    expect(locks.locks['L1']).toBeUndefined();
  });
});

describe('sealing', () => {
  it('locks every section plus the preamble on approval', () => {
    const locks = emptyLocks();
    const created = sealPlan(locks, normalizedLines(PLAN), 3);
    expect(created.map((l) => l.section)).toEqual([
      null,
      '## Context',
      '## Approach',
      '## Rollout',
    ]);
    expect(locks.sealed_at).not.toBeNull();
    expect(locks.sealed_version).toBe(3);
  });

  it('seals a plan with no ## headings as a single lock', () => {
    const locks = emptyLocks();
    expect(sealPlan(locks, ['just', 'prose'], 1)).toHaveLength(1);
  });

  it('leaves an existing hand-made lock alone instead of renumbering it', () => {
    const { locks } = withRolloutLocked();
    const created = sealPlan(locks, normalizedLines(PLAN), 2);
    expect(created.some((l) => l.section === '## Rollout')).toBe(false);
    expect(locks.locks['L1']!.origin).toBe('user');
  });

  it('does not overlay a section lock on a block locked by hand inside it', () => {
    const locks = emptyLocks();
    const doc = normalizedLines(PLAN);
    // One line in the middle of ## Rollout, so the section is neither wholly
    // free nor an exact match for the hand-made lock.
    addLock(locks, { docLines: doc, range: { start: 9, end: 9 }, origin: 'user', version: 1 });

    sealPlan(locks, doc, 2);
    expect(coverageOf(locks, doc).every((n) => n <= 1)).toBe(true);
    expect(locks.locks['L1']!.origin).toBe('user');
  });

  // Every section of PLAN but the last ends in a blank line, so this is the
  // ordinary case rather than a contrived one: sealing used to store a needle
  // one line short and leave that blank line with no ⚿ beside it.
  it('locks every line of a plan whose sections end in a blank line', () => {
    const locks = emptyLocks();
    const doc = normalizedLines(PLAN);
    sealPlan(locks, doc, 1);

    const covered = lockedLineMap(doc, locks);
    expect(doc.map((_, i) => covered.has(i + 1))).toEqual(doc.map(() => true));
  });
});

describe('splitting text into lines', () => {
  // A document's trailing newline is a terminator; a lock's stored text has no
  // terminator at all, so a trailing "" there is a blank line it covers.
  it('drops a document’s trailing blank and keeps a needle’s', () => {
    expect(normalizedLines('one\ntwo\n')).toEqual(['one', 'two']);
    expect(needleLines('one\ntwo\n')).toEqual(['one', 'two', '']);
  });

  it('agrees on text that does not end in a newline', () => {
    expect(normalizedLines('one\ntwo')).toEqual(['one', 'two']);
    expect(needleLines('one\ntwo')).toEqual(['one', 'two']);
  });

  it('finds a needle ending in a blank line, at its full length', () => {
    const doc = ['a', 'b', '', 'c'];
    expect(findOccurrences(doc, needleLines('b\n'))).toEqual([{ start: 1, end: 2 }]);
  });
});

/**
 * How many records cover each line of the document.
 *
 * Locks are disjoint by construction, so this is a vector of ones and zeroes.
 * A two anywhere means the gutter has to pick one of the covering ids
 * arbitrarily and an unlock has to split more than one record.
 */
function coverageOf(locks: LocksFile, doc: string[]): number[] {
  const counts = new Array<number>(doc.length).fill(0);
  for (const lock of Object.values(locks.locks)) {
    const found = locateLock(doc, lock);
    if (!found.ok) continue;
    for (let i = found.range.start; i <= found.range.end; i++) counts[i] = (counts[i] ?? 0) + 1;
  }
  return counts;
}

describe('overlapping lock requests', () => {
  it('locks only the part of a span that is not locked already', () => {
    const locks = emptyLocks();
    const doc = normalizedLines(PLAN);
    addLock(locks, { docLines: doc, range: { start: 3, end: 5 }, origin: 'user', version: 1 });

    const runs = uncoveredRuns(locks, doc, { start: 0, end: 9 });
    expect(runs).toEqual([
      { start: 0, end: 2 },
      { start: 6, end: 9 },
    ]);
    for (const run of runs) {
      addLock(locks, { docLines: doc, range: run, origin: 'user', version: 1 });
    }

    // Every line of 0–9 covered, and none of them covered twice.
    expect(coverageOf(locks, doc).slice(0, 10)).toEqual(new Array(10).fill(1));
  });

  it('frees a line that two requests asked to lock, leaving no orphans', () => {
    const locks = emptyLocks();
    const doc = normalizedLines(PLAN);
    addLock(locks, { docLines: doc, range: { start: 3, end: 5 }, origin: 'user', version: 1 });
    for (const run of uncoveredRuns(locks, doc, { start: 0, end: 9 })) {
      addLock(locks, { docLines: doc, range: run, origin: 'user', version: 1 });
    }

    unlockRange(locks, doc, { start: 4, end: 4 });
    const map = lockedLineMap(doc, locks);
    expect(map.get(5)).toBeUndefined(); // 1-based: line 4 is gone
    expect(map.get(4)).toBeDefined();
    expect(map.get(6)).toBeDefined();
    expect(coverageOf(locks, doc).every((n) => n <= 1)).toBe(true);
  });
});

describe('partial unlock', () => {
  it('splits a lock, keeping the original id on the leading fragment', () => {
    const locks = emptyLocks();
    const doc = normalizedLines(PLAN);
    addLock(locks, {
      docLines: doc,
      range: { start: 8, end: 10 },
      origin: 'seal',
      version: 1,
      section: '## Rollout',
    });

    const result = unlockRange(locks, doc, { start: 9, end: 9 });
    expect(result.removed).toEqual(['L1']);
    expect(Object.keys(locks.locks).sort()).toEqual(['L1', 'L2']);
    expect(locks.locks['L1']!.text).toBe('## Rollout');
    expect(locks.locks['L2']!.text).toBe('Hold at each step for a day.');
  });

  it('removes the lock entirely when the unlock covers all of it', () => {
    const { locks } = withRolloutLocked();
    unlockRange(locks, normalizedLines(PLAN), { start: 0, end: 99 });
    expect(Object.keys(locks.locks)).toHaveLength(0);
  });

  it('keeps the original id when the unlock clips only the front', () => {
    const { locks } = withRolloutLocked();
    unlockRange(locks, normalizedLines(PLAN), { start: 8, end: 8 });
    expect(Object.keys(locks.locks)).toEqual(['L1']);
    expect(locks.locks['L1']!.text).toContain('ff_clock_guard');
  });

  // A sealed section runs to the blank line before the next heading, so
  // unlocking its body leaves that blank line behind. A lock on nothing but a
  // blank line matches every blank line in the plan, so it could never be
  // placed again — and a lock that cannot be placed blocks every later capture.
  it('does not leave a blank line behind as a lock of its own', () => {
    const locks = emptyLocks();
    const doc = normalizedLines(PLAN);
    // `## Approach`, its body, and the blank line under it.
    addLock(locks, {
      docLines: doc,
      range: { start: 5, end: 7 },
      origin: 'seal',
      version: 1,
      section: '## Approach',
    });

    unlockRange(locks, doc, { start: 5, end: 6 });
    expect(Object.keys(locks.locks)).toHaveLength(0);
  });

  it('leaves locks that do not overlap untouched', () => {
    const { locks } = withRolloutLocked();
    const result = unlockRange(locks, normalizedLines(PLAN), { start: 0, end: 1 });
    expect(result.kept).toEqual(['L1']);
    expect(result.removed).toEqual([]);
  });
});

describe('the line map', () => {
  it('maps 1-based lines to their lock', () => {
    const { locks } = withRolloutLocked();
    const map = lockedLineMap(normalizedLines(PLAN), locks);
    expect(map.get(9)).toBe('L1');
    expect(map.get(11)).toBe('L1');
    expect(map.get(8)).toBeUndefined();
  });
});

describe('skeleton and splice', () => {
  it('collapses locked blocks to labelled markers', () => {
    const { locks } = withRolloutLocked();
    const skeleton = renderSkeleton(PLAN, locks);
    expect(skeleton).toContain('[[planx:keep L1]]   <!-- ## Rollout — 3 lines, locked -->');
    expect(skeleton).not.toContain('ff_clock_guard');
    expect(skeleton).toContain('## Approach');
  });

  it('round-trips skeleton then splice back to the original', () => {
    const { locks } = withRolloutLocked();
    const spliced = splice(renderSkeleton(PLAN, locks), { locks, versionText: () => null });
    expect(spliced.text.trimEnd()).toBe(PLAN.trimEnd());
    expect(spliced.expandedLocks).toEqual(['L1']);
  });

  it('expands an unchanged unlocked span from a stored version', () => {
    const { locks } = withRolloutLocked();
    const result = splice('head\n[[planx:keep v2#3-4]]\ntail\n', {
      locks,
      versionText: (n) => (n === 2 ? PLAN : null),
    });
    expect(result.text).toBe(
      'head\n## Context\nThe poller reads a snapshot every 15 seconds.\ntail\n',
    );
  });

  it('hard-errors on a marker naming a lock that does not exist', () => {
    const { locks } = withRolloutLocked();
    expect(() => splice('a\n[[planx:keep L9]]\nb\n', { locks, versionText: () => null })).toThrow(
      MarkerError,
    );
  });

  it('hard-errors on a marker naming nothing', () => {
    const { locks } = withRolloutLocked();
    expect(() => splice('[[planx:keep]]\n', { locks, versionText: () => null })).toThrow(
      /names nothing/,
    );
  });

  it('hard-errors on a marker that is not alone on its line', () => {
    const { locks } = withRolloutLocked();
    expect(() =>
      splice('text before [[planx:keep L1]]\n', { locks, versionText: () => null }),
    ).toThrow(/alone on its line/);
  });

  it('hard-errors on an out-of-range span', () => {
    const { locks } = withRolloutLocked();
    expect(() => splice('[[planx:keep v1#1-999]]\n', { locks, versionText: () => PLAN })).toThrow(
      /out of range/,
    );
  });

  it('hard-errors on a span pointing at a version that is gone', () => {
    const { locks } = withRolloutLocked();
    expect(() => splice('[[planx:keep v7#1-2]]\n', { locks, versionText: () => null })).toThrow(
      /not stored/,
    );
  });

  it('leaves a marker inside a code fence literal, and says which line', () => {
    const { locks } = withRolloutLocked();
    const source = ['Docs:', '```', '[[planx:keep L1]]', '```', 'end'].join('\n');
    const result = splice(source, { locks, versionText: () => null });
    expect(result.text).toContain('[[planx:keep L1]]');
    expect(result.expandedLocks).toEqual([]);
    expect(result.literalInFence).toEqual([3]);
  });

  it('detects markers without parsing them', () => {
    expect(hasMarkers('a [[planx:keep L1]] b')).toBe(true);
    expect(hasMarkers('no markers here')).toBe(false);
  });
});
