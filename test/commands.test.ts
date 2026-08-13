import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { planSections } from '../src/cli/commands.js';
import { capture } from '../src/protocol/capture.js';
import { markExecuted } from '../src/store/plans.js';
import { SAMPLE_PLAN, tempStore } from './helpers.js';

let store: ReturnType<typeof tempStore>;

beforeEach(() => {
  store = tempStore();
});
afterEach(() => store.cleanup());

describe('planSections', () => {
  it('splits plans into a labeled "This directory" section and a labeled "Elsewhere" one', () => {
    // Distinct content, so each capture gets its own plan id — the derived id
    // hashes title and content together, and identical text would collapse
    // both captures onto the same plan regardless of `cwd`.
    capture({ text: SAMPLE_PLAN, source: 'test', cwd: process.cwd() });
    capture({ text: SAMPLE_PLAN.replace('10%', '20%'), source: 'test', cwd: '/elsewhere' });

    const sections = planSections();
    expect(sections.map((s) => s.key)).toEqual(['here', 'elsewhere']);
    expect(sections[0]!.label).toBe('This directory');
    expect(sections[1]!.label).toBe('Elsewhere');
    expect(sections[0]!.items).toHaveLength(1);
    expect(sections[1]!.items).toHaveLength(1);
  });

  it('omits the elsewhere section entirely when every plan was captured here', () => {
    capture({ text: SAMPLE_PLAN, source: 'test', cwd: process.cwd() });

    const sections = planSections();
    expect(sections.map((s) => s.key)).toEqual(['here']);
  });

  it('omits "This directory" entirely when only elsewhere plans exist', () => {
    capture({ text: SAMPLE_PLAN, source: 'test', cwd: '/elsewhere' });

    const sections = planSections();
    expect(sections.map((s) => s.key)).toEqual(['elsewhere']);
  });

  it('folds elsewhere behind the plans from here, and only when there are any', () => {
    capture({ text: SAMPLE_PLAN, source: 'test', cwd: '/elsewhere' });

    // On its own it is the list, so there is nothing to fold it behind.
    expect(planSections().find((s) => s.key === 'elsewhere')!.defaultCollapsed).toBe(false);

    capture({ text: SAMPLE_PLAN.replace('10%', '20%'), source: 'test', cwd: process.cwd() });
    const sections = planSections();
    expect(sections.find((s) => s.key === 'here')!.defaultCollapsed).toBeUndefined();
    expect(sections.find((s) => s.key === 'elsewhere')!.defaultCollapsed).toBe(true);
  });

  it('shows the directory, not the id, in the hint for an elsewhere plan', () => {
    capture({ text: SAMPLE_PLAN, source: 'test', cwd: '/elsewhere' });

    const row = planSections().find((s) => s.key === 'elsewhere')!.items[0]!;
    expect(row.hint).toContain('/elsewhere');
    expect(row.hint).not.toContain(row.searchable);
  });
});

describe('the resume a picker row offers', () => {
  /**
   * A plan whose versions can each be marked as built by a named session.
   *
   * The marker keeps two seeds apart: the derived id hashes title and content
   * together, so identical text is the same plan rather than a second one.
   */
  function seed(versions: number, marker = 'a') {
    const text = `${SAMPLE_PLAN}\nseed ${marker}\n`;
    const { planId } = capture({ text, source: 'test', cwd: process.cwd() });
    for (let n = 2; n <= versions; n++) {
      capture({ text: `${text}rev ${n}\n`, planId, source: 'test' });
    }
    return planId;
  }

  function rowFor(id: string) {
    return planSections()
      .flatMap((s) => s.items)
      .find((item) => item.value.id === id)!;
  }

  it('sits on the version that was built, and on the plan row above it', () => {
    const id = seed(2);
    markExecuted(id, 1, { sessionId: 'sess-1', agent: 'claude' });

    const plan = rowFor(id);
    expect(plan.resume).toEqual({ id, version: 1, row: 'version', action: 'resume' });
    // Newest first, so v1 is the second child.
    expect(plan.children![1]!.resume).toEqual({ id, version: 1, row: 'version', action: 'resume' });
    expect(plan.children![0]!.resume).toBeUndefined();
  });

  it('leaves the plan row out of it once two versions have been built', () => {
    const id = seed(2);
    markExecuted(id, 1, { sessionId: 'sess-1', agent: 'claude' });
    markExecuted(id, 2, { sessionId: 'sess-2', agent: 'claude' });

    // Picking silently between two builds is worse than pressing `→` first.
    const plan = rowFor(id);
    expect(plan.resume).toBeUndefined();
    expect(plan.children!.map((c) => c.resume?.version)).toEqual([2, 1]);
  });

  it('offers nothing for an agent planx cannot launch, or a session it never saw', () => {
    const id = seed(1);
    markExecuted(id, 1, { sessionId: 'sess-1', agent: 'aider' });
    expect(rowFor(id).resume).toBeUndefined();
    expect(rowFor(id).children![0]!.resume).toBeUndefined();

    markExecuted(id, 1, { agent: 'claude' });
    expect(rowFor(id).resume).toEqual({ id, version: 1, row: 'version', action: 'resume' });

    // A build marked before this release has no session behind it at all.
    const older = seed(1, 'b');
    markExecuted(older, 1, { agent: 'claude' });
    expect(rowFor(older).resume).toBeUndefined();
  });

  it('offers nothing at all when the caller is not going to hand the terminal over', () => {
    const id = seed(1);
    markExecuted(id, 1, { sessionId: 'sess-1', agent: 'claude' });

    const plan = planSections(false)
      .flatMap((s) => s.items)
      .find((item) => item.value.id === id)!;
    expect(plan.resume).toBeUndefined();
    expect(plan.children![0]!.resume).toBeUndefined();
  });
});
