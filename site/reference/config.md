# Configuration

PlanX reads `~/.planx/config.json`. It contains the render mode and the
`defaults` block:

```jsonc
{
  "format_version": 1,
  "render": "rich",
  "defaults": {
    "revise_command": "codex exec --full-auto",
    "execute_command": null
  }
}
```

| Key | Values | Default | Purpose |
| --- | --- | --- | --- |
| `render` | `rich`, `plain` | `rich` | Default output for `diff` and `show` |
| `defaults.revise_command` | Any command | `null` | Your own command for the revise hand-off |
| `defaults.execute_command` | Any command | `null` | Your own command for the execute hand-off |

`--plain` and `--rich` override the render mode for one command. `null` means
not set, which is the seeded state and what clearing a value returns it to.

## Your own hand-off commands

Set either default and the review's hand-off list gains a row for it, above the
rows PlanX builds itself. PlanX takes the command you stored and appends the
skill invocation to it as one quoted argument:

```text
stored:  codex exec --full-auto
runs:    codex exec --full-auto "$planx revise upload-limits-a3f9"
```

The prompt is spelt `$planx` for a command that runs Codex and `/planx` for
everything else, because that is how each agent invokes a skill. PlanX reads the
agent out of the command you stored.

Set them from the screen, from flags, or from the review:

```bash
planx defaults                                  # the screen
planx defaults --revise "codex exec --full-auto"
planx defaults --execute ""                     # clear it
planx defaults --json                           # print the block
```

A flag never opens the screen, so a script or a dotfiles repo uses that form.
Rewriting a custom row in the hand-off list before running it also stores what
you typed, minus the prompt PlanX appended, as the new default — the way you
fixed a command once is the way it comes back next time.

Two things a reader otherwise learns by surprise:

- The command must be written so that a **trailing prompt** is the right thing
  to receive. `codex exec --full-auto` takes one; `codex exec --full-auto -` does
  not.
- The agent it names needs the **PlanX skill installed** for `/planx revise` to
  mean anything there. Run `planx add-skills` on the machine that agent runs on.

## Environment variables

| Variable | Effect |
| --- | --- |
| `PLANX_DIR` | Use another store; `--dir` takes precedence. |
| `PLANX_NO_POSTINSTALL` | Skip skill installation during npm install. |
| `PLANX_NO_UPDATE_CHECK` | Disable npm update checks. |
| `PLANX_DEBUG` | Include stack traces in errors. |
| `NO_COLOR` | Disable ANSI colour. |
| `FORCE_COLOR` | Enable colour outside a TTY. |

`~/.planx/update.json` is a cache of the latest npm version, not configuration.
PlanX refreshes it during background update checks.
