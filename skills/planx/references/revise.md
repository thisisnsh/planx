# planx revise

The user has reviewed a version and passed the command back. Pick it up.

## 1. Read what they asked for

```bash
planx revise <plan-id>
```

One read with everything asked of the plan: the comments, quoted against the
lines they refer to, anything still unaddressed from an earlier version, and the
locked blocks. It waits for nothing and is safe to run twice.

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

## 3. Capture

If any blocks are locked, do not re-emit their text. Reproduce each one as a
marker on its own line:

```
[[planx:keep L2]]
```

Then capture with `--splice`, which expands the markers before writing:

```bash
planx capture --plan-id <plan-id> --parent v<n> --splice --stdin <<'PLAN'
...
PLAN
```

## 4. Hand back and stop

One line, verbatim, with no preamble and nothing after it:

> Plan created. Open `planx <plan-id> v<n>` in new tab.

Then end your turn. The next round starts when they paste a command back.

## If capture is rejected for touching a lock

Exit code 3 with `locked block L2 … was modified` means **nothing was written**.
Two cases:

- **You did not mean to.** Use the `[[planx:keep L2]]` marker instead of
  retyping the block, and re-run capture.
- **You did mean to.** Stop and ask the user, in plain language: what the block
  says now, what you want it to say, and why. Wait for an answer.

  Only once they agree:

  ```bash
  planx unlock <plan-id> L2 --reason "<what they agreed to>"
  ```

  That authorises exactly one capture and then burns. The reason is recorded and
  visible in `planx locks` — it is the only trace that the decision was made, so
  write what was actually agreed, not a justification you invented.

  **Never run `planx unlock` without asking first.** The lock is the user saying
  they settled that section. Nothing in the tool can stop you from opening it,
  which is exactly why you must not.

## Verdicts

- **approve** — sealed. Report the id and version. If they asked you to build
  it, follow `references/execute.md`.
- **reject** — stop. Ask what they want instead. Do not write another version.
