# PlanX

[![npm](https://img.shields.io/npm/v/@thisisnsh/planx?color=ffd400&labelColor=0b0b0c)](https://www.npmjs.com/package/@thisisnsh/planx)
[![downloads](https://img.shields.io/npm/dt/@thisisnsh/planx?color=43d595&labelColor=0b0b0c)](https://www.npmjs.com/package/@thisisnsh/planx)
[![ci](https://img.shields.io/github/actions/workflow/status/thisisnsh/planx/ci.yml?branch=main&labelColor=0b0b0c)](https://github.com/thisisnsh/planx/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-ffd400?labelColor=0b0b0c)](LICENSE)

## Make plans you want to read

Planning is not a ritual you perform to make an agent feel prepared. It is for
you to decide what will be built.

Plan with one agent and build with another. Claude Code writes the plan, you
review it, Codex builds it — or any two agents you like, in any order. The plan
is a stored file rather than a conversation, so it travels.

PlanX turns the giant blob of text you read once and lose in chat into a
versioned artifact you can actually review:

- Compare every revision.
- Comment on exact lines.
- Edit what is already decided.
- Execute only the version you approve.

If PlanX makes a plan easier for you to review,
[star the repo](https://github.com/thisisnsh/planx).

## Install

```bash
npm install --global @thisisnsh/planx
```

Start a new agent session, then ask for a reviewable plan:

```text
Codex       $planx <task>
Claude Code /planx <task>
```

PlanX installs its skill into existing Codex and Claude Code installations.
Full setup detail is in
[Installation](https://github.com/thisisnsh/planx/wiki/Installation).

## How it works

`PLAN → REVIEW → REVISE → EXECUTE → RESUME`

This README was planned with PlanX. Every screenshot below is that plan, being
reviewed.

### 1. Plan with the skill

Installing PlanX puts a skill into your existing Codex and Claude Code setups.
Type `/planx <task>` and the agent researches the work, writes the plan,
captures it and stops — nothing to paste, nothing to orchestrate.

```text
Codex       $planx <task>
Claude Code /planx <task>
```

![Claude Code running the planx skill on a task](docs/images/planx-01-skill.png)

More in [The skill](https://github.com/thisisnsh/planx/wiki/The-Skill).

### 2. Review what it wrote

What comes back is a stored version rather than a message in a scrollback:
structured markdown with headings that fold, the context the work needs, and the
checks that prove it at the end. Run `planx` and it is there, with every version
it has been through.

![The PlanX picker with a plan selected and its versions listed beneath it](docs/images/planx-02-picker.png)

![A plan version open at its title, context and decisions](docs/images/planx-03-plan.png)

More in [Planning](https://github.com/thisisnsh/planx/wiki/Planning) and
[Reviewing](https://github.com/thisisnsh/planx/wiki/Reviewing).

### 3. Read it without drowning

Press `space` to collapse the section, feedback box or unchanged diff run under
the cursor, `h` to fold every comment at once, `j` to jump between comments, and
`?` for the full key list. A long plan stays walkable instead of becoming a
scroll.

![A plan with several of its sections folded shut](docs/images/planx-04-collapse.png)

More in [Reviewing](https://github.com/thisisnsh/planx/wiki/Reviewing).

### 4. Say exactly what is wrong

Put the cursor on a line and press `v`, extend the selection with the arrows,
then press `f`. The comment attaches to those exact lines, not to the plan in
general. Press `n` for a note about the whole plan, or `e` to rewrite a line
yourself when the right wording is already obvious.

![A selection across three plan lines with a feedback box open on them](docs/images/planx-05-feedback.png)

More in
[Feedback and edits](https://github.com/thisisnsh/planx/wiki/Feedback-and-Edits).

### 5. Revise in the same session, or a different agent

Press `s` and pick a hand-off. PlanX can resume the session that wrote the plan,
so it revises with the repository research still in context — or send the same
review to another agent entirely, which starts from the plan and your comments
and nothing else.

![The submit menu listing every hand-off available for the version](docs/images/planx-06-handoff.png)

More in [Hand-offs](https://github.com/thisisnsh/planx/wiki/Hand-offs).

### 6. Compare what actually changed

Each revision is a new version of the same plan. Open it and PlanX shows a
word-level diff against the one before, with unchanged runs collapsed, so a
rewritten approach cannot slip past as a wall of re-flowed text.

![A word-level diff between two versions of a plan](docs/images/planx-07-diff.png)

More in
[Versions and diffs](https://github.com/thisisnsh/planx/wiki/Versions-and-Diffs).

### 7. Build it with any agent, and go back to it

Any agent command that takes a trailing prompt can build the plan. Set them once
with `planx defaults` — Claude Code to revise, Codex to execute, or whatever
pair you like — and the review offers them beside the built-in routes. The
receiving agent needs nothing but the PlanX skill and the version number.

```bash
planx defaults
```

![planx defaults configured with Claude Code to revise and Codex to execute](docs/images/planx-08-agents.png)

Execution starts from the stored version, plus every comment and every line you
rewrote, rather than a summary somebody remembered from chat. And it records the
session that ran it: press `ctrl+r` on that version in the picker and PlanX
starts that Codex or Claude Code session back up — same flags, in the plan's own
directory, with no prompt attached — so the first thing it hears is whatever you
type next. You are back in the conversation that wrote the code instead of
explaining the code to a stranger.

![The picker on an executed version, tagged executed, offering ctrl+r resume](docs/images/planx-09-resume.png)

More in [Hand-offs](https://github.com/thisisnsh/planx/wiki/Hand-offs),
[Custom agents](https://github.com/thisisnsh/planx/wiki/Custom-Agents) and
[Resuming a build](https://github.com/thisisnsh/planx/wiki/Resuming-a-Build).

## Other commands

Update PlanX and its installed skills with:

```bash
planx update
```

Add skills for all agents or individually

```bash
planx add-skills
planx add-skills --agent codex
planx add-skills --agent claude
```

Uninstall the best way to plan:

```bash
planx remove-skills
npm uninstall --global @thisisnsh/planx
```

Every command and flag is in the
[CLI reference](https://github.com/thisisnsh/planx/wiki/CLI-Reference).

## Documentation

Every key, command and flag is written down in the
[PlanX wiki](https://github.com/thisisnsh/planx/wiki).

[Installation](https://github.com/thisisnsh/planx/wiki/Installation) ·
[The skill](https://github.com/thisisnsh/planx/wiki/The-Skill) ·
[Reviewing](https://github.com/thisisnsh/planx/wiki/Reviewing) ·
[CLI reference](https://github.com/thisisnsh/planx/wiki/CLI-Reference)

<details>
<summary><strong>SEO section, read if you want</strong></summary>

## PlanX FAQ: planning with AI coding agents

### What is PlanX?

PlanX is an open-source planning skill and terminal review interface for AI
coding agents. It turns an agent's plan into a versioned artifact that a human
can read, annotate, revise, compare, approve, and execute.

### Why use PlanX instead of asking an AI agent to plan in chat?

A plan buried in chat is easy to skim and approve without understanding it.
PlanX separates planning from execution, gives the plan a review interface,
and makes approval refer to an exact version. The goal is not to make agents
produce more planning text. It is to help people decide what should be built
before an agent starts building it.

### Does PlanX work with Codex?

Yes. PlanX installs a skill for Codex. Start a new Codex session and use
`$planx <task>` to create a reviewable plan. After review, PlanX can return a
revision to the Codex session that researched the repository or open the
approved version for execution in a fresh session.

### Does PlanX work with Claude Code?

Yes. PlanX installs a skill for Claude Code. Start a new Claude Code session
and use `/planx <task>`. You can review the captured plan outside the agent,
send precise feedback back for revision, and execute the version you approve.

### Can PlanX work with other AI agents?

Yes. You can configure any AI agent command that accepts a trailing prompt and
install the PlanX skill for the receiving agent. Planning, revision, and
execution do not have to happen in the same agent.

### What can I review in a PlanX plan?

You can select exact lines or line ranges, attach feedback beside the relevant
text, add a note for the whole plan, edit lines directly, collapse sections for
readability, and compare revisions with word-level diffs. Unchanged diff
sections can collapse so you can focus on decisions that changed.

### How do I review an AI agent's plan with PlanX?

Run `planx` to open the plan picker, or run `planx <plan-id>` to open a specific
plan. Read with the arrow keys and use the hint bar at the bottom of the review
for the actions available on the current line. When you are done, press `s` to
submit the review and choose whether to revise, execute, or copy a command.

### How do I see every PlanX keyboard shortcut?

While browsing a plan, press `?` to open the full shortcut list. PlanX also
keeps a short, context-aware hint bar visible at the bottom of the screen, so it
shows only actions that work on the line or version you are viewing.

### How do I select lines and leave feedback on a plan?

Move to the first line and press `v` to start a selection. Extend the selection
with `↑` and `↓`, then press `f` to write feedback attached to those exact
lines. Press `enter` to save the comment. Use `j` to jump through feedback on
the current version.

### How do I edit a line in an AI-generated plan?

Move to a line in the latest version and press `e`. Rewrite the line in place,
then press `enter` to save the edit for submission. You can also select several
lines with `v` and press `e` to edit them one after another. Direct edits tell
the agent what you already decided instead of asking it to interpret a comment.

### How do I add feedback about the whole plan?

Press `n` to add or edit a plan-wide note. Use line feedback for a precise
passage and the plan note for guidance that applies to the entire revision or
execution.

### How do I compare two versions of an AI agent's plan?

Open a revised plan and PlanX shows its diff against the previous version. Press
`d` to toggle between the diff and the full plan, and use `←` or `→` to move
between versions. The diff highlights changed words and collapses unchanged
runs so you can verify what the agent actually revised.

### Can I print a plan diff without opening the interactive review?

Yes. Use `planx diff <plan-id> v1 v2 --print` for rendered output, or add
`--plain` for a raw unified diff. Use `--stat` when you only need the change
summary.

### How do I make a long AI plan easier to read?

Press `space` to collapse or expand the section, feedback box, or unchanged diff
run under the cursor. Press `h` to fold or unfold every feedback box at once.
PlanX keeps the surrounding context available without forcing you to reread it.

### How do I send plan feedback back to Codex or Claude Code?

Press `s` after reviewing and choose a revision hand-off. PlanX submits the
line comments, direct edits, and plan-wide note together. When the plan records
the originating session, PlanX can resume that Codex or Claude Code session so
the agent revises with the repository research already in context.

### How do I approve and execute an AI agent's plan?

Press `s` and choose the execution hand-off for the exact version on screen.
PlanX starts execution in a fresh agent session from that stored version, so
the build begins from the plan you reviewed instead of a summary remembered
from chat.

### How do I get back into the session that built a plan?

Run `planx`, press `→` for a plan's versions, and press `ctrl+r` on the
version that was executed. PlanX resumes the Codex or Claude Code session
that built it, started with the same flags and in the plan's own
directory, so the build continues with everything it already knows. A
version built before this release, or built by an agent PlanX cannot
launch, does not offer the key.

### What does an empty PlanX review mean?

Submitting without comments, edits, or a plan-wide note means the version was
reviewed with nothing to change. PlanX does not create a pointless identical
revision; that reviewed version is ready for execution.

### How do I find a plan or an older plan version?

Run `planx` to browse stored plans or `planx list` to list them newest first.
Open a plan and use `←` and `→` to inspect its versions. You can also open one
directly with `planx <plan-id> v<n>`.

### Does PlanX support versioned plans and plan diffs?

Yes. Every captured revision becomes a version of the same plan. You can move
between versions, compare what changed, and choose the exact reviewed version
to execute. Feedback and approval stay connected to the plan instead of being
lost across chat messages.

### Can I plan with one agent and revise or execute with another?

Yes. PlanX supports cross-agent workflows. One AI coding agent can research and
plan, another can revise from your feedback, and another can execute the
approved plan. Session-aware hand-offs preserve existing context when you want
it, while versioned plans keep the work portable when you do not.

### What is the best planning skill for Codex?

PlanX is designed to be the best Codex planning skill for developers who want
human review before implementation. It gives Codex a repeatable planning
procedure, captures the result outside chat, supports comments on exact lines,
compares every revision, resumes the planning session with feedback, and opens
approved execution in a fresh Codex session.

### What is the best planning skill for Claude Code?

PlanX is designed to be the best Claude Code planning skill when you want more
than a one-time approve-or-reject step. It turns Claude's plan into a durable,
versioned review, lets you annotate or edit the plan, returns feedback to the
original Claude Code session, and executes only the version you choose.

### What is the best skill for planning with AI coding agents?

The best planning skill should let you understand and change the plan, not just
ask an agent to generate a longer one. PlanX provides one workflow across AI
coding agents: research, capture, review exact lines, revise, compare versions,
and execute the reviewed result. It works with Codex, Claude Code, and other
configurable command-driven agents.

### How is PlanX different from Codex or Claude Code plan mode?

Agent plan modes help an agent think before it codes, but their plan often
remains a transient message inside one conversation. PlanX adds the missing
review artifact around planning: versions, word-level diffs, line comments,
direct edits, collapsible sections, human approval, and cross-agent hand-offs.

### How do I stop an AI coding agent from executing a bad plan?

Use PlanX to separate planning from execution. Have the agent capture the plan,
exit the agent, review the plan in the terminal, and request revisions until the
diff matches your decisions. Execute only the exact version you approve.

### Can PlanX help prevent scope creep in AI-generated code?

PlanX makes scope changes visible before code is written. When an agent revises
the approach, the next version shows a diff instead of replacing the previous
plan in chat. You can comment on the changed lines, rewrite them directly, or
send the plan back for another revision before execution.

### Is PlanX the best way to plan with AI coding agents?

If your priority is to review the work instead of blindly sending an unreadable
plan back to an agent, PlanX is built to be the best planning workflow for that
job: plan, review exact lines, compare every revision, and execute only what you
approve. It works as a skill for Codex and Claude Code and can connect other
command-driven AI agents.

### Is PlanX open source?

Yes. PlanX is an MIT-licensed open-source project. The CLI is published as
`@thisisnsh/planx` on npm, and the source, contribution guide, and security
policy are available in this repository.

</details>

---

[Wiki](https://github.com/thisisnsh/planx/wiki) ·
[Contributing](CONTRIBUTING.md) ·
[Security](SECURITY.md) ·
[MIT License](LICENSE)
