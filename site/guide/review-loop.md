# The review loop

```
agent                                     you
  |                                        |
  | planx capture --stdin --title "..."    |
  |   → writes v2.md, prints id + version  |
  |   → says "run planx <id>", stops       |
  |                                        |
  |                                      planx <id>
  |                                        → the plan as it stands
  |                                        → select lines: feedback / lock
  |                                        → s to submit
  |                                        → prints: planx resume <id>
  |                                        |
  |   ← you paste that back                |
  | planx resume <id>                      |
  |   → the plan, the feedback, the locks  |
  | revises → capture v3 → stops again     |
```

**Nothing blocks and nothing polls.** There is no daemon, no background process
and no waiting subprocess. The agent's turn ends when it captures; the next turn
starts when you hand it the command the reviewer printed.

That is a deliberate change from how planx used to work. The agent used to block
on a queue while you reviewed, which held a session hostage, burned turns
re-polling, and had to work around a 600-second ceiling on tool calls. The
review was never the thing that needed to be synchronous — the *feedback* is on
disk either way, and `planx resume` reads it.

## Review whenever you like

`planx` opens whether or not anything is waiting, because nothing ever is. Leave
notes an hour later. Leave them in three sittings. They accumulate on the
version, and whenever you hand the agent `planx resume`, it sees all of them.

`planx <plan>` opens that plan directly — the id the agent printed is the
argument, and prefixes work, so `planx guard-clock` is enough. Bare `planx`
opens a picker instead.

## The plan first, the diff on `d`

A plan opens as it stands, not as a diff. The diff is the interesting view
sometimes; the plan is what you came to read. `d` shows the changes against the
previous version and `d` again puts them away, while `[` and `]` walk the
history — the header is the indicator, reading `v3` or `v3 ← v2`.

Notes belong to the version they were written on. Walking back to v1 and leaving
a note there submits it against v1, in its own batch, alongside anything left on
the version you started from.

## Which feedback is still live

Feedback is **outstanding until a newer version exists**. That is derived from
the version list rather than stored as a flag, so it cannot drift out of step
with reality: comments on v2 are what you address to produce v3, and once v3
exists they are history.

Because capturing a new version retires the previous version's comments whether
or not anything was done about them, `planx resume` checks. If the lines a
comment quoted are still present word for word, it says so:

```
### Still unaddressed from earlier versions
- **a1** (v1) on `Extend the guard in poller.ts.`
  — Wrong layer. Use the R2 write path.
```

It is a heuristic and is reported as one — a comment can be satisfied by
changing something else entirely.

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
— snaps to whole lines. `v` anchors a selection and the arrow keys extend it.

This is a deliberate constraint. A word-level anchor gives the model an
ambiguous target ("this word, in a sentence you are about to rewrite anyway"),
while a line range gives it a self-contained unit it can reason about and
replace. It also means feedback anchors, lock anchors and diff hunks share one
coordinate system, so a lock and a comment on overlapping text compose
predictably instead of needing a character-offset merge.

Word-level highlighting still appears in the diff — as a *reading* aid. It never
affects what you can select.

## What the agent sees

`planx resume <id>` prints exactly this — one read with everything needed to
revise, including the plan itself, so it works in a session that has never seen
the plan:

````markdown
## planx — guard-clock-regression-a3f9 v2 (verdict: revise)

### The plan as it stands
```markdown
# Guard the clock regression
[[planx:keep L1]]   <!-- ## Context — 28 lines, locked -->
## Approach
…
```

### What was asked

#### [a1] under "## Approach" (lines 42–47)
> extend the existing snapshot-regression guard in poller.ts…

**Feedback:** Wrong layer. Guard belongs in the R2 write path, not the poller.

### 🔒 Locked
- **L1** "## Context" (lines 1–28) — do not modify
- **L2** "## Rollout" (lines 88–104) — do not modify

---
Revise the plan addressing every comment. Locked blocks must be reproduced
as `[[planx:keep L1]]` markers — do not re-emit their text. Then run:
  planx capture --plan-id guard-clock-regression-a3f9 --parent v2 --splice --stdin
````

Every comment carries its verbatim quote, the locks are stated as an instruction
rather than a status, and the last line is the exact command to run next.

It waits for nothing and is safe to run twice.

## Versions

Versions are **content-addressed**. Capturing content byte-identical to the
current latest is a no-op that returns the existing version, so a skill can call
`capture` defensively without polluting history.

Version refs are accepted everywhere: `v2`, `2`, `latest`, `prev`, `~1`, or a
sha prefix.
