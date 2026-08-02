# planx redesign

Everything from the review notes, plus the removal of `await`, as one sequenced
plan. Uncommitted and disposable — delete it once we agree.

Two things drive the shape of this: the review loop stops being a blocking
protocol and becomes a paste, and the TUI stops being a diff viewer with an
overlay and becomes a document you edit in place.

---

## Phase 0 — remove `await`

The realisation that makes this cheap: **`await` was only a notification
mechanism, never a transport.** Feedback is written to disk by the TUI and read
back with a `readdir` + parse. Deleting the blocking loop loses no data and no
capability, only the push. Grants already live in `locks.json`
(`locks.grants`, `issueGrant`/`consumeGrant`), so the single-use unlock and the
re-arm-on-capture behaviour survive untouched.

### Delete

| what | where |
| --- | --- |
| the blocking loop | `src/protocol/await.ts` (whole file) |
| inbox queue | `src/store/queue.ts` — `writeRequest`, `removeRequest`, `listRequests`, `writeResponse`, `listResponses`, `markResponseConsumed`, `pendingUnlockResponses` |
| feedback queue semantics | `src/store/queue.ts` — `openFeedback`, `markFeedbackDelivered`, `markFeedbackAddressed` |
| inbox schema | `src/store/types.ts` — `AwaitRequestSchema`, `AwaitResponseSchema`, `Feedback.delivered_to`, `Feedback.addressed_by` |
| signal cleanup | `src/signals.ts` — `cleanupOnSignals` loses its only caller |
| CLI commands | `await`, `unlock-request`, `submit`, `execute` |
| config key | `awaitTimeout` |
| TUI | `pending` prop, `describeBanner`, the whole unlock overlay, `ReviewResult.unlock` and `action: 'unlock'` |

`~/.planx/plans/*/inbox/` disappears from the store layout.

**`queue.ts` becomes `feedback.ts`.** Most of its feedback half was queue
machinery serving async delivery, and dies with it. `openFeedback` and
`markFeedbackDelivered` have no caller but `await.ts`. `markFeedbackAddressed`
(called from `capture.ts:164`) stamps `addressed_by` on feedback from older
versions — which is derivable from `feedback.version < latest` using data
already in the store, so the field and the write both go, and `capture` stops
touching feedback at all. Its only reader is the "N earlier notes still waiting
for the agent" line in `ReviewApp`, an await-era concept.

What survives is `writeFeedback` and `listFeedback` over a directory of JSON
files. That is storage, not a queue, and the module should stop claiming
otherwise.

Feedback stays on disk rather than riding along in the clipboard paste: the
records carry quoted line context and get long, the TUI reads them back so you
can see what you already asked for on this version, and clipboards are
unreliable over ssh, in tmux, and on Linux without `xclip`. The file is the
durable thing; the clipboard is a convenience over it.

`submit` and `execute` are safe to remove: I grepped both skills and neither
calls them, and neither has a caller inside `src/` besides its dispatch entry.
`planx execute` is also the only consumer of the orphan fix from earlier, so
`forwardSignals` goes with it.

### Add

**`planx resume <id> [--json]`** — a pure read that answers the only question an
agent has when it picks the plan back up: *what am I revising, and what did they
ask for?* It prints the current version in skeleton form, the feedback anchored
to its lines, and the locks. One call, not the `show --skeleton` plus
feedback-read pair the old flow needed.

It also flags feedback that was never addressed. Capturing a new version
silently declares the previous version's feedback handled, whether or not the
agent did anything about it — a blind spot that exists today too. `resume` is
the one place positioned to notice, so it reports
`2 comments on v2 were never addressed` rather than letting them vanish.

This is the entire replacement for `await` — roughly thirty lines against the
two hundred deleted.

### Hand-off instead of blocking

On submit, the TUI prints and copies the command to paste into the agent:

```
✓ 3 comments on guard-clock-a3f9 v2
  tell your agent:  planx resume guard-clock-a3f9
  (copied to clipboard)
```

No leading slash. Intent is derived from the verdict rather than offered as a
menu — revise prints `resume`, approve prints `execute`, reject prints nothing.
The reviewer already stated intent by choosing a verdict; asking twice invites
picking "execute" on a plan with three unaddressed comments.

