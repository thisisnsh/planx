---
name: planx-diff
description: Show the diff between two versions of a planx plan, inline, with no commentary. Use when the user types /planx-diff or asks what changed between versions of a plan.
---

# planx-diff

Return the diff between two versions of a plan. **Diff only. No commentary.**

```bash
planx diff <plan-id> [vA] [vB] --print --plain
```

`--print` keeps it non-interactive and `--plain` gives raw unified diff — you
want the text, and ANSI colour is noise in your context.

Version refs accepted anywhere: `v2`, `2`, `latest`, `prev`, `~1`, or a sha
prefix. With no versions given it diffs the latest against the one before it.

If the user did not name a plan, run `planx list --json` and pick the one they
mean from the titles. If it is genuinely ambiguous, ask — do not guess.

Print the diff. Do not explain it, do not summarise what changed, and do not
offer an opinion on it unless the user asks a follow-up question.
