<div align="center">

# planx

**Your agent's plan, as a versioned artifact you can annotate and lock.**

[![npm](https://img.shields.io/npm/v/@thisisnsh/planx?color=ffd400&labelColor=0b0b0c)](https://www.npmjs.com/package/@thisisnsh/planx)
[![ci](https://img.shields.io/github/actions/workflow/status/thisisnsh/planx/ci.yml?branch=main&labelColor=0b0b0c)](https://github.com/thisisnsh/planx/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-ffd400?labelColor=0b0b0c)](LICENSE)
[![node](https://img.shields.io/node/v/@thisisnsh/planx?labelColor=0b0b0c)](https://nodejs.org)

[**Documentation**](https://thisisnsh.github.io/planx) ·
[Install](https://thisisnsh.github.io/planx/guide/install) ·
[The review loop](https://thisisnsh.github.io/planx/guide/review-loop) ·
[CLI reference](https://thisisnsh.github.io/planx/reference/cli)

</div>

---

## The problem

Reviewing an agent's plan today means reading a wall of markdown in a chat
window and answering it with more prose. Nothing is anchored, so the agent
re-reads the whole plan to guess which paragraph you meant. And **nothing you
settle stays settled** — the next revision quietly rewrites the section you
already agreed on, and you only notice three versions later.

The failure isn't that agents write bad plans. It's that plan review has no
artifact: no stable text to point at, no record of which version you saw, and no
way to say *this part is finished* that survives the next generation.

## What planx does

The plan becomes a file with versions. The agent captures it and blocks. You
open it in a second terminal tab and work on the text directly — drag-select the
lines you disagree with, type feedback, lock the sections you have settled, and
submit once.

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

Press `S`. The agent's `planx await` unblocks with every comment quoted against
the exact lines it refers to, and it revises. Press `A` when you are happy — the
plan seals and every section locks.

## Why it stands out

**A lock is enforced by the CLI, not by the prompt.** Locks have to hold even in
bypass-permissions mode, which rules out enforcement by instruction — a prompt
is advice, and an unattended agent will eventually ignore it. So `planx capture`
refuses to write a version that mutates a locked block:

```
✗ planx: locked block L2 ("## Rollout") was modified — version rejected.

  - Deploy behind the `ff_clock_guard` flag, 10% → 50% → 100% over 3 days.
  + Deploy directly to 100%; the flag adds no value here.

  This block is locked. To change it:
      planx unlock-request guard-clock-a3f9 L2 --reason "..."
  Then re-run capture. Nothing was written.
```

The agent physically cannot land the change. It has one path forward: ask you.
Your answer grants exactly one capture, then the lock re-arms.

**Feedback is anchored to the text.** Comments reach the agent quoted against
the lines they came from, not as a wall of prose it has to re-read the plan to
interpret.

**Files are the protocol.** Everything is `~/.planx` and a blocking subprocess —
no server, no daemon, no MCP, no lifecycle to manage. Any agent that can spawn a
process is a first-class citizen. Claude Code and Codex both work today through
the same skill files, and neither is privileged over the other.

> Locks are an **integrity** mechanism against agent drift, not a security
> boundary against a hostile agent. See [SECURITY.md](SECURITY.md).

## Quickstart

```bash
npm install -g @thisisnsh/planx
```

Node 20.19 or newer. The install writes three skills into `~/.claude/skills/`
and `~/.codex/skills/`. It does **not** touch `settings.json`, `config.toml`, or
any other agent configuration — there is no hook to register.

Then, in Claude Code or Codex:

```
/planx add rate limiting to the upload endpoint
```

The agent researches, writes a plan, captures it, and blocks — printing a plan
id. In another tab:

```bash
planx diff <plan-id>
```

<details>
<summary><b>Using planx without an agent</b></summary>

planx is a normal CLI. The agent side is three commands:

```bash
# capture a plan and block until someone reviews it
planx capture --stdin --title "Rate limit uploads" < plan.md
planx await <plan-id>

# from anywhere else — a script, a hook, another editor
planx submit <plan-id> --comment "42-47:Wrong layer, use the R2 write path."
planx submit <plan-id> --approve
```

</details>

### The three skills

| Skill | What it does |
| --- | --- |
| `/planx` | The review loop: write → capture → await → revise → approve. |
| `/planx-diff` | Prints a diff between two versions inline. Diff only, no commentary. |
| `/planx-execute` | Loads a stored plan into the current session and executes it. |

### Channels

```bash
npm install -g @thisisnsh/planx           # latest — stable
npm install -g @thisisnsh/planx@staging   # staging — every merge to main
```

`planx --version` reports which one you are on, so a bug report says so too.

## Documentation

Every explanation lives in exactly one place, and that place is the site. This
README is the front door.

### → **[thisisnsh.github.io/planx](https://thisisnsh.github.io/planx)**

| Page | What is there |
| --- | --- |
| [What planx is](https://thisisnsh.github.io/planx) | The problem, and the shape of the answer |
| [Install](https://thisisnsh.github.io/planx/guide/install) | What the installer touches, channels, rollback |
| [Claude Code](https://thisisnsh.github.io/planx/guide/claude-code) · [Codex](https://thisisnsh.github.io/planx/guide/codex) | Per-agent setup |
| [The review loop](https://thisisnsh.github.io/planx/guide/review-loop) | Capture, await, revise, approve |
| [Locking](https://thisisnsh.github.io/planx/guide/locking) | How locks are enforced and lifted |
| [CLI reference](https://thisisnsh.github.io/planx/reference/cli) | Every command and flag |
| [Troubleshooting](https://thisisnsh.github.io/planx/troubleshooting) | When something does not behave |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). The most likely useful contribution is
**a new agent adapter**, which is usually a config entry rather than code.

MIT licensed.