Because `resume` is a real CLI command, the pasted string is safe in either
place: in the agent it triggers the skill branch, and in a shell it simply
prints your own review back at you. There is no wrong window to paste it into.

### Unlock, without the round-trip

1. Agent revises, runs `capture`, hits the existing `locked block L2 … was
   modified` rejection. Nothing is written — that guard is unchanged.
2. Agent **stops and asks in chat**: what L2 says, what it wants instead, why.
3. User agrees in chat.
4. Agent runs `planx unlock <id> L2 --note "<reason>"` (the renamed
   `unlock-respond`), which issues the same single-use grant as today.
5. Agent re-captures. Grant consumed, lock re-arms on the new text.

> **This makes locks advisory rather than enforced.** Today a human presses a
> key in the TUI to grant. After this the agent issues its own grant and nothing
> verifies the user actually agreed. It stops *accidental* rewriting, not
> *determined* rewriting. Accepting that on the condition it becomes auditable:
> record the agent's stated reason on the `GrantRecord` and surface self-issued
> unlocks in `planx locks` and in the next diff.

---

## Phase 1 — CLI surface

### `planx` with no arguments opens the review

Bare `planx` lists plans, you pick one, it opens the review TUI. `planx --help`
shows help. `planx diff` remains as an alias but stops being the thing people
are told to type.

### Grouped help

`topLevelHelp` currently prints one flat list of twenty-two commands, most of
which exist for the LLM. Add a `group` field to `CommandSpec` and render
sections:

- **Common** — `planx` (review), `list`, `show`, `on`, `off`, `status`
- **Agent** — `capture`, `resume`, `unlock`
- **Maintenance** — `versions`, `locks`, `import`, `clean`, `restore`, `rename`, `config`, `install`, `uninstall`, `doctor`

`site/reference/cli.md` is generated from `spec.ts`, so it needs regenerating,
and the grouping should carry into it.

### Model prompting, deleted

`commands.ts:565` prints `agent.model_switch` as a hint for the user to paste —
it never actually switches anything, which is the "model change is not
happening" note. The approve path is being simplified to not ask about models
at all, so this is fixed by deletion rather than repair. The model picker, the
here/new-window choice, and `model_switch` in config all go.

---

## Phase 2 — skills

Three skills collapse into one router at `skills/planx/SKILL.md`:

| invocation | branch |
| --- | --- |
| `planx <free text>` | research → write → capture → hand off |
| `planx resume <id>` | run `planx resume` → address it → capture → hand off |
| `planx execute <id>` | load and implement in this session |
| `planx diff <id>` | print the diff, no commentary |
| `planx on` / `off` | toggle |

`skills/planx-diff/` and `skills/planx-execute/` are deleted.

**Keep `SKILL.md` thin.** One router file loads entirely into context on every
invocation, so `planx diff` would otherwise pay for the planning and execution
instructions too. The router plus the planning branch stay in `SKILL.md`;
`resume`, `execute` and `diff` detail move to `skills/planx/references/*.md`
that the model reads only on that branch.

**Descriptions get shorter.** The current frontmatter descriptions run to two
full lines each; one short sentence is enough.

**Install leaves stale skills behind.** `uninstall` only removes what it
recorded writing, so previously-installed `planx-diff` and `planx-execute`
directories will linger after the merge. Install needs a sweep for known-retired
skill names.

**"await was not called when I asked for a new plan."** With `await` gone the
specific symptom dissolves, but the underlying gap is real: the router has no
rule for "a plan is already approved and I'm being asked for a different one."
The planning branch needs to start a fresh plan rather than resume the sealed
one.

---

## Phase 3 — the TUI

The largest piece. Today `ReviewApp` renders one row per diff line and collects
comments in a modal `TextPrompt`. It becomes a document with feedback blocks
rendered inline underneath the lines they annotate.

### Keymap

All lowercase. `c` is gone — it collided with ctrl-c.

| key | does |
| --- | --- |
| `↑` `↓` | move the line cursor |
| `v` | start / end a selection, then arrows extend it |
| `f` | feedback on the selection — opens the inline box |
| `l` | lock / unlock the selection (toggle) |
| `s` | submit |
| `a` | approve → confirm |
| `d` | delete the feedback block under the cursor |
| `space` | expand a collapsed run |
| `x` | exit (`q` kept as a synonym) |
| `?` | help |

`enter` confirms and `esc` cancels in the approve dialog.

