# Locking

Select lines exactly as you would to comment on them, and press `l` instead of
`c`. Those lines are frozen. `u` on locked lines lifts the lock.

## Enforcement is in the CLI, not in the prompt

This is the critical design decision.

Locks have to hold **even in bypass-permissions mode**, which rules out
enforcement by instruction — a prompt is advice, and an unattended agent will
eventually ignore it.

So `planx capture` refuses to write a version that mutates a locked region. It
exits non-zero and prints the offending diff:

```
✗ planx: locked block L2 ("## Rollout") was modified — version rejected.

  - Deploy behind the `ff_clock_guard` flag, 10% → 50% → 100% over 3 days.
  + Deploy directly to 100%; the flag adds no value here.

  This block is locked. To change it:
      planx unlock guard-clock-regression-a3f9 L2 --reason "..."
  Then re-run capture. Nothing was written.
```

The agent physically cannot land the change. It has one path forward: ask.

Two consequences worth internalising:

- An agent **will** hit a hard failure mid-revision. That is the design working,
  not a bug — which is why the error message is part of the product and ends
  with the exact command that unblocks it.
- Nothing is written on rejection. The store is byte-identical afterwards, so
  the agent can fix its output and re-run safely.

::: warning What locks are not
Locks are an integrity mechanism against agent drift, **not a security boundary
against a hostile agent**. Anything with shell access can edit `~/.planx`
directly. See [SECURITY.md](https://github.com/thisisnsh/planx/blob/main/SECURITY.md).
:::

## What counts as a modification

The lock's stored text must appear, verbatim, in the new version.

- Rewording it — rejected.
- Changing leading or interior whitespace — rejected.
- **Deleting it — rejected.** Deletion is a modification, by the same path.
- Trailing whitespace on a line — allowed. That is the only normalization, and
  it exists because editors add it silently.
- Duplicating it so the text now appears twice — **rejected**, as ambiguous.
  planx will not guess which copy is the locked one.

## Lifting a lock

A rejected capture stops the agent. It has to come back and explain itself: what
the block says now, what it wants it to say, and why. Only once you agree does
it run:

```bash
planx unlock <id> L2 --reason "the flag adds no value for a guard this cheap"
```

**A grant is single-use and scoped to one lock.** It authorises exactly one
capture that may modify `L2`, then the lock re-arms against the new content. No
blanket unlocks, no drift. A second edit to the same block needs asking again.

There is no matching `--deny`, because nothing is blocked waiting for one. If
you say no, the command simply never runs.

### This makes locks advisory, not enforced

The agent issues that unlock itself. Nothing verifies that you agreed, or that
it asked at all — an agent that decides its reason is good enough can open any
lock in the store. Locks stop **accidental** rewriting, which is the failure
that actually happens, not **determined** rewriting.

What holds it accountable is the record. The stated reason is written onto the
grant rather than printed and discarded, so every unlock is visible after the
fact:

```bash
planx locks <id>
```

If an unlock appears there that you do not remember agreeing to, that is the
signal. See [SECURITY.md](https://github.com/thisisnsh/planx/blob/main/SECURITY.md).

## Approval seals the entire plan

When you approve a version, planx locks every line of it: one lock per `##`
section, plus one for any preamble above the first heading.

Per-section rather than one document-wide lock, because it reuses every piece of
machinery that already exists — the unlock handshake names a lock, the TUI shows
locks in the gutter, and `--skeleton` collapses them individually. A single
monolithic lock would need its own special case for all three.

A plan with no `##` headings at all seals as one block.

After approval you can still `planx diff` the plan and select lines to
**unlock**. Carving a hole in a sealed plan is a normal, supported operation —
it just has to be your explicit act.

## Partial unlock splits a lock

Unlock lines 95–98 of a lock spanning 88–104 and you get two locks (88–94 and
99–104) with the middle free. The alternative — refusing partial unlocks —
would force you to unfreeze a whole section to change one line.

The leading fragment keeps the original lock id, so an outstanding grant against
it still resolves to something meaningful.

## Lock records

```jsonc
// ~/.planx/plans/<id>/locks.json
{
  "sealed_at": "2026-08-02T00:14:03Z",     // set on approval; null before
  "locks": {
    "L2": {
      "created": "2026-08-01T23:40:11Z",
      "origin": "user",                     // "user" | "seal"
      "section": "## Rollout",
      "sha256": "c41b…",                    // of the normalized locked lines
      "context_sha": "9f2c…",               // disambiguates a repeated block
      "text": "…",                          // verbatim, so it can be re-spliced
      "first_locked_version": 2,
      "still_present_in": 3,
      "consumed_grant": null
    }
  }
}
```

Locks live at the **plan** level and carry forward across versions
automatically.

## Repeated text

If a lock's text appears twice in a plan, planx picks the occurrence whose
surrounding lines match `context_sha`. If that still cannot break the tie, the
capture is rejected as ambiguous rather than guessed at — locking the wrong half
of a document because two sections read alike is worse than making you look.
