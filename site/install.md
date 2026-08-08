# Install PlanX

```bash
npm install -g @thisisnsh/planx
```

PlanX requires Node 20.19 or newer. The npm install adds the `planx` CLI and
writes the `/planx` skill into existing Claude Code and Codex skill directories.
Start a new agent session after installation, then type `/planx`.

## Set up an agent added later

If Codex or Claude Code is installed after PlanX, refresh the skills:

```bash
planx add-skills
```

The command updates only PlanX-managed skill directories. It does not change
Claude Code settings or Codex configuration. To set up only one agent, use
`--agent claude` or `--agent codex`.

Set `PLANX_NO_POSTINSTALL=1` before npm installation when you want to skip the
automatic skill step.

## Update

```bash
planx update
```

PlanX checks for a newer npm release in the background and shows an update
notice on a later interactive run. Set `PLANX_NO_UPDATE_CHECK=1` to disable the
check.

## Remove

```bash
planx remove-skills
npm uninstall -g @thisisnsh/planx
```

`remove-skills` removes only skill directories that PlanX created. It asks
separately before deleting `~/.planx`, because that directory contains your
plans and versions.

## Install a specific channel or version

```bash
npm install -g @thisisnsh/planx@latest
npm install -g @thisisnsh/planx@staging
npm install -g @thisisnsh/planx@0.6.0
```

`latest` is the stable channel and `staging` is for release testing.

## Verify the store

```bash
planx --version
planx doctor
```

Continue with [Review a plan](/review-loop), [Claude Code](/claude-code), or
[Codex](/codex).
