---
name: planx
description: Plan something as a reviewable artifact the user annotates, or revise, execute or diff a plan they already have. Use for /planx and anything mentioning planx.
argument-hint: <task> | revise <id> | execute <id> | diff <id>
---

# planx

Turn a plan into an artifact the user reviews line by line, then build what
they approved.

## Pick the branch

Match on what followed `/planx`:

| the user said | do this |
| --- | --- |
| `/planx` alone | say you are ready, and ask what to plan |
| `/planx revise <id>` | read `references/revise.md` |
| `/planx execute <id>` | read `references/execute.md` |
| `/planx diff <id>` | read `references/diff.md` |
| `/planx <anything else>` | clarify, check, research, plan, capture |

Read only the file for the branch you took.

Bare `/planx` does not print a menu of the branches. The `argument-hint` in the
front matter already showed them, in the slash menu, before enter was pressed —
repeating them after is a wall of text in answer to someone who is ready to
talk about their task.

If `planx` is not installed, say so and stop. Do not fall back to writing the
plan into chat: the user asked for something they can annotate.

---

# Planning

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

## 1. Clarify, then check

Two steps before any research, both mandatory, both ending in a wait.

**First, ask what is ambiguous.** Scope, approach, the trade-offs that decide
what actually gets built. Use the question tool, and wait for the answers.

**Then ask, in the chat:**

> Anything else before I write it?

and wait again.

The second question is the one that catches what the first did not think to ask
about. Skipping it is how a plan arrives missing a requirement the user assumed
was obvious — and a missing requirement costs a whole review round, because the
only way to tell you about it is to annotate a plan built without it.

## 2. Research and write it

Now do the actual work: read the code, understand the problem, make the
decisions. Write the plan as markdown with an H1 title and `##` sections. The
`##` sections matter — they are the unit the user locks, and the unit you will
later collapse to save tokens.

If the user already has an approved plan and is asking for a different one, this
is a new plan. Do not revise the old one.

## 3. Capture it

```bash
planx capture --stdin --source claude <<'PLAN'
# <title>

## Context
...
PLAN
```

This prints the plan id and version. Keep both. If the user named the plan, add
`--name "<their name>"`.

The heredoc is the point: the plan goes in on stdin and never touches a temp
file on its way. Do not write it out and pass `--file` — that is a hand-off
buffer, read once and never referenced again, and it leaves a copy of the plan
somewhere nothing is going to clean up.

## 4. Hand it over, then stop

One line, verbatim, with no preamble and nothing after it:

> Plan created. Open `planx <plan-id> v<n>` in new tab.

**Then stop and end your turn.** Nothing blocks and nothing polls. They review
it, and the reviewer prints a command they paste back to you — usually
`/planx revise <plan-id>`. That is what starts the next round.

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

**`## Out of scope` may only list what the user declined.** Anything there
because *you* decided to leave it out is proof of a question you skipped.

## What a follow-up message means

Once a plan is captured, a further message is one of three things. Decide which,
and ask when it is not obvious:

- **a change to the plan on the table** → revise and capture a new version
- **a different piece of work** → ask whether to start a new plan
- **an instruction to build it** → ask whether to execute the plan as it stands

Never silently start a second plan, and never silently start implementing.

## Rules

- One `capture` per revision. Capturing identical content is a safe no-op, so
  you may call it defensively.
- Never edit files under `~/.planx` yourself. Every change goes through the CLI.
- Never work around a lock. Editing the store to defeat one is a serious breach
  of the user's trust.
