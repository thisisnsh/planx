# Executing

`s` is the way out of a review with something to say, and it is the only one. It
is offered on every row of every version, whether or not anything is pending,
and it opens one list of what can happen next to the plan:

```
  Submit feedback on guard-clock-regression-a3f9 v3 — then what?

▸ Revise in the session that wrote it   claude --resume 01J8XR --fork-session "/planx revise guard-clock-regression-a3f9"
  Execute in a new session
  Just give me the command
```

Two keys used to end a review. `s` submitted and asked *agent or command?*; `x`
executed and asked the same thing. Both answers were numbers on the hint bar, and
the pair had drifted apart from what the review actually decides — by the time
you are done reading a plan the question is not which key you pressed but what
happens next to this plan. So there is one key, and one list. `x` is unbound.

## What is on the list

| Entry | Shown when |
| --- | --- |
| `Revise in the session that wrote it` | this version carries a comment or a note, **and** planx recorded a session and an agent for it |
| `Execute in a new session` | planx recorded an agent for this version |
| `Just give me the command` | always |

**A line you rewrote with `e` does not bring `Revise` back.** The edit *is* the
change — settled text, already in the version — so there is nothing left to ask
an agent for. A comment and the note are requests, and a request needs a round.

Where planx cannot start something it is not offered. A version captured before
planx recorded sessions shows `Execute` and the command; one that names no agent
shows the command alone, a list of one. Nothing greyed out, nothing that declines
a press after advertising itself.

**Whatever you pick, everything pending is submitted first** — the comments, the
note, the rewritten lines. `Just give me the command` submits too, and then
prints the closing block.

Handing a plan on with its feedback still open is supported: the execute branch
works those comments into the build rather than bouncing them back for another
round.

## The command, on the right

The highlighted entry shows the command it would run, in a column to the right of
the labels — the whole launch line, flags and all, the same line planx prints
above the agent's first frame.

`→` moves into it and it becomes editable: change the model, add a directory,
rewrite the prompt, or replace the command outright. `enter` runs what is on
screen.

| Key | On the list | In the command |
| --- | --- | --- |
| `↑` `↓` | Move between entries, clamped at the ends | Back to the entries, keeping the edit |
| `→` | Into the command, when the entry has one | The caret |
| `←` | — | The caret — and at the start, back to the entries |
| `⌥←` `⌥→` `^a` `^e` | — | By word, and to the ends |
| `enter` | Do it | Run this line |
| `esc` | Back to the plan | Discard the edit, back to the entries |

An edit lives as long as the list is open: arrow away to another entry and back
and it is still there. `esc` out of the list to the plan and it is gone. `enter`
on an emptied command does nothing.

Anything unbound is ignored rather than falling through to the document
underneath. There are no numbers — the list is walked, not indexed.

**The edited line is split into arguments, not run through a shell.** planx
spawns the binary directly, so `&&`, `|` and `$(…)` in an edited line reach the
agent as text rather than being interpreted. Quoting follows the shell's
rules — `"`, `'` and `\` — because that is what the line planx printed is quoted
with.

## How it is drawn

The list is a block at the bottom of the body, drawn over the last few rows of
the plan rather than pushing anything around. The frame is exactly as tall as it
was, the document does not reflow, and `esc` puts you back on the row you were
on — which is why it is drawn over the plan rather than added under it.

The question is the block's first line, in the yellow every planx question is
already in. On a version carrying nothing to submit it is shorter, because there
is nothing to submit:

```
  guard-clock-regression-a3f9 v3 — what next?
