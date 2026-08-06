# Executing

Approving a plan does not build it. Submitting a review that asks for nothing is
how you approve, and what it prints is how you build it:

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

And quitting gets the reopen line alone, which is what every block opens on —
it is the one entry that is true of every ending:

```
Reopen it in your terminal:  planx guard-clock-regression-a3f9 v3
```

The commands are not padded into a shared column. Alignment was there to tie
three adjacent lines together; with a blank line between each of them there is
nothing left to tie, and a ragged right edge of labels reads worse than a ragged
left edge of commands.

## A version with nothing left on it

An empty submit is what approving became. It means the same thing `a` meant —
there is nothing left to answer — without a second key gated on the condition
the empty submit already expresses.

<PlanxSim scenario="executing" :rows="14" />

## In this session, not a new process

planx used to be able to spawn a fresh agent for you. It no longer does, and the
CLI command that did it is gone.

Spawning a subprocess agent from inside an agent loses the context it already
has, the permissions it was granted, and your ability to intervene — which is
why even the old command's own help told agents not to call it. Outside an
agent, it was a wrapper around typing `claude` yourself. Printing the command
and letting you run it where you already are is the same thing with fewer parts.

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
running by accident is the exact thing planx exists to prevent. If there is
feedback on it, this is a revise round rather than an execute one.

## Executing does not revise

If the plan turns out to be wrong once you are in the code, the agent stops and
says so rather than quietly doing something else. Changing it is your decision,
and it goes back through review.
