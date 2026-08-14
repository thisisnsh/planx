# planx revise

The user has reviewed a version and passed the command back. Pick it up.

## 1. Read what they asked for

```bash
planx revise <plan-id> v<n>
```

**The version is required, and it is the one the user handed you.** The command
they pasted names it. Pass that version through unchanged — do not drop it, and
do not substitute `latest`: a plan can gain a version between the review and
this command, and `latest` would quietly point you at one nobody reviewed. If
you genuinely arrived here with no version — the user typed `/planx revise <id>`
from scratch — run `planx list --json`, take the latest from it, and say which
version you are working on in your reply.

One read with everything asked of the plan: the stored version verbatim, the
comments quoted against the lines they refer to, every line the user rewrote by
hand, and anything still unaddressed from an earlier version. It waits for
nothing and is safe to run twice.

**Revise the text it returns, not the copy in your context.** The two are not
the same document even when they say the same thing — yours has been through
your own paraphrase of it. Work from the fenced text under
`### The plan as it stands`.

If it says **no review yet**, say so in one line and revise from what the user
asked for in the chat — that is what the revision is towards when nobody has
annotated the plan. **If the chat holds no request either, ask rather than
capturing a version nobody asked for.**

## 2. Revise

Address **every** comment. Do not summarise them back to the user first; they
wrote them and can already see them. Revise, then show the result.

If it reports comments *still unaddressed from earlier versions*, check each
one. That means the text they quoted survived a version unchanged, so it was
probably skipped rather than handled. Either act on it or say plainly why it no
longer applies.

**Answer questions in your reply; put only work in the plan.** A comment that
asks something — *what does this command do?*, *why can't I do X?* — is answered
in the chat. A plan is what will be built, and an answer is not part of what
will be built. And if revising turns up a decision the comments do not settle,
ask before capturing rather than capturing a guess and explaining it.

**A boundary you drew is a question you did not ask.** Scope is the user's to
set. If you are about to narrow, widen or split what a comment asked for —
anything you would write as *not in scope*, *I read X as Y*, *assuming*, or any
line the comment did not draw — stop and ask. Batch every such question into one
call, and ask **before** capturing. Stating the assumption in the plan and
flagging it in chat is not asking: it puts a decision the user never made into a
document that says what will be built, and the only way to undo it is another
whole review round.

**A plan never contains an out-of-scope section.** The plan is what will be
built. Anything the user declined is said in the chat, immediately before the
hand-off line.

**Keep the heading depth the first version set.** `##`, `###` and `####`, used
liberally, and nothing deeper — those three are exactly what the review can
fold, and flattening a structured plan into long `##` runs takes the folds away
from the reader who was using them.

**A line you are not changing keeps the bytes it already has.** Same words, same
line breaks, same wrapping, same blank lines around it. The user reads the next
version as a diff against this one, so anything you re-emit differently is a row
they have to read and rule out. A paragraph whose words you did not change must
not come back re-wrapped — that is the most common way to fill a diff with
nothing.

**Hard-wrap to 80 physical characters, and re-wrap only what you rewrote.** The
80-column rule governs lines you are writing; it is not licence to re-flow a
paragraph that already satisfies it. When an edit does force a re-wrap, keep it
inside the paragraph you edited rather than letting it run on into the next one.
This applies to the captured plan only, not conversation in chat. Preserve
indentation, headings, fences and list structure; prefer vertical lists to wide
tables; split a command or a code line only where its syntax stays valid.

## 3. Capture it

`planx revise` printed the exact command. Keep `--stdin`, and supply the whole
revised plan with a heredoc, without a temporary file:

```bash
planx capture --plan-id <plan-id> --parent v<n> --stdin \
  --source claude --session-id "$CLAUDE_CODE_SESSION_ID" <<'PLAN'
...
PLAN
```

**Reproduce every reviewer-edited line exactly.** A line under the
`### Edited by the reviewer` heading is already in the stored parent: the review
rewrote it in place on the version it was on. That section tells you what they
changed and that it is settled; it is not work to do, and it is not wording to
put back.

Executing a plan never captures a revision.

### Which agent you are

The session id is what lets the review start you again on the other side of it.
Pass whichever row is yours:

| agent | pass |
| --- | --- |
| Claude Code | `--source claude --session-id "$CLAUDE_CODE_SESSION_ID"` |
| Codex | `--source codex --session-id "$CODEX_THREAD_ID"` |
| neither variable is set | `--source <your agent>`, and no `--session-id` |

Whichever variable is set is the agent you are, and its value is the id.

**If neither is set, take the third row rather than the first.** `--agent`
defaults to `--source`, so borrowing `claude` files the version under an agent
that is not you and can point a resume at the wrong binary. Naming yourself and
leaving `--session-id` off costs only this: the review cannot restart you, so it
hands the user a command to paste back instead. That is a normal way in.

## 4. Hand back and stop

If the user declined something, say so here in one short line — in the chat, not
in the plan. Then, verbatim, with nothing after it — no trailing period, since
the command is there to be copied:

> Plan created. Exit the agent, then run `planx <plan-id> v<n>`

Then end your turn. The user exits the agent and runs that command. After they
submit the review, PlanX resumes this same agent conversation with everything
already in context.

## A review that asked for nothing

`planx revise` says **reviewed with nothing to change** when the user submitted
an empty review. That is them saying the plan is fine, so there is nothing in
the review to revise towards. Say so in one line and revise from what the user
asked for in the chat since. **If the chat holds no such request, do not write
another version** — report the id and version, and if they asked you to build
it, follow `references/execute.md`.
