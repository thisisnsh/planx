# Troubleshooting

## `/planx` is unavailable

Refresh the installed skills and start a new agent session:

```bash
planx add-skills
```

PlanX writes into agent directories that already exist. Force one target when
needed:

```bash
planx add-skills --agent claude
planx add-skills --agent codex
```

## The agent stops after creating the plan

Open `planx` in a terminal, review the plan, and press `s`. The review hands you
the command for revision or execution; paste that command into the agent if you
do not launch it from PlanX.

## Feedback does not appear

Check the stored review directly:

```bash
planx revise <id>
```

Feedback belongs to the version where it is left. If a newer revision already
addresses that review, open the latest version and leave any remaining request
there.

## Terminal colour or layout is unclear

```bash
planx diff <id> --print --plain
NO_COLOR=1 planx diff <id> --print
```

Set `"render": "plain"` in `~/.planx/config.json` to keep plain output as the
default. Run `reset` if another process leaves the terminal in a broken state.

## The picker or store looks inconsistent

```bash
planx doctor
```

The command validates plans and rebuilds `index.json`. If PlanX names a stale
lock and no PlanX process is running, delete only the named `.lock` file.

## A plan was deleted

Picker deletion is permanent. See [Delete plans and versions](/retention)
before confirming a target.

## Report a problem

Include `planx --version` and the output of `planx doctor` in a
[GitHub issue](https://github.com/thisisnsh/planx/issues/new/choose). Report
security problems through
[GitHub's private advisory form](https://github.com/thisisnsh/planx/security/advisories/new).
