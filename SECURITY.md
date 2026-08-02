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

## Scope: what locks are, and what they are not

**This is the part that matters more than the boilerplate above.**

Locks are an **integrity mechanism against agent drift**. They stop an agent
from quietly rewriting a decision mid-revision, including in bypass-permissions
mode, by making `planx capture` refuse to write a version that mutates a locked
region.

They are **not a security boundary against a hostile agent.** Anything with
shell access can edit `~/.planx` directly: rewrite `locks.json`, delete a lock,
or overwrite `v3.md`. planx does not sign, encrypt, or otherwise protect its
store against the user account it runs as, and it is not trying to.

So:

- "An agent with shell access can bypass a lock by editing `~/.planx`" is
  **not** a vulnerability. It is the documented boundary.
- "An agent that only uses the `planx` CLI can modify a locked block" **is** a
  vulnerability. Please report it.

Saying this plainly prevents two failures: a bad-faith CVE for behaviour that
was never claimed, and — much worse — someone trusting locks to contain an
agent they have real reason to distrust.

## What planx executes

`planx execute` spawns another agent process using the argv template in
`~/.planx/config.json`, and the shipped Claude Code template includes
`--permission-mode acceptEdits`. That is your configuration to change. planx
always prints the exact argv before running it.

`planx` itself never executes anything out of a plan's contents. Plans are
markdown; they are stored, diffed and printed, never evaluated.
