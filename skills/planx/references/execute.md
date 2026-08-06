# planx execute

Load a stored plan and implement it **in this session**.

## Load it

```bash
planx show <plan-id> [version] --plain
```

Defaults to the latest version, which is the one to build. If the user did not
name a plan, run `planx list --json` and pick from the titles; if it is
ambiguous, ask.

Then check it was actually reviewed:

```bash
planx revise <plan-id>
```

If it says **no review yet**, say so in one line and ask whether to proceed
anyway — an unreviewed plan running by accident is exactly what planx exists to
prevent. If it reports comments, those are unaddressed: this is a revise round,
not an execute one.

## Execute it

Implement the plan as written, here. Do **not** spawn a nested agent: it would
lose the context you already have, the permissions you were granted, and the
user's ability to intervene.

If something in the plan turns out to be wrong once you are in the code, stop
and say so rather than quietly doing something else. The plan was reviewed —
changing it is the user's decision, not yours.

## Do not edit the plan

Executing a plan does not revise it. If it needs changing, that is a planning
round, and it goes back through review.
