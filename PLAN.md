# planx — plan capture, versioning, inline review, locking, and execution

**Status:** proposal for review (rev 3)
**Date:** 2026-08-01
**Package:** `@thisisnsh/planx` (npm — `latest` + `staging` channels)

---

## 1. What this is

`planx` turns an agent's plan from a throwaway wall of text into a **versioned artifact you can annotate and lock**.

The headline feature: an agent writes a plan, and while it *waits*, you open a second terminal tab, drag-select the lines you disagree with, type feedback, select three more spots, **lock** two sections you've already settled, hit submit — and it all lands back in the original agent's context, anchored to the text it refers to. The agent revises, and it *cannot* alter the locked sections without coming back to ask you.

When you approve, **the whole plan locks**. From then on nothing changes unless you deliberately unlock it.

Four surfaces:

| Surface | What it is |
|---|---|
| `planx` CLI | The real implementation. Everything runs through it. |
| `/planx` skill | Activates planx mode: write plan → capture → await → revise → approve. |
| `/planx-diff` skill | Returns a diff between two plan versions inline. Diff only, no commentary. |
| `/planx-execute` skill | Loads a stored plan version into the current session and executes it. |

Works identically under **Claude Code** and **Codex**. Neither is privileged.

---

## 2. Architecture: files are the protocol

The thing you need is a **tool call that blocks** while a human does something out-of-band. `planx` gets it with a blocking shell command: the agent runs `planx await <id> <version>`, the process sits there until the TUI in the other tab submits, then prints the feedback to stdout.

That works in Claude Code, Codex, Gemini CLI, Cursor, Amp — anything that can run a subprocess. No server, no daemon, no lifecycle.

Its one real weakness is the timeout ceiling — Claude Code caps a Bash call at 600s. Solved by making `await` **resumable**: it returns `PLANX: no feedback yet (waited 480s) — run the same command again to keep waiting`, and the skill instructs the agent to re-run. All state lives on disk, so re-running costs nothing.

**`~/.planx` on disk is the protocol.** Every command is a thin operation over it. Any agent that can spawn a process is a first-class citizen, forever.

---

## 3. planx mode is the only mode

There is no plan-mode integration. planx has exactly one flow, which makes the product one thing instead of two half-things.

**Activation:** you type `/planx` in a normal session. The skill instructs the agent to:

1. **If the session is in plan mode, leave it first.** Plan mode's accept/reject gate is fundamentally incompatible with the review loop — the plan doesn't exist as an artifact until `ExitPlanMode` is accepted, and accepting it ends the session's planning phase. So the skill calls `ExitPlanMode` immediately with a one-line stub ("switching to planx mode — the plan will be written to planx for review"), *not* with a plan. You approve, plan mode drops, and the real loop starts. If the agent has no such tool (Codex), the skill prints `press shift+tab to leave plan mode, then say "go"`.
2. Research and write the plan as markdown.
3. `planx capture` it → get `<plan-id>` and `v1`.
4. Print the review banner and call `planx await`.
5. Absorb feedback → revise → `planx capture` (→ `v2`) → `await` again.
6. Loop until you approve.

**Consequence — the `ExitPlanMode` hook is gone.** Rev 2 auto-captured plan-mode plans via a `PostToolUse` hook. With plan mode out of scope that hook has no reason to exist, and its removal is a real win: **postinstall no longer touches `~/.claude/settings.json` at all.** No merge logic, no backup, no conflict handling, nothing to break in your settings.

Backfilling old plans stays available as an explicit, user-run command — `planx import --from claude --all` — not as automatic background behavior.

---

## 4. Storage layout

**Plans are global.** One flat store, not scoped per project. `cwd` is recorded as metadata and available as a filter (`planx list --here`), but never as a boundary — plans move between repos and get referenced from anywhere.

```
~/.planx/
  config.json                     # enabled flag, agent registry, render prefs
  index.json                      # id → {title, cwd, updated, latest, approved} for listing
  plans/
    guard-clock-regression-a3f9/
      meta.json                   # id, title, created, source, cwd, session_id, tags, approved_at
      versions.json               # ordered version records
      locks.json                  # active locks — plan-level, carried across versions
      v1.md  v2.md  v3.md
      feedback/  v2-01K9X4.json
      inbox/     req-01K9X4.json  resp-01K9X4.json
  .trash/                         # soft-deleted plans (see §11)
  logs/
```

