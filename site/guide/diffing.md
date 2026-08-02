# Diffing

```bash
planx diff <id>              # TUI: latest vs previous
planx diff <id> v1 v3        # TUI: an arbitrary pair
planx diff <id> --print      # non-interactive to stdout, exits
planx diff                   # picker: plan → version pair → TUI
planx diff <id> --stat       # just the summary line
```

Piping implies `--print`, so `planx diff <id> | less` does what you expect
without being told.

## Rich and plain

| Flag | Rendering |
| --- | --- |
| *(default)* | **Rich** — highlighted code fences, bold headings, word-level intra-line diff, collapsed runs of unchanged lines, 🔒 gutter |
| `--plain` | **Plain** — raw source as a real unified diff with `@@` hunk headers, no ANSI beyond `+`/`-` colouring |

Rendering mode is independent of interactivity: `--plain` works in the TUI and
piped alike. Make it permanent with:

```bash
planx config set render plain
```

`NO_COLOR` is honoured, as is `--no-color`.

Plain mode emits a genuine unified diff rather than a prettier bespoke format.
`/planx-diff` pipes this straight into an agent's context, and an agent already
knows how to read `@@ -42,6 +42,8 @@`.

## Highlighting never hides characters

The rich renderer dims markdown syntax rather than removing it: `**bold**` stays
`**bold**`, with the asterisks dimmed. This is a source view, and the line on
screen has to be the line in the file — because that is the line you are
selecting and the line the agent will be quoted.

## Collapsed runs

Long unchanged stretches collapse:

```
⋯ 23 unchanged lines (space to expand)
```

Press `space` with the cursor on the marker to expand it. A run only collapses
when it hides more lines than the marker costs, so you never trade three lines
for a keystroke.

## Version refs

Accepted anywhere a version is named:

| Ref | Means |
| --- | --- |
| `v2`, `2` | Version 2 |
| `latest` | The newest version (the default) |
| `prev` | One before latest |
| `~1`, `~3` | N before latest |
| `first` | The oldest stored version |
| `c41b8f` | A sha256 prefix, if unambiguous |

## In the TUI

| Key | Action |
| --- | --- |
| `j` `k` `↑` `↓` | Move the cursor |
| `ctrl-d` / `ctrl-u` | Half a page |
| `g` / `G` | Top / bottom |
| `V` | Start or end a line selection |
| drag | Select with the mouse — always whole lines |
| `m` | Toggle mouse capture |
| `space` | Expand the collapsed run under the cursor |
| `c` | Comment on the selection |
| `l` / `u` | Lock / unlock the selection |
| `d` | Delete the annotation under the cursor |
| `n` | General note about the whole plan |
| `S` | Submit everything at once |
| `A` / `R` | Approve (seals) / reject |
| `q` | Leave without submitting |
| `?` | Help |

### Why `m` exists

Mouse capture hijacks your terminal's own text selection, which is infuriating
if you just wanted to copy a line out. `m` turns capture off — and keyboard
visual mode (`V`) always works, which is why it is not optional.
