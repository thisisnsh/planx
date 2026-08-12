import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { planSections } from '../src/cli/commands.js';
import { capture } from '../src/protocol/capture.js';
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

  it('carries an empty message on "This directory" when only elsewhere plans exist', () => {
    capture({ text: SAMPLE_PLAN, source: 'test', cwd: '/elsewhere' });

    const sections = planSections();
    expect(sections[0]!.key).toBe('here');
    expect(sections[0]!.items).toHaveLength(0);
    expect(sections[0]!.emptyMessage).toBe('No plans for this directory.');
  });

  it('shows the directory, not the id, in the hint for an elsewhere plan', () => {
    capture({ text: SAMPLE_PLAN, source: 'test', cwd: '/elsewhere' });

    const row = planSections().find((s) => s.key === 'elsewhere')!.items[0]!;
    expect(row.hint).toContain('/elsewhere');
    expect(row.hint).not.toContain(row.searchable);
  });
});
