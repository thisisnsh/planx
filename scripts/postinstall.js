#!/usr/bin/env node
// Prints one line after an npm install. It writes nothing.
//
// It used to run the installer, which meant every `npm install -g` refreshed
// the skills in ~/.claude and ~/.codex without being asked — including on an
// upgrade, where the thing being silently replaced might be a skill you had
// been reading five minutes earlier. Setting up your agents is now a command
// you run: `planx add-skills`.
//
// The line is printed rather than the step simply deleted, because an install
// that says nothing at all leaves you with a CLI and no idea that the skills
// are a separate step.
//
// Silence it entirely with PLANX_NO_POSTINSTALL=1.
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.env.PLANX_NO_POSTINSTALL) {
  process.exit(0);
}

const root = dirname(dirname(fileURLToPath(import.meta.url)));

// A checkout of planx itself running `npm install` is a dev install, not a
// consumer install — there is nothing to tell the developer they do not know.
if (existsSync(join(root, 'src', 'cli.ts')) && !process.env.PLANX_FORCE_POSTINSTALL) {
  process.exit(0);
}

console.log('planx installed — run `planx add-skills` to set up your agents.');
