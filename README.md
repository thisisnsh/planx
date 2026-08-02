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

The plan becomes a file with versions. The agent captures it and stops. You open
it and work on the text directly — select the lines you disagree with, type
feedback where it belongs, lock the sections you have settled, and submit once.

```console
$ planx
```

```
╭─ planx v0.3.0  guard-the-clock-regression-26af  v1 ─────────────────────────╮
│                                                                             │
│   │   1  ## Approach                                                        │
│   │   2  Extend the existing snapshot-regression guard in `poller.ts`       │
│   │   3  to also reject a cross-period backward jump.                       │
│   ├────────────────────────────────────────────────────────────╮            │
│   │ Wrong layer. This belongs in the R2 write path.            │            │
│   ╰────────────────────────────────────────────────────────────╯            │
│       4                                                                     │
│   ⚿  5  ## Rollout                                                          │
│ ▸ ⚿  6  Deploy behind the `ff_clock_guard` flag, 10% → 50% → 100% over 3 d… │
│                                                                             │
│                                                                             │
│ v select · f feedback · l lock · n note · d diff · [ ] version · g/G ^d/^u… │
╰────────────────────────────────────────────── ★ github.com/thisisnsh/planx ─╯
```

Press `s`. It prints one command to paste back to your agent, which picks the
plan up with every comment quoted against the exact lines it refers to. Press
`a` when you are happy — the plan seals and every section locks.

Nothing blocks and nothing polls. The agent finishes its turn when it captures,
and starts again when you hand it the command.

## Why it stands out

**A lock is enforced by the CLI, not by the prompt.** Locks have to hold even in
bypass-permissions mode, which rules out enforcement by instruction — a prompt
is advice, and an unattended agent will eventually ignore it. So `planx capture`
refuses to write a version that mutates a locked block:

```
✗ planx: locked block L2 ("## Rollout") was modified — version rejected.

  - Deploy behind the `ff_clock_guard` flag, 10% → 50% → 100% over 3 days.
  + Deploy directly to 100%; the flag adds no value here.

  This block is locked. Nothing was written.
  If you did not mean to touch it, use a [[planx:keep …]] marker instead.
  If you did, explain the change to the user first. Only once they agree:
      planx unlock guard-clock-a3f9 L2 --reason "..."
  Then re-run capture.
```

The agent physically cannot land the change. It has to stop and explain itself
first. The unlock it then issues grants exactly one capture, records the reason
it gave, and the lock re-arms on whatever gets written.

> An agent issues that unlock itself, once you have agreed in chat — nothing
> verifies the conversation happened. Locks stop *accidental* rewriting, not
> *determined* rewriting, which is why the reason is on the record and visible
> in `planx locks`.

**Feedback is anchored to the text.** Comments reach the agent quoted against
the lines they came from, not as a wall of prose it has to re-read the plan to
interpret.

**Files are the protocol.** Everything is `~/.planx` and a CLI — no server, no
daemon, no MCP, no background process, nothing to keep alive between turns. Any
agent that can run a command is a first-class citizen. Claude Code and Codex
both work today through the same skill files, and neither is privileged.

> Locks are an **integrity** mechanism against agent drift, not a security
> boundary against a hostile agent. See [SECURITY.md](SECURITY.md).

## Quickstart

```bash
npm install -g @thisisnsh/planx
```

Node 20.19 or newer. The install writes one skill into `~/.claude/skills/` and
`~/.codex/skills/`. It does **not** touch `settings.json`, `config.toml`, or any
other agent configuration — there is no hook to register.

Then, in Claude Code or Codex:

```
/planx add rate limiting to the upload endpoint
```

The agent researches, writes a plan, captures it, and stops — printing a plan
id. Then:

```bash
planx
```

Pick the plan, review it, submit. It prints the command to paste back.

<details>
<summary><b>Using planx without an agent</b></summary>

planx is a normal CLI. The agent side is three commands:

```bash
# store a plan, then pick it back up after someone reviews it
planx capture --stdin --title "Rate limit uploads" < plan.md
planx resume <plan-id>

# from anywhere else — a script, a hook, another editor
planx submit <plan-id> --comment "42-47:Wrong layer, use the R2 write path."
planx submit <plan-id> --approve
```

`planx resume` waits for nothing and is safe to run twice: it reads the plan,
the feedback on it and its locks straight out of the store.

</details>

### One skill

`/planx` dispatches on what follows it, so you can be explicit or just describe
what you want:

| Say | What happens |
| --- | --- |
| `planx <anything>` | Research it, write a plan, capture it for review |
| `planx resume <id>` | Pick up the feedback and revise |
| `planx execute <id>` | Build the approved plan in this session |
| `planx diff <id>` | Print a diff between two versions, no commentary |

### Channels

```bash
npm install -g @thisisnsh/planx           # latest — stable
npm install -g @thisisnsh/planx@staging   # staging — maintainer test builds
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
| [The review loop](https://thisisnsh.github.io/planx/guide/review-loop) | Capture, review, resume, approve |
| [Locking](https://thisisnsh.github.io/planx/guide/locking) | How locks are enforced and lifted |
| [CLI reference](https://thisisnsh.github.io/planx/reference/cli) | Every command and flag |
| [Troubleshooting](https://thisisnsh.github.io/planx/troubleshooting) | When something does not behave |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). The most likely useful contribution is
**a new agent adapter**, which is usually a config entry rather than code.

MIT licensed.
