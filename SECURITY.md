# Security policy

## Reporting a vulnerability

Report privately through
[GitHub Security Advisories](https://github.com/thisisnsh/planx/security/advisories/new).
Please do not open a public issue for a vulnerability.

Expect an acknowledgement within a week. If a fix is warranted it ships on
`staging` first and is promoted to `latest` with the advisory.

## Supported versions

Only the current `latest` release is supported. planx is pre-1.0 and small
enough that backporting to older versions would cost more than it is worth —
`npm install -g @thisisnsh/planx@latest` is the fix for anything.

## Scope: what planx is, and what it is not

**This is the part that matters more than the boilerplate above.**

planx is a **record**: plans are captured as versions in `~/.planx`, diffed, and
handed back to an agent with your comments attached. The value is that a
rewritten decision is _visible_ — it shows up in the diff between v2 and v3
instead of passing unremarked.

It is **not a security boundary against a hostile agent**, and not a sandbox.
Anything with shell access to your account can edit `~/.planx` directly:
overwrite `v3.md`, rewrite `versions.json`, or delete a plan. planx does not
sign, encrypt, or otherwise protect its store against the user account it runs
as, and it is not trying to.

So:

- "An agent with shell access can rewrite a stored version by editing
  `~/.planx`" is **not** a vulnerability. It is the documented boundary.
- "An agent that only uses the `planx` CLI can alter a stored version without it
  appearing as a new version in the diff" **is** a vulnerability. Please report
  it.

Saying this plainly prevents two failures: a bad-faith CVE for behaviour that
was never claimed, and — much worse — someone trusting a plan history to
contain an agent they have real reason to distrust.

## What planx executes

planx does not run your plan. Plans are markdown; they are stored, diffed and
printed, never evaluated. Nothing in a plan's contents becomes a command.

The review can start an agent for you — `revise`, `execute`, and `ctrl+r` to
resume. planx adds no permission flags of its own. It replays the flags the
session it was invoked from was already started with, read off the process
tree, so the agent it starts is granted exactly what your terminal was granted
and nothing more. That includes a permissive `--permission-mode` if that is how
you started, which is why the whole command line is printed before anything
runs.

Everything planx can launch, it can also just print for you to paste. If you
would rather it never spawn a process, paste the command instead.

`planx update` spawns `npm install -g @thisisnsh/planx@latest --foreground-scripts`,
and prints that line before running it. Always npm, never a guess at another
package manager — a wrong guess installs a second copy under a manager you do
not use. The arguments are fixed and nothing from a plan reaches them.

## Where planx writes

- `~/.planx` (or `--dir` / `PLANX_DIR`) — the store. Files are written
  atomically and created mode `0600`.
- `~/.claude/skills/planx*` and `~/.codex/skills/planx*` — written by
  `add-skills`, including from the package `postinstall`. It only writes into an
  agent directory that already exists, only replaces skill directories carrying
  its own marker, and never touches an agent's settings files.
  `PLANX_NO_POSTINSTALL=1` disables the install-time run.

planx makes one network request: a version check against the npm registry,
cached for six hours, behind the update prompt. It sends nothing about you or
your plans.
