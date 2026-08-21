# Contributing to planx

## Setup

```bash
git clone https://github.com/thisisnsh/planx
cd planx
npm install          # postinstall detects a planx checkout and exits
npm run build
npm test
```

Node 24 (see `.nvmrc`); the published package supports Node >= 20.19.

The `postinstall` runs `planx add-skills` on a real install, so an upgrade never
leaves an old skill in `~/.claude` or `~/.codex` pointing at a CLI that has moved
on. It exits immediately inside a planx checkout, so `npm install` here never
rewrites your real skills from a working tree. `PLANX_NO_POSTINSTALL=1` disables
it everywhere — CI sets it explicitly rather than relying on the checkout
detection.

## Never develop against your real store

Always pass `--dir`:

```bash
npm run build
node dist/cli.js --dir .planx-dev capture --stdin < some-plan.md
node dist/cli.js --dir .planx-dev diff <plan-id>
```

`.planx-dev/` is gitignored. `PLANX_DIR=.planx-dev` works too, and applies to
every command.

The store is not the only thing a working tree can reach. `add-skills` and
`remove-skills` write into `~/.claude/skills` and `~/.codex/skills` — the skills
you are actually using while you work. Use `--local` to install into
`./.claude/skills` instead, and `--no-store` to leave `~/.planx` alone.

To try the TUI without polluting anything:

```bash
npm run build && node dist/cli.js --dir .planx-dev diff
```

## The layout

```
src/
  cli.ts, cli/       arg parsing, dispatch, the command spec, the doc generator
  store/             ~/.planx: atomic writes, index, plans, versions, feedback
  protocol/          capture, present, submit
  diff/, render/     line diff, collapsing, rich + plain rendering
  tui/               pure interaction model + Ink components
  exec/              agent launch, process-tree walk, clipboard
  install/           skill installation
  update/            the release check behind the update prompt
skills/planx/        SKILL.md plus references/, shipped as-is
```

The rule that keeps this honest: **`~/.planx` is the protocol.** Anything that
reads or writes it goes through `src/store`, and nothing above `src/store`
touches the filesystem directly.

`planx --help` and the Markdown CLI reference are both generated from
`src/cli/spec.ts`. Change a flag's meaning there, not in prose.

## Tests

```bash
npm test                          # everything
npx vitest run test/store.test.ts # one file
npm run test:watch                # watch
```

It matters which file a change belongs in:

- **`test/integration.test.ts`** drives the built binary as real subprocesses
  with real timing. The capture/submit/revise hand-off lives here because it is
  the thing most likely to break, and mocking the process boundary would mock
  away the only part under test.
- **`test/store.test.ts`** is the on-disk format: ids, atomic writes, the index,
  version reads, and what happens to a corrupt file. **Any change to what
  `~/.planx` looks like needs a case here.**
- **`test/protocol.test.ts`** and **`test/revise.test.ts`** cover the round
  trip — what a review submits, what carries over into the next version, what
  the hand-off prints.
- **`test/selection.test.ts`** and **`test/repeat.test.ts`** cover TUI
  interaction as pure functions over `(rows, events)` and over an injected
  clock. No terminal is involved, and none should be.
- **`test/tui-render.test.tsx`** renders the Ink components for real and asserts
  on the frame. Slower, and the right place for anything about what is actually
  on screen.
- **`test/launch.test.ts`** covers the argv planx hands an agent, against a
  stubbed `ps` — a test that reads a real process tree passes only on the
  machine it was written on.
- **`test/install.test.ts`** and **`test/skill.test.ts`** cover writing skills
  into agent directories and the content of the shipped skill. Both use a
  temporary home; neither may read a real one.
- **`test/update.test.ts`** covers the release check and its cache, with the
  registry stubbed.

## Adding agent support

The most likely outside contribution, and it is small.

planx does not spawn an agent from a config template any more — it prints the
command and you run it where you already are, and the review can run that same
command for you. Adding an agent therefore means two lists:

1. **`AGENTS` in `src/exec/launch.ts`** — the agents planx can name and launch.
   A new one needs its resume syntax in `launchFor`; Claude takes
   `--resume <id>`, Codex takes `resume <id>` as a subcommand, and the
   difference is the whole of it. Add a case to `test/launch.test.ts`.
2. **`TARGETS` in `src/install/install.ts`** — the agent's skills directory, if
   it has one. `add-skills` only writes into a directory that already exists
   unless the agent was asked for by name, so adding a row does not create
   `~/.newagent` on machines that do not have it.

If the agent's session ids or process names do not match what
`agentProcess` walks for, that is worth a case in `test/launch.test.ts` too.

## Commit conventions

No prefixes — no `feat:`, `fix:`, or `chore:`. A commit message is a sentence
case title and then a list of points:

```
Check again when the cached answer is one you already ran past

- An upgrade leaves `update.json` naming a version below the one now
  installed, and `shouldCheck` only asked how old the file was — so planx
  said nothing about releases for the rest of the six-hour window.
- A cached answer the running version is past cannot be what npm calls
  `latest`. `shouldCheck` now takes `current` and treats that answer as spent,
  checking again regardless of age.
- Equal stays age-gated: after `planx update` the cache names the version you
  are on, which is correct, not spent.
- Tests for the upgrade case, the already-current case, and the offline forget.
```

The title is one line, capitalised, imperative, and says what changed — not what
area was touched. The body is `-` points, never a prose paragraph.

Each point says **why**, especially for a behaviour change: what the old
behaviour was and why it was wrong. Do not list the files you changed — the
commit already carries them, and a point spent on `src/update/check.ts` is a
point not spent on the reasoning. Much of planx is a set of deliberate
trade-offs, and a commit that only says what changed makes the next person
re-derive them.

## Before you open a PR

```bash
npm run lint && npm run typecheck && npm test
```

`npm run format` fixes anything `lint` complains about.

If you changed the layout of `~/.planx`, call it out explicitly in the PR
description — that is the one thing users cannot roll back.

## Code of conduct

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).
