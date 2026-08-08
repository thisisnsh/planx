<div align="center">

# PlanX

**Review an agent's plan like code.**

Attach feedback to exact lines, compare every revision, and execute the version
you approve.

[![npm](https://img.shields.io/npm/v/@thisisnsh/planx?color=ffd400&labelColor=0b0b0c)](https://www.npmjs.com/package/@thisisnsh/planx)
[![ci](https://img.shields.io/github/actions/workflow/status/thisisnsh/planx/ci.yml?branch=main&labelColor=0b0b0c)](https://github.com/thisisnsh/planx/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-ffd400?labelColor=0b0b0c)](LICENSE)

<img src="https://raw.githubusercontent.com/thisisnsh/planx/main/assets/planx-review.png" alt="PlanX terminal review with selected plan lines and feedback attached to their shared rail" width="880">

</div>

```bash
npm install -g @thisisnsh/planx
```

Then type `/planx` in Codex or Claude Code.

## What you get

- **Feedback on exact lines.** Select one line or a range and attach feedback to
  that text, so the agent never has to guess which passage you mean.
- **A diff for every revision.** Keep the full version history and see changes
  as a readable word-level diff.
- **Context that survives revision.** Send the review back to the agent that
  wrote the plan and keep the reasoning behind it.
- **Direct edits and whole-plan notes.** Rewrite a line when that is faster, or
  leave one note that applies to the entire plan.
- **Long plans that stay readable.** Collapse sections and unchanged runs until
  only the decisions in front of you remain.
- **Execution from the settled version.** Hand the reviewed plan to an agent to
  build when the review is complete.

## Review, revise, execute

1. `/planx <task>` creates a versioned plan.
2. `planx` opens it for line-level review.
3. `/planx revise <id>` applies feedback; `/planx execute <id> v<n>` builds the
   settled version.

## Complete guide

Installation, review, diffing, agent setup, execution, and reference material
live at **[planx.sh](https://planx.sh)**.

[GitHub](https://github.com/thisisnsh/planx) ·
[Contributing](CONTRIBUTING.md) ·
[MIT License](LICENSE)
