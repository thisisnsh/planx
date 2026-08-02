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
| *(default)* | **Rich** — highlighted code fences, bold headings, word-level intra-line diff, collapsed runs of unchanged lines, `⚿` lock gutter |
| `--plain` | **Plain** — raw source as a real unified diff with `@@` hunk headers, no ANSI beyond `+`/`-` colouring |

Rendering mode is independent of interactivity: `--plain` works in the TUI and
piped alike. Make it permanent with:

```bash
planx config set render plain
```

`NO_COLOR` is honoured, as is `--no-color`.

Plain mode emits a genuine unified diff rather than a prettier bespoke format.
`planx diff` pipes this straight into an agent's context, and an agent already
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
| `↑` `↓` | Move the cursor |
| `v` | Start or end a selection, then `↑` `↓` to extend |
| `space` | Fold the note, or expand the collapsed run, under the cursor |
| `f` | Feedback on the selection, or edit the note under the cursor |
| `l` | Lock or unlock the selection — written immediately |
| `d` | Delete the note under the cursor |
| `h` | Fold or unfold every note at once |
| `n` | A note about the whole plan |
| `s` | Submit everything at once |
| `a` | Approve — seals the plan |
| `x` | Leave without submitting |
| `?` | Help |

The hints along the bottom offer only what the row under the cursor can do, so
`s` and `a` are never both on screen: `a` while you have nothing to say, `s`
once you do. A locked passage offers `l unlock` and no `f` at all — see
[Locking](/guide/locking).

All lowercase, and there is no `c`: it sits next to `ctrl-c`, which is how you
leave a terminal program.

### Notes live in the document

Pressing `f` opens a box directly under the lines it refers to, and you type
into it there rather than into a dialog over the top. The box is closed on all
four sides and grows as you type, so what you have written is always the whole
of what is in it.

`space` folds the note under the cursor down to a single row that still carries
its opening words, and `h` folds every note at once — the plan comes back
readable without losing track of which passages you have been through.

One note per passage: pressing `f` on lines that already carry one edits it
rather than stacking a second note on the same text.