**Plan id** = kebab slug of the title + 4-char content hash → `guard-clock-regression-a3f9`. Greppable, tab-completable. `--name` overrides.

**Versions are content-addressed.** `versions.json` holds `{n, sha256, author, agent, created, parent, note}`. Capturing byte-identical content is a no-op returning the existing version, so skills can call `capture` defensively without polluting history.

**Version refs** accepted everywhere: `v2`, `2`, `latest`, `prev`, `~1`, or a sha prefix.

---

## 5. The review protocol

```
agent                                     human (other tab)
  |                                              |
  | planx capture --stdin --title "..."          |
  |   → writes v2.md, prints id + version        |
  |                                              |
  | planx await <id> v2 --timeout 480            |
  |   → writes inbox/req-01K9X4.json, blocks     |
  |                                     planx diff <id>
  |                                       → REVIEW mode on v2 (diff vs v1)
  |                                       → select lines: comment / lock / unlock
  |                                       → submit  (or approve)
  |                                     writes feedback/ + inbox/resp-*.json
  |   ← unblocks, prints feedback markdown       |
  | revises → capture v3 → await v3              |
```

**No daemon.** `await` uses `fs.watch` on `inbox/` with a 500ms poll fallback (network filesystems, macOS FSEvents quirks). Writes are tmp-file + `rename`. Stale requests are garbage-collected past their TTL.

**If no one is waiting**, `planx diff <id>` still opens — annotations are stored as detached feedback and delivered to the *next* `await`. So you can review an hour later and nudge the agent then.

### Selection is line-based, everywhere

**You cannot select a sub-line span.** Every selection — feedback, lock, unlock — snaps to whole lines. Dragging from the middle of one line to the middle of another selects both lines entirely.

This is a deliberate constraint, not a simplification I took for convenience. A word-level anchor gives the model an ambiguous target ("this word, in a sentence you're about to rewrite anyway"), while a line range gives it a self-contained unit it can reason about and replace. It also means feedback anchors, lock anchors, and diff hunks all share one coordinate system, so a lock and a comment on overlapping text compose predictably instead of needing a character-offset merge.

### Feedback payload

```jsonc
{
  "plan_id": "guard-clock-regression-a3f9",
  "version": 2,
  "verdict": "revise",              // "revise" | "approve" | "reject"
  "annotations": [
    {
      "id": "a1",
      "kind": "comment",            // "comment" | "lock" | "unlock"
      "anchor": { "start_line": 42, "end_line": 47, "context_sha": "9f2c…" },
      "quote": "…the full text of lines 42–47, verbatim…",
      "comment": "Wrong layer. Guard belongs in the R2 write path, not the poller.",
      "section": "## Approach"
    }
  ],
  "general": "Direction is fine, but see the two comments on scope."
}
```

**Anchoring is quote-first.** Line numbers rot the instant the plan is rewritten; the quoted lines are what the agent must act on and they survive. Line numbers + `context_sha` are hints for re-locating the range in the TUI, never the source of truth.

### What the agent sees

`await` prints exactly this — designed to be maximally actionable in-context:

```markdown
## planx feedback — guard-clock-regression-a3f9 v2 (verdict: revise)

### [a1] under "## Approach" (lines 42–47)
> extend the existing snapshot-regression guard in poller.ts…

**Feedback:** Wrong layer. Guard belongs in the R2 write path, not the poller.

### 🔒 Locked
- **L1** "## Context" (lines 1–28) — do not modify
- **L2** "## Rollout" (lines 88–104) — do not modify

---
Revise the plan addressing every annotation. Locked blocks must be reproduced
as `[[planx:keep L1]]` markers — do not re-emit their text. Then run:
  planx capture --plan-id guard-clock-regression-a3f9 --parent v2 --splice --stdin
```

---

## 6. Locking

Select lines exactly as you would to comment on them, and press `l` instead of `c`. Those lines are frozen. `u` on locked lines lifts the lock.

### Enforcement is at the storage layer, not in the prompt

This is the critical design decision. You asked for locks to hold **even in bypass-permissions mode**, which rules out enforcement by instruction — a prompt is advice, and an unattended agent will eventually ignore it.

So: **`planx capture` refuses to write a version that mutates a locked region.** It exits non-zero and prints the offending diff:

