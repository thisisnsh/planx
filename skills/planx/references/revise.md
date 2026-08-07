# planx revise

Revise the reviewed plan incrementally, capture one version, then stop.

## Read feedback once

```bash
planx revise <plan-id>
```

Run it once. It supplies comments, reviewer edits, carried feedback, review
status, and the exact parent capture command. Retain the plan already in this
continuing session. Only if compaction or missing context removed it, run:

```bash
planx show <plan-id> --plain
```

If the output says **no review yet**, stop and tell the user; there is nothing
to revise. If it says **reviewed with nothing to change**, do not capture a new
version. Report the id and version. If they asked to build it, follow
`references/execute.md`.

## Revise

Address every request, including carried feedback. Preserve reviewer-edited
lines exactly. Answer questions in chat, not in the plan. If a request leaves
a decision or scope boundary unsettled, batch the questions and ask before
capture; never invent a boundary or add an out-of-scope section.

Reuse the initial research. Inspect code again only when new feedback introduces
an unresolved fact. Keep the plan compact and self-contained.

Before capture, hard-wrap the generated plan Markdown to at most 80 physical
characters per line. This applies to the captured plan only, not conversation
in chat. Preserve reviewer-edited text in place exactly while wrapping the
surrounding agent-written plan. Preserve indentation, headings, fences, and
list structure. Prefer vertical lists to wide tables, and split code only where
its syntax remains valid.

## Capture once

Run the exact `planx capture --plan-id <plan-id> --parent v<n> --stdin` command
printed by `planx revise`. Keep `--stdin` and add the current agent identity:

| agent | capture identity |
| --- | --- |
| Claude Code | `--source claude --session-id "$CLAUDE_CODE_SESSION_ID"` |
| Codex | `--source codex --session-id "$CODEX_THREAD_ID"` |

Supply the revised plan with a heredoc, without a temporary file. Executing a
plan never captures a revision.

## Hand off and stop

If the user declined something, say so in one short chat line. Then print this
verbatim, with nothing after it:

> Plan created. Open `planx <plan-id> v<n>` in new tab.

End the turn. Do not poll or continue into implementation.
