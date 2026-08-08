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
argument, in full. **A plan reference is the exact id and nothing else.** A
prefix used to resolve to whichever plan happened to start with it, so `planx
gu` opened `guard-clock-a3f9` while it was the only one, and something else the
week a second one landed; a refusal is visible and the wrong plan is not. Bare
`planx` opens the list instead: every plan, newest first, `→` on one opens it
into its versions, and typing filters. `esc` in a review takes you back to that
list.

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

## Typing in a note

`f` and `n` open a box with a real caret in it, the same one `e` has had since
it was written:

| Key | What it does |
| --- | --- |
| `←` `→` | One character |
| `⌥←` `⌥→` | One word — to the start of the run of non-whitespace either side |
| `^a` `^e` | The start and the end |
| `backspace` | Delete the character before the caret |
| printable | Insert at the caret |

The box used to be append-only: every arrow key fell through to the browse
handler, so `←` walked the document underneath the note you were typing in, and
backspace could only take back the last character you typed.

**Option+arrow arrives two ways** depending on how your terminal is configured —
`\x1b[1;3D`, which reads as an arrow with meta set, and `\x1bb`, which reads as
the letter `b` with meta set. Both are bound, because which one you get is a
setting nobody remembers changing.

**Cmd+arrow is not bound and cannot be.** Terminal.app and iTerm both consume it
before it reaches the process, so there is no escape sequence to bind.

## Rewrite a line yourself, with `e`

A review can do more than ask. `e` opens the line under the cursor as its raw
markdown source — the `##`, the backticks, the text as it is stored — with a
caret at the end of it, and what you type is what the plan says. A wrong word
costs a keystroke instead of a round trip through an agent that has to guess
which word you meant.

It is a line editor, not a note box. `←` `→` move the caret, `^a` and `^e` reach
the ends of the line, `enter` commits it and `esc` throws the draft away. There
is no key that splits a line or joins two, so the line count never changes and
every comment keeps the line number it already had.

`v` a span first and the lines open one at a time from the top: `enter` commits
this one and opens the next, `esc` ends the walk and keeps everything already
committed.

The edit lands **on the version on screen** — no new version is minted, because
you already settled the wording and there is nothing left for an agent to
decide. Like feedback, nothing reaches disk until `s` submits:
until then an edited line carries a yellow `~` in the sign column, the words you
changed are lit against the ones you kept, and the summary counts them.

```
▸  ~ 7 │ Extend the guard on the R2 write path.
```

`e` refuses where an edit would mean something other than it says, and where it
refuses it is not on the hint bar at all: any version but the latest — rewriting
v2 while v3 exists rewrites the text v3 was built from.

`planx revise` reports what you rewrote in a section of its own, above what was
asked, as settled text rather than a request:

```markdown
### Edited by the reviewer

- **line 7**
  - was: `Extend the existing snapshot-regression guard in poller.ts`
  - now: `Extend the guard on the R2 write path`
```

## `s` hands the plan on

One key ends a review. `s` is offered on every row of every version, whether or
not anything is pending, and it opens a list of what happens next to the plan:

```
  Submit guard-clock-regression-a3f9 v3
▸ 1. Revise plan in the session that wrote it   claude --resume 01J8XR "/planx revise guard-clock-regression-a3f9"
  2. Execute plan in a new session              claude "/planx execute guard-clock-regression-a3f9 v3"
  3. Copy revise command for agent              /planx revise guard-clock-regression-a3f9
  4. Copy execute skill for agent               /planx execute guard-clock-regression-a3f9 v3
```

The number picks and fires in one press; `↑ ↓` and `enter` do the same walking
it, and `esc` puts you back on the row you were on. `→` moves into the command
and it becomes editable, so the model, the directory and the prompt are yours to
change before it runs — on the two entries that run one. A copy entry puts its
line on the clipboard instead, and will not open it for editing.

Everything pending is submitted whichever entry you pick — including the one that
builds the plan with its feedback still open, which is supported. A review that
asked for nothing submits nothing, and `planx revise` reports the version as
*reviewed with nothing to change*. See [Executing](/executing).

There is no `x`. Two keys used to end a review and both asked the same follow-up
question, which is one key more than the review has decisions to make.

Leaving planx is **ctrl+c, twice**. The first press says so in red on the row
under the plan; any other key disarms it, and so does two seconds passing — the
two presses have to be prompt, so a guard armed by a stray ctrl+c and left armed
all session is not one keystroke from ending a review. `^c exit` is on the hint
bar now, the one key that ends the session having been the only one nowhere on
screen. `esc` is unchanged in the review: back to the list, with a red warning
when something on screen has not been submitted. On the plan list it is unbound
— ctrl+c leaves from there too.

