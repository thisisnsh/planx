<div align="center">

# planx

**Review your agent's plan like code — line by line, version by version.**

[![npm](https://img.shields.io/npm/v/@thisisnsh/planx?color=ffd400&labelColor=0b0b0c)](https://www.npmjs.com/package/@thisisnsh/planx)
[![ci](https://img.shields.io/github/actions/workflow/status/thisisnsh/planx/ci.yml?branch=main&labelColor=0b0b0c)](https://github.com/thisisnsh/planx/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-ffd400?labelColor=0b0b0c)](LICENSE)
[![node](https://img.shields.io/node/v/@thisisnsh/planx?labelColor=0b0b0c)](https://nodejs.org)

[**Docs**](https://planx.sh) ·
[**Try the review in your browser**](https://planx.sh) ·
[Install](https://planx.sh/install) ·
[CLI](https://planx.sh/reference/cli)

</div>

---

Chat gives you one move on a plan: type a paragraph and hope. planx makes the
plan a **file with versions** — so you point at lines, comment where it belongs,
rewrite what you can say better yourself, and hand it back.

```console
$ planx
```

```
╭─ planx v0.4.0  guard-clock-a3f9  v3 ◂ v2 ───────────────────────────────────────────╮
│                                                                                     │
│     1   # Guard the clock regression                                                │
│     2                                                                               │
│     3   ## Approach                                                                 │
│     4 │ Extend the existing snapshot-regression guard in `poller.ts`                │
│     5 │ to also reject a cross-period backward jump.                                │
│       ├────────────────────────────────────────────────────────╮                    │
│       │ Wrong layer. This belongs in the R2 write path.         │                   │
│       ╰────────────────────────────────────────────────────────╯                    │
│    ⋯ 12 lines · 1 feedback (space to expand)                                        │
│ ▸  18   ## Rollout                                                                  │
│    19   Deploy behind the `ff_clock_guard` flag, 10% then 50% then 100%.            │
│                                                                                     │
│ f feedback · e rewrite line · j next · d diff · s submit · x exit · ? help          │
╰────────────────────────────────────────────────────── ★ github.com/thisisnsh/planx ─╯
```

## What you get

| | Key | |
| --- | --- | --- |
| **Anchored feedback** | `v` to select lines, `f` to comment | Reaches the agent quoted against the exact lines — no prose for it to re-interpret |
| **Versions** | `←` `→` walk the history | Every revision is stored; you always know which one you saw |
| **Diff by default** | `d` | A version with a predecessor opens *as* the diff — word-level, with runs of unchanged lines collapsed |
| **Fold to skim** | `space`, `j` | Collapse a whole section into one row, jump feedback to feedback, on a plan you have read before |
| **Edit in place** | `e` | Rewrite a line yourself as raw markdown, instead of round-tripping through the agent |
| **Approve** | `s` with nothing on the version | An empty submit is how you say the plan is fine |
| **Execute** | `/planx execute <id>` | Builds the plan in the session you are already in |

## The loop

```
/planx add rate limiting to uploads   →  agent researches, writes, captures, stops
planx                                 →  you comment, press s
/planx revise <id>                    →  agent revises  ⟳
planx  →  press s with nothing on it  →  settled
/planx execute <id>                   →  built
```

Nothing blocks and nothing polls. The agent's turn ends at capture and starts
again when you paste the command back.

## Install

```bash
npm install -g @thisisnsh/planx
```

Node 20.19+. The postinstall runs `planx add-skills`, which writes one skill
into `~/.claude/skills/` and `~/.codex/skills/` and touches no agent config —
there is no hook to register. Then type `/planx` in Claude Code or Codex.

Upgrading: `planx update`, which planx offers on its own border when a newer
release is available. Removal: `planx remove-skills`, then
`npm uninstall -g @thisisnsh/planx`.

<details>
<summary><b>One skill, four branches</b></summary>

| Say | What happens |
| --- | --- |
| `/planx` | Say it is ready, then ask what to plan |
| `/planx <anything>` | Clarify, research, write a plan, capture it |
| `/planx revise <id>` | Pick up the feedback and revise |
| `/planx execute <id>` | Build the plan in this session |

</details>

<details>
<summary><b>Using planx without an agent</b></summary>

It is a normal CLI, and **files are the protocol** — everything is `~/.planx`.
No server, no daemon, no MCP, nothing alive between turns, so any agent that can
run a command is a first-class citizen.

```bash
planx capture --stdin --title "Rate limit uploads" < plan.md
planx <plan-id>          # review: comment, rewrite, submit
planx diff <plan-id>     # any two versions, TUI or piped
planx revise <plan-id>   # hand the feedback back to whatever is building
```

</details>

<details>
<summary><b>Release channels</b></summary>

```bash
npm install -g @thisisnsh/planx           # latest — stable
npm install -g @thisisnsh/planx@staging   # maintainer test builds
```

`planx --version` reports which one you are on.

</details>

## Docs

Every explanation lives on the site — and **the review runs there in your
browser**, beside the feature it explains. Same rows, same keys, same rules,
nothing installed.

### → **[planx.sh](https://planx.sh)**

[Install](https://planx.sh/install) ·
[Claude Code](https://planx.sh/claude-code) ·
[Codex](https://planx.sh/codex) ·
[Review Loop](https://planx.sh/review-loop) ·
[Diffing](https://planx.sh/diffing) ·
[Executing](https://planx.sh/executing) ·
[CLI reference](https://planx.sh/reference/cli) ·
[Troubleshooting](https://planx.sh/troubleshooting)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) — the most useful contribution is usually
**a new agent adapter**, which is a config entry rather than code.

MIT licensed.
