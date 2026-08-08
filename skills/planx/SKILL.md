---
name: planx
description: >-
  Plan something as a reviewable artifact the user annotates, or revise or
  execute a plan they already have. Use for /planx and anything mentioning
  planx.
argument-hint: <task> | revise <id> | execute <id>
---

# planx

Turn a plan into an artifact the user reviews line by line, then build what
they settled on.

## Pick the branch

Match on what followed `/planx`:

| the user said | do this |
| --- | --- |
| `/planx` alone | say you are ready, and ask what to plan |
| `/planx revise <id>` | read `references/revise.md` |
| `/planx execute <id>` | read `references/execute.md` |
| `/planx <anything else>` | read `references/plan.md` |

Read only the file for the branch you took.

Bare `/planx` does not print a menu of the branches. The `argument-hint` in the
front matter already showed them, in the slash menu, before enter was pressed —
repeating them after is a wall of text in answer to someone who is ready to
talk about their task.

If `planx` is not installed, say so and stop. Do not fall back to writing the
plan into chat: the user asked for something they can annotate.

## True on every branch

These three hold whichever file you read next, so they are here rather than in
one of them. Each guards a mistake that is live while planning, while revising
and while executing alike.

**Never edit files under `~/.planx` yourself.** Every change goes through the
CLI. `index.json` is a cache that the list and the picker read instead of
opening every plan, so a file changed behind it leaves the two disagreeing about
what is stored, and nothing but `planx doctor` will ever put that right.

**One capture per revision.** Capturing content identical to the current latest
is a safe no-op that hands back the existing version, so you may call it
defensively — but two captures of two different texts are two versions, and the
user now has a review round to spend working out which one they are reading.

**A follow-up message is one of three things.** Once a plan is captured, decide
which it is, and ask when it is not obvious:

- **a change to the plan on the table** → revise and capture a new version
- **a different piece of work** → ask whether to start a new plan
- **an instruction to build it** → ask whether to execute the plan as it stands

Never silently start a second plan, and never silently start implementing.
