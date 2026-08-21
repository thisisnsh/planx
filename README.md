# PlanX

[![npm](https://img.shields.io/npm/v/@thisisnsh/planx?color=ffd400&labelColor=0b0b0c)](https://www.npmjs.com/package/@thisisnsh/planx)
[![downloads](https://img.shields.io/npm/dt/@thisisnsh/planx?color=43d595&labelColor=0b0b0c)](https://www.npmjs.com/package/@thisisnsh/planx)
[![ci](https://img.shields.io/github/actions/workflow/status/thisisnsh/planx/ci.yml?branch=main&labelColor=0b0b0c)](https://github.com/thisisnsh/planx/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-ffd400?labelColor=0b0b0c)](LICENSE)

## Make plans you want to read

Planning is not a ritual you perform to make an agent feel prepared. It is for
you to decide what will be built.

PlanX turns the giant blob of text you read once and lose in chat into a
versioned artifact you can actually review:

- Create structured plans.
- Compare every revision.
- Give feedback on exact lines.
- Execute the version you approve.

PlanX allows you to plan and execute with any agent, like Claude writes the plan, you review it, Codex builds it, or reverse, or any two agents you like.

## Install

```bash
npm install --global @thisisnsh/planx
```

PlanX installs its skill into existing Codex and Claude Code agents, and the TUI to review plans.
Full setup detail is in
[Installation](https://github.com/thisisnsh/planx/wiki/Installation).

## How it works

`PLAN → REVIEW → REVISE → EXECUTE → RESUME`

> [!NOTE]
> _Fun fact: This README was recreated using PlanX. Every image below is that plan, being
reviewed._

### 1. Plan with the skill

Using the planning skill, the agent researches the work, writes the structured plan,
captures the version and asks you to review the plan.

```markdown
# Codex       
$planx we need to build something that ...
# Claude Code 
/planx we need to create something that ...
```

More in [The skill](https://github.com/thisisnsh/planx/wiki/The-Skill).

### 2. Review what it wrote

What comes back is a stored version rather than a message in a scrollback:
structured markdown with headings that fold, the context the work needs, and the
checks that prove it at the end. 

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
rewritten approach cannot slip past as a wall of re-flowed text. Press `d` to show/hide diff. 

![A word-level diff between two versions of a plan](docs/images/planx-07-diff.png)

More in
[Versions and diffs](https://github.com/thisisnsh/planx/wiki/Versions-and-Diffs).

### 7. Build it with any agent

Any agent command that takes a trailing prompt can build the plan. Set them once
with `planx defaults` — Claude Code to revise, Codex to execute, or whatever
pair you like — and the review offers them beside the built-in routes. The
receiving agent needs nothing but the PlanX skill.

![planx defaults configured with Claude Code to revise and Codex to execute](docs/images/planx-08-agents.png)


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

## Questions and ideas

Ask anything in
[Q&A](https://github.com/thisisnsh/planx/discussions/categories/q-a) — how a key
works, whether a workflow is supported, why something behaves the way it does.

Have something PlanX should do? Post it in
[Ideas](https://github.com/thisisnsh/planx/discussions/categories/ideas), where
it can be talked through before anyone builds it.

## Star the repo

If PlanX made a plan easier for you to review, please
[star it on GitHub](https://github.com/thisisnsh/planx). It takes a second, it
tells me the tool is worth continuing, and it is how the next person who is
tired of losing plans in a scrollback finds it.

---

[Wiki](https://github.com/thisisnsh/planx/wiki) ·
[Q&A](https://github.com/thisisnsh/planx/discussions/categories/q-a) ·
[Ideas](https://github.com/thisisnsh/planx/discussions/categories/ideas) ·
[Contributing](CONTRIBUTING.md) ·
[Security](SECURITY.md) ·
[MIT License](LICENSE)