```

The entries are blue. The highlighted one takes a `▸` and the blue at full
strength; the rest are dim. Inside the command the entry keeps its arrow and goes
dim, and the caret is the lit block the note and line editors already use — so
which side of the list you are typing on is visible without reading a hint.

<PlanxSim scenario="executing" :rows="14" />

## What the two agent entries run

The version records which agent captured it, which session wrote it, and how that
session's terminal was started. So planx can be exact:

```
claude --resume 01J8XR… --fork-session "/planx revise guard-clock-regression-a3f9"
claude "/planx execute guard-clock-regression-a3f9 v3"
```

Revising **forks** the session rather than continuing it. A fork carries every
message up to now under a new id, so the agent picks up exactly where it left off
while the tab it came from is left alone — and there is never one transcript with
two processes writing to it.

The recorded launch line is replayed in front of all of that, because a fork
restores the conversation and not the terminal it was typed into: a tab started
with `--model opus --add-dir ../shared` would otherwise fork into a different
agent with the same memory. Replay is verbatim, which means planx re-grants
whatever the tab was granted — so the whole command is on screen before anything
runs, and on the scrollback after.

planx runs in the plan's own directory, falling back to the current one with a
line saying so when that path is gone. It then exits with the agent's exit code:
the review tab becomes the agent tab.

## What `Just give me the command` prints

```
Reopen it in your terminal:  planx guard-clock-regression-a3f9 v3
Execute this plan in your agent:  /planx execute guard-clock-regression-a3f9 v3
```

Paste the second one to an agent and the `/planx` skill takes the execute branch:
it loads the stored version with `planx show`, drops it into the current context,
and implements it there.

**Every line says where its command runs.** A slash command and a bare command
look alike enough on a terminal that a lead like `Paste to your agent:` was the
only thing telling them apart, and a lead that carries that much has to be read to
be believed. `in your terminal` and `in your agent` say it outright.

A submit that carried feedback needs two commands instead of one, because the
feedback has to be answered before the plan can be built:

```
Reopen it in your terminal:  planx guard-clock-regression-a3f9 v3
Revise this plan in your agent:  /planx revise guard-clock-regression-a3f9
Execute it in your agent:  /planx execute guard-clock-regression-a3f9 v3
```

The execute line carries no qualifier about the feedback. The order already says
it: revise is the line above. Colour tells the three apart — the way back is grey
throughout, revise is yellow, execute is blue — and the labels stay grey on every
line, so the command is what the eye lands on.

Going back to the list gets the reopen line alone, which is what every block opens
on — it is the one entry that is true of every ending:

```
Reopen it in your terminal:  planx guard-clock-regression-a3f9 v3
```

There is no blank line between the entries. The air was there to give each
command room; four adjacent lines read as one block, which is what they are. Nor
are the commands padded into a shared column: a ragged right edge of labels reads
worse than a ragged left edge of commands.

## Which plan was built

`planx executed <id> v<n>` marks it, and the picker draws that plan's row green
while its latest version is the one that was built. The version row says the word
as well, because colour alone is a legend nobody was given:

```
    v3   2h ago
    v2   1d ago · executed
```

Capture a newer version and the plan row goes back to normal — what was executed
is no longer the plan — while the child row for the version that was built stays
green, which is where the history is.

The execute branch runs the mark itself, before its first edit, whichever route
reached it. planx does not mark on launch: a launch you immediately ctrl+c out of
built nothing.

## A new session, not a subprocess

Executing starts a **fresh** agent, and revising forks the one that wrote the
plan. Neither is a subprocess of the review — planx hands over the terminal and
exits with the agent's exit code, so you are talking to it directly, with the
permissions its launch line carries and nothing wrapped around it.

That is the difference from the spawner planx used to have, which ran an agent
underneath another agent and took the context, the permissions and your ability
to intervene with it.

`Execute in a new session` means what it says: the agent it starts has none of
the planning conversation, so the execute branch loads the plan with `planx show
<id> v<n> --plain` before anything else. Revising has no such step — the forked
session wrote the plan.

## Why there is no model picker

planx cannot change a running session's model, and neither can anything else:
`/model` is a user-typed slash command, `settings.json` is read at session start,
and `ANTHROPIC_MODEL` only affects new processes.

The old approve flow asked which agent you wanted, then which model, and then
printed a slash command for you to paste — two prompts to arrive at a string it
could not act on. What replaced it is the line itself: it is on screen, `→` edits
it, and `--model` in it is a flag that will actually be passed.

## Executing a plan nobody reviewed

The execute branch checks, by running `planx revise <id> --executing`. If nobody
has opened the version it says so in one line and asks whether to go ahead anyway
— an unreviewed plan running by accident is the exact thing planx exists to
prevent. Feedback on it is not a stop: those comments are worked into the build.

`--executing` is the same feedback with a different last line. Without it the
read ends on *Revise the plan addressing every comment. Then run `planx
capture`*, which is the wrong instruction for an agent about to build the plan —
and it was the last thing in the output. With it:

```
Build the plan, addressing every comment as you go. Do not capture a new
version: the plan is what was reviewed, and the comments are instructions on
top of it for this build.
```

## Executing does not revise

If the plan turns out to be wrong once you are in the code, the agent stops and
says so rather than quietly doing something else. Changing it is your decision,
and it goes back through review.
