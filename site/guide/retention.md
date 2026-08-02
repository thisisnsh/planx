# Retention

Plans are kept **forever** by default. Nothing expires, nothing is pruned
automatically, and there is no background GC. They are a few kilobytes each.

Cleanup is an explicit action:

```bash
planx clean                          # interactive multi-select over all plans
planx clean --older-than 90d
planx clean --unapproved             # never reached approve
planx clean --versions-beyond 5      # trim history, keep the plan and its latest
planx clean --id <id> [--purge]
planx clean --empty-trash [--older-than 30d]
```

Bare `planx clean` opens a picker showing every plan with its title, age,
version count and approved badge: `space` to mark, `x` to mark everything
matching the current filter, `enter` to confirm.

Filter forms print the full list of what they would remove and ask for
confirmation. `--yes` skips the prompt, for scripts. Outside a terminal, a
destructive command without `--yes` refuses rather than guessing.

## Deletion is soft by default

Removed plans move to `~/.planx/.trash/<id>/` with a deletion timestamp:

```bash
planx restore <id>
```

`--purge` deletes for real. The trash is never emptied automatically —
`planx clean --empty-trash` does it, and only when asked.

Losing a plan you spent an hour reviewing to an off-by-one in a date filter is
the one unrecoverable failure in this system, so it takes two deliberate steps.

## Trimming history

`--versions-beyond N` keeps the newest N versions of each matching plan and
deletes the older `vN.md` files, leaving the plan itself alone.

It **never** removes a version a lock still points at. Splice reads its source
text out of stored versions, so trimming one a lock references would break the
marker path — that is treated as a constraint, not a preference. The latest
version is never removed either.

## Durations

`--older-than` and `--since` take `90d`, `36h`, `2w`, `6mo`, `1y`, `30m`, `45s`.
They compare against a plan's **last update**, not when it was created.
