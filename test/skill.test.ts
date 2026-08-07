import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SKILL_DIR = join(ROOT, 'skills', 'planx');

const router = readFileSync(join(SKILL_DIR, 'SKILL.md'), 'utf8');
const plan = readFileSync(join(SKILL_DIR, 'references', 'plan.md'), 'utf8');
const revise = readFileSync(join(SKILL_DIR, 'references', 'revise.md'), 'utf8');

// Before the router split, SKILL.md + revise.md cost 1,806 words and 9,805
// UTF-8 bytes on every revision. These dependency-free proxies keep the
// revision path at no more than half that baseline.
const BASELINE_REVISION_WORDS = 1_806;
const BASELINE_REVISION_BYTES = 9_805;
const ROUTER_MAX_WORDS = 220;
const ROUTER_MAX_BYTES = 1_400;

function words(text: string): number {
  return text.trim().split(/\s+/u).length;
}

function bytes(text: string): number {
  return Buffer.byteLength(text, 'utf8');
}

function route(invocation: string): string {
  const row = router.split('\n').find((line) => line.startsWith(`| \`${invocation}\``));
  expect(row).toBeDefined();
  const references = row?.match(/references\/[^`]+\.md/gu) ?? [];
  expect(references).toHaveLength(1);
  return references[0]!;
}

describe('the shipped planx skill', () => {
  it('keeps the router and revision prompt within their budgets', () => {
    expect(words(router)).toBeLessThanOrEqual(ROUTER_MAX_WORDS);
    expect(bytes(router)).toBeLessThanOrEqual(ROUTER_MAX_BYTES);

    const revisionBundle = router + revise;
    expect(words(revisionBundle)).toBeLessThanOrEqual(Math.floor(BASELINE_REVISION_WORDS / 2));
    expect(bytes(revisionBundle)).toBeLessThanOrEqual(Math.floor(BASELINE_REVISION_BYTES / 2));
  });

  it('routes each non-bare invocation to exactly one reference', () => {
    expect(route('/planx <anything else>')).toBe('references/plan.md');
    expect(route('/planx revise <id>')).toBe('references/revise.md');
    expect(route('/planx execute <id>')).toBe('references/execute.md');
  });

  it('leaves planning-only instructions out of the router', () => {
    expect(router).not.toContain('ExitPlanMode');
    expect(router).not.toContain('planx capture');
    expect(router).not.toContain('Anything else before I write it?');
    expect(router).not.toContain('CLAUDE_CODE_SESSION_ID');
  });

  it('hard-wraps every shipped skill Markdown source line', () => {
    const files = [
      join(SKILL_DIR, 'SKILL.md'),
      ...readdirSync(join(SKILL_DIR, 'references')).map((name) =>
        join(SKILL_DIR, 'references', name),
      ),
    ];

    for (const file of files) {
      for (const [index, line] of readFileSync(file, 'utf8').split('\n').entries()) {
        expect.soft([...line].length, `${file}:${index + 1}`).toBeLessThanOrEqual(80);
      }
    }
  });

  it('keeps the initial planning and capture contracts', () => {
    expect(plan).toContain('Anything else before I write it?');
    expect(plan).toContain('captured plan only, not conversation');
    expect(plan).toContain('80 physical');
    expect(plan).toContain('planx capture --stdin');
    expect(plan).toContain('$CLAUDE_CODE_SESSION_ID');
    expect(plan).toContain('$CODEX_THREAD_ID');
    expect(plan.match(/Plan created\. Open/gu)).toHaveLength(1);
  });

  it('keeps the incremental revision safety contracts', () => {
    expect(revise).toContain('planx revise <plan-id>');
    expect(revise).toContain('planx show <plan-id> --plain');
    expect(revise).toContain('no review yet');
    expect(revise).toContain('reviewed with nothing to change');
    expect(revise).toContain('--parent v<n> --stdin');
    expect(revise).toContain('$CLAUDE_CODE_SESSION_ID');
    expect(revise).toContain('$CODEX_THREAD_ID');
    expect(revise).toContain('captured plan only, not conversation');
    expect(revise).toContain('80 physical');
    expect(revise.match(/Plan created\. Open/gu)).toHaveLength(1);
  });
});
