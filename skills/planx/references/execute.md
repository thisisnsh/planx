# planx execute

Load a stored plan and implement it **in this session**.

## Take the plan, and say you are building it

```bash
planx execute <plan-id> v<n> --session-id "$CLAUDE_CODE_SESSION_ID"
```

Always, and before the first edit. One command does both halves: it marks the
version as the one being built, and it returns what you are building — the plan
itself, under `### The plan as it stands`, every comment left on it, and every
line the reviewer rewrote by hand. It closes on the instruction to build, and it
never tells you to capture.

The mark comes from here rather than from the launch, whichever route reached
this point — the agent planx launched from the review, a command pasted in by
hand, or `/planx execute` typed from scratch. A launch you immediately ctrl+c
out of built nothing, so what makes the mark true is you being about to build.

**The version is required, and it is the one the user handed you.** `/planx
execute <id> v<n>` names the version they reviewed and chose to build. Never
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

If it says **no review yet**, say so to the user in one line and build the plan
as it stands. Nobody has looked at it, so there is nothing to work from beyond
the plan itself.

### Which agent you are

The session id is what lets the picker start you again later, with the build
still in context. Pass whichever row is yours:

| agent | pass |
| --- | --- |
| Claude Code | `--session-id "$CLAUDE_CODE_SESSION_ID"` |
| Codex | `--session-id "$CODEX_THREAD_ID"` |
| neither variable is set | `--agent <your agent>`, and no `--session-id` |

The mark lands either way. Without a session id the row simply offers no
resume.

## Work the comments into the build

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
