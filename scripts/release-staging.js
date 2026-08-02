#!/usr/bin/env node
// Cuts a staging build from this machine: `npm run release:staging`.
//
// Staging is a release-candidate channel, never `latest`. Installing
// `@thisisnsh/planx` without a tag must keep resolving to the last real
// release, which only the GitHub Release workflow publishes — so nothing here
// touches the `latest` tag, and npm is told the version is a prerelease so it
// cannot become `latest` by default either.
//
// The version is synthesised at publish time and package.json is never left
// modified: rewriting it in a commit would mean bot churn on main for every
// dogfood build.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
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
  console.error(`\n  release:staging — ${msg}\n`);
  process.exit(1);
};

// A staging build is what the release will be cut from, so it has to be a
// tree that actually exists in git. Publishing uncommitted work produces a
// version nobody can ever check out again.
if (capture('git', ['status', '--porcelain'])) {
  die('the working tree is dirty. Commit or stash first — a staging build must be a tree in git.');
}

const pkgPath = join(root, 'package.json');
const original = readFileSync(pkgPath, 'utf8');
const { name, version: base } = JSON.parse(original);

if (base.includes('-')) {
  die(`package.json version (${base}) is already a prerelease. Set it to a stable base version.`);
}

// npm reports a misleading 404 when a publish is unauthenticated. Check the
// session before doing the version lookup, tests, and build so the most common
// auth failure is obvious and inexpensive.
let npmUser;
try {
  npmUser = capture('npm', ['whoami']);
} catch {
  die('not authenticated with npm. Run `npm login`, then verify it with `npm whoami`.');
}

console.log(`\n  Authenticated with npm as ${npmUser}.`);

// Pick the next suffix from what is actually on npm rather than a local
// counter: two maintainers, or a fresh clone, would otherwise collide on a
// version number that npm refuses to overwrite.
//
// Asking for the whole version list and filtering here, rather than querying
// `name@<base>-staging`: that is not a valid semver range, so npm answers it
// with a 404 that is indistinguishable from an unpublished package.
let next = 1;
try {
  const published = JSON.parse(capture('npm', ['view', name, 'versions', '--json']));
  const suffix = new RegExp(`^${base.replace(/\./g, '\\.')}-${DIST_TAG}\\.(\\d+)$`);
  const taken = (Array.isArray(published) ? published : [published])
    .map((v) => Number(suffix.exec(v)?.[1]))
    .filter(Number.isInteger);
  if (taken.length) next = Math.max(...taken) + 1;
} catch {
  // Nothing published under this base yet, or npm is unreachable. The publish
  // itself will fail loudly if it is the latter.
}

const version = `${base}-${DIST_TAG}.${next}`;

console.log(`\n  Publishing ${name}@${version} under the "${DIST_TAG}" tag.`);
console.log(`  "latest" stays where it is — only a GitHub Release moves it.\n`);

run('npm', ['run', 'typecheck']);
run('npm', ['test']);
run('npm', ['run', 'build']);

// From here package.json is modified, so every exit path has to restore it —
// leaving a developer's checkout on a prerelease version would be silently
// carried into the next real release.
let failure;
try {
  run('npm', ['version', '--no-git-tag-version', '--allow-same-version', version]);
  // No --provenance: that needs a CI OIDC token, and this runs on a laptop.
  // Signed provenance is a property of the release build, not of staging.
  run('npm', ['publish', '--tag', DIST_TAG, '--access', 'public']);
} catch (error) {
  failure = error;
} finally {
  writeFileSync(pkgPath, original);
  // npm version rewrote the lockfile's version fields too.
  try {
    run('git', ['checkout', '--', 'package-lock.json'], { stdio: 'ignore' });
  } catch {
    // The lockfile may legitimately be untracked in a consumer's fork.
  }
}

if (failure) {
  die(
    `publish failed as ${npmUser}. package.json has been restored to ${base}. ` +
      `If npm reported 404, confirm this account can publish under the ${name.split('/')[0]} scope.`,
  );
}

console.log(`\n  Published ${name}@${version}\n`);
console.log(`  Smoke-test it:\n    npm install -g ${name}@${DIST_TAG}\n    planx --version\n`);
