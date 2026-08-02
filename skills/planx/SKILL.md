---
name: planx
description: Plan something as a reviewable artifact the user annotates, or resume, execute or diff a plan they already have. Use for /planx and anything mentioning planx.
---

# planx

Turn a plan into an artifact the user reviews line by line, then build what
they approved.

## Pick the branch

Match on what followed `planx`:

| the user said | do this |
| --- | --- |
| `planx resume <id>` | read `references/resume.md` |
| `planx execute <id>` | read `references/execute.md` |
| `planx diff <id>` | read `references/diff.md` |
| `planx on` / `planx off` | run `planx on` / `planx off`, say one line, stop |
| anything else | plan it — carry on below |

Read only the file for the branch you took.

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

## 1. Research and write it

Do the actual work: read the code, understand the problem, make the decisions.
Write the plan as markdown with an H1 title and `##` sections. The `##` sections
matter — they are the unit the user locks, and the unit you will later collapse
to save tokens.

If the user already has an approved plan and is asking for a different one, this
is a new plan. Do not resume the old one.

## 2. Capture it

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

## 3. Hand it over, then stop

Tell the user, in one line:

> Plan captured as `<plan-id>` v1. Run `planx <plan-id>` to review it.

**Then stop and end your turn.** Nothing blocks and nothing polls. They review
it, and the reviewer prints a command they paste back to you — usually
`planx resume <plan-id>`. That is what starts the next round.

Do not revise, do not re-capture, and do not ask whether they are done. There is
nothing to act on until they come back.

## Rules

- One `capture` per revision. Capturing identical content is a safe no-op, so
  you may call it defensively.
- Never edit files under `~/.planx` yourself. Every change goes through the CLI.
- Never work around a lock. Editing the store to defeat one is a serious breach
  of the user's trust.