```
✗ planx: locked block L2 ("## Rollout") was modified — version rejected.

  - Deploy behind the `ff_clock_guard` flag, 10% → 50% → 100% over 3 days.
  + Deploy directly to 100%; the flag adds no value here.

  This block is locked. To change it:
      planx unlock-request guard-clock-regression-a3f9 L2 --reason "..."
  Then re-run capture. Nothing was written.
```

The agent physically cannot land the change. It has one path forward: ask.

### The unlock handshake

`planx unlock-request <id> <lock-id> --reason "..."` writes an unlock request and **blocks on the same await machinery**. Your TUI surfaces it as a banner with the agent's stated reason and the proposed replacement text side by side. You approve or deny.

Approval is **single-use and scoped to one lock** — it grants exactly one capture that may modify `L2`, then the lock re-arms against the new content. No blanket unlocks, no drift.

### Approval seals the entire plan

When you approve a version, planx **locks every line of it**. Concretely, it splits the document on `##` headings and creates one lock per section — `L1 "## Context"`, `L2 "## Approach"`, and so on, plus a lock for any preamble above the first heading.

Per-section rather than one document-wide lock, because it reuses every piece of machinery that already exists: the unlock handshake names a lock, the TUI shows locks in the gutter, and `--skeleton` collapses them individually. A single monolithic lock would need its own special case for all three.

After approval you can still `planx diff` the plan and select lines to **unlock** — carving a hole in a sealed plan is a normal, supported operation, it just has to be your explicit act.

**Unlocking a portion of a lock splits it.** Unlock lines 95–98 of a lock spanning 88–104 and you get two locks (88–94, 99–104) with the middle free. The alternative — refusing partial unlocks — would force you to unfreeze a whole section to change one line.

### Lock records

```jsonc
// locks.json
{
  "sealed_at": "2026-08-02T00:14:03Z",     // set on approval; null before
  "locks": {
    "L2": {
      "created": "2026-08-01T23:40:11Z",
      "origin": "user",                     // "user" | "seal"
      "section": "## Rollout",
      "sha256": "c41b…",                    // of the normalized locked lines
      "text": "…",                          // verbatim, so it can be re-spliced
      "first_locked_version": 2,
      "still_present_in": 3,
      "consumed_grant": null
    }
  }
}
```

Locks live at the **plan** level and carry forward across versions automatically. Hash normalization trims trailing whitespace and nothing else — locked means locked, and the escape hatch is the unlock request, not a fuzzy tolerance. If a lock's text can't be found in a new version at all, that's a rejection too: deletion is a modification.

---

## 7. Token-efficient revision

Locked blocks are, by definition, text that isn't changing. Making the agent re-emit them every round is pure waste — and after approval, when the whole plan is locked, it's *all* of the output.

**Two markers, both directions:**

**Input** — `planx show <id> <v> --skeleton` renders the plan with locked blocks collapsed:

```markdown
## Approach
Extend the existing snapshot-regression guard…

[[planx:keep L2]]   <!-- ## Rollout — 17 lines, locked -->

## Risks
…
```

The agent starts from the compact form and never spends input tokens on frozen text.

**Output** — the agent emits the same markers, and `planx capture --splice --parent v2` expands them before writing:

```
planx capture --plan-id <id> --parent v2 --splice --stdin
```

`[[planx:keep L2]]` on its own line → replaced verbatim by `L2`'s stored text. `[[planx:keep v2#88-104]]` → an unchanged *unlocked* line span, for the same saving on stable-but-unfrozen prose.

Splice runs **before** lock verification, so the marker path is the frictionless one and hand-retyping a locked block is what trips the guard. Unknown or malformed markers are a hard error, never silently dropped — a dropped marker means silently deleting a section of the plan.

Stored `vN.md` files are always fully expanded. Markers are a wire format between agent and `capture`, never a storage format, so diffing, execution, and rendering never learn they existed.

---

## 8. The TUI — `planx diff`

### Layout

```
┌ planx · guard-clock-regression-a3f9 · v2 ← v1 · REVIEW ─────────────┐
│                                                                     │
│ 🔒 28   ## Rollout                                          [L2]    │
│ 🔒 29   Deploy behind the `ff_clock_guard` flag, 10% → 50% …        │
│                                                                     │
│    38   ## Approach                                                 │
│  + 42   Extend the existing snapshot-regression guard in            │
│  + 43   `poller.ts` to also reject a cross-period backward jump     │
│  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓  (3 lines selected)   │
│  + 45   while the match is live.                                    │
│  - 47   ~~Patch each client separately.~~                  ●a1      │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│ ● a1  L42–47  "Wrong layer. Guard belongs in the R2 write path…"    │
│ 🔒 L2  L28–44 locked                                                │
├─────────────────────────────────────────────────────────────────────┤
│ drag/v select · c comment · l lock · u unlock · d del · S submit · A approve │
└─────────────────────────────────────────────────────────────────────┘
```