### Rendering

- **Cursor** — an arrow in a left gutter on the current line.
- **Locks** — a marker in that same left gutter on locked lines.
- **Annotated lines** — a blue dotted border around the span, which stays
  visible whether or not the feedback body is shown.
- **Feedback** — a blue box rendered *below* the span it annotates, editable in
  place. Toggleable open/closed; the dotted border on the lines persists either
  way.
- **Frame** — a border around the whole screen like codex/claude. `planx` and
  the version top-left; bottom-right the repo link, a "star it if it's useful"
  line, and the issues URL for bugs and suggestions.

### Structural changes this forces

`ViewRow` is currently 1:1 with rendered diff lines. Feedback blocks are rows
too — focusable, multi-line, deletable — so `ViewRow` becomes a union of
`diff-line | feedback-block`. Everything that maps a cursor to a document line
(`spanAtCursor`, `isRowSelected`, annotation anchoring, `rowForLine`) has to skip
feedback rows rather than count them. This is the part most likely to be fiddly
and is where I would expect the "per line feedback is not working" bug to have
come from.

**Two input modes.** `s` must insert the letter "s" while typing in a feedback
box and submit while navigating. So the app needs an explicit navigation/editing
mode, with `esc` leaving the box. The current design sidesteps this with a modal
overlay, which is exactly what we're removing.

### Removals

- **Mouse and drag, entirely.** `src/tui/mouse.ts`, the mouse effect,
  `handleMouse`, `mouseOn`, and the `m` key all go. Bonus: with mouse capture
  gone the terminal can select text natively again, and `exitOnCtrlC: false`
  (added only to protect mouse-mode teardown) can be reconsidered.
- **`d` as delete-annotation-under-line** becomes delete-the-feedback-block-you-
  are-standing-on.
- **One feedback per span.** If a selection overlaps existing feedback, focus
  that block for editing rather than refusing — refusing is a dead end.

### Approve

`a` → confirm dialog, `enter` yes, `esc` no. On yes: seal, then print

```
  tell your agent:  planx execute guard-clock-a3f9 v3
```

and exit. No model questions, no here/new-window branch.

### Picker leaves the screen

Selecting a plan currently leaves the picker output scrolled above the review.
The picker should clear before the review mounts so it reads as one screen.

---

## Phase 4 — docs and tests

- Rewrite the await-based cases in `test/integration.test.ts`; keep the
  `test/cleanup.test.ts` cases that still apply once `execute` is gone.
- `test/tui-render.test.tsx` needs reworking for the new row model.
- Regenerate `site/reference/cli.md`.
- The docs still describe a two-tab blocking loop: `site/guide/review-loop.md`,
  `guide/locking.md`, `guide/executing.md`, `guide/claude-code.md`, `README.md`.

---

## Order

Phase 0 before Phase 3, deliberately. Removing `await` deletes a banner, an
overlay and a prop from `ReviewApp.tsx` — the same component Phase 3 rebuilds.
Doing the redesign first means building the new frame and keymap around
machinery that is about to be deleted.

1. `planx resume` read command
2. Skill router + `references/`, shorter descriptions, stale-skill sweep
3. TUI prints and copies the hand-off command on submit
4. Delete `await`, `unlock-request`, `submit`, `execute`; rename `unlock-respond` → `unlock`
5. `queue.ts` → `feedback.ts`; drop `addressed_by` / `delivered_to` and the queue functions
6. Strip banner / unlock overlay / `pending` from `ReviewApp`
7. Bare `planx` opens review; grouped help; regenerate CLI docs
8. TUI rebuild: row model, then keymap, then inline feedback, then the frame
9. Schema prune, tests, docs

Committed atomically, one step per commit, no co-author trailer.

---

## Open questions

1. **"monitor task does not stop and remove itself"** — there is no `monitor`
   anywhere in planx (I grepped `src/` and `skills/`). I read this as Claude
   Code's Monitor tool rather than something in this repo. Out of scope unless
   you meant something else.

2. **`planx import`** — survives as maintenance, but it backfills from agent
   history and nothing else references it. Keep, or retire alongside `submit`?

3. **Blue on a light terminal.** The dotted border and feedback box are
   specified as blue; on light backgrounds that can be low-contrast. Fine to
   fix later, but worth knowing it's a known gap rather than an oversight.
