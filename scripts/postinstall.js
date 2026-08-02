#!/usr/bin/env node
// Runs `planx install` after a global/local npm install.
//
// It is deliberately timid: it writes skills into ~/.claude and ~/.codex and
// seeds ~/.planx, and it touches NO agent settings files. There is no hook to
// register so there is nothing it needs from settings.json.
//
// Skip entirely with PLANX_NO_POSTINSTALL=1. Reverse with `planx uninstall`.
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

if (process.env.PLANX_NO_POSTINSTALL) {
  process.exit(0);
}

const root = dirname(dirname(fileURLToPath(import.meta.url)));

// A checkout of planx itself running `npm install` is a dev install, not a
// consumer install — never mutate the developer's real agent directories.
if (existsSync(join(root, 'src', 'cli.ts')) && !process.env.PLANX_FORCE_POSTINSTALL) {
  process.exit(0);
}

const entry = join(root, 'dist', 'cli.js');
if (!existsSync(entry)) {
  // Nothing built (e.g. installing straight from a git ref without a prepare
  // step). Silence beats a scary error in someone else's install log.
  process.exit(0);
}

try {
  const { runInstall } = await import(pathToFileURL(join(root, 'dist', 'install/install.js')).href);
  await runInstall({ postinstall: true });
} catch (err) {
  console.error(`planx: postinstall skipped (${err instanceof Error ? err.message : err})`);
  console.error('planx: run `planx install` yourself to finish setup.');
}