### Selection — both input methods, line-snapped

- **Mouse drag** — SGR mouse tracking (`\x1b[?1002h\x1b[?1006h`), parsing `\x1b[<btn;col;rowM|m`. Column is used only for hit-testing the gutter; the selection always covers whole lines.
- **Keyboard visual mode** — `V` then `j/k`, vim's *line*-visual, matching the line-based model exactly. **Not optional.** Mouse capture hijacks the terminal's native text selection, which will infuriate anyone trying to copy a line out. `m` toggles mouse capture off; keyboard selection always works.

`c` comments on the selection, `l` locks it, `u` unlocks (splitting a lock if partial), `S` submits everything at once, `A` approves and seals.

### Rendering — rich by default

| Flag | Rendering |
|---|---|
| *(default)* | **Rich** — syntax-highlighted code fences, bold headings, word-level intra-line diff for *display*, collapsed runs of unchanged lines (`⋯ 23 unchanged lines (space to expand)`), 🔒 gutter |
| `--plain` | **Plain markdown** — raw source, unified diff, no ANSI beyond +/- coloring. Honors `NO_COLOR`. |

Word-level highlighting is a *reading* aid only; it never affects what you can select. Rendering mode is independent of interactivity — `--plain` works in the TUI and piped alike. Permanent default via `planx config set render plain`.

### Modes

| Invocation | Behavior |
|---|---|
| `planx diff <id>` in a TTY | Interactive TUI, latest vs. previous |
| `planx diff <id> v1 v3` | TUI, arbitrary version pair |
| `planx diff <id> --print` | Non-interactive to stdout, exits |
| `planx diff` (no args) | Fuzzy picker: plan → version pair → TUI |
| Pending request exists | Banner: `agent is waiting` / `agent requests unlock of L2`; submit unblocks it |

Piping implies `--print`. `/planx-diff` calls `--print --plain` — an agent wants raw diff text; ANSI is noise.

---

## 9. Approve → execute

Pressing `A`, or submitting with `verdict: approve`, seals the plan (§6) and ends the review loop. planx then asks two questions:

**Where?**
- **Same window** — `await` returns an approval telling the agent to execute the plan itself, in the session that wrote it. Keeps all the research context it already has.
- **New window** — planx spawns a fresh agent process with the plan as its prompt. Clean context; the planning session stays free.

**Which model?** A picker over the configured models for the target agent.

### The model-switch caveat — read this one

For a **new window** this is trivial and fully automatic: `claude --model <m>` / `codex exec -m <m>`.

For the **same window** it is not. Neither Claude Code nor Codex exposes a way for a running agent to change its own model — `/model` is a user-typed slash command, `settings.json` is read at session start, and `ANTHROPIC_MODEL` only affects new processes. So the honest design: planx prints the exact line for you to paste, and the skill waits.

```
✓ Approved & sealed — guard-clock-regression-a3f9 v3 (6 sections locked)

  Execute here with a different model? Paste this, then say "go":
      /model opus

  Or execute in a new window (model applied automatically):
      planx execute guard-clock-regression-a3f9 v3 --agent claude --model opus
```

One paste, or zero if you're happy with the current model. Better to surface that honestly than ship something that quietly doesn't switch.

---

## 10. Execution

`planx execute` means two different things depending on where it runs, and both are correct.

**From the terminal** — spawns a fresh agent process:

```jsonc
// ~/.planx/config.json
{
  "defaultAgent": "claude",
  "agents": {
    "claude": {
      "cmd": "claude",
      "args": ["--permission-mode", "acceptEdits", "--model", "{model}", "{prompt}"],
      "models": ["opus", "sonnet", "haiku"]
    },
    "codex": {
      "cmd": "codex",
      "args": ["exec", "-m", "{model}", "{prompt}"],
      "models": ["gpt-5.6-terra", "gpt-5.6"]
    },
    "aider": { "cmd": "aider", "args": ["--message-file", "{prompt_file}"] }
  }
}
```

