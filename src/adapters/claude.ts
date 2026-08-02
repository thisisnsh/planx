import { readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { deriveTitle } from '../protocol/capture.js';
import type { Adapter, AdapterOptions, ImportedPlan } from './types.js';

function plansDir(opts: AdapterOptions): string {
  return join(opts.home ?? homedir(), '.claude', 'plans');
}

/**
 * Claude Code writes plans as plain markdown files, which makes this the whole
 * adapter: read the file, take the title from the H1, take the timestamp from
 * mtime because the format carries no other one.
 */
export const claudeAdapter: Adapter = {
  name: 'claude',

  describe(opts) {
    return plansDir(opts);
  },

  collect(opts) {
    const dir = plansDir(opts);
    let names: string[];
    try {
      names = readdirSync(dir).filter((f) => f.endsWith('.md'));
    } catch {
      return [];
    }

    const cutoff = opts.since ? Date.now() - opts.since : 0;
    const out: ImportedPlan[] = [];

    for (const name of names) {
      const file = join(dir, name);
      let text: string;
      let mtime: number;
      try {
        text = readFileSync(file, 'utf8');
        mtime = statSync(file).mtimeMs;
      } catch {
        continue; // deleted between listing and reading
      }
      if (!text.trim()) continue;
      if (mtime < cutoff) continue;

      out.push({
        title: deriveTitle(text) || basename(name, '.md'),
        text,
        created: new Date(mtime).toISOString(),
        source: 'claude',
        sessionId: null,
        origin: file,
      });
    }

    return out.sort((a, b) => b.created.localeCompare(a.created)).slice(0, opts.limit ?? Infinity);
  },
};
