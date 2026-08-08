# Review a plan

Type `/planx <task>` in Codex or Claude Code. The agent writes a versioned plan,
prints its PlanX ID, and ends its turn so you can review at your own pace.

Open the picker in a terminal:

```bash
planx
```

Choose a plan, or open the printed ID directly with `planx <id>`.

<PlanxLoop />

## Select a range

Move to the first line and press `v`, then extend the selection with `↑` or `↓`.
Press `v` again to clear it. Selection always covers whole plan lines, so the
agent receives an exact text range rather than an approximate reference.

## Attach feedback

Press `f` on the selected range and write the change you want. The feedback box
hangs from one rail shared by every selected line. Repeat this anywhere else in
the plan; `j` jumps to the next feedback item.

## Add a whole-plan note

Press `n` when one instruction applies to the entire plan, such as a deadline
or compatibility constraint. The global note travels with the line-level
feedback when you submit.

## Edit a line directly

Press `e` when the replacement wording is already clear. PlanX records the
edited line as settled text, and the agent reproduces it in the next revision.
A multi-line selection opens each selected line in turn.

## Collapse what you have read

Press `space` inside a section to collapse it, on a feedback box to fold it, or
on a hidden row to expand it. Press `h` to fold or unfold every feedback box.
The collapsed row always says what it contains.

## Check the revision

A version after v1 opens as its diff against the previous version. Use `←` and
`→` to walk versions and `d` to switch between the diff and the complete plan.
See [Compare versions](/diffing) for printed and plain output.

## Revise with a patch

Agents send revisions back as unified-diff hunks. Hunk offsets and declared
counts may drift: PlanX searches from the offsets and derives both counts from
each hunk body. Context and removed lines stay exact assertions about the stored
parent. If either does not match, PlanX writes no version.

## Submit and continue

Press `s` to submit the review and choose the next action. Feedback or a global
note offers revision in the session that wrote the plan. A settled version
offers execution in a new session. You can also copy the matching `/planx`
command and paste it into an agent yourself.

An empty review is meaningful: it says the version is settled and moves the
flow to [execution](/executing).