## Getting around a plan you have read before

**Hold an arrow and it goes faster.** A row at a time to start with, two rows
after a second and a half of holding, five after four seconds. Let go and press
again and it is back to one — a terminal has no key-up event, so a hold is a run
of presses with no gap long enough to be a release, and tapping never
accelerates.

`space` collapses the section you are standing in, from any line of it,
subsections included. It leaves a row saying what went with it — the same dim
marker a collapsed run of unchanged lines leaves, in the same column, expanded
by the same key — and the cursor follows the collapse onto that row:

```
▸  3 │ ## Approach
      ⋯ 12 lines · 2 feedback (space to expand)
   16   ## Rollout
```

Where something is hidden under the cursor, `space` brings it back instead: that
reading wins, on the dim row a fold leaves behind and on a collapsed run alike.
The bar says which way it goes — `space expand` or `space collapse` — because
what it acts on is the row you are pointing at and needs no naming.

The rail beside a folded heading means there is feedback inside it, so nothing
you left can hide behind a fold. `j` steps to the next feedback on the version,
in document order, wrapping at the end — and unfolds a section to get there.

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
  "annotations": [
    {
      "id": "a1",
      "kind": "comment",
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

**You cannot select a sub-line span.** Every selection — feedback, a rewrite —
snaps to whole lines. `v` anchors a selection and the arrow keys extend it.

This is a deliberate constraint. A word-level anchor gives the model an
ambiguous target ("this word, in a sentence you are about to rewrite anyway"),
while a line range gives it a self-contained unit it can reason about and
replace. It also means feedback anchors, edits and diff hunks share one
coordinate system.

Word-level highlighting still appears in the diff — as a *reading* aid. It never
affects what you can select.

## What the agent sees

`planx revise <id>` prints exactly this — one read with everything asked of the
plan, and nothing else:

````markdown
## planx — guard-clock-regression-a3f9 v2

### What was asked

#### [a1] under "## Approach" (lines 42–47)
> extend the existing snapshot-regression guard in poller.ts…

**Feedback:** Wrong layer. Guard belongs in the R2 write path, not the poller.

---
Revise the plan addressing every comment. Then run:
  planx capture --plan-id guard-clock-regression-a3f9 --parent v2 --stdin
````

Every comment carries its verbatim quote, and the last line is the exact command
to run next.

## Capturing the revision as a patch

That command is the full-text form, and adding `--patch` to it is the normal way
to answer a review. The payload on stdin then is a unified diff against
`--parent` rather than the whole plan:

```bash
planx capture --plan-id guard-clock-regression-a3f9 --parent v2 --patch --stdin <<'PATCH'
@@ -40,4 +40,4 @@
 ## Approach
 The guard runs on every snapshot read.
-Extend the existing snapshot-regression guard in poller.ts.
+Extend the guard in the R2 write path, not the poller.
PATCH
```

This is the format [`planx diff --plain`](#the-feedback-payload) prints, read
the other way round — the read and write sides of a revision speak the same
language. A revision that changes three lines of a two-hundred-line plan costs
three lines of agent output instead of two hundred, and it costs that on every
round, which is where the real expense of the loop was.

**What gets stored is unchanged.** planx applies the patch to the stored parent
and writes the resulting document, so versions stay complete files on disk and
history, diffing, feedback anchoring and the byte-identical no-op all behave
exactly as they do for a full-text capture.

**The base is the stored parent, byte for byte** — including every line you
rewrote with `e`. Those are written into the version in place, so `planx show`
returns them and a patch has to be built against them. An agent that tries to
"restore" your wording writes a hunk quoting text that is no longer there, and
the hunk is refused; the lines you settled are simply left out of the patch.

**A stale `@@` offset is fine; a wrong context line is not.** planx searches
outward from the line number in the header, which absorbs the miscounting agents
do constantly. It never falls back to a fuzzy context match — the one failure
mode a patch capture must not have is applying cleanly to the wrong place. When
a hunk cannot be placed, planx writes nothing, names the hunk, and says to
re-read the parent and capture the full text:

```
planx: hunk 2 does not match guard-clock-a3f9 v2. Re-read it with
`planx show guard-clock-a3f9 v2 --plain` and capture the full text.
```

On success it reports what it applied — `Applied 3 hunks: +12 −4.` — because the
agent sent a diff and never saw the document that came out of it. Full-text
capture keeps working unchanged and stays the fallback.

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
