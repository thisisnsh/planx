# Releasing planx

Nothing is ever published by hand.

## 1. Channels

| Trigger | Publishes | npm tag | Who gets it |
| --- | --- | --- | --- |
| Merge to `main` | `1.2.0-staging.47` | `staging` | `@staging` installers, dogfooding |
| GitHub Release published | `1.2.0` | `latest` | everyone |

Both channels are one workflow, `release.yml`, because npm trusted publishing
pins a single repository *and workflow filename* — two files would mean two
trusted publishers for one package. The trigger picks the channel.

It synthesises the prerelease version at build time as
`<version-in-package.json>-staging.<run_number>`. **`package.json` is never
rewritten in a commit and CI never pushes to `main`.** Bot commits on the
default branch cause push loops, force everyone to pull after every merge, and
need `[skip ci]` guards — all avoidable by treating the committed version as
"the next release target".

## 2. Cutting a release

1. Bump `version` in `package.json` to the release you are cutting.
2. Move the `Unreleased` section of `CHANGELOG.md` into a dated section.
3. Merge that PR. This publishes one more `staging` build, which is the exact
   tree the release will be cut from.
4. Smoke-test it:
   ```bash
   npm install -g @thisisnsh/planx@staging
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
5. Create a GitHub Release on tag `v1.2.0`, with the changelog section as the
   body. `release.yml` does the rest.

The tag must match `package.json` exactly — the workflow asserts this and fails
loudly if not, because publishing `1.2.0` from a tag called `v1.3.0` is nearly
impossible to notice afterwards and impossible to undo.

## 3. Version policy

Semver. **Pre-1.0, breaking changes bump the minor.**

The **`~/.planx` on-disk format is versioned independently** (`format_version`
in every stored file) and gets its own migration note in the changelog whenever
it changes. That is the thing users cannot roll back cleanly: downgrading the
CLI is instant, but a store already migrated forward is not.

## 4. Rollback

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

## 5. Prerequisites

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
- Release creation is restricted to maintainers (`@thisisnsh`).

## 6. Post-release verification

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
string then appears in every `planx --version`, every bug report and every
changelog entry. A clean rebuild from the release tag is worth more than
byte-identity here, and the tree is the same one `staging` already tested.
