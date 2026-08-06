# Executing

`x` executes the plan on screen. It is offered on every row of every version,
and it asks which way the command goes:

```
│ Execute guard-clock-regression-a3f9 v3.                          │
│ 1 execute in a new agent · 2 give me the command · esc back      │
```

`1` starts the agent itself. `2` prints the command for you to paste. `esc` goes
back to the plan — `x` is easy to hit, and the way back from it has to be free.

Pressing `x` with feedback still on screen submits it first. Nothing is lost and
nothing is warned about: a plan being built with comments on it is a supported
thing, and the execute branch works them into the build rather than bouncing
them back for another round.

`s` asks the same question for the other direction — *submit and revise* — and
is offered whenever the version carries something to submit: a comment, a note,
or a line you rewrote.

## What `1` runs

The version records which agent captured it, which session wrote it, and how
that session's terminal was started. So planx can be exact:

```
claude --resume 01J8XR… --fork-session "/planx revise guard-clock-regression-a3f9"
claude "/planx execute guard-clock-regression-a3f9 v3"
```

Revising **forks** the session rather than continuing it. A fork carries every
message up to now under a new id, so the agent picks up exactly where it left
off while the tab it came from is left alone — and there is never one transcript
with two processes writing to it.

The recorded launch line is replayed in front of all of that, because a fork
restores the conversation and not the terminal it was typed into: a tab started
with `--model opus --add-dir ../shared` would otherwise fork into a different
agent with the same memory. Replay is verbatim, which means planx re-grants
whatever the tab was granted — so the whole command is printed, flags included,
before anything runs.

planx runs in the plan's own directory, falling back to the current one with a
line saying so when that path is gone. It then exits with the agent's exit code:
the review tab becomes the agent tab.

## What `2` prints

The commands, exactly as before:

```
Reopen it in your terminal:  planx guard-clock-regression-a3f9 v3

Execute this plan in your agent:  /planx execute guard-clock-regression-a3f9 v3
```

Paste the second one to an agent and the `/planx` skill takes the execute
branch: it loads the stored version with `planx show`, drops it into the current
context, and implements it there.

**Every line says where its command runs.** A slash command and a bare command
look alike enough on a terminal that a lead like `Paste to your agent:` was the
only thing telling them apart, and a lead that carries that much has to be read
to be believed. `in your terminal` and `in your agent` say it outright.

A submit that carried feedback needs two commands instead of one, because the
feedback has to be answered before the plan can be built:

```
Reopen it in your terminal:  planx guard-clock-regression-a3f9 v3

Revise this plan in your agent:  /planx revise guard-clock-regression-a3f9

Execute it in your agent, once the feedback is addressed:  /planx execute guard-clock-regression-a3f9 v3
```

Going back to the list gets the reopen line alone, which is what every block
opens on — it is the one entry that is true of every ending:

```
Reopen it in your terminal:  planx guard-clock-regression-a3f9 v3
```

Where planx cannot be exact — a version captured before the session id was
recorded, or by an agent it cannot name — the prompt is still drawn, with the
command as its only option:

```
│ Execute guard-clock-regression-a3f9 v3.                          │
│ 1 give me the command · esc back                                 │
```

The number is the position on screen, so the command answers to `1` there. The
question is still worth asking, and a key that silently printed a block read as
`x` having been ignored.

The commands are not padded into a shared column. Alignment was there to tie
three adjacent lines together; with a blank line between each of them there is
nothing left to tie, and a ragged right edge of labels reads worse than a ragged
left edge of commands.

## A version with nothing left on it

A review that asked for nothing ends in `x`. There is nothing to submit, so `s`
is not offered at all — the plan is fine, and what is left to do with it is
build it.

<PlanxSim scenario="executing" :rows="14" />

## Which plan was built

`planx executed <id> v<n>` marks it, and the picker draws that plan's row green
while its latest version is the one that was built. The version row says the
word as well, because colour alone is a legend nobody was given:

```
    v3   2h ago
    v2   1d ago · executed
```

Capture a newer version and the plan row goes back to normal — what was executed
is no longer the plan — while the child row for the version that was built stays
green, which is where the history is.

The execute branch runs the mark itself, before its first edit, whichever route
reached it. planx does not mark on launch: a launch you immediately ctrl+c out
of built nothing.

## A new session, not a subprocess

Executing starts a **fresh** agent, and revising forks the one that wrote the
plan. Neither is a subprocess of the review — planx hands over the terminal and
exits with the agent's exit code, so you are talking to it directly, with the
permissions its launch line carries and nothing wrapped around it.

That is the difference from the spawner planx used to have, which ran an agent
underneath another agent and took the context, the permissions and your ability
to intervene with it.

## Why there is no model picker

planx cannot change a running session's model, and neither can anything else:
`/model` is a user-typed slash command, `settings.json` is read at session
start, and `ANTHROPIC_MODEL` only affects new processes.

The old approve flow asked which agent you wanted, then which model, and then
printed a slash command for you to paste — two prompts to arrive at a string it
could not act on. If you want a different model, switch it the way you always
would and then paste the command.

## Executing a plan nobody reviewed

The skill checks, by running `planx revise`. If nobody has opened the version it
says so in one line and asks whether to go ahead anyway — an unreviewed plan
running by accident is the exact thing planx exists to prevent. Feedback on it is
not a stop: those comments are worked into the build.

## Executing does not revise

If the plan turns out to be wrong once you are in the code, the agent stops and
says so rather than quietly doing something else. Changing it is your decision,
and it goes back through review.
