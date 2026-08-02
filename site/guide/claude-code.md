# Claude Code

## Start

```
/planx add rate limiting to the upload endpoint
```

Claude researches, writes the plan, captures it, prints the id, and blocks.

::: tip If you were already in plan mode
The skill calls `ExitPlanMode` immediately with a one-line stub — not with a
plan — and asks you to accept it. That is deliberate: plan mode's accept/reject
gate is incompatible with a review loop, because the plan does not exist as an
artifact until `ExitPlanMode` is accepted, and accepting it ends the planning
phase. One keypress buys you one flow instead of two half-flows.
:::

## Review

In a second terminal tab:

```bash
planx diff <plan-id>
```

Drag to select lines, or press `V` and move with `j`/`k`. Then:

| Key | What it does |
| --- | --- |
| `c` | Comment on the selection |
| `l` | Lock the selection |
| `u` | Unlock (splits a lock if partial) |
| `n` | A general note about the whole plan |
| `s` | Submit everything at once |
| `a` | Approve — seals the plan |
| `?` | Full key list |

Claude picks the feedback up wherever it is in the loop and revises.

## Nothing blocks, so nothing has to be resumed

Claude Code caps a single Bash call at 600 seconds, and you will often take
longer than that to review a plan properly. planx used to work around that by
blocking in slices and having Claude re-run the command — which is why you would
see `PLANX: no feedback yet (waited 480s)` scroll past.

That is gone. Claude captures the plan, tells you to run `planx`, and ends its
turn. You review whenever you like. The reviewer prints the command to hand
back, and pasting it starts the next round with the session's context intact.

## When Claude hits a lock

If Claude tries to modify a locked block, `capture` exits non-zero and nothing
is written. The skill tells it to either fix its output — usually by using the
`[[planx:keep L2]]` marker instead of retyping the block — or to ask:

It has to ask you in chat first — what the block says, what it wants instead,
and why. Only once you agree does it run:

```bash
planx unlock <plan-id> L2 --reason "the flag adds no value here"
```

That grants exactly one capture and records the reason, which is what makes the
decision reviewable later in `planx locks`.

## After approval

Approving seals the plan and prints one command to paste back — no questions
about agents or models.

**New window** applies your model choice automatically. **Same window** cannot:
no agent CLI lets a running session change its own model, so planx prints the
exact `/model opus` line for you to paste, then Claude continues. One paste, or
zero if you are happy with the current model. See
[Executing](/guide/executing).

## Backfilling old plans

Claude Code writes plans to `~/.claude/plans/*.md`. To bring them in:

```bash
planx import --from claude --all
planx import --from claude --since 7d
```

Explicit and user-run. Nothing watches that directory in the background.
