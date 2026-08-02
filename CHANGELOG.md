# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Pre-1.0, breaking changes bump the minor version.

The **`~/.planx` on-disk format is versioned independently** of the package. Any
change to it gets a migration note here, because that is the one thing a user
cannot roll back by reinstalling an older CLI.

## [Unreleased]

### Added

- **The review loop.** `planx capture` stores a plan as a version; `planx await`
  blocks while you review it in another terminal tab; `planx submit` (or the
  TUI) sends comments, locks and a verdict back, anchored to the lines they
  refer to.
- **The review TUI** (`planx diff <id>`): line-snapped selection by mouse drag
  or vim-style visual mode, comment / lock / unlock, multi-annotation submit,
  approve-and-seal, and a banner when an agent is blocked waiting on you.
- **Locking, enforced at the storage layer.** `planx capture` refuses to write a
  version that mutates a locked region, so locks hold even in
  bypass-permissions mode. `planx unlock-request` blocks on your decision and a
  grant authorises exactly one capture.
- **Seal on approve**: approving locks every `##` section plus the preamble.
  Partial unlocks split a lock rather than being refused.
- **Token-efficient revision**: `planx show --skeleton` collapses locked blocks
  to `[[planx:keep L2]]` markers, and `planx capture --splice` expands them.
- **The three skills** — `/planx`, `/planx-diff`, `/planx-execute` — installed
  for both Claude Code and Codex.
- **`planx execute`**: spawns a fresh agent from a configurable argv template.
  Adding an agent is a config entry, not a code change.
- **`planx import --from claude|codex`** to backfill from an agent's own
  history. Explicit and user-run; nothing watches your directories.
- **Retention**: `planx clean` soft-deletes to `~/.planx/.trash`, `planx restore`
  brings a plan back, and `--purge` is required to actually destroy anything.
- `planx submit` and `planx unlock-respond` as first-class commands, so the TUI
  is one front-end to a documented wire format rather than the only way in.
- `planx doctor`, `planx status`, `planx on` / `off`, `planx config`.

### Notes

- Installation writes skills into `~/.claude/skills/` and `~/.codex/skills/` and
  seeds `~/.planx`. It modifies **no** agent settings files.
- On-disk format version: **1**.

[Unreleased]: https://github.com/thisisnsh/planx/commits/main