Placeholders: `{prompt}`, `{prompt_file}`, `{plan_path}`, `{plan_id}`, `{version}`, `{model}`, `{cwd}`. Adding another agent CLI is a config entry, not a code change. Bare `planx execute` walks a picker: plan → version → agent → model → extra args → confirm, showing the exact argv before it runs.

**From inside an agent** (`/planx-execute`) — no nested CLI. The skill runs `planx show <id> <version>`, drops the plan into the current context, and executes directly. Spawning a subprocess agent from inside an agent loses the context, the permissions, and your ability to intervene.

The prompt is always prefixed with a header naming plan id + version, so execution transcripts trace back to the artifact.

---

## 11. Retention — `planx clean`

Plans are kept **forever** by default. Nothing expires, nothing is pruned automatically, no background GC. They're a few kilobytes each.

Cleanup is an explicit CLI action:

```
planx clean                          # interactive multi-select over all plans
planx clean --older-than 90d
planx clean --unapproved             # never reached approve
planx clean --versions-beyond 5      # trim history, keep the plan and its latest
planx clean --id <id> [--purge]
planx clean --empty-trash [--older-than 30d]
```

Bare `planx clean` opens a picker: every plan with title, age, version count, approved badge; space to mark, `x` to select all matching a filter, enter to confirm. Filter forms print the full list of what they'd remove and require confirmation (`--yes` to skip, for scripts).

**Deletion is soft by default.** Removed plans move to `~/.planx/.trash/<id>/` with a deletion timestamp, recoverable via `planx restore <id>`. `--purge` deletes for real. Trash is never emptied automatically — `planx clean --empty-trash` does it, and only when asked. Losing a plan you spent an hour reviewing to an off-by-one in a date filter is the one unrecoverable failure in this system, so it takes two deliberate steps.

---

## 12. CLI surface

```
planx capture [--plan-id ID] [--title T] [--stdin|--file F] [--parent VER]
              [--splice] [--source claude|codex|...] [--note N]
planx await <id> [version] [--timeout 480]
planx unlock-request <id> <lock-id> --reason "..."
planx diff [id] [vA] [vB] [--print] [--plain|--rich] [--stat]
planx show <id> [version] [--plain|--rich] [--skeleton]
planx list [--here] [--approved] [--json]
planx versions <id>
planx locks <id> [--json]
planx execute [id] [version] [--agent NAME] [--model M] [--args "..."] [--dry-run]
planx import --from claude|codex [--latest|--all] [--since 7d]
planx clean [filters] [--purge] [--yes] | planx restore <id>
planx rename <id> <new>
planx on | off | status
planx config get|set <key> [value]
planx install [--skills] | planx uninstall
```

Global: `--json` on every read command, `--dir` to override `~/.planx`, `NO_COLOR` respected.

---

## 13. Distribution — `@thisisnsh/planx` on npm

```bash
npm install -g @thisisnsh/planx          # latest — stable
npm install -g @thisisnsh/planx@staging  # staging — maintainer test builds
```

Public npm registry, scoped package, published with `--access public` (scoped packages are private by default — this flag is not optional) and `--provenance` (free supply-chain attestation, requires `id-token: write` in the workflow). No `.npmrc` setup, no token, no friction for anyone installing it.

### Package contents

- `bin.planx` → `dist/cli.js`
- the three skills, for **both** agents
- `~/.planx/config.json` seeded with `claude` and `codex` agent entries

A **postinstall** runs `planx install` idempotently: writes skills to `~/.claude/skills/planx*/` and `~/.codex/skills/planx*/`, seeds `~/.planx/`, prints a summary of exactly what it touched. It does **not** modify `~/.claude/settings.json` or any other agent config — with the `ExitPlanMode` hook dropped (§3), there's nothing it needs from there. Skip with `PLANX_NO_POSTINSTALL=1`; reverse with `planx uninstall`, which removes only what it wrote.

`planx install --skills --local` writes to a repo's `.claude/skills/` for someone who wants planx checked into a project.

### Release — two channels

| Trigger | Publishes | Tag | Who gets it |
|---|---|---|---|
| `npm run release:staging` | `1.2.0-staging.47` | `staging` | `@staging` installers, you, dogfooding |
| GitHub Release published | `1.2.0` | `latest` | everyone |

