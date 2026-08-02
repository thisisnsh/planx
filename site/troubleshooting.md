# Troubleshooting

## `/planx` does nothing, or the agent has never heard of it

```bash
planx status
```

If `skills` is empty, the postinstall did not run or was skipped:

```bash
planx install
```

Skills are read at session start for both agents, so restart the session
afterwards. If `~/.codex` does not exist on your machine, the installer skips it
on purpose rather than creating it — pass `--agent codex` to force it.

## The agent keeps printing "no feedback yet (waited 480s)"

That is correct behaviour, not an error. Claude Code caps a Bash call at 600
seconds, so `await` returns a resumable message and the skill re-runs it. Take
as long as you like reviewing.

If the agent *stops* re-running, its skill is out of date — reinstall with
`planx install`.

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

```bash
planx unlock-request <id> L2 --reason "..."
```

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

## The mouse selects planx rows instead of letting me copy text

Press `m` to release mouse capture. Keyboard selection (`V`, then `j`/`k`)
always works, so nothing is lost.

## The TUI looks broken, or colours bleed

```bash
planx diff <id> --plain
NO_COLOR=1 planx diff <id>
planx config set render plain     # make it the default
```

If the terminal is left reporting clicks after a crash, run `reset`.

## `planx execute` says the command is not on PATH

planx runs whatever `cmd` says in `~/.planx/config.json`. Check it resolves:

```bash
which claude
planx execute <id> --dry-run      # shows the exact argv without running it
```

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

```bash
planx restore <id>
```

Deletion is soft unless you passed `--purge` or ran `--empty-trash`.

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
