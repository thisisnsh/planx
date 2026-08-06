# Codex

Codex is not a second-class citizen. The skills are the same files, the CLI is
the same CLI, and the protocol is identical — planx talks to both through a
directory of JSON, so neither is privileged.

## Start

```
/planx add rate limiting to the upload endpoint
```

::: tip If Codex is in Plan Mode
Codex has no tool for leaving plan mode on its own, so the skill prints:

> press shift+tab to leave plan mode, then say "go"

Do that and the loop starts. (Under Claude Code the equivalent step is
automatic — one accepted `ExitPlanMode` stub.)
:::

## Review

Exactly as everywhere else, in a second terminal tab:

```bash
planx <plan-id>
```

Leave a comment, press `s`, and answer the prompt — `1` hands the work straight
back to the session that wrote the plan, `2` prints the line to paste yourself:

<PlanxSim scenario="agents" :rows="14" />

## Executing

planx launches Codex for you. `s` on a review that asked for something and `x`
on one that is ready to build both ask which way the command goes, and `1` runs
it:

```
codex fork 01J8XR… "/planx revise guard-clock-regression-a3f9"
codex "/planx execute guard-clock-regression-a3f9 v3"
```

Revising forks the thread rather than continuing it, so the tab you were
reviewing from is left alone. The flags the thread was started with are replayed
in front, because a fork restores the conversation and not the terminal it was
typed into — and the whole command is printed before it runs, so what it was
granted is on the scrollback.

For that to work, the capture has to have carried `--session-id
"$CODEX_THREAD_ID"`; the skill does it. Without one, planx prints the command
instead of asking — see [Executing](/executing).
