# Releasing planx

Production is never published by hand.

## 1. Channels

| Trigger | Publishes | npm tag | Who gets it |
| --- | --- | --- | --- |
| `npm run release:staging` (local) | `1.2.0-staging.47` | `staging` | `@staging` installers, dogfooding |
| `npm run remove:staging <n>` (local) | unpublishes `1.2.0-staging.<n>`, or all of them with `--all` | `staging` repointed | — |
| GitHub Release published | `1.2.0` | `latest` | everyone |

**Merging to `main` publishes nothing.** Most merges are not a build anyone
needs, and a channel that moves on every merge is one nobody can pin to. A
staging build is something you decide to cut.

Only `release.yml` publishes to production, and it is the sole workflow that
touches npm at all — npm trusted publishing pins one repository *and workflow
filename*, so a second publishing workflow would need a second trusted
publisher for the same package.

Staging synthesises `<version-in-package.json>-staging.<n>` at publish time.
Production takes its version from the GitHub Release tag, commits that exact
version to `main`, and publishes it. Neither channel predicts or commits a
future version. The local staging script restores both `package.json` and the
lockfile on every exit path, including a failed publish.

## 2. Cutting a staging build

From a clean checkout of the commit you want to test:

```bash
npm login
npm whoami
npm run release:staging
```

The login must be an npm account allowed to publish under the `@thisisnsh`
scope. The script checks that session before doing any expensive work. It then
refuses a dirty tree, runs typecheck, tests and build, picks the next free
`-staging.N` by asking npm what is already published, and publishes under the
`staging` tag. It never moves `latest` — a plain `npm install @thisisnsh/planx`
keeps resolving to the last real release. There is no provenance on a staging
build: that needs a CI OIDC token, and signed provenance is a property of the
release build.

### Removing a staging build

A broken dogfood build should not stay installable:

```bash
npm run remove:staging 47            # or the full 1.2.0-staging.47
npm run remove:staging               # lists what is published
npm run remove:staging -- --all      # every published staging build
```

It only accepts `<base>-staging.<n>`, so it cannot be pointed at a real release
whatever you type after it, and it confirms before deleting — `--all` asks you
to type `yes` in full, and refuses outright if that would take the package's
last published version with it. After the unpublish it repoints the `staging`
tag at the newest surviving staging build, or removes the tag if that was the
last one — a tag pointing at a version that no longer exists makes
`npm install @thisisnsh/planx@staging` fail outright.

Unpublishing only works within 72 hours of the publish. After that, deprecate
the version instead. `--all` therefore usually clears only the recent builds
and reports the rest as still published, with the `npm deprecate` line for each.
Either way npm never accepts a removed version number again, so the next
`release:staging` moves on to `-staging.<n+1>` rather than refilling the gap.

## 3. Cutting a release

1. Merge the changes you want to release, then cut a staging build from that
   merge commit — that is the
   exact tree the release will be cut from.
2. Smoke-test it:
   ```bash
   npm install -g @thisisnsh/planx@1.2.0-staging.N --prefer-online
   planx --version                       # should print 1.2.0-staging.N
   planx doctor
   ```
   Then one real round-trip against a scratch store, so you never test against
   your own plans:
   ```bash
   planx --dir /tmp/planx-smoke capture --stdin <<< '# Smoke
   ## A
   one'
   planx --dir /tmp/planx-smoke submit <id> --comment "3:no" --approve
   ```
3. Create a GitHub Release with the desired semver tag, such as `v1.2.0`, from
   the tip of `main`. Summarise notable changes and any on-disk format migration
   in the release notes. `release.yml` sets the package version from the tag,
   runs the checks, commits that exact version to `main`, and publishes it. It
   does not calculate a subsequent version.

Release tags must be stable semver versions. Prerelease tags are rejected so a
prerelease can never move npm's `latest` tag.

## 4. Version policy

Semver. **Pre-1.0, breaking changes bump the minor.**

The **`~/.planx` on-disk format is versioned independently** (`format_version`
in every stored file). Describe any migration in the relevant GitHub Release
notes. That is the thing users cannot roll back cleanly: downgrading the CLI is
instant, but a store already migrated forward is not.

## 5. Rollback

In order, always:

1. **Repoint `latest`.** This takes seconds and fixes every new install:
   ```bash
   npm dist-tag add @thisisnsh/planx@1.1.3 latest
   ```
2. **Deprecate the bad version**, with a message pointing at the issue:
   ```bash
   npm deprecate @thisisnsh/planx@1.2.0 "Broken lock verification, see #123. Use 1.1.3."
   ```
3. **Unpublish only as a last resort.** It works within 72 hours of publishing
   and it breaks anyone who pinned that exact version. Documented here so it is
   a considered decision rather than something discovered under pressure.

Then fix forward and cut a new release. Never re-publish a version number.

## 6. Prerequisites

- **A trusted publisher** on npmjs.com for `@thisisnsh/planx`, pointed at this
  repository and the workflow file `release.yml`. There is no `NPM_TOKEN` and
  no long-lived credential to leak or rotate: the job exchanges its OIDC token
  for a short-lived one at publish time. Renaming `release.yml`, or moving a
  publish into a second workflow file, breaks auth until the publisher is
  updated to match.
- **`id-token: write`** on the publishing job, which the workflow already sets.
  This is what the OIDC exchange needs, and it is also what mints provenance —
  free supply-chain attestation, generated automatically under trusted
  publishing rather than via an explicit `--provenance` flag.
- **`--access public`** on publish. Scoped packages are private by default, so
  this flag is not optional; omitting it fails the publish on a free account.
- **`contents: write`** on the publishing job, so it can commit the exact
  released version to `main` before publishing it.
- **`npm login` on the maintainer's machine** for staging builds, which
  authenticate with your own credentials rather than OIDC. If the package is
  ever set to *require* trusted publishing on npmjs.com, that setting rejects
  every token-based publish — including `release:staging`. Keep that option off
  unless you are willing to move staging into CI too.
- Release creation is restricted to maintainers (`@thisisnsh`).

## 7. Post-release verification

```bash
npm view @thisisnsh/planx dist-tags       # latest and staging point where you expect
npx -y @thisisnsh/planx@latest --version  # no -staging suffix
```

Then one real `/planx` round-trip against a scratch `--dir`, in both Claude Code
and Codex if you can.

## Why `latest` is a rebuild, not a promotion

`npm dist-tag add` on the staging artifact would reuse the exact tested bytes,
which is genuinely attractive. It is not what we do, because it would leave
`latest` pointing at a version literally named `1.2.0-staging.47` — and that
string then appears in every `planx --version` and every bug report. A clean
rebuild from the release tag is worth more than byte-identity here, and the tree
is the same one `staging` already tested.
