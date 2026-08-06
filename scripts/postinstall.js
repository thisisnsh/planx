#!/usr/bin/env node
// Runs `planx add-skills` after an npm install, so the skills in ~/.claude and
// ~/.codex are the ones this version ships.
//
// It used to print a line telling you to run that yourself. The reasoning was
// that an install which refreshed your skills unasked was doing the one thing
// the command exists to be asked for — but the practical outcome was upgrades
// that left an old skill in place, pointing at a CLI that had moved on. An
// install is when the two are meant to match, so this is where they are made to.
//
// It is still not free rein: `add-skills` only writes into agent directories
// that already exist, only replaces skill directories carrying its own marker,
// and never touches an agent's settings files.
//
// Silence it entirely with PLANX_NO_POSTINSTALL=1.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.env.PLANX_NO_POSTINSTALL) {
  process.exit(0);
}

const root = dirname(dirname(fileURLToPath(import.meta.url)));

// A checkout of planx itself running `npm install` is a dev install, not a
// consumer install — there is nothing to tell the developer they do not know,
// and rewriting their real ~/.claude skills from a working tree would be a
// nasty surprise mid-branch.
if (existsSync(join(root, 'src', 'cli.ts')) && !process.env.PLANX_FORCE_POSTINSTALL) {
  process.exit(0);
}

const cli = join(root, 'dist', 'cli.js');
if (!existsSync(cli)) {
  console.log('planx installed — run `planx add-skills` to set up your agents.');
  process.exit(0);
}

// Never fail the install. A skill that could not be written is worth saying out
// loud, and worth nothing at all as a reason to fail `npm install -g`.
const child = spawn(process.execPath, [cli, 'add-skills'], { stdio: 'inherit' });
child.on('error', () => {
  console.log('planx installed — run `planx add-skills` to set up your agents.');
  process.exit(0);
});
child.on('close', () => process.exit(0));
