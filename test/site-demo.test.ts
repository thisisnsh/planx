import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), 'utf8');

describe('the static website examples', () => {
  it('presents every product feature without interactive controls', () => {
    const component = read('site/.vitepress/theme/components/FeatureTerminal.vue');

    for (const example of ['feedback', 'diff', 'versions', 'editing', 'readability', 'handoff']) {
      expect(component).toContain(`${example}:`);
    }

    expect(component).toContain('aria-label="label"');
    expect(component).toContain('several selected lines');
    expect(component).toContain('v3 ← v2');
    expect(component).toContain('space to expand');
    expect(component).toContain('/planx execute upload-limits-a3f9 v3');
    expect(component).not.toMatch(/<button|<input|@click|@keydown|addEventListener/);
  });

  it('tells the feature story in the agreed order', () => {
    const home = read('site/index.md');
    const headings = [
      '## Feedback on exact lines',
      '## A diff for every revision',
      '## Context that survives revision',
      '## Direct edits and whole-plan notes',
      '## Long plans that stay readable',
      '## Execute the settled version',
    ];

    const positions = headings.map((heading) => home.indexOf(heading));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  /**
   * The one thing a person can get wrong about a custom command is what PlanX
   * appends to it, so every page that hands a plan to an agent says it — and
   * the configuration reference is where the rule itself lives.
   */
  it('documents the custom hand-off commands wherever a plan is handed over', () => {
    const config = read('site/reference/config.md');
    expect(config).toContain('defaults.revise_command');
    expect(config).toContain('defaults.execute_command');
    expect(config).toContain('planx defaults --revise');
    // Both spellings of the appended prompt, and the two surprises.
    expect(config).toContain('"$planx revise upload-limits-a3f9"');
    expect(config).toContain('`/planx` for');
    expect(config).toContain('trailing prompt');
    expect(config).toContain('PlanX skill installed');

    for (const page of [
      'site/review-loop.md',
      'site/executing.md',
      'site/claude-code.md',
      'site/codex.md',
    ]) {
      const text = read(page);
      expect(text, page).toContain('set `planx defaults`');
      expect(text, page).toContain('[Configuration](/reference/config)');
    }
  });

  it('removes the browser simulator and registers the static component', () => {
    const theme = read('site/.vitepress/theme/index.ts');

    expect(theme).toContain("app.component('FeatureTerminal', FeatureTerminal)");
    expect(theme).not.toContain('PlanxSim');
    expect(existsSync(join(root, 'site/.vitepress/theme/sim'))).toBe(false);
    expect(existsSync(join(root, 'site/.vitepress/theme/components/PlanxScreen.vue'))).toBe(false);
    expect(existsSync(join(root, 'site/.vitepress/theme/components/PlanxPicker.vue'))).toBe(false);
  });
});
