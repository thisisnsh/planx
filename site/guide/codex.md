# Codex

Codex is not a second-class citizen. The skills are the same files, the CLI is
the same CLI, and the protocol is identical — planx talks to both through a
blocking subprocess and a directory, so neither is privileged.

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
planx diff <plan-id>
```

## Backfilling old plans

Codex has no plan files. It emits `update_plan` function calls carrying a
structured step list, recorded in
`~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`.

The adapter takes the **last** `update_plan` per session — the final state of
the checklist — plus the agent prose around it, and normalizes that to a
markdown checklist:

```markdown
# Optimise the PiP scroll path

Tracing how update() drives layout before proposing a fix.

## Plan

- [x] Refactor the content view
- [ ] Update the render cadence _(in progress)_
- [ ] Run a verification build
```

```bash
planx import --from codex --all
planx import --from codex --since 7d
```

The parser is deliberately tolerant. These are Codex's private logs: they can
change shape without warning, and an import that skips a record it does not
recognise is far better than one that throws halfway through a backfill.

## Executing

```jsonc
// ~/.planx/config.json
{
  "agents": {
    "codex": {
      "cmd": "codex",
      "args": ["exec", "-m", "{model}", "{prompt}"],
      "models": ["gpt-5.6-terra", "gpt-5.6"]
    }
  }
}
```

```bash
planx execute <plan-id> --agent codex --model gpt-5.6
```

Edit `models` to match what your account actually has. planx never validates
model names against a provider — it passes through what you configure.
