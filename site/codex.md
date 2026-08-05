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

Leave a comment, press `s`, and paste the line it prints back into Codex:

<PlanxSim scenario="agents" :rows="14" />

## Executing

planx does not launch Codex for you. Approving a plan prints one command to
paste into whichever session you want to build it in — see
[Executing](/executing).
