# planx

**Your agent's plan, as a versioned artifact you can annotate and lock.**

An agent writes a plan. While it waits, you open a second terminal tab, drag-select
the lines you disagree with, type feedback, select three more spots, **lock** two
sections you've already settled, and hit submit. It all lands back in the agent's
context, anchored to the text it refers to. The agent revises — and it *cannot*
alter the locked sections without coming back to ask you.

When you approve, the whole plan locks.

```bash
npm install -g @thisisnsh/planx
```

Works identically under **Claude Code** and **Codex**. Neither is privileged —
anything that can spawn a subprocess is a first-class citizen.

---

## Quickstart — Claude Code

```
/planx add rate limiting to the upload endpoint
```

Claude researches, writes a plan, captures it, and blocks. It prints an id.
In another tab:

```bash
planx diff <plan-id>
```

Select lines with the mouse or `V`, press `c` to comment, `l` to lock, `S` to
submit. Claude picks the feedback up and revises. Press `A` when you're happy —
the plan seals, and every section is locked.

## Quickstart — Codex

```
/planx add rate limiting to the upload endpoint
```

Identical. The skill is the same file, installed into `~/.codex/skills/`.
If Codex is in plan mode, it will ask you to press shift+tab first.

## Quickstart — no agent at all

planx is a normal CLI. The agent side is just three commands:

```bash
# capture a plan and block until someone reviews it
planx capture --stdin --title "Rate limit uploads" < plan.md
planx await <plan-id>

# from anywhere else — a script, a hook, another editor
planx submit <plan-id> --comment "42-47:Wrong layer, use the R2 write path."
planx submit <plan-id> --approve
```

---

## Why locks are enforced by the CLI

Locks hold **even in bypass-permissions mode**, which rules out enforcement by
instruction — a prompt is advice, and an unattended agent will eventually ignore
it. So `planx capture` simply refuses to write a version that mutates a locked
region:

```
✗ planx: locked block L2 ("## Rollout") was modified — version rejected.

  - Deploy behind the `ff_clock_guard` flag, 10% → 50% → 100% over 3 days.
  + Deploy directly to 100%; the flag adds no value here.

  This block is locked. To change it:
      planx unlock-request guard-clock-a3f9 L2 --reason "..."
  Then re-run capture. Nothing was written.
```

The agent physically cannot land the change. It has one path forward: ask. Your
answer grants exactly one capture, then the lock re-arms.

> Locks are an **integrity** mechanism against agent drift, not a security
> boundary against a hostile agent. See [SECURITY.md](SECURITY.md).

## Files are the protocol

Everything lives in `~/.planx`, and every command is a thin operation over it.
No server, no daemon, no lifecycle. That is what makes planx work in any agent
that can run a subprocess, forever.

```
~/.planx/plans/guard-clock-a3f9/
  meta.json  versions.json  locks.json
  v1.md  v2.md  v3.md
  feedback/  inbox/
```

## The three skills

| Skill | What it does |
| --- | --- |
| `/planx` | The review loop: write → capture → await → revise → approve. |
| `/planx-diff` | Prints a diff between two versions inline. Diff only, no commentary. |
| `/planx-execute` | Loads a stored plan into the current session and executes it. |

Installed automatically on `npm install -g`, into both `~/.claude/skills/` and
`~/.codex/skills/`. **It does not modify `settings.json` or any other agent
config** — there is no hook to register.

## Documentation

Full guides and the complete CLI reference live at
**<https://thisisnsh.github.io/planx/>**. This README is the front door; every
explanation exists in exactly one place, and that place is the site.

- [Install, channels and rollback](https://thisisnsh.github.io/planx/guide/install)
- [The review loop](https://thisisnsh.github.io/planx/guide/review-loop)
- [Locking](https://thisisnsh.github.io/planx/guide/locking)
- [CLI reference](https://thisisnsh.github.io/planx/reference/cli)

## Channels

```bash
npm install -g @thisisnsh/planx           # latest — stable
npm install -g @thisisnsh/planx@staging   # staging — every merge to main
```

`planx --version` reports which one you are on, so a bug report says so too.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). The most likely useful contribution is
**a new agent adapter**, which is usually a config entry rather than code.

MIT licensed.
