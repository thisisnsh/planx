# The review loop

```
agent                                     human (other tab)
  |                                              |
  | planx capture --stdin --title "..."          |
  |   → writes v2.md, prints id + version        |
  |                                              |
  | planx await <id> v2 --timeout 480            |
  |   → writes inbox/req-01K9X4.json, blocks     |
  |                                     planx diff <id>
  |                                       → REVIEW mode on v2 (diff vs v1)
  |                                       → select lines: comment / lock / unlock
  |                                       → submit  (or approve)
  |                                     writes feedback/ + inbox/resp-*.json
  |   ← unblocks, prints feedback markdown       |
  | revises → capture v3 → await v3              |
```

There is no daemon. `await` watches `inbox/` with `fs.watch` and a 500 ms poll
behind it — the watcher makes the common case instant, the poll makes network
filesystems and macOS FSEvents quirks merely slow instead of broken. Every write
is a temp file plus `rename`, so a reader never sees half a file.

## Feedback does not need anyone waiting

If no agent is blocked, `planx diff <id>` still opens. Your annotations are
stored as detached feedback and delivered to the *next* `await`. Review an hour
later and nudge the agent then.

## When feedback stops being delivered

Feedback is **open until a newer version exists**. That single rule gives three
behaviours that would otherwise each need their own mechanism:

- Two `await` processes on the same version both receive the same feedback.
- Feedback left before anyone was waiting still reaches the next `await`.
- The loop terminates, because capturing v3 closes v2's feedback.

Nothing is marked "consumed" when it is printed. Acting on feedback means
writing a new version, so that is what closes it.

## The resumable timeout

Claude Code caps a Bash call at 600 seconds. `await` therefore treats its
timeout as a *slice*, not a deadline:

```
PLANX: no feedback yet (waited 480s) — run the same command again to keep waiting
```

Exit code 0. The skill re-runs the identical command. Because all state is on
disk, re-running costs nothing and nothing can slip through the gap.

## The feedback payload

This is the wire format. The TUI writes exactly this, which is why
`planx submit` can too.

```jsonc
{
  "plan_id": "guard-clock-regression-a3f9",
  "version": 2,
  "verdict": "revise",              // "revise" | "approve" | "reject"
  "annotations": [
    {
      "id": "a1",
      "kind": "comment",            // "comment" | "lock" | "unlock"
      "anchor": { "start_line": 42, "end_line": 47, "context_sha": "9f2c…" },
      "quote": "…the full text of lines 42–47, verbatim…",
      "comment": "Wrong layer. Guard belongs in the R2 write path, not the poller.",
      "section": "## Approach"
    }
  ],
  "general": "Direction is fine, but see the two comments on scope."
}
```

**Anchoring is quote-first.** Line numbers rot the instant the plan is
rewritten; the quoted lines are what the agent must act on, and they survive.
Line numbers and `context_sha` are hints for re-locating the range in the TUI,
never the source of truth.

Post one yourself:

```bash
planx submit <id> v2 --stdin < feedback.json

# or the shorthand
planx submit <id> v2 \
  --comment "42-47:Wrong layer, use the R2 write path." \
  --lock 88-104 \
  --general "Direction is fine."
```

## Selection is line-based, everywhere

**You cannot select a sub-line span.** Every selection — feedback, lock, unlock
— snaps to whole lines. Dragging from the middle of one line to the middle of
another selects both lines entirely.

This is a deliberate constraint. A word-level anchor gives the model an
ambiguous target ("this word, in a sentence you are about to rewrite anyway"),
while a line range gives it a self-contained unit it can reason about and
replace. It also means feedback anchors, lock anchors and diff hunks share one
coordinate system, so a lock and a comment on overlapping text compose
predictably instead of needing a character-offset merge.

Word-level highlighting still appears in the diff — as a *reading* aid. It never
affects what you can select.

## What the agent sees

`await` prints exactly this, designed to be maximally actionable in context:

````markdown
## planx feedback — guard-clock-regression-a3f9 v2 (verdict: revise)

### [a1] under "## Approach" (lines 42–47)
> extend the existing snapshot-regression guard in poller.ts…

**Feedback:** Wrong layer. Guard belongs in the R2 write path, not the poller.

### 🔒 Locked
- **L1** "## Context" (lines 1–28) — do not modify
- **L2** "## Rollout" (lines 88–104) — do not modify

---
Revise the plan addressing every annotation. Locked blocks must be reproduced
as `[[planx:keep L1]]` markers — do not re-emit their text. Then run:
  planx capture --plan-id guard-clock-regression-a3f9 --parent v2 --splice --stdin
````

Every annotation carries its verbatim quote, the locks are stated as an
instruction rather than a status, and the last line is the exact command to run
next.

## Versions

Versions are **content-addressed**. Capturing content byte-identical to the
current latest is a no-op that returns the existing version, so a skill can call
`capture` defensively without polluting history.

Version refs are accepted everywhere: `v2`, `2`, `latest`, `prev`, `~1`, or a
sha prefix.
