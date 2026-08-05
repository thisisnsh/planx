# Executing

Approving a plan does not build it. It seals it, and then tells you how to
build it:

```
✓ Approved & sealed — guard-clock-regression-a3f9 v3 (6 sections locked)

  Paste to your agent:  /planx execute guard-clock-regression-a3f9 v3
```

Paste that to an agent and the `/planx` skill takes the execute branch: it loads
the stored version with `planx show`, drops it into the current context, and
implements it there.

**A slash command is for your agent; a bare command is for your terminal.** That
is the only thing that tells the two apart, so the review is careful about which
form it prints. `/planx execute` is a branch of the skill and has never been a
shell command — printing it as one is what used to make the line read as noise.

The other two exits print the same way:

```
s   Paste to your agent:  /planx revise guard-clock-regression-a3f9
x   Reopen it with:  planx guard-clock-regression-a3f9 v3
```

## What a sealed plan looks like

Every section carries a lock, `e` refuses, and the only key left that changes
anything is `l` — if you really have to open one back up.

<PlanxSim scenario="sealed" :rows="14" />

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

## Executing an unapproved plan

The skill checks. If the plan was never approved it says so in one line and asks
whether to go ahead anyway — an unreviewed plan running by accident is the exact
thing planx exists to prevent.

## Executing does not revise

If the plan turns out to be wrong once you are in the code, the agent stops and
says so rather than quietly doing something else. Changing it is your decision,
and it goes back through review: an approved plan is sealed, so every section of
it is locked.