**`ci.yml`** — on PR: lint, typecheck, test, build. Required to merge.

**`scripts/release-staging.js`** — from a clean local checkout: verify npm login → test → build → publish `--tag staging`. The version is derived at publish time as `<version-in-package.json>-staging.<n>`, where `n` is the next suffix available on npm. The script temporarily updates the package files and restores them on every exit path.

**`release.yml`** — on `release: published`: assert the release tag matches `package.json`'s version exactly (fail loudly if not), test → build → publish `--tag latest`. It builds from the release tag's source, so a `latest` publish is the same tree that was on `staging`, minus the prerelease suffix.

Promoting the staging artifact via `npm dist-tag add` instead would reuse the exact tested bytes, but it would leave `latest` pointing at a version literally named `1.2.0-staging.47` — every `planx --version` and bug report would carry the suffix. A clean rebuild from the tag is worth more than byte-identity here.

Staging authenticates with the maintainer's local npm login. Production uses npm trusted publishing with GitHub Actions OIDC, without a long-lived token.

Cutting a release is: bump `package.json`, merge, create a GitHub Release on the tag. `planx --version` reports its channel (`1.2.0` vs `1.2.0-staging.47`), so a bug report says which one you're on.

---

## 14. Repository scaffolding

The things an OSS repo needs before anyone else can usefully touch it.

| File | Contents |
|---|---|
| `README.md` | Front door: pitch, the GIF, install, a 20-line quickstart per agent, links into the site. Deliberately short — full docs live on the site only (§15). |
| `LICENSE` | **MIT.** Permissive, universally understood, no friction for a dev tool people will fork and vendor. |
| `RELEASING.md` | The release runbook — see below. |
| `CONTRIBUTING.md` | Dev setup, `npm run dev` against a scratch `--dir`, how to run the TUI without polluting your real `~/.planx`, test layout, commit conventions, and a walkthrough for the most likely outside contribution: **adding an agent adapter**. |
| `CODE_OF_CONDUCT.md` | Contributor Covenant 2.1, verbatim. |
| `SECURITY.md` | Private reporting via GitHub Security Advisories, supported versions, and one honest scope statement (below). |
| `.github/ISSUE_TEMPLATE/` | `bug.yml` (auto-collects `planx --version` + channel, agent, OS, terminal), `feature.yml`, `config.yml` pointing questions at Discussions. |
| `.github/PULL_REQUEST_TEMPLATE.md` | Change summary, test evidence, and migration safety checks. |
| `.github/dependabot.yml` | npm + github-actions, weekly, grouped minor/patch. |
| `.github/CODEOWNERS` | `* @thisisnsh` |
| `.editorconfig`, `.nvmrc`, `files` in package.json | Formatting, Node pin (24.x), and shipping `dist/` + `skills/` only — never `site/`, `src/`, or tests. |

**The SECURITY.md scope statement matters more than the boilerplate around it.** Locks are an *integrity* mechanism against agent drift — they stop an agent from quietly rewriting a decision mid-revision. They are **not a security boundary against a hostile agent**: anything with shell access can edit `~/.planx` directly. Saying that plainly in `SECURITY.md` prevents both a bad-faith CVE and, worse, someone trusting locks for something they were never built to do.

### `RELEASING.md`

The runbook, written so a release is mechanical:

1. **Channels** — the table from §13: a local staging command → `staging`; GitHub Release → `latest`.
2. **Cutting a release** — bump `version` in `package.json`, merge that PR, smoke-test `npm i -g @thisisnsh/planx@staging`, then create the GitHub Release on tag `v1.2.0`. `release.yml` does the rest.
3. **Version policy** — semver. Pre-1.0, breaking changes bump minor. The **`~/.planx` on-disk format is versioned independently** and any migration is described in the GitHub Release notes; that's the thing users can't roll back cleanly.
4. **Rollback** — `npm dist-tag add @thisisnsh/planx@1.1.3 latest` repoints `latest` in seconds and is the first move, always. `npm deprecate` the bad version with a message pointing at the issue. **Unpublish only works within 72 hours** and breaks anyone who pinned the version, so it's a last resort, documented as such rather than left for someone to discover under pressure.
5. **Prerequisites** — a maintainer npm login for staging, trusted publishing plus workflow `id-token: write` for production, and who can create releases.
6. **Post-release verification** — `npm view @thisisnsh/planx dist-tags`, `npx -y @thisisnsh/planx@latest --version`, and one real `/planx` round-trip against a scratch dir.

