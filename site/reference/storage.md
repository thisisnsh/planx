# Storage

PlanX stores its data under `~/.planx` by default:

```text
~/.planx/
  config.json
  update.json
  index.json
  plans/
    upload-limits-a3f9/
      meta.json
      versions.json
      v1.md
      v2.md
      feedback/
  logs/
```

The CLI and agent skills use these files directly. There is no PlanX server or
daemon.

## Plans and versions

Plan IDs combine a readable title slug with a short content hash. Metadata
records the title, capture directory, source agent, and session ID. Each
`vN.md` contains one complete plan version, while `versions.json` records their
order, hashes, parent versions, notes, and reviewer edits.

Capturing content identical to the latest version returns that version instead
of creating a duplicate. A revision that returns to older wording still creates
a version when it differs from the current latest.

## Feedback

Feedback files connect comments, whole-plan notes, and reviewer edits to the
version under review. `planx revise <id>` reads open feedback for the agent; a
new captured revision closes the round it addresses.

## Safe writes and repair

PlanX writes through temporary files and atomic renames. `index.json` is a
rebuildable list cache; the plan directories remain the source of truth.

```bash
planx doctor
```

This validates stored plans and rebuilds the index. Stored files carry their own
format version so an incompatible CLI reports the problem instead of replacing
data.

Use `PLANX_DIR` or the global `--dir` flag to work with another store.
