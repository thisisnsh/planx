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

If it reports comments *still unaddressed from earlier versions*, check each one.
That means the text they quoted survived a version unchanged, so it was probably
skipped rather than handled. Either act on it or say plainly why it no longer
applies.

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

## 3. Capture

```bash
planx capture --plan-id <plan-id> --parent v<n> --stdin <<'PLAN'
...
PLAN
```

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
