---
title: What planx is
---

# What planx is

planx turns the plan your coding agent writes into a versioned artifact you can
annotate line by line, lock in place, and hand back. The agent blocks until you
are done, and it cannot change a section you locked without asking you first.

<div class="pnx-lede">

Reviewing an agent's plan today means reading a wall of markdown in a chat
window and answering it with more prose. Nothing is anchored, so the agent
re-reads the whole plan to guess which paragraph you meant. And **nothing you
settle stays settled** — the next revision quietly rewrites the section you
already agreed on, and you only notice three versions later.

</div>

## The problem, concretely

An agent proposes a plan across forty lines. You disagree with two of them, you
want the rollout section left exactly as written, and the rest is fine.

Chat gives you one move: type a paragraph and hope. The agent maps your prose
back onto its own text, revises everything at once, and returns a new wall of
markdown. To find out what actually changed you diff it in your head. Meanwhile
the rollout section you were happy with has picked up a new sentence, because
nothing was holding it.

The failure is not that agents write bad plans. It is that plan review has no
artifact — no stable text to point at, no record of which version you saw, and
no way to say "this part is finished" that survives the next generation.

## What planx does instead

The plan becomes a file with versions. You open it in a second terminal tab and
work on the text directly:

- **Point at lines.** Drag-select or press `V`, type feedback, select three more
  spots, submit once. Every comment reaches the agent quoted against the exact
  lines it refers to.
- **Lock what is settled.** Select lines, press `l`. Locked blocks come back to
  the agent as `[[planx:keep L2]]` markers it must reproduce verbatim.
- **Approve when you are done.** The plan seals and every section locks.

```console
$ planx diff guard-clock-regression-a3f9
```

```
┌ planx · guard-clock-regression-a3f9 · v1 · REVIEW ──────────────────┐
│    38   ## Approach                                                 │
│  ▓ 42   Extend the existing snapshot-regression guard in            │
│  ▓ 43   `poller.ts` to also reject a cross-period backward jump     │
│    44   while the match is live.                                    │
│                                                                     │
│ 🔒 88   ## Rollout                                          [L2]    │
│ 🔒 89   Deploy behind the `ff_clock_guard` flag, 10% → 50% …        │
├─────────────────────────────────────────────────────────────────────┤
│ ● a1  L42–43  "Wrong layer. Guard belongs in the R2 write path…"    │
├─────────────────────────────────────────────────────────────────────┤
│ drag/V select · c comment · l lock · u unlock · S submit · A approve │
└─────────────────────────────────────────────────────────────────────┘
```

You press `S`. In the other tab, the agent's `planx await` unblocks with your
annotations attached to the lines they came from, and it revises.

## Why a lock is different from an instruction

Enforcement lives in the storage layer, not in the prompt. `planx capture`
refuses to write a version that mutates a locked block:

```
✗ planx: locked block L2 ("## Rollout") was modified — version rejected.

  - Deploy behind the `ff_clock_guard` flag, 10% → 50% → 100% over 3 days.
  + Deploy directly to 100%; the flag adds no value here.

  This block is locked. To change it:
      planx unlock-request guard-clock-a3f9 L2 --reason "..."
  Then re-run capture. Nothing was written.
```

That distinction is the whole point. A prompt is advice, and an unattended agent
in bypass-permissions mode will eventually ignore it. A rejected write is not
advice. The agent has one path forward, which is to ask you — and your answer
grants exactly one capture before the lock re-arms.

Locks are an integrity mechanism against agent drift, not a security boundary
against a hostile agent. See [Locking](/guide/locking).

## Files are the protocol

Everything is `~/.planx` and a blocking subprocess. No server, no daemon, no
MCP, no lifecycle to manage:

```
~/.planx/plans/guard-clock-a3f9/
  meta.json  versions.json  locks.json
  v1.md  v2.md  v3.md
  feedback/  inbox/
```

Which means any agent that can spawn a process is a first-class citizen. Claude
Code and Codex both work today through the same skill files, and neither is
privileged over the other.

## Start here

```bash
npm install -g @thisisnsh/planx
```

Then type `/planx` in Claude Code or Codex.

- [Install](/guide/install) — what the installer touches, channels, rollback
- [The review loop](/guide/review-loop) — capture, await, revise, approve
- [Locking](/guide/locking) — how locks are enforced and lifted
- [CLI reference](/reference/cli) — every command and flag
