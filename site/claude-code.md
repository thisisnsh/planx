# Claude Code

## Start

```
/planx add rate limiting to the upload endpoint
```

Claude researches, writes the plan, captures it, prints the id, and stops. Its
turn is over — nothing is waiting on a queue, and nothing is polling.

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
planx <plan-id>
```

Press `v` to start a selection, extend it with the arrows, and then:

| Key | What it does |
| --- | --- |
| `f` | Feedback on the selection — or edit the note under the cursor |
| `e` | Rewrite the line yourself, in place |
| `n` | A note about the whole plan |
| `d` `←` `→` | The diff against the previous version, and the history |
| `s` | Submit everything at once |
| `a` | Approve — marks the version settled |
| `?` | Every key |

<PlanxSim scenario="agents" :rows="14" />

`s` prints one line to paste back into the Claude Code session. Claude picks the
feedback up wherever it is in the loop and revises.

## Nothing blocks, so nothing has to be resumed

Claude Code caps a single Bash call at 600 seconds, and you will often take
longer than that to review a plan properly. planx used to work around that by
blocking in slices and having Claude re-run the command — which is why you would
see `PLANX: no feedback yet (waited 480s)` scroll past.

That is gone. Claude captures the plan, tells you to run `planx`, and ends its
turn. You review whenever you like. The reviewer prints the command to hand
back, and pasting it starts the next round with the session's context intact.

## After approval

Approving prints one command to paste back — no questions about agents or
models. planx cannot switch a running session's model and no agent CLI lets it,
so it prints the command and you run it wherever you like. See
[Executing](/executing).
