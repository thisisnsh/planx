import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), 'utf8');

describe('the single-page product website', () => {
  it('uses one landing page instead of agent-specific and reference routes', () => {
    const index = read('site/index.md');
    const config = read('site/.vitepress/config.ts');

    expect(index).toContain('<LandingPage />');
    expect(config).not.toContain('sidebar:');

    for (const page of [
      'site/install.md',
      'site/review-loop.md',
      'site/diffing.md',
      'site/executing.md',
      'site/codex.md',
      'site/claude-code.md',
      'site/retention.md',
      'site/troubleshooting.md',
      'site/reference/cli.md',
      'site/reference/config.md',
      'site/reference/storage.md',
    ]) {
      expect(existsSync(join(root, page)), page).toBe(false);
    }
  });

  it('makes the product, agent support, workflow, and proof explicit', () => {
    const page = read('site/.vitepress/theme/components/LandingPage.vue');

    expect(page).toContain('PlanX is a skill and terminal review interface');
    expect(page).toContain('CODEX SKILL');
    expect(page).toContain('CLAUDE CODE SKILL');
    expect(page).toContain('OTHER AGENT CLIs');
    expect(page).toContain('Plan. Review. Revise. Execute.');
    expect(page).toContain('Stop feeding agents');
    expect(page).toContain('planx-review.png');
    expect(page.match(/SCREENSHOT PLACEHOLDER/g)).toHaveLength(2);
  });

  it('shows every core feature with a static terminal view', () => {
    const page = read('site/.vitepress/theme/components/LandingPage.vue');
    const component = read('site/.vitepress/theme/components/FeatureTerminal.vue');

    for (const example of ['feedback', 'diff', 'versions', 'editing', 'readability', 'handoff']) {
      expect(page).toContain(`example="${example}"`);
      expect(component).toContain(`${example}:`);
    }

    expect(component).toContain('aria-label="label"');
    expect(component).not.toMatch(/<button|<input|@click|@keydown|addEventListener/);
  });

  it('keeps implementation and configuration details expanded in the README', () => {
    const readme = read('README.md');

    expect(readme).toContain('## Configuration');
    expect(readme).toContain('## Agent setup and updates');
    expect(readme).not.toContain('<details>');
    expect(readme).toContain('Custom revise and execute commands');
    expect(readme).toContain('The command must accept a trailing prompt');
    expect(readme).toContain('assets/planx-handoff.png');
  });
});
