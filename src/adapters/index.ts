import { capture } from '../protocol/capture.js';
import { claudeAdapter } from './claude.js';
import { codexAdapter } from './codex.js';
import type { Adapter, AdapterOptions, ImportedPlan } from './types.js';

export const adapters: Record<string, Adapter> = {
  claude: claudeAdapter,
  codex: codexAdapter,
};

export function getAdapter(name: string): Adapter {
  const adapter = adapters[name];
  if (!adapter) {
    throw new Error(
      `planx: no import adapter "${name}". Available: ${Object.keys(adapters).join(', ')}. ` +
        'Anything else can be piped: `some-agent … | planx capture --stdin --source foo`.',
    );
  }
  return adapter;
}

export interface ImportResult {
  imported: Array<{ planId: string; title: string; origin: string }>;
  skipped: number;
}

/**
 * Ingest plans from an agent's own history.
 *
 * Imports are explicit and user-run. Nothing watches your agent directories in
 * the background (PLAN §16) — a tool that quietly indexes everything an agent
 * writes is a surprise nobody asked for.
 *
 * Re-importing is safe: capture is content-addressed, so a plan that is already
 * stored under the same id collapses to a no-op rather than a duplicate.
 */
export function runImport(
  name: string,
  opts: AdapterOptions & { latestOnly?: boolean },
): ImportResult {
  const adapter = getAdapter(name);
  const found = adapter.collect(opts);
  const selected = opts.latestOnly ? found.slice(0, 1) : found;

  const result: ImportResult = { imported: [], skipped: 0 };
  for (const plan of selected) {
    const stored = importOne(plan);
    if (stored) result.imported.push(stored);
    else result.skipped++;
  }
  return result;
}

function importOne(plan: ImportedPlan): { planId: string; title: string; origin: string } | null {
  try {
    const result = capture({
      text: plan.text,
      title: plan.title,
      source: plan.source,
      sessionId: plan.sessionId,
      author: 'import',
      created: plan.created,
      note: `imported from ${plan.origin}`,
    });
    return { planId: result.planId, title: result.title, origin: plan.origin };
  } catch {
    // One malformed plan should not abort a backfill of seventeen.
    return null;
  }
}

export type { Adapter, AdapterOptions, ImportedPlan };
