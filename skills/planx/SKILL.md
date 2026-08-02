---
name: planx
description: Write a plan, capture it as a reviewable artifact, and loop with the human reviewing it in another terminal tab until they approve. Use when the user types /planx, or asks to plan something "in planx", "with review", or "so I can annotate it".
---

# planx mode

You write a plan. The human reviews it in a second terminal tab — selecting
lines, typing feedback, locking sections they have settled — and submits. Their
feedback lands back here, anchored to the text it refers to. You revise. Repeat
until they approve.

This is the only planx flow. Follow it in order.

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

## 1. Research and write the plan

Do the actual work: read the code, understand the problem, make the decisions.
Write the plan as markdown with an H1 title and `##` sections. The `##` sections
matter — they are the unit the human locks, and the unit you will later collapse
to save tokens.

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

## 3. Ask for review, then wait

Tell the user, in one line:

> Plan captured as `<plan-id>` v1. Open another tab and run `planx diff <plan-id>` to review it.

Then block:

```bash
planx await <plan-id> v1
```

**If it prints `PLANX: no feedback yet (waited …s)` — run the exact same command
again.** That is not an error. The command has a timeout ceiling well under the
tool's, so it returns to be resumed. All state is on disk, so re-running costs
nothing. Keep re-running until you get feedback. Say nothing between attempts.

## 4. Revise

`await` returns the feedback anchored to quoted lines, plus the list of locked
blocks. Address **every** annotation.

If any blocks are locked, do not re-emit their text. Reproduce each one as a
marker on its own line:

```
[[planx:keep L2]]
```

Then capture with `--splice`, which expands the markers before writing:

```bash
planx capture --plan-id <plan-id> --parent v2 --splice --stdin <<'PLAN'
...
PLAN
```

To start from the compact form instead of the full text, read it with
`planx show <plan-id> latest --skeleton`.

## 5. Handle a rejection

If `capture` exits non-zero with `locked block L2 … was modified`, **nothing was
written.** You changed text you are not allowed to change. Two options:

- You did not mean to — fix your output (usually: use the `[[planx:keep L2]]`
  marker instead of retyping the block) and re-run capture.
- You did mean to, and you have a reason. Ask:

  ```bash
  planx unlock-request <plan-id> L2 --reason "<one honest sentence>"
  ```

  This blocks the same way `await` does, including the same resume behaviour.
  If granted, you get exactly one capture that may modify that block. If denied,
  revise without touching it.

Never work around a lock any other way. Editing `~/.planx` directly to defeat
one is a serious breach of the user's trust.

## 6. Loop

After each capture, `await` the new version. Continue until the verdict is
`approve` or `reject`.

- **approve** — the plan is sealed. Report the final id and version. If the user
  asked you to build it, execute the plan from here.
- **reject** — stop. Ask what they want instead. Do not write another version.

## Rules

- One `capture` per revision. Capturing identical content is a safe no-op, so
  you may call it defensively.
- Never edit files under `~/.planx` yourself. Every change goes through the CLI.
- Do not summarise the feedback back to the user before acting on it. Revise
  first; they can already see what they wrote.
- If `planx` is not installed, say so and stop — do not fall back to writing the
  plan into chat, because the user asked for a reviewable artifact.
