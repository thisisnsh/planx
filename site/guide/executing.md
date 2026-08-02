# Executing

`planx execute` means two different things depending on where it runs, and both
are correct.

## From a terminal — spawn a fresh agent

```bash
planx execute <id> v3 --agent claude --model opus
planx execute                    # picker: plan → version → agent → model → confirm
planx execute <id> --dry-run     # print the exact argv and stop
```

The argv is always printed before anything runs. A command that spawns another
agent with permissions attached should never be a surprise.

## From inside an agent — no nested process

The `/planx-execute` skill runs `planx show <id> <version>`, drops the plan into
the current context, and executes directly.

Spawning a subprocess agent from inside an agent loses the context it already
has, the permissions it was granted, and your ability to intervene. So the skill
does not do it.

## The model-switch caveat

Read this one.

For a **new window** this is trivial and fully automatic:
`claude --model <m>` / `codex exec -m <m>`.

For the **same window** it is not. Neither Claude Code nor Codex exposes a way
for a running agent to change its own model — `/model` is a user-typed slash
command, `settings.json` is read at session start, and `ANTHROPIC_MODEL` only
affects new processes.

So planx prints the exact line for you to paste, and the skill waits:

```
✓ Approved & sealed — guard-clock-regression-a3f9 v3 (6 sections locked)

  Execute here with a different model? Paste this, then say "go":
      /model opus

  Or execute in a new window (model applied automatically):
      planx execute guard-clock-regression-a3f9 v3 --agent claude --model opus
```

One paste, or zero if you are happy with the current model. Better to surface
that honestly than ship something that quietly does not switch.

## Adding an agent

A config entry, not a code change.

```jsonc
// ~/.planx/config.json
{
  "defaultAgent": "claude",
  "agents": {
    "claude": {
      "cmd": "claude",
      "args": ["--permission-mode", "acceptEdits", "--model", "{model}", "{prompt}"],
      "models": ["opus", "sonnet", "haiku"]
    },
    "codex": {
      "cmd": "codex",
      "args": ["exec", "-m", "{model}", "{prompt}"],
      "models": ["gpt-5.6-terra", "gpt-5.6"]
    },
    "aider": { "cmd": "aider", "args": ["--message-file", "{prompt_file}"] }
  }
}
```

| Placeholder | Substituted with |
| --- | --- |
| `{prompt}` | The full prompt: a header naming the plan, then the plan text |
| `{prompt_file}` | Path to a temp file containing that prompt |
| `{plan_path}` | Path to the stored `vN.md` |
| `{plan_id}` | The plan id |
| `{version}` | The version number |
| `{model}` | The chosen model |
| `{cwd}` | The directory the plan was captured in |

If no model is chosen, the `{model}` placeholder **and the flag introducing it**
are both dropped, so `--model ""` never reaches the agent.

## The prompt header

Every execution prompt is prefixed with a header naming the plan id and version:

```
You are executing planx plan guard-clock-a3f9 v3, which has been reviewed and
approved. Implement it as written. If something in it turns out to be wrong,
stop and say so rather than quietly doing something else.
```

So an execution transcript always traces back to the artifact that produced it.
