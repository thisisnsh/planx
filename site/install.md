# Install

One step. npm gives you the CLI, and its postinstall gives your agents the
`/planx` command.

```bash
npm install -g @thisisnsh/planx
```

Node 20.19 or newer. That is the whole installation — there is no server to
run, no daemon to start, and nothing to add to a config file.

## What npm does

It installs the binary, then runs `planx add-skills` for you. Every install and
every upgrade therefore leaves the skills in `~/.claude` and `~/.codex` matching
the CLI that is now on your PATH, which is the state they are supposed to be in
and the one an install is for.

This is deliberately not free rein. `add-skills` only writes into agent
directories that already exist, only replaces skill directories carrying its own
marker — a `planx` skill you wrote by hand is left alone — and never touches an
agent's settings files.

Skip it entirely with `PLANX_NO_POSTINSTALL=1`, and run `planx add-skills`
yourself whenever you want.

## What `add-skills` does

It draws each step as it happens:

```
 planx v0.5.0  add-skills

  Detecting agents
    claude   ~/.claude          found
    codex    ~/.codex           not installed

  Writing skills
    planx    ~/.claude/skills   written

  Seeding the store
    ~/.planx                    ready

  Done. /planx is available in claude.
```

No border on this one. It is the screen npm runs during an install, where the
output is already sitting inside npm's own — and a box drawn around part of
somebody else's log is worse than no box.

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

Run it by hand whenever you install an agent planx did not find last time.

## Staying current

planx tells you when a newer release is out, on the border of whatever it is
already drawing:

```
╭─ planx v0.4.0 ───────────────────────── v0.5.0 is out · run planx update ─╮
│                                                                          │
│  Which plan?                                                             │
│  Pick one to review, → for its versions.                           3/3   │
```

The check that produces it never happens while you wait. Each run shows what
the *last* run found and fires a detached check for the next one, at most once
every six hours, so an offline machine behaves exactly like an up-to-date one
and no command is ever a millisecond slower for it.

Nothing is stored about having seen it. There is no dismissal to go stale: the
notice is a fact about two version numbers, recomputed every run, so if 0.6.0
lands while you are still on 0.4.0 it says 0.6.0.

Then:

```bash
planx update
```

which runs `npm install -g @thisisnsh/planx@latest --foreground-scripts` and
hands the terminal to npm — its output scrolls, and the `add-skills` its
postinstall runs is drawn live at the end of it. Already on the latest, it says
so and does nothing. npm's exit code is the command's exit code, and npm's
errors are left exactly as npm wrote them.

It always runs npm, never a guess at pnpm or bun: a wrong guess installs a
second copy under another prefix and leaves you looking at the old version
wondering why the update did nothing. If you installed planx with something
else, upgrade it with that instead.

Silence the whole thing with `PLANX_NO_UPDATE_CHECK=1`. `CI` does it too, and
so does any run that is piped or `--json` — nothing an agent reads ever
mentions a version of planx.

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
  type delete to confirm: ▌

  esc keep
```

You type the word — `enter` does nothing until you have. That is the same gate
the review picker puts in front of deleting a plan, and for the same reason:
there is no trash behind either of them.

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

(`planx update` only ever moves you to `latest`; a specific version is npm's
job.)

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
