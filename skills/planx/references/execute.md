# planx execute

Load a stored plan and implement it **in this session**.

## Load it

```bash
planx show <plan-id> [version] --plain
```

Defaults to the latest version, which is the one to build. If the user did not
name a plan, run `planx list --json` and pick from the titles; if it is
ambiguous, ask.

Then read what is outstanding:

```bash
planx revise <plan-id>
```

If it says **no review yet**, say so in one line and ask whether to proceed
anyway — an unreviewed plan running by accident is exactly what planx exists to
prevent.

If it reports comments, they are **worked into the build**, not bounced back.
The reviewer can execute a plan with its feedback still open, and pressing `x`
in the review is them saying: build it, with these. Address each comment in the
code as you implement the plan around it.

Still no new version. Executing a plan does not revise it: the plan is what was
reviewed, and the comments are instructions layered on top of it for this build.

## Say that you are building it

```bash
planx executed <plan-id> v<n>
```

Before the first edit, whichever route reached here — the agent planx launched
from the review, a command pasted in by hand, or `/planx execute` typed from
scratch. That is what makes the mark true rather than a guess about what a
launch turned into.

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
