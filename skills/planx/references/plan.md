# planx planning

Create a reviewable plan, capture it once, then stop.

## Leave plan mode

If this session is in plan mode, leave it immediately. Its accept/reject gate
is incompatible with creating a planx artifact. Give it only this one-line
stub, not the plan:

> switching to planx mode — the plan will be written to planx for review

If there is no tool for leaving plan mode, print the following and stop until
the user answers:

> press shift+tab to leave plan mode, then say "go"

## Clarify once

Before research, ask every material scope, approach, and trade-off question in
one interaction. End that same interaction with:

> Anything else before I write it?

Then wait once. If nothing material is ambiguous, ask only that catch-all and
wait once. Use a structured question tool when it improves concrete choices;
otherwise ask in chat. Do not make a separate call just to use a tool.

The user owns scope. If a boundary or decision is unsettled, ask instead of
putting an assumption, an out-of-scope section, or an answer in the plan.
During research, batch genuinely new decisions into one additional interaction
before capture. Answer review questions in chat; a plan contains only work.

## Research and write

Search relevant files and symbols first, read narrow ranges, batch independent
reads when supported, and reuse facts already in context. Stop when the
implementation decisions and verification path are supported. Do not repeat
repository-wide discovery after finding the relevant surface.

Write compact, self-contained Markdown for a fresh execution agent. Use an H1
title and `##` sections. Include concrete behavior, affected files or symbols,
compatibility constraints, and verification. Omit research transcripts,
review-question answers, rejected alternatives, and repeated explanations. A
request for a different plan creates a new plan, not a revision of an old one.

Before capture, hard-wrap the generated plan Markdown to at most 80 physical
characters per line. This applies to the captured plan only, not conversation
in chat. Preserve indentation, headings, fences, and list structure. Prefer
vertical lists to wide tables. Split commands or code only where syntax stays
valid; replace an unnecessary long literal with a short label or reference.
Do not mirror the plan into another planning artifact or a temporary file.

## Capture

Capture through stdin using the current agent and session identity. Use the
matching source and variable:

| agent | source | session variable |
| --- | --- | --- |
| Claude Code | `claude` | `$CLAUDE_CODE_SESSION_ID` |
| Codex | `codex` | `$CODEX_THREAD_ID` |

For example, for Claude Code:

```bash
planx capture --stdin --source claude \
  --session-id "$CLAUDE_CODE_SESSION_ID" <<'PLAN'
# <title>

## Context
...
PLAN
```

Add `--name "<their name>"` if the user named the plan. Keep the printed plan
id and version. Never edit files under `~/.planx`; use the CLI.

## Hand off and stop

If the user declined something, say so in one short chat line. Then print this
verbatim, with nothing after it:

> Plan created. Open `planx <plan-id> v<n>` in new tab.

End the turn. Do not poll, revise, recapture, or ask if review is done.

After capture, classify a follow-up before acting: revise the current plan,
start a different plan, or execute the reviewed plan. Ask when it is unclear.
Never silently create another plan or begin implementation.