---

## 15. Website — GitHub Pages

A real docs site at `https://thisisnsh.github.io/planx/` (custom domain wired later if you want one).

**Built with VitePress**, in `site/`, deployed by `.github/workflows/pages.yml` on push to `main`. VitePress over hand-rolled HTML because there are ~10 pages with code samples and a sidebar; over Docusaurus because it's a fraction of the build weight for the same result.

```
site/
  index.md              # landing: one-sentence pitch, the GIF, install block
  guide/
    install.md          # npm i -g, plus the staging channel and how to roll back
    claude-code.md      # quickstart
    codex.md            # quickstart
    review-loop.md      # capture / await / submit, with the wire format
    locking.md          # why it's enforced in the CLI, unlock handshake, seal-on-approve
    diffing.md          # rich vs plain, version refs, --print
    executing.md        # same-window vs new-window, model choice + caveat
    retention.md        # planx clean, trash, restore
  reference/
    cli.md              # generated from the arg parser — never hand-written
    config.md           # config.json schema, adding your own agent
    storage.md          # ~/.planx layout, why files-not-daemon
  troubleshooting.md
```

The landing page leads with an **asciinema recording of the review loop** — agent writes plan, second tab opens, lines get selected, feedback typed, agent revises. That thirty seconds explains the product better than any paragraph, so it's the first thing on the page, not buried in a docs section.

The CLI reference is **generated from the argument parser** in CI and committed. Hand-maintained CLI docs go stale within two releases, without exception.

The README is a short front door — pitch, install, a 20-line quickstart for each agent, and links into the site. Full documentation lives on the site only, so there's exactly one copy of every explanation.

---

## 16. Ingestion adapters

| Source | Mechanism |
|---|---|
| **Claude Code (backfill)** | `~/.claude/plans/*.md` — 17 already on this machine. `planx import --from claude --all` ingests them, title from the H1, created-at from mtime. |
| **Codex (backfill)** | `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`. Codex has no plan files — it emits `update_plan` function calls (65 in local history) carrying a structured step list. The adapter takes the last `update_plan` per session plus surrounding `agent_message` prose, normalized to a markdown checklist. |
| **Anything else** | `some-agent … \| planx capture --stdin --source foo` |

Imports are explicit and user-run. Nothing watches your agent directories in the background.

---

## 17. Implementation

**TypeScript + Ink**, published as `@thisisnsh/planx`.

Chosen over Go/Bubble Tea (better native mouse support) because: one `npm i -g`, no cross-compile matrix, and it's the ecosystem this lives in. The mouse gap is ~100 lines of ANSI parsing, and line-snapped selection makes it *less* code than rev 2's character-precise version — no column tracking, no sub-line offset math. The CLI/TUI boundary stays clean enough to swap the TUI for a Go binary later without touching the file protocol.

```
planx/
  src/
    cli.ts              # arg parsing, subcommand dispatch, reference-doc generator
    store/              # plans dir, atomic writes, index, trash
    protocol/           # capture, await (watch+poll), submit, unlock handshake
    locks/              # anchor resolution, verification, seal, split, splice/skeleton
    diff/               # line + word diff, markdown-aware chunking
    render/             # rich + plain renderers, shared by TUI and --print
    tui/                # Ink app: viewer, mouse, line selection, editors, pickers
    adapters/           # claude, codex, generic
    exec/               # agent registry, argv building, spawn
    install/            # skills, uninstall
  skills/               # source of the three SKILL.md files
  site/                 # VitePress docs
  .github/workflows/    # ci.yml, release.yml, pages.yml
```

Dependencies kept minimal: `ink`, `react`, `diff`, `zod`. Mouse parsing, fuzzy matching, file locking, and markdown rendering hand-rolled.

**Concurrency:** every write is tmp + `rename`. `index.json` and `locks.json` take an advisory lock (`O_EXCL`, stale after 10s). Two `await`s on the same version both receive the same feedback.

**Testing:**
- Protocol tests drive `capture`/`await`/submit as **real subprocesses with real timing** — the handshake is most likely to break, so it gets integration tests, not mocks.
- Lock enforcement gets an adversarial suite: reworded locked block, whitespace-only change, deleted block, marker pointing at a nonexistent lock, marker inside a code fence, two locks with identical text, partial unlock at a boundary, seal on a plan with no `##` headings.
- TUI selection is pure functions over `(lines, events) → annotations`, unit-tested without a terminal.
- Adapters run against fixture transcripts copied from the local `~/.claude` and `~/.codex` histories.

