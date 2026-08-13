# planx execute

Load a stored plan and implement it **in this session**.

## Load it, with the feedback

```bash
planx revise <plan-id> v<n> --executing
```

Always, and before the first edit. One read returns both halves of what you are
building: the plan itself, under `### The plan as it stands`, and every comment
left on it. `--executing` is that same payload with a closing that says what you
are doing — it never tells you to capture.

**The version is required, and it is the one the user handed you.** `/planx
execute <id> v<n>` names the version they reviewed and chose to build. Pass it
through to every command here, this one and `planx executed` alike. Never
substitute `latest`: a revise running in another session can capture a newer
version between their review and your first edit, and building that one means
building a plan nobody has read. If you arrived with no version at all, run
`planx list --json`, take the latest, and say which version you are building.

If the user did not name a plan, run `planx list --json` and pick from the
titles; if it is ambiguous, ask.

`Execute plan in a new session` starts an agent with none of the planning
conversation in it, so that read is not optional — do it before anything else.
Revising resumes the session that wrote the plan and already has it; executing
does not. (`planx show <plan-id> v<n> --plain` returns the plan on its own,
without the feedback. Executing wants both, so it is not the one to reach for.)

If it says **no review yet**, say so in one line and ask whether to proceed
anyway — an unreviewed plan running by accident is exactly what planx exists to
prevent.

Comments are **worked into the build**, not bounced back. The reviewer can hand
a plan on with its feedback still open, and doing so is them saying: build it,
with these. Address each one in the code as you implement the plan around it.

- The **global note** is feedback. It arrives under `#### General` and it is
  about the whole plan, so it is a constraint on the whole build rather than a
  comment on one line.
- The **edited lines** under `### Edited by the reviewer` are already in the
  plan text above them. They are what the reviewer settled on, not work to do —
  build them, do not re-litigate them.
- A comment that **asks a question** is answered in the chat, not built.
- A comment that cannot be satisfied without changing the plan is where you stop
  and say so. That is a planning round, and it goes back through review.
- Executing never captures a version, whatever the feedback says.

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

Executing a plan does not revise it. The plan is what was reviewed, and the
comments are instructions layered on top of it for this build. If it needs
changing, that is a planning round, and it goes back through review.
