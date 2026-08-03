# Contributing to planx

## Setup

```bash
git clone https://github.com/thisisnsh/planx
cd planx
npm install          # postinstall is silent inside a planx checkout
npm run build
npm test
```

Node 24 (see `.nvmrc`). The `postinstall` writes nothing anywhere — it prints
one line pointing at `planx add-skills` — and detects a planx checkout and stays
quiet, so `npm install` here never touches your real agent config.

## Never develop against your real store

Always pass `--dir`:

```bash
node dist/cli.js --dir .planx-dev capture --stdin < some-plan.md
node dist/cli.js --dir .planx-dev diff <plan-id>
```

`.planx-dev/` is gitignored. `PLANX_DIR=.planx-dev` works too. Doing this from
the start matters more than it sounds: `planx clean` is a real delete, and the
first thing you will want to test is `planx clean`.

To try the TUI without polluting anything:

```bash
npm run build && node dist/cli.js --dir .planx-dev diff
```

## The layout

```
src/
  cli.ts, cli/       arg parsing, dispatch, the command spec, the doc generator
  store/             ~/.planx: atomic writes, index, versions, trash
  protocol/          capture, revise, submit, unlock grants
  locks/             anchoring, verification, seal, split, splice/skeleton
  diff/, render/     line diff, collapsing, rich + plain rendering
  tui/               pure interaction model + Ink components
  adapters/          claude, codex import
  install/           skill installation
skills/planx/        SKILL.md plus references/, shipped as-is
site/                VitePress docs
```

The rule that keeps this honest: **`~/.planx` is the protocol.** Anything that
reads or writes it goes through `src/store`, and nothing above `src/store`
touches the filesystem directly.

## Tests

```bash
npm test                          # everything
npx vitest run test/locks.test.ts # one file
npx vitest                        # watch
```

Four kinds, and it matters which one a change belongs in:

- **`test/integration.test.ts`** drives the built binary as real subprocesses
  with real timing. The `capture`/submit/`revise` hand-off lives here because it
  is the thing most likely to break, and mocking the process boundary would mock
  away the only part under test.
- **`test/locks.test.ts`** is adversarial by design: reworded block, whitespace
  either side of the normalization line, deleted block, duplicated block,
  marker naming a nonexistent lock, marker inside a code fence, partial unlock
  at both boundaries. **Add a case here for any lock change.**
- **`test/selection.test.ts`** covers TUI interaction as pure functions over
  `(rows, events)`. No terminal is involved, and none should be.
- **`test/adapters.test.ts`** runs against fixtures whose shape is copied from
  real `~/.claude` and `~/.codex` history. Please keep it that way — a fixture
  invented from documentation will pass while the parser fails on the real file.

## Adding an agent adapter

The most likely outside contribution, and usually **not code**.

### If the agent takes a prompt on the command line

Add an entry to `~/.planx/config.json` and you are done:

```jsonc
{
  "agents": {
    "myagent": {
      "cmd": "myagent",
      "args": ["run", "--model", "{model}", "{prompt}"],
      "models": ["fast", "slow"],
      "model_switch": "/model {model}",
      "skills_dir": ".myagent/skills"
    }
  }
}
```

Placeholders: `{prompt}`, `{prompt_file}`, `{plan_path}`, `{plan_id}`,
`{version}`, `{model}`, `{cwd}`. Use `{prompt_file}` if the agent wants a file —
planx writes one and substitutes the path. If no model is chosen, the `{model}`
placeholder *and* the flag introducing it are dropped, so `--model ""` never
reaches the agent.

To ship it for everyone, add the same entry to `defaultConfig()` in
`src/store/config.ts` and a `TARGETS` row in `src/install/install.ts` if the
agent has a skills directory.

### If the agent stores plans somewhere planx should import

Write an adapter in `src/adapters/`, implementing the `Adapter` interface, and
register it in `src/adapters/index.ts`. Two rules:

1. **Parse defensively.** These are another tool's private logs. They change
   without warning, and an import that skips an unrecognised record is far
   better than one that throws halfway through a backfill.
2. **Take an `AdapterOptions.home` override** so the tests never read a real
   home directory.

## Commit conventions

Conventional Commits: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`,
with an optional scope (`feat(locks):`).

The body matters more than the subject here. Explain **why**, especially for a
behaviour change — what the old behaviour was and why it was wrong. Much of
planx is a set of deliberate trade-offs, and a commit that only says what
changed makes the next person re-derive the reasoning.

## Before you open a PR

```bash
npm run lint && npm run typecheck && npm test
npm run docs:cli     # if you touched src/cli/spec.ts — CI checks this
```

If you changed anything in `~/.planx`'s layout, call it out explicitly in the
PR description — that is the one thing users cannot roll back.

## Code of conduct

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).
