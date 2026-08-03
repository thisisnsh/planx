# Configuration

`~/.planx/config.json`, seeded on first use. There is one key.

```jsonc
{
  "format_version": 1,
  "render": "rich"
}
```

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `render` | `rich` \| `plain` | `"rich"` | Default rendering for `diff` and `show`. `--plain` and `--rich` override it per command. |

There is no `planx config` command. One key in a two-line file is a text editor's
job, and a command to set it would be a bigger surface than the thing it sets.

## What used to be here

- **`mouse`**, which turned on wheel scrolling in the review at the cost of the
  terminal's own click-and-drag text selection. Wheel scrolling is gone: an
  append-only render cannot host a moving cursor, boxes that grow as you type,
  or folds, so there was nothing on the other side of the trade.
- **`agents`**, an argv registry that existed so planx could spawn an agent for
  you. It does not: it prints a command and you run it where you already are.

## Environment

| Variable | Effect |
| --- | --- |
| `PLANX_DIR` | Use a different store. `--dir` takes precedence. |
| `PLANX_NO_POSTINSTALL` | Skip the postinstall step entirely. |
| `PLANX_DEBUG` | Print stack traces on error. |
| `NO_COLOR` | Disable ANSI colour, per [no-color.org](https://no-color.org). |
| `FORCE_COLOR` | Force colour on when not a TTY. |
