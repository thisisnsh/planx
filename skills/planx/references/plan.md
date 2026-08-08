# planx planning

Write the plan, capture it once, hand it over, and stop.

## 0. If this session is in plan mode, leave it first

Plan mode's accept/reject gate is incompatible with this loop: the plan does not
exist as an artifact until `ExitPlanMode` is accepted, and accepting it ends the
planning phase.

So if you are in plan mode, call `ExitPlanMode` **immediately**, with a one-line
stub and *not* with a plan:

> switching to planx mode — the plan will be written to planx for review

If you have no such tool, print this and stop until the user answers:

> press shift+tab to leave plan mode, then say "go"

Do not skip this. Do not write the plan into `ExitPlanMode`.

## 1. Clarify

Before any research, ask one batch of necessary clarifying questions about
scope, approach and the trade-offs that decide what actually gets built. Ask
only questions whose answers materially affect the plan. Use the question tool,
and wait for the answers.

## 2. Research and write it

Now do the actual work: read the code, understand the problem, make the
decisions. Write the plan as markdown with an H1 title.

**Use `##`, `###` and `####`, liberally, and nothing deeper.** Those three are
exactly what the review can fold: a `##` folds and takes its subsections with
it, a `####` folds on its own, and a `#####` does not fold at all. A plan of
long flat `##` sections is all-or-nothing to fold, in the one tool built for
folding it. The heading is also the label a comment comes back under, so a plan
divided finely enough comes back with feedback you can place.

**Hard-wrap the plan to 80 physical characters per line.** This applies to the
captured plan only, not conversation in chat: the review draws the plan in a
terminal, and a line that overruns is one the reader has to scroll sideways for.
Preserve indentation, headings, fences and list structure. Prefer vertical lists
to wide tables, and split a command or a code line only where its syntax stays
valid.

If the user already has a plan and is asking for a different one, this is a new
plan. Do not revise the old one.

## 3. Capture it

```bash
planx capture --stdin --source claude \
  --session-id "$CLAUDE_CODE_SESSION_ID" <<'PLAN'
# <title>

## Context
...
PLAN
```

This prints the plan id and version. Keep both. If the user named the plan, add
`--name "<their name>"`.

The session id is what lets the review start you again on the other side of it,
with everything you already know still in context. Pass whichever row is yours:

| agent | pass |
| --- | --- |
| Claude Code | `--source claude --session-id "$CLAUDE_CODE_SESSION_ID"` |
| Codex | `--source codex --session-id "$CODEX_THREAD_ID"` |
| neither variable is set | `--source <your agent>`, and no `--session-id` |

Whichever variable is set is the agent you are, and its value is the id.

**If neither is set, take the third row rather than the first.** `--agent`
defaults to `--source`, so borrowing `claude` files the plan under an agent that
is not you and can point a resume at the wrong binary. Naming yourself and
leaving `--session-id` off costs only this: the review cannot restart you, so it
hands the user a command to paste back instead. That is a normal way in.

The heredoc is the point: the plan goes in on stdin and never touches a temp
file on its way. Do not write it out and pass `--file` — that is a hand-off
buffer, read once and never referenced again, and it leaves a copy of the plan
somewhere nothing is going to clean up.

## 4. Hand it over, then stop

If the user declined something, say so here in one short line — in the chat, not
in the plan. Then, verbatim, with nothing after it:

> Plan created. Exit the agent, then run `planx <plan-id> v<n>`.

**Then stop and end your turn.** Nothing blocks and nothing polls. The user
exits the agent and runs that command. After they submit the review, PlanX
resumes this same agent conversation with everything already in context.

Do not revise, do not re-capture, and do not ask whether they are done. There is
nothing to act on until they come back.

## A question is answered where it was asked

When a review comment asks something — *what does `doctor` do?*, *why can't I
type two spaces?* — the answer goes in your **chat reply**, not into the plan.
And when revising turns up a decision the comments do not settle, ask in the
chat before capturing. Do not capture a version that guesses and then explains
the guess.

A plan is what will be built. An answer to a question is not part of what will
be built, so putting it there both bloats the plan and buries the reply where it
has to be read as a diff.

### A boundary you drew is a question you did not ask

Scope is the user's to set. If you are about to narrow, widen or split what
they asked for — anything you would write as *not in scope*, *I read X as Y*,
*assuming*, or any line the request did not draw — stop and ask. Batch every
such question into one call, and ask **before** capturing.

Stating the assumption in the plan and flagging it in chat is not asking. It
puts a decision the user never made into a document that says what will be
built, and the only way to undo it is a whole review round.

**A plan never contains an out-of-scope section.** The plan is what will be
built; a list of what will not be built is not part of it. Anything the user
declined goes in the **chat**, immediately before the hand-off line — see §4.

That is about where the answer is recorded. It is not a licence to decide the
boundary yourself and then mention it: the rule above still stands, and a
boundary you are about to draw is a question to ask before capturing.
