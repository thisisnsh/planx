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
| `S` | Submit everything at once |
| `A` | Approve — seals the plan |
| `?` | Full key list |

Claude picks the feedback up wherever it is in the loop and revises.

## The 600-second cap

Claude Code caps a single Bash call at 600 seconds, and you will often take
longer than that to review a plan properly. `planx await` handles this by
returning a resumable message rather than dying:

```
PLANX: no feedback yet (waited 480s) — run the same command again to keep waiting
```

The skill instructs Claude to re-run the identical command. All state is on
disk, so re-running costs nothing and no feedback can be missed in the gap. You
will see this happen and it is not an error.

## When Claude hits a lock

If Claude tries to modify a locked block, `capture` exits non-zero and nothing
is written. The skill tells it to either fix its output — usually by using the
`[[planx:keep L2]]` marker instead of retyping the block — or to ask:

```bash
planx unlock-request <plan-id> L2 --reason "the flag adds no value here"
```

That blocks, and your TUI shows a banner with its reason and the proposed
replacement. Press `y` to grant a single-use unlock or `n` to refuse.

## After approval

Approving seals the plan and planx asks where to execute it.

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
