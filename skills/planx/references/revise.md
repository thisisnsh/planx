# planx revise

The user has reviewed a version and passed the command back. Pick it up.

## 1. Read what they asked for

```bash
planx revise <plan-id>
```

One read with everything asked of the plan: the comments, quoted against the
lines they refer to, every line the user rewrote by hand, and anything still
unaddressed from an earlier version. It waits for nothing and is safe to run
twice.

It does **not** return the plan. You wrote it, so you have it. If you no longer
have it in context, run `planx show <plan-id> --plain` — do not assume `revise`
will hand it to you.

If it says **no review yet**, stop and tell the user. Do not revise — there is
nothing to revise towards.

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

**Hard-wrap the plan to 80 physical characters per line.** This applies to the
captured plan only, not conversation in chat. Preserve indentation, headings,
fences and list structure; prefer vertical lists to wide tables; split a command
or a code line only where its syntax stays valid.

## 3. Capture it as a patch

`planx revise` printed the exact command. Add `--patch` and send a unified diff
against the parent instead of the whole plan:

```bash
planx capture --plan-id <plan-id> --parent v<n> --patch --stdin \
  --source claude --session-id "$CLAUDE_CODE_SESSION_ID" <<'PATCH'
@@ -12,4 +12,4 @@
 ## Capture
 Capture through stdin, as the agent that wrote the plan.
-Send the whole plan every round.
+Send only the hunks that changed.
 Keep the plan id and version it prints.
PATCH
```

This is the format `planx diff --plain` prints, read the other way round. A
revision that changes three lines of a two-hundred-line plan costs three lines
of output rather than two hundred, and it costs that every single round. planx
stores the whole document either way.

**Patch against the stored parent, byte for byte** — which is what `planx show
<plan-id> --plain` prints, not the plan as you last wrote it. A line under
`### Edited by the reviewer` is *already in that text*: the review rewrote it in
place on the version it was on. That section tells you what they changed and
that it is settled; it is not work to do. **Do not write a hunk that puts a
reviewer's wording back** — there is nothing to put back, and the `-` line you
would quote is your old wording, which is no longer there, so the hunk will not
match. Leave those lines out of the patch entirely unless a comment asks you to
change them again.

**Give every hunk at least three lines of context, and make the counts in the
`@@` header match the body under it.** planx searches outward from the line
number in the header, so an offset you miscounted is absorbed; a context line
that occurs twice in the plan is not, and neither is a header whose counts are
wrong.

planx answers with what it applied — `Applied 3 hunks: +12 −4.` — and that is
your only sight of the document you just wrote. If those numbers are not the
change you meant, say so instead of moving on.

### When a patch will not do

**A hunk that does not match writes nothing**, and planx says which one. Do what
it tells you: re-read the parent with `planx show <plan-id> --plain`, then
capture the full text.

Skip the patch and capture full text from the start when the revision rewrites
most of the plan anyway — a diff of a document against its replacement is bigger
than the replacement.

```bash
planx capture --plan-id <plan-id> --parent v<n> --stdin \
  --source claude --session-id "$CLAUDE_CODE_SESSION_ID" <<'PLAN'
...
PLAN
```

### Which agent you are

The session id is what lets the review start you again on the other side of it.
Pass whichever row is yours, on either form of the command:

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
in the plan. Then, verbatim, with nothing after it:

> Plan created. Open `planx <plan-id> v<n>` in new tab.

Then end your turn. The next round starts when they paste a command back.

## A review that asked for nothing

`planx revise` says **reviewed with nothing to change** when the user submitted
an empty review. That is them saying the plan is fine. Do not write another
version — report the id and version, and if they asked you to build it, follow
`references/execute.md`.
