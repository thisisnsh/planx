# Troubleshooting

## `/planx` does nothing, or the agent has never heard of it

Check whether the skill was ever written:

```bash
ls ~/.claude/skills/planx ~/.codex/skills/planx
```

If neither is there, the postinstall did not run or was skipped:

```bash
planx install
```

Skills are read at session start for both agents, so restart the session
afterwards. If `~/.codex` does not exist on your machine, the installer skips it
on purpose rather than creating it — pass `--agent codex` to force it.

## The agent prints "no feedback yet (waited 480s)"

Its skill is out of date. planx no longer blocks or polls: the agent captures
the plan, tells you to run `planx`, and ends its turn. Reinstall with
`planx install`, which also removes the retired `planx-diff` and `planx-execute`
skills, then restart the session.

## The agent just stopped after capturing

That is correct. Nothing is waiting. Run `planx`, review, submit — the reviewer
prints the command to paste back, and that starts the next round.

## I submitted, but the agent did not pick it up

Check the feedback is actually stored and still open:

```bash
planx locks <id> --json
ls ~/.planx/plans/<id>/feedback/
```

Feedback is open until a newer version exists. If the agent already captured a
newer version, your feedback was closed against it — leave it again on the new
version:

```bash
planx diff <id>
```

## `capture` keeps getting rejected

Read the message: it names the lock and shows the diff. Two ways forward.

**You did not mean to change it.** Use the marker instead of retyping the block:

```bash
planx show <id> latest --skeleton    # locked blocks become [[planx:keep L2]]
# edit, keeping the markers as-is
planx capture --plan-id <id> --splice --stdin
```

**You did mean to change it.** Ask:

It has to explain the change to you first, and only run this once you agree:

```bash
planx unlock <id> L2 --reason "..."
```

The reason lands on the record. `planx locks <id>` shows every grant that was
issued, which is how you spot one you never agreed to.

## "locked block L2 now appears more than once"

The locked text got duplicated into a second copy, and planx will not guess
which one is the locked one. Remove the duplicate, or unlock the block and
re-lock the copy you meant.

## "a `[[planx:keep …]]` marker must be alone on its line"

Markers are only expanded when they are the entire line. A marker mid-sentence
is an error rather than silently passed through, because a dropped marker means
silently deleting a section of the plan.

Markers **inside a fenced code block are left literal** and not expanded — so
you can document the syntax. `capture` prints a note saying which lines those
were.

## The TUI looks broken, or colours bleed

```bash
planx diff <id> --plain
NO_COLOR=1 planx diff <id>
# make it the default: "render": "plain" in ~/.planx/config.json
```

If the terminal is left in a strange state after a crash, run `reset`.

## Everything looks wrong after an interrupted write

```bash
planx doctor
```

It reports plans whose version files are missing or whose locks cannot be
located, and rebuilds `index.json` from the plan directories.

If a stale lockfile is left by a killed process, planx steals it after 10
seconds. If it complains about one persistently and no planx process is running,
delete the named `.lock` file.

## I deleted a plan by accident

It is gone. There is no trash and nothing to restore from — `d` in the picker
deletes permanently, which is what the red confirmation naming the plan in full
is there to say. See [Deleting](/guide/retention).

The one thing that survives is a version you deleted from a plan you kept: the
plan, its other versions and its locks are all still there.

## Filing a bug

```bash
planx --version    # include this, suffix and all — it names the channel
planx doctor
```

[Open an issue](https://github.com/thisisnsh/planx/issues/new/choose). For
anything security-related, use
[private reporting](https://github.com/thisisnsh/planx/security/advisories/new)
instead — but read the [scope statement](https://github.com/thisisnsh/planx/blob/main/SECURITY.md)
first, because "an agent with shell access can edit `~/.planx`" is the
documented boundary rather than a vulnerability.
