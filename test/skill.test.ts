import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SKILL_DIR = join(ROOT, 'skills', 'planx');

const router = readFileSync(join(SKILL_DIR, 'SKILL.md'), 'utf8');
const plan = readFileSync(join(SKILL_DIR, 'references', 'plan.md'), 'utf8');
const revise = readFileSync(join(SKILL_DIR, 'references', 'revise.md'), 'utf8');
const handoff = 'Plan created. Exit the agent, then run `planx <plan-id> v<n>`';

// There is no size budget here on purpose. File size was the wrong proxy for
// prompt cost, and a word ceiling on the skill fails the moment someone
// restores a sentence an agent needed. What is asserted instead is that each
// invocation loads exactly one reference, and that the contracts whose failure
// costs a whole review round are actually written down.

function route(invocation: string): string {
  const row = router.split('\n').find((line) => line.startsWith(`| \`${invocation}\``));
  expect(row).toBeDefined();
  const references = row?.match(/references\/[^`]+\.md/gu) ?? [];
  expect(references).toHaveLength(1);
  return references[0]!;
}

describe('the shipped planx skill', () => {
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

  // Global before the split and global still. Putting these in plan.md hid them
  // from exactly the sessions — revise and execute — where the mistakes they
  // prevent are live.
  it('keeps the rules that are true on every branch in the router', () => {
    expect(router).toContain('~/.planx');
    expect(router).toContain('One capture per revision');
    expect(router).toContain('Never silently start a second plan');
    expect(router).toContain('an instruction to build it');
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
    expect(plan).toContain('ExitPlanMode');
    expect(plan).not.toContain('Anything else before I write it?');
    expect(plan).toContain('one batch of necessary clarifying questions');
    expect(plan).toContain('materially affect the plan');
    expect(plan).toContain('captured plan only, not conversation');
    expect(plan).toContain('80 physical');
    expect(plan).toContain('planx capture --stdin');
    expect(plan).toContain('$CLAUDE_CODE_SESSION_ID');
    expect(plan).toContain('$CODEX_THREAD_ID');
    expect(plan.match(/Plan created\. Exit/gu)).toHaveLength(1);
  });

  // The abstract rule does not fire on its own — an agent pattern-matches on
  // the words it is about to write, so the tells are the rule.
  it('keeps the tells in the scope-boundary rule', () => {
    for (const source of [plan, revise]) {
      expect(source).toContain('not in scope');
      expect(source).toContain('I read X as Y');
      expect(source).toContain('assuming');
    }
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
    expect(revise).toContain('Do not summarise them back to the user');
    expect(revise).toContain('still unaddressed from earlier versions');
    expect(revise.match(/Plan created\. Exit/gu)).toHaveLength(1);
  });

  it('hands review to the terminal as the last agent output', () => {
    for (const source of [plan, revise]) {
      expect(source).toContain('verbatim, with nothing after it');
      expect(source).toContain(`\n> ${handoff}\n`);
      // The line ends on the command so it survives a copy-paste — a trailing
      // period rides along into the shell.
      expect(source).not.toContain(`${handoff}.`);
      expect(source).toContain('resumes this same agent conversation');
      expect(source).not.toContain('open in new tab');
    }
  });

  // The review folds `##` through `####` and nothing deeper (MAX_FOLD_LEVEL in
  // src/tui/model.ts). A plan of flat `##` sections is all-or-nothing to fold.
  it('asks for the heading depths the review can fold, on both write paths', () => {
    for (const source of [plan, revise]) {
      expect(source).toContain('`##`, `###` and `####`');
      expect(source).toContain('nothing deeper');
    }
  });

  // Without a third row an agent that is neither most likely copies the Claude
  // one, filing the plan under an agent that is not it — and `--agent` defaults
  // to `--source`, so a resume can be aimed at the wrong binary.
  it('tells an agent that is neither Claude nor Codex what to pass', () => {
    for (const source of [plan, revise]) {
      expect(source).toContain('neither variable is set');
      expect(source).toContain('`--source <your agent>`, and no `--session-id`');
    }
  });

  // Reviewer edits are written into the stored version in place, so the whole
  // plan a revision sends back has to carry them forward unchanged.
  it('tells the revision to reproduce reviewer-edited lines', () => {
    expect(revise).toContain('### Edited by the reviewer');
    expect(revise).toContain('Reproduce every reviewer-edited line exactly');
  });
});
