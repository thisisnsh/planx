# Configuration

PlanX reads `~/.planx/config.json`. It contains one user setting:

```jsonc
{
  "format_version": 1,
  "render": "rich"
}
```

| Key | Values | Default | Purpose |
| --- | --- | --- | --- |
| `render` | `rich`, `plain` | `rich` | Default output for `diff` and `show` |

`--plain` and `--rich` override the setting for one command.

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
