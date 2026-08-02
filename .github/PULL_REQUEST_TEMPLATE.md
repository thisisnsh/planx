## What this changes

<!-- One or two sentences. What is different afterwards? -->

## Why

<!-- The problem being solved. If it is a behaviour change, say what the old
     behaviour was and why it was wrong. -->

## Test evidence

<!-- Paste the relevant output, not just "tests pass". If you changed the
     locking or the await handshake, say which test covers the new case —
     those are the two things most likely to break in a way nobody notices. -->

## Checklist

- [ ] `npm test` passes
- [ ] `npm run lint && npm run typecheck` pass
- [ ] `CHANGELOG.md` has an entry under `Unreleased`, or this change is invisible to users
- [ ] `npm run docs:cli` re-run and committed, if `src/cli/spec.ts` changed
- [ ] The on-disk `~/.planx` format is unchanged, or the change is noted in the changelog with a migration note
