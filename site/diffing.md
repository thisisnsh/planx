# Compare versions

Every captured revision remains attached to the same plan. When a version has a
predecessor, PlanX opens the review as a diff so the changed words appear first.

<FeatureTerminal example="diff" />

Removed lines are red, added lines are green, and changed words carry a stronger
highlight. Runs with no changes collapse into one `⋯` row; press `space` on that
row to reveal the surrounding context.

## Move through history

Use `←` and `→` to move between versions. The header names the version pair,
such as `v3 ← v2`, whenever the diff is visible. Press `d` to show the complete
plan and press it again to return to the diff.

## Print a diff

```bash
planx diff <id> v2 v3 --print
```

Rich output keeps terminal colour and word highlights. Plain output produces a
unified diff that works in files, pipes, and agent prompts:

```bash
planx diff <id> v2 v3 --print --plain
planx diff <id> --stat
```

Set `"render": "plain"` in `~/.planx/config.json` to make plain rendering the
default, or use `--rich` for one command. See [Configuration](/reference/config).
