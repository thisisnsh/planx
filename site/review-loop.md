# Review Loop

<PlanxLoop />

**Nothing blocks and nothing polls.** There is no daemon, no background process
and no waiting subprocess. The agent's turn ends when it captures; the next turn
starts when you hand it the command the reviewer printed.

That is a deliberate change from how planx used to work. The agent used to block
on a queue while you reviewed, which held a session hostage, burned turns
re-polling, and had to work around a 600-second ceiling on tool calls. The
review was never the thing that needed to be synchronous — the *feedback* is on
disk either way, and `planx revise` reads it.

## The whole loop, on one screen

Everything below is in this frame. Select lines and comment on them, rewrite a
line yourself, leave one note about the plan, then press `s` — the markdown your
agent receives is printed underneath.

<PlanxSim scenario="review" :rows="16" />

## Review whenever you like

`planx` opens whether or not anything is waiting, because nothing ever is. Leave
notes an hour later. Leave them in three sittings. They accumulate on the
version, and whenever you hand the agent `planx revise`, it sees all of them.

`planx <plan>` opens that plan directly — the id the agent printed is the
argument, and prefixes work, so `planx guard-clock` is enough. Bare `planx`
opens the list instead: every plan, newest first, and `→` on one opens it into
its versions. `esc` in a review takes you back to that list.

## The plan first, the diff on `d`

A plan opens as it stands, not as a diff. The diff is the interesting view
sometimes; the plan is what you came to read. `d` shows the changes against the
previous version and `d` again puts them away, while `[` and `]` walk the
history — the header is the indicator, reading `v3` or `v3 ← v2`.

Notes belong to the version they were written on. Walking back to v1 and leaving
a note there submits it against v1, in its own batch, alongside anything left on
the version you started from.

Feedback you have already submitted is loaded back in. Open a version and you
see what you left on it, in the document, editable — there is no
submitted-versus-pending distinction to keep track of. Change a comment and
submit again and the store matches what is on screen; empty one and the deletion
lands the same way.

Reading a version is not editing it. Step through v1 to see what is on it,
change nothing, and it stays out of the submission — what you already left
there is untouched, and the summary names only the versions you actually wrote
on.

## Rewrite a line yourself, with `e`

A review can do more than ask. `e` opens the line under the cursor as its raw
markdown source — the `##`, the backticks, the text as it is stored — with a
caret at the end of it, and what you type is what the plan says. A wrong word
costs a keystroke instead of a round trip through an agent that has to guess
which word you meant.

It is a line editor, not a note box. `←` `→` move the caret, `^a` and `^e` reach
the ends of the line, `enter` commits it and `esc` throws the draft away. There
is no key that splits a line or joins two, so the line count never changes and
every comment and lock keeps the line number it already had.

`v` a span first and the lines open one at a time from the top: `enter` commits
this one and opens the next, `esc` ends the walk and keeps everything already
committed. Lines a lock covers are stepped over, and the status line says how
many were.

The edit lands **on the version on screen** — no new version is minted, because
you already settled the wording and there is nothing left for an agent to
decide. Like feedback, nothing reaches disk until `s` submits or `a` approves:
until then an edited line carries a yellow `~` in the sign column, the words you
changed are lit against the ones you kept, and the summary counts them.

```
▸  ~ 7 │ Extend the guard on the R2 write path.
```

`e` refuses where an edit would mean something other than it says, and where it
refuses it is not on the hint bar at all: a locked line (unlock it with `l`
first), a sealed plan, and any version but the latest — rewriting v2 while v3
exists rewrites the text v3 was built from.

`planx revise` reports what you rewrote in a section of its own, above what was
asked, as settled text rather than a request:

```markdown
### Edited by the reviewer

- **line 7**
  - was: `Extend the existing snapshot-regression guard in poller.ts`
  - now: `Extend the guard on the R2 write path`
```

## Submit, or approve — never both

A version carrying feedback or a note offers `s submit`. A version carrying
neither offers `a approve`. **A plan can be approved only when it carries no
feedback and no note**, which is why the two are never on the bar at once:
approving seals the plan, and sealing the very lines a comment is asking to
change would be a contradiction the tool should not let you write.

Press `a` anyway and it says what is in the way:

```
This version has 3 feedbacks. Delete them or press s to submit.
```

## Getting around a plan you have read before

`space` on a heading folds its section away, subsections included, and leaves a
row saying what went with it — the same dim marker a collapsed run of unchanged
lines leaves, in the same column, expanded by the same key:

```
▸  3 │ ## Approach
      ⋯ 12 lines · 2 feedback (space to expand)
   16   ## Rollout
```

`space` on either row brings the section back. The rail beside a folded heading
means there is feedback inside it, so nothing you left can hide behind a fold.
`j` steps to the next feedback on the version, in document order, wrapping at
the end — and unfolds a section to get there.

## Which feedback is still live

Feedback is **outstanding until a newer version exists**. That is derived from
the version list rather than stored as a flag, so it cannot drift out of step
with reality: comments on v2 are what you address to produce v3, and once v3
exists they are history.

Because capturing a new version retires the previous version's comments whether
or not anything was done about them, `planx revise` checks. If the lines a
comment quoted are still present word for word, it says so:

```
### Still unaddressed from earlier versions
- **a1** (v1) on `Extend the guard in poller.ts.`
  — Wrong layer. Use the R2 write path.
```

It is a heuristic and is reported as one — a comment can be satisfied by
changing something else entirely.

## The feedback payload

This is the wire format — what the review writes into
`~/.planx/plans/<id>/feedback/v<n>.json` and what `planx revise` reads back out.
One file per version, rewritten in place with exactly what the review holds, so
what is on disk is what you last saw on screen.

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

`planx revise <id>` prints exactly this — one read with everything asked of the
plan, and nothing else:

````markdown
## planx — guard-clock-regression-a3f9 v2 (verdict: revise)

### What was asked

#### [a1] under "## Approach" (lines 42–47)
> extend the existing snapshot-regression guard in poller.ts…

**Feedback:** Wrong layer. Guard belongs in the R2 write path, not the poller.

### Locked
- **L1** "## Context" (lines 1–28) — do not modify
- **L2** "## Rollout" (lines 88–104) — do not modify

---
Revise the plan addressing every comment. Locked blocks must be reproduced
as `[[planx:keep L1]]` markers — do not re-emit their text. Then run:
  planx capture --plan-id guard-clock-regression-a3f9 --parent v2 --splice --stdin
````

Every comment carries its verbatim quote, the locks are stated as an instruction
rather than a status, and the last line is the exact command to run next.

**It does not return the plan.** It used to emit the whole thing as a fenced
skeleton on every call, which for a plan of any size dwarfed the feedback it
exists to deliver — and the agent that wrote the plan already has it. The quoted
lines stay, because they are what makes a line number mean anything once a
revision has moved it. A session that genuinely does not have the plan runs
`planx show <id> --plain`.

It waits for nothing and is safe to run twice.

## Versions

Versions are **content-addressed**. Capturing content byte-identical to the
current latest is a no-op that returns the existing version, so a skill can call
`capture` defensively without polluting history.

Version refs are accepted everywhere: `v2`, `2`, `latest`, `prev`, `~1`, or a
sha prefix.
