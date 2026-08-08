---
title: PlanX
titleTemplate: false
description: Review an agent's plan with feedback on exact lines and a diff for every revision.
---

# PlanX

<div class="pnx-lede">

**Review an agent's plan like code.** Attach feedback to exact lines, see what
changes in every revision, and execute the version you approve.

</div>

```bash
npm install -g @thisisnsh/planx
```

Type `/planx` in Codex or Claude Code to create your first reviewable plan.

## Feedback on exact lines

Select one line or a whole range and attach feedback to that text. A shared rail
keeps the comment visibly connected to every line it covers.

<FeatureTerminal example="feedback" />

## A diff for every revision

Every revision stays available. PlanX shows removed and added words together
and collapses unchanged context so the decision is easy to find.

<FeatureTerminal example="diff" />

## Context that survives revision

Walk from the first proposal to the settled version without losing the plan or
the review that shaped it. Send feedback back to the agent session that already
understands the work.

<FeatureTerminal example="versions" />

## Direct edits and whole-plan notes

Rewrite a line directly when the replacement is obvious. Add one note when the
instruction applies to the plan as a whole.

<FeatureTerminal example="editing" />

## Long plans that stay readable

Collapse a section you have already read or an unchanged run in a diff. The
hidden row always says what it contains and expands in place.

<FeatureTerminal example="readability" />

## Execute the settled version

Submit feedback for another revision, or hand a reviewed version to an agent to
build. The plan ID and version travel with the command.

<FeatureTerminal example="handoff" />

## Start the loop

1. **Install.** Run `npm install -g @thisisnsh/planx` and start a new agent
   session.
2. **Review.** Type `/planx <task>`, then open `planx` in a terminal and comment
   on exact lines.
3. **Revise.** Run the `/planx revise <id>` hand-off until the plan is settled,
   then choose execution.

Use PlanX with [Codex](/codex) or [Claude Code](/claude-code). Continue with the
[review guide](/review-loop), [version comparison](/diffing), or
[execution guide](/executing).
