#!/usr/bin/env node
// Removes staging builds from npm: `npm run remove:staging <version>`, or
// `npm run remove:staging -- --all` for every published staging version.
//
// The counterpart to release:staging. A dogfood build that turns out to be
// broken should not stay installable, and old ones accumulate on the registry
// forever, but unpublishing is irreversible — npm never lets that exact version
// number be republished — so this script is deliberately narrow:
//
//   * it only ever accepts `<base>-staging.<n>`, so it cannot be pointed at a
//     real release no matter what is typed after the script name;
//   * it confirms before it deletes anything;
//   * it repoints the `staging` dist-tag afterwards, so the tag never dangles
//     on a version that no longer exists.
//
// It never touches `latest`. Rolling back a *release* is a different procedure
// (repoint `latest`, then deprecate) and is documented in RELEASING.md.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const DIST_TAG = 'staging';

const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { cwd: root, stdio: 'inherit', ...opts });
const capture = (cmd, args) =>
  execFileSync(cmd, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();

const die = (msg) => {
  console.error(`\n  remove:staging — ${msg}\n`);
  process.exit(1);
};

const { name, version: base } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const stagingOf = (v) => Number(new RegExp(`^(.+)-${DIST_TAG}\\.(\\d+)$`).exec(v)?.[2]);

const args = process.argv.slice(2);
const assumeYes = args.some((a) => a === '-y' || a === '--yes');
const removeAll = args.some((a) => a === '--all');
const [requested] = args.filter((a) => !a.startsWith('-'));
// An account with 2FA on writes needs an OTP for both the unpublish and the
// dist-tag move. Forward it rather than making the maintainer run npm by hand
// and then clean up the tag themselves.
const otp = args.filter((a) => a.startsWith('--otp='));

// npm reports a misleading 404 when a request is unauthenticated, and unpublish
// needs a session regardless. Check it first so the common auth failure is
// obvious rather than arriving as a 404 on a version you can see published.
let npmUser;
try {
  npmUser = capture('npm', ['whoami']);
} catch {
  die('not authenticated with npm. Run `npm login`, then verify it with `npm whoami`.');
}

// --prefer-online for the same reason release:staging uses it: a publish or a
// previous removal leaves a stale packument in npm's local HTTP cache, and
// acting on that would either miss a version or offer to delete a gone one.
let published;
try {
  const raw = JSON.parse(capture('npm', ['view', name, 'versions', '--json', '--prefer-online']));
  published = Array.isArray(raw) ? raw : [raw];
} catch {
  die(`could not read published versions of ${name} from npm. Nothing was removed.`);
}

// Registry order, not a sort of my own: staging suffixes restart at 1 on every
// base version, so `-staging.9` of an old base is not newer than `-staging.1`
// of the current one. npm lists versions in publish order, which is exactly the
// "newest surviving build" the tag should fall back to.
const stagingVersions = published.filter((v) => Number.isInteger(stagingOf(v)));

const listStaging = () => {
  if (!stagingVersions.length) {
    console.error(`  No staging versions of ${name} are published.`);
    return;
  }
  console.error(`  Published staging versions of ${name}:`);
  for (const v of stagingVersions) console.error(`    ${v}`);
};

if (removeAll && requested) {
  die(
    `--all removes every staging version, so it takes no version argument. Pick one or the other.`,
  );
}

if (!removeAll && !requested) {
  console.error(`\n  Usage: npm run remove:staging <version>     one build, by version or suffix`);
  console.error(`         npm run remove:staging -- --all      every published staging build\n`);
  console.error(`  A version can be given in full (${base}-${DIST_TAG}.1) or as its suffix (1).`);
  console.error(`  Add -- --yes to skip the confirmation prompt.\n`);
  listStaging();
  console.error('');
  process.exit(1);
}

let targets;
if (removeAll) {
  if (!stagingVersions.length) {
    die(`no staging versions of ${name} are published. Nothing to remove.`);
  }
  targets = stagingVersions;
} else {
  // Accept what a maintainer is likely to paste — the smoke-test install line,
  // a git-style `v` prefix — plus the bare suffix number, which is the only
  // part that varies between two staging builds of the same base version.
  const version = /^\d+$/.test(requested)
    ? `${base}-${DIST_TAG}.${requested}`
    : requested.replace(/^.*@(?=\d)/, '').replace(/^v/, '');

  if (!Number.isInteger(stagingOf(version))) {
    die(
      `refusing to remove "${version}" — this script only removes ` +
        `<base>-${DIST_TAG}.<n> builds. Rolling back a real release is a different ` +
        `procedure: repoint latest and deprecate. See RELEASING.md.`,
    );
  }

  if (!published.includes(version)) {
    console.error(`\n  remove:staging — ${name}@${version} is not published.\n`);
    listStaging();
    console.error('');
    process.exit(1);
  }

  targets = [version];
}

// Unpublishing every remaining version removes the whole package from npm,
// which frees the name and would need `npm unpublish --force` anyway. Say so
// rather than letting npm's own error be the first hint. Only reachable on a
// package that has never had a real release — otherwise `latest` survives.
if (published.length === targets.length) {
  die(
    `that is every published version of ${name}, so removing it would unpublish ` +
      `the entire package. Do that deliberately with \`npm unpublish ${name} --force\` ` +
      `if it is really what you want.`,
  );
}

console.log(`\n  Authenticated with npm as ${npmUser}.`);
console.log(
  `\n  About to unpublish ${targets.length === 1 ? `${name}@${targets[0]}` : `${targets.length} staging versions of ${name}`}:`,
);
for (const v of targets) console.log(`    ${v}`);
console.log(`\n  This is permanent — npm will never accept those version numbers again.`);
console.log(`  Anyone who pinned one breaks. "latest" is untouched.\n`);

if (!assumeYes) {
  if (!process.stdin.isTTY) {
    die('not a terminal, so there is nothing to confirm with. Re-run with --yes if you mean it.');
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  // --all is the one that deletes work you cannot enumerate from memory, so it
  // asks for the whole word rather than a keystroke a tired maintainer can
  // reflex their way through.
  const prompt = removeAll
    ? `  Unpublish all ${targets.length}? Type "yes" to confirm: `
    : `  Unpublish ${targets[0]}? [y/N] `;
  const answer = (await rl.question(prompt)).trim().toLowerCase();
  rl.close();
  const ok = removeAll ? answer === 'yes' : answer === 'y' || answer === 'yes';
  if (!ok) die('cancelled. Nothing was removed.');
}

// Keep going after a failure instead of stopping at the first one: on --all the
// usual failure is a build older than npm's 72-hour window, and stopping there
// would leave every newer build — the ones that can still be removed — behind.
const removed = [];
const failed = [];
for (const v of targets) {
  try {
    run('npm', ['unpublish', `${name}@${v}`, ...otp]);
    removed.push(v);
    console.log(`  Unpublished ${name}@${v}`);
  } catch {
    failed.push(v);
    console.error(`  FAILED to unpublish ${name}@${v} — npm's error is above.`);
  }
}

console.log(`\n  Unpublished ${removed.length} of ${targets.length}.`);

// The `staging` tag can now point at a version that no longer exists, which
// makes `npm install @thisisnsh/planx@staging` fail outright. Move it to the
// newest surviving staging build, or drop it if that was the last one.
if (removed.length) {
  try {
    const tags = JSON.parse(
      capture('npm', ['view', name, 'dist-tags', '--json', '--prefer-online']),
    );
    if (tags[DIST_TAG] !== undefined && !removed.includes(tags[DIST_TAG])) {
      console.log(`\n  "${DIST_TAG}" still points at ${tags[DIST_TAG]}.`);
    } else {
      const survivors = stagingVersions.filter((v) => !removed.includes(v));
      const newest = survivors[survivors.length - 1];
      if (newest) {
        run('npm', ['dist-tag', 'add', `${name}@${newest}`, DIST_TAG, ...otp]);
        console.log(`\n  "${DIST_TAG}" now points at ${newest}.`);
      } else if (tags[DIST_TAG] !== undefined) {
        run('npm', ['dist-tag', 'rm', name, DIST_TAG, ...otp]);
        console.log(`\n  No staging builds left — removed the "${DIST_TAG}" tag.`);
      } else {
        console.log(`\n  No staging builds left, and no "${DIST_TAG}" tag to clean up.`);
      }
    }
  } catch {
    console.error(
      `\n  The versions were removed, but the "${DIST_TAG}" tag could not be settled. ` +
        `Check it with \`npm view ${name} dist-tags\`.`,
    );
  }
}

// npm's own errors are already on the terminal (stdio is inherited), so this
// points at the two causes it does not explain well rather than asserting one.
if (failed.length) {
  console.error(`\n  Still published: ${failed.join(', ')}`);
  console.error(`  If npm asked for a one-time password, re-run with --otp=<code>.`);
  console.error(`  If a publish is more than 72 hours old, unpublishing is closed and`);
  console.error(`  deprecating is the remaining option:`);
  for (const v of failed) {
    console.error(`    npm deprecate ${name}@${v} "Broken staging build, do not use."`);
  }
  console.error('');
  process.exit(1);
}

console.log('');
