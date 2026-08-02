---
layout: home

hero:
  name: planx
  text: Plans you can annotate and lock
  tagline: An agent writes a plan and waits. You review it line by line in another tab, lock what you have settled, and hit submit. It cannot change a locked section without asking you.
  actions:
    - theme: brand
      text: Install
      link: /guide/install
    - theme: alt
      text: The review loop
      link: /guide/review-loop
    - theme: alt
      text: GitHub
      link: https://github.com/thisisnsh/planx

features:
  - title: Review anchored to the text
    details: Drag-select lines, type feedback, select three more spots, submit once. Every comment reaches the agent quoted against the lines it refers to, not as a wall of prose it has to re-read the plan to interpret.
  - title: Locks the agent cannot route around
    details: Enforcement lives in the storage layer. planx capture refuses to write a version that mutates a locked block, so a lock holds even in bypass-permissions mode, where a prompt would not.
  - title: Files are the protocol
    details: Everything is ~/.planx and a blocking subprocess. No server, no daemon, no MCP. Any agent that can spawn a process is a first-class citizen, forever.
---

## Thirty seconds of it

Tab one — the agent writes a plan, captures it, and blocks:

```console
$ planx capture --stdin --source claude < plan.md
✓ captured guard-clock-regression-a3f9 v1

$ planx await guard-clock-regression-a3f9 v1
```

Tab two — you review it:

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

You press `S`. Back in tab one, `await` unblocks:

```markdown
## planx feedback — guard-clock-regression-a3f9 v1 (verdict: revise)

### [a1] under "## Approach" (lines 42–43)
> Extend the existing snapshot-regression guard in
> `poller.ts` to also reject a cross-period backward jump

**Feedback:** Wrong layer. Guard belongs in the R2 write path, not the poller.

### 🔒 Locked
- **L2** "## Rollout" (lines 88–89) — do not modify

---
Revise the plan addressing every annotation. Locked blocks must be reproduced
as `[[planx:keep L2]]` markers — do not re-emit their text. Then run:
  planx capture --plan-id guard-clock-regression-a3f9 --parent v1 --splice --stdin
```

The agent revises. If it tries to touch `## Rollout` anyway, the capture is
rejected and nothing is written — it has one path forward, which is to ask you.

<!--
  A recorded asciinema cast of the loop belongs here, replacing the static
  transcript above. It is not committed yet; a fabricated one would be worse
  than none. See CONTRIBUTING.md.
-->

## Install

```bash
npm install -g @thisisnsh/planx
```

Then type `/planx` in Claude Code or Codex. Full instructions in
[Install](/guide/install).
