# Configuration

`~/.planx/config.json`, seeded on first use.

```jsonc
{
  "format_version": 1,
  "enabled": true,
  "render": "rich",
  "agents": {
    "claude": {
      "cmd": "claude",
      "args": ["--permission-mode", "acceptEdits", "--model", "{model}", "{prompt}"],
      "models": ["opus", "sonnet", "haiku"],
      "model_switch": "/model {model}",
      "skills_dir": ".claude/skills"
    }
  }
}
```

## Settable keys

```bash
planx config get                    # the whole document
planx config get render
planx config set render plain
```

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` | `planx off` sets this false. Write commands then print a notice and exit 0, so the skills degrade quietly instead of erroring. |
| `render` | `rich` \| `plain` | `"rich"` | Default rendering for `diff` and `show`. |

Agent definitions are edited in `config.json` directly. There is no
`planx config set agents.claude.args[2]` — a flag syntax for nested argv arrays
would be worse than a text editor.

## Agent entries

| Field | Meaning |
| --- | --- |
| `cmd` | The executable. Must be on `PATH`. |
| `args` | argv template. See the placeholder table in [Executing](/guide/executing). |
| `models` | Offered in the model picker. Never validated against a provider — planx passes through what you configure. |
| `model_switch` | The line printed for you to paste when executing in the same window. |
| `skills_dir` | Where `planx install` writes skills, relative to `$HOME`. Empty means this agent gets none. |

## Environment

| Variable | Effect |
| --- | --- |
| `PLANX_DIR` | Use a different store. `--dir` takes precedence. |
| `PLANX_NO_POSTINSTALL` | Skip the postinstall step entirely. |
| `PLANX_DEBUG` | Print stack traces on error. |
| `NO_COLOR` | Disable ANSI colour, per [no-color.org](https://no-color.org). |
| `FORCE_COLOR` | Force colour on when not a TTY. |

## Turning planx off

```bash
planx off      # skills degrade quietly; nothing is deleted
planx on
planx status
```

`status`, `config`, `install`, `uninstall` and `doctor` keep working while
disabled — otherwise you could never turn it back on.
