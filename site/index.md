---
title: What planx is
---

# What planx is

planx turns the plan your coding agent writes into a versioned artifact you can
annotate line by line, lock in place, and hand back. Nothing blocks and nothing
polls — and the agent cannot change a section you locked without asking you
first.

<div class="pnx-lede">

Reviewing an agent's plan today means reading a wall of markdown in a chat
window and answering it with more prose. Nothing is anchored, so the agent
re-reads the whole plan to guess which paragraph you meant. And **nothing you
settle stays settled** — the next revision quietly rewrites the section you
already agreed on, and you only notice three versions later.

</div>

## The review, here, now

This is the real thing: the same rows, the same keys, the same rules. Click it
and use your keyboard, or tap the keys underneath. Nothing is written anywhere —
`s` prints the hand-off it would have printed, and shows you the markdown your
agent would receive.

<PlanxSim scenario="playground" :rows="17" />

Every page on this site carries one of these beside the feature it explains.

## What each key does

| Key | What it does | Where it is explained |
| --- | --- | --- |
| `↑` `↓` | Move a row at a time. A note box is one stop, on its first line. | [Review Loop](/review-loop) |
| `v` | Start a selection; `↑` `↓` extend it. Selection is always whole lines. | [Review Loop](/review-loop#selection-is-line-based-everywhere) |
| `f` | Feedback on the selection, anchored to those exact lines. `f` on a note edits it; empty it to delete it. | [Review Loop](/review-loop) |
| `e` | Rewrite the line yourself, in place, as raw markdown. | [Review Loop](/review-loop#rewrite-a-line-yourself-with-e) |
| `l` | Lock the selection, or lift a lock. Applied the moment you press it. | [Locking](/locking) |
| `space` | Fold the section, or the note, or expand a collapsed run. | [Review Loop](/review-loop#getting-around-a-plan-you-have-read-before) |
| `j` `h` | Walk the feedback; fold every note at once. | [Review Loop](/review-loop) |
| `d` `←` `→` | The diff against the previous version, and the history. | [Diffing](/diffing) |
| `n` | One note about the whole plan. | [Review Loop](/review-loop) |
| `s` | Submit everything at once, and print the command to paste back. | [Review Loop](/review-loop#what-the-agent-sees) |
| `a` | Approve — seals the plan and locks every section. | [Executing](/executing) |
| `?` | Every key, in the same order the hint bar puts them. | — |

The hint bar along the bottom of the frame only ever offers keys that work on
the row you are pointing at. `f` disappears on a locked passage, `d` is missing
on v1, and `s submit` and `a approve` are never on the bar at the same time.

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

- **Point at lines.** Press `v`, extend with the arrows, type feedback, select
  three more spots, submit once. Every comment reaches the agent quoted against
  the exact lines it refers to.
- **Rewrite what you can say yourself.** `e` opens a line as its source and what
  you type is what the plan says — no round trip through an agent that has to
  guess which word you meant.
- **Lock what is settled.** Select lines, press `l`. Locked blocks come back to
  the agent as `[[planx:keep L1]]` markers it must reproduce verbatim.
- **Approve when you are done.** The plan seals and every section locks.

A note hangs off a rail that runs down the lines it is about, between the line
number and the text, so it is never a comment floating near a passage — it is
attached to one, and its words start on the same left edge as theirs.

A version with a predecessor opens as the diff against it: you opened v3 because
v3 is new, and what is new about it is the diff. `d` shows the plan on its own
instead, and `←` and `→` walk the history.

You press `s`. It prints a command to paste back to your agent, which picks the
plan up with your annotations attached to the lines they came from, and it
revises.

## Why a lock is different from an instruction

Enforcement lives in the storage layer, not in the prompt. `planx capture`
refuses to write a version that mutates a locked block — so the agent physically
cannot land the change, and has one path forward, which is to ask you.

Walk it:

<PlanxCapture />

That distinction is the whole point. A prompt is advice, and an unattended agent
in bypass-permissions mode will eventually ignore it. A rejected write is not
advice, and the unlock you then agree to grants exactly one capture before the
lock re-arms.

Locks are an integrity mechanism against agent drift, not a security boundary
against a hostile agent. See [Locking](/locking).

## Every plan you have, in one list

Bare `planx` opens the picker rather than a plan: every plan in the store,
newest first, `→` into its versions, and `d` on the row in front of you to
delete it.

<PlanxPicker />

## Files are the protocol

Everything is `~/.planx` and a CLI. No server, no daemon, no MCP, no lifecycle
to manage:

```
~/.planx/plans/guard-clock-a3f9/
  meta.json  versions.json  locks.json
  v1.md  v2.md  v3.md
  feedback/
```

Which means any agent that can spawn a process is a first-class citizen. Claude
Code and Codex both work today through the same skill files, and neither is
privileged over the other.

## Start here

```bash
npm install -g @thisisnsh/planx
planx add-skills
```

Then type `/planx` in Claude Code or Codex.

- [Install](/install) — what the installer touches, channels, rollback
- [Review Loop](/review-loop) — capture, review, revise, approve
- [Locking](/locking) — how locks are enforced and lifted
- [CLI reference](/reference/cli) — every command and flag
