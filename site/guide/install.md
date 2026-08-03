# Install

Two steps. npm gives you the CLI; `add-skills` gives your agents the `/planx`
command.

```bash
npm install -g @thisisnsh/planx
planx add-skills
```

Node 20.19 or newer. That is the whole installation — there is no server to
run, no daemon to start, and nothing to add to a config file.

## What npm does

Nothing but install the binary. The `postinstall` step writes no files at all;
it prints one line:

```
planx installed — run `planx add-skills` to set up your agents.
```

It used to run the installer for you, which meant every `npm install -g`
rewrote the skills in `~/.claude` and `~/.codex` without being asked —
including on an upgrade, where the thing being silently replaced might be a
skill you had open in another window. Setting up your agents is now something
you ask for.

Silence the line with `PLANX_NO_POSTINSTALL=1`.

## What `add-skills` does

It draws each step as it happens:

```
╭─ planx v0.3.0  add-skills ──────────────────────────────────╮
│                                                             │
│  Detecting agents                                           │
│    claude   ~/.claude          found                        │
│    codex    ~/.codex           not installed                │
│                                                             │
│  Writing skills                                             │
│    planx    ~/.claude/skills   written                      │
│                                                             │
│  Seeding the store                                          │
│    ~/.planx                    ready                        │
│                                                             │
│  Done. /planx is available in claude.                       │
╰──────────────────────── ★ github.com/thisisnsh/planx ───────╯
```

- It writes the `planx` skill into `~/.claude/skills/planx/` and
  `~/.codex/skills/planx/`, for whichever of those directories exists,
  **replacing** any it previously wrote there rather than copying over it — so
  a file this version no longer ships does not survive the upgrade.
- It removes skills an older planx installed that this version no longer ships,
  leaving anything you wrote by hand alone.
- It seeds `~/.planx/` with a `config.json`. `--no-store` skips that step.
- An agent directory that does not exist is reported, not created. Creating
  `~/.codex` on a machine with no Codex is litter. Pass `--agent codex` to
  force it.

It does **not** modify `~/.claude/settings.json`, `~/.codex/config.toml`, or any
other agent configuration. There is no hook to register, so there is nothing it
needs from those files — which means no merge logic, no backups, and nothing in
your settings that planx can break.

Piped, or with `--json`, the same steps print as plain lines instead, so a CI
log keeps everything.

Run it again after an upgrade to refresh the skills.

## Removing it

```bash
planx remove-skills
npm uninstall -g @thisisnsh/planx
```

`remove-skills` removes only what `add-skills` wrote — it leaves a `planx*`
skill directory alone if it does not carry the installer's marker, and reports
that it did.

Then it asks about your plans:

```
  Delete the store too? ~/.planx holds 14 plans. This cannot be undone.
  enter delete · esc keep
```

Decline and it prints the path so you can do it yourself later. A
non-interactive run never deletes and never asks.

The order no longer matters much — npm 7 and newer run no uninstall scripts at
all, so `npm uninstall` alone would leave the skills behind, listed and
loadable with no `planx` under them. If you removed the package first,
reinstall it, run `planx remove-skills`, then remove it again.

## Repo-local install

To check planx skills into a project so everyone working on it gets them:

```bash
planx add-skills --no-store --local
```

That writes into `./.claude/skills/` relative to the current directory.

## Channels

| Command | Channel | What it is |
| --- | --- | --- |
| `npm i -g @thisisnsh/planx` | `latest` | Stable. Published when a GitHub Release is created. |
| `npm i -g @thisisnsh/planx@staging` | `staging` | Maintainer-published test build, versioned `1.2.0-staging.47`. |

`planx --version` reports which one you are on, suffix and all, so a bug report
says so without you having to remember.

## Rolling back

```bash
npm install -g @thisisnsh/planx@1.1.3
```

Downgrading the CLI is instant and safe. The one caveat is the **on-disk format
version** of `~/.planx`, which is versioned independently of the package: if a
release migrated your store forward, an older CLI may not read it. Every such
change is described in the relevant
[GitHub Release](https://github.com/thisisnsh/planx/releases), and they are rare.

## Verify it

```bash
planx doctor
```

```
Store  /Users/you/.planx
Reindexed 0 plan(s).
No problems found.
```

It says which store it is talking to, checks every plan for anything it cannot
make sense of, and rebuilds the index. It is the only repair path in the tool.

## Using a different store

```bash
planx --dir /tmp/scratch list
PLANX_DIR=/tmp/scratch planx list
```

Worth knowing before you experiment with `d` in the picker, which deletes
permanently.