---

## 18. Phasing

**Phase 1 — the loop**
Package + postinstall + the staging script and production release workflow, `capture`, `await`, `show`, `list`, `versions`, `diff` (rich + plain, TUI + `--print`), review TUI with line-based mouse and keyboard selection and multi-annotation submit, `/planx` + `/planx-diff` skills for both agents, README + a minimal site, and the repo scaffolding (LICENSE, RELEASING.md, CONTRIBUTING.md, SECURITY.md, issue/PR templates, dependabot) — all of it lands with the first tagged release, not after it.
*Done when:* Claude writes a plan, you select three ranges in another tab, submit, and Claude revises.

**Phase 2 — locks**
`l`/`u` in the TUI, `locks.json`, capture-time enforcement, the unlock handshake, seal-on-approve, lock splitting, `--skeleton` / `--splice` markers, adversarial test suite.
*Done when:* an agent in bypass-permissions mode tries to rewrite a locked section, gets rejected, asks, and you decide.

**Phase 3 — execution & upkeep**
`execute` (CLI picker + skill), agent + model registry, approve → same-window/new-window handoff, `/planx-execute`, `clean`/`restore`/trash, import adapters, `planx on/off`, `doctor`, the full VitePress site with the asciinema recording.

Approve works from Phase 1 — it ends the loop and reports the final id/version; Phase 2 adds the seal, Phase 3 adds the launcher.

---

## 19. Decisions I made for you

1. **No MCP anywhere.** Files + a blocking subprocess do the whole job in every agent. Costs a resume loop against Claude Code's 600s Bash cap.
2. **planx mode is the only mode; `/planx` exits plan mode via a stub `ExitPlanMode`** rather than trying to coexist with the accept/reject gate. Costs one approval keypress at activation; buys one flow instead of two.
3. **The `ExitPlanMode` hook is dropped**, so install never touches `~/.claude/settings.json`. Backfill is an explicit `planx import`.
4. **Locks are enforced by `capture` refusing to write.** The only way to honor "even in bypass-permissions mode." Consequence: an agent *will* hit a hard failure mid-revision, so the error message is part of the product and tells it exactly what to run next.
5. **Approval seals as per-`##`-section locks**, not one document-wide lock — reuses the unlock handshake, gutter, and skeleton machinery unchanged.
6. **Partial unlock splits a lock** rather than being refused.
7. **Line-snapped selection everywhere**, including mouse drag. Word-level diff highlighting remains, for reading only.
8. **Retention is forever; `planx clean` is manual, soft-deletes to trash, and needs `--purge` to actually destroy.**
9. **Same-window model switching requires one paste from you.** No agent CLI exposes in-session model switching; better to say so than fake it.
10. **Two release channels, no bot commits.** Staging versions are synthesized in CI as `<pkg-version>-staging.<run>`; `package.json` is never rewritten by a workflow. `latest` is a clean rebuild from the release tag rather than a dist-tag promotion of the staging artifact, so no shipped version is named `…-staging.47`.
11. **MIT license.** Permissive and frictionless for a dev tool people will fork and vendor.
12. **`SECURITY.md` states that locks are an integrity mechanism, not a security boundary.** An agent with shell access can edit `~/.planx` directly; saying so prevents both a bad-faith CVE and misplaced trust.
13. **The website is VitePress with a generated CLI reference**; the README is a front door that links to it, so no explanation exists in two places.
14. **TypeScript/Ink over Go/Bubble Tea.** Distribution beats input-handling ergonomics; the boundary stays clean if that's wrong.

## 20. Open questions (non-blocking)

- When a lock's anchor text appears **twice** in a plan, which occurrence is locked? Current answer: the one matching `context_sha` of surrounding lines; ambiguity is a capture-time error rather than a guess.
- Should a sealed plan's next version be a **fork** (new plan id, parent recorded) rather than a revision? Leaning yes once execution exists, so "what was approved" is never retroactively rewritten.
- Does `planx clean --versions-beyond N` need to preserve versions that locks reference (`still_present_in`)? Almost certainly yes — otherwise splice loses its source text. Treat as a constraint, not a question.
