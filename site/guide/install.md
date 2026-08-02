# Install

```bash
npm install -g @thisisnsh/planx
```

Node 20.19 or newer. That is the whole installation — there is no server to
run, no daemon to start, and nothing to add to a config file.

## What the install actually does

A `postinstall` step runs `planx install`, which:

- writes the three skills into `~/.claude/skills/planx*/` and
  `~/.codex/skills/planx*/`, for whichever of those directories exists;
- seeds `~/.planx/` with a `config.json` containing `claude` and `codex` agent
  entries;
- prints a summary of exactly what it touched.

It does **not** modify `~/.claude/settings.json`, `~/.codex/config.toml`, or any
other agent configuration. There is no hook to register, so there is nothing it
needs from those files — which means no merge logic, no backups, and nothing in
your settings that planx can break.

Skip it entirely:

```bash
PLANX_NO_POSTINSTALL=1 npm install -g @thisisnsh/planx
planx install    # run it yourself later
```

Reverse it:

```bash
planx uninstall
```

`uninstall` removes only what the installer wrote — it leaves a `planx*` skill
directory alone if it does not carry the installer's marker, and it never
touches `~/.planx`. Your plans survive uninstalling the tool.

## Repo-local install

To check planx skills into a project so everyone working on it gets them:

```bash
planx install --skills --local
```

That writes into `./.claude/skills/` relative to the current directory.

## Channels

| Command | Channel | What it is |
| --- | --- | --- |
| `npm i -g @thisisnsh/planx` | `latest` | Stable. Published when a GitHub Release is created. |
| `npm i -g @thisisnsh/planx@staging` | `staging` | Every merge to `main`, versioned `1.2.0-staging.47`. |

`planx --version` reports which one you are on, suffix and all, so a bug report
says so without you having to remember.

## Rolling back

```bash
npm install -g @thisisnsh/planx@1.1.3
```

Downgrading the CLI is instant and safe. The one caveat is the **on-disk format
version** of `~/.planx`, which is versioned independently of the package: if a
release migrated your store forward, an older CLI may not read it. Every such
change gets a migration note in the
[changelog](https://github.com/thisisnsh/planx/blob/main/CHANGELOG.md), and they
are rare.

## Verify it

```bash
planx status
```

```
planx on
  store      /Users/you/.planx
  plans      0 (0 approved)
  trash      0
  render     rich
  agent      claude
  skills     /Users/you/.claude/skills/planx
             /Users/you/.claude/skills/planx-diff
             /Users/you/.claude/skills/planx-execute
```

If something looks wrong, `planx doctor` checks the store and rebuilds its
index.

## Using a different store

```bash
planx --dir /tmp/scratch list
PLANX_DIR=/tmp/scratch planx list
```

Worth knowing before you experiment with `planx clean`.
