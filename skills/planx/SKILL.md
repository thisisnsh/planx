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

Match what followed `/planx`:

| the user said | do this |
| --- | --- |
| `/planx` alone | say you are ready, and ask what to plan |
| `/planx revise <id>` | read `references/revise.md` |
| `/planx execute <id>` | read `references/execute.md` |
| `/planx <anything else>` | read `references/plan.md` |

For a non-bare command, read only the one reference named by its row.

Bare `/planx` does not print a menu. The slash command already showed its
argument hint before enter was pressed.

If `planx` is not installed, say so and stop. Do not put a fallback plan in
chat; the user asked for an artifact they can annotate.
