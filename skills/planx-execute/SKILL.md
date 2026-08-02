---
name: planx-execute
description: Load a stored planx plan version into this session and execute it. Use when the user types /planx-execute, or asks to build/implement/run a plan they have already approved.
---

# planx-execute

Load a stored plan and implement it **in this session**.

## Load it

```bash
planx show <plan-id> [version] --plain
```

Defaults to the latest version. If the user did not name a plan, run
`planx list --approved --json` and pick from the titles; if it is ambiguous,
ask.

Prefer the approved version. If the plan has never been approved, say so in one
line and ask whether to proceed anyway — an unreviewed plan is exactly what
planx exists to prevent from being executed by accident.

## Execute it

Implement the plan as written, in this session. Do **not** spawn a nested agent
process. `planx execute` from a terminal spawns a fresh agent; called from
inside one it would lose the context you already have, the permissions you were
granted, and the user's ability to intervene.

If something in the plan turns out to be wrong once you are in the code, stop
and say so rather than quietly doing something else. The plan was reviewed and
approved — a change to it is the user's decision, not yours.

## Do not edit the plan

Executing a plan does not revise it. If it needs changing, that is a `/planx`
round: the plan is likely sealed, and every section of it locked, so a change
has to go through the review loop.
