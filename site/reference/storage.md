# Storage

**`~/.planx` on disk is the protocol.** Every command is a thin operation over
it, which is what makes any agent that can spawn a process a first-class
citizen, forever.

```
~/.planx/
  config.json                     # enabled flag, agent registry, render prefs
  index.json                      # id → {title, cwd, updated, latest, approved}
  plans/
    guard-clock-regression-a3f9/
      meta.json                   # id, title, created, source, cwd, session_id, tags, approved_at
      versions.json               # ordered version records
      locks.json                  # active locks — plan-level, carried across versions
      v1.md  v2.md  v3.md
      feedback/  v2-01K9X4….json
      inbox/     req-01K9X4….json  resp-01K9X4….json
  .trash/                         # soft-deleted plans
  logs/
```

## Why files and not a daemon

The thing planx needs is a **tool call that blocks** while a human does
something out of band. A blocking shell command gets it: the agent runs
`planx await <id> <version>`, the process sits there until the TUI in another
tab submits, and then it prints the feedback to stdout.

That works in Claude Code, Codex, Gemini CLI, Cursor, Amp — anything that can
run a subprocess. No server, no lifecycle, nothing to install alongside.

Its one real weakness is the timeout ceiling, solved by making `await`
resumable. See [The review loop](/guide/review-loop).

## Plans are global

One flat store, not scoped per project. `cwd` is recorded as metadata and
available as a filter (`planx list --here`), but never as a boundary — plans
move between repos and get referenced from anywhere.

## Plan ids

Kebab slug of the title plus a 4-character content hash:

```
guard-clock-regression-a3f9
```

Greppable and tab-completable, where a UUID would be neither, while the hash
keeps two plans called "refactor the poller" apart. `--name` pins an id
instead.

Because the id is derived from title *and* content, capturing the same plan
twice lands on the same id and adds no version. That is what makes
`planx import` safe to re-run.

## Versions are content-addressed

`versions.json` holds `{n, sha256, author, agent, created, parent, note}`.

Capturing content byte-identical to the current **latest** is a no-op returning
that version. Only the latest is compared: matching an older version would mean
rewinding `latest` and losing everything in between, and a revision that happens
to revert to v1 is still a decision worth recording.

Stored `vN.md` files are always **fully expanded**. `[[planx:keep …]]` markers
are a wire format between the agent and `capture`, never a storage format, so
diffing, execution and rendering never learn they existed.

## Concurrency

- Every write is a temp file plus `rename`, which is atomic within a filesystem.
  A reader sees the whole old file or the whole new one, never half of either.
- `index.json` and `locks.json` take an advisory lock: an `O_EXCL` lockfile,
  stolen if it is more than 10 seconds old. Not `flock`, because dotfiles live
  on network filesystems where `flock` lies.
- Two `await`s on the same version both receive the same feedback.

## Corruption

A file that exists but fails its schema raises an error naming the file. planx
never silently falls back to defaults — quietly replacing a plan's `locks.json`
with "no locks" is exactly the data loss this store exists to prevent.

```bash
planx doctor    # checks every plan and rebuilds index.json
```

`index.json` is a cache. A plan directory that is missing from it still lists,
and `doctor` rebuilds it from the plan directories, which are the truth.

## Format version

Every stored file carries `format_version`. It is versioned **independently of
the npm package**, because the CLI can be rolled back in seconds and a migrated
store cannot. Any migration is documented in the relevant
[GitHub Release](https://github.com/thisisnsh/planx/releases).

Current on-disk format version: **1**.
