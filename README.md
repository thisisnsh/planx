<div align="center">

# PlanX

**Review the plan. Not the agent's confidence.**

A skill and terminal review interface for Codex, Claude Code, and other coding
agents.

[Website](https://planx.sh) ·
[npm](https://www.npmjs.com/package/@thisisnsh/planx) ·
[GitHub](https://github.com/thisisnsh/planx)

[![npm](https://img.shields.io/npm/v/@thisisnsh/planx?color=ffd400&labelColor=0b0b0c)](https://www.npmjs.com/package/@thisisnsh/planx)
[![ci](https://img.shields.io/github/actions/workflow/status/thisisnsh/planx/ci.yml?branch=main&labelColor=0b0b0c)](https://github.com/thisisnsh/planx/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-ffd400?labelColor=0b0b0c)](LICENSE)

</div>

> [!TIP]
> **You've been planning with agents all wrong.** A plan is not disposable chat
> between prompts. It is the work you are about to approve. Read it, challenge
> it, revise it, and only then hand it to an agent to build.

Agents can produce a wall of plausible-looking steps in seconds. PlanX turns
that wall into a versioned artifact you can actually review: compare revisions,
comment on exact lines, edit what is already decided, and execute only the
version you approve.

<p align="center">
  <img src="https://raw.githubusercontent.com/thisisnsh/planx/main/assets/planx-review.png" alt="PlanX comparing two versions of a plan with a collapsed unchanged section, an edited line, and feedback attached to an exact line" width="920">
</p>

<p align="center"><sub>The same screen shows a version diff, collapsed context, a direct edit, and feedback anchored to one exact line.</sub></p>

## Start in ten seconds

```bash
npm install --global @thisisnsh/planx
```

Start a new agent session, then ask for a reviewable plan:

```text
Codex       $planx <task>
Claude Code /planx <task>
```

PlanX installs its skill into existing Codex and Claude Code installations.
The packaged skill and custom hand-off commands also let other agent CLIs join
the workflow.

## The loop

`PLAN → REVIEW → REVISE → EXECUTE`

1. **Plan in an agent.** The agent researches the work and captures `v1` instead
   of burying its plan in chat.
2. **Review outside the chat.** Run `planx`, read the plan, select exact lines,
   leave feedback, add a whole-plan note, or edit settled wording yourself.
3. **Revise with context.** Send the review back to the same agent session, or
   hand it to another agent. Every revision becomes a version you can compare.
4. **Execute what you approved.** Choose an exact reviewed version and let the
   agent build that version—not a fuzzy recollection of the conversation.

## What changes when plans become reviewable

<table>
<tr>
<td width="50%" valign="top">
<h3>Versioned, not overwritten</h3>
Every revision stays attached to the plan. Walk from the first proposal to the
settled version without losing the decisions that shaped it.
</td>
<td width="50%" valign="top">
<h3>Diffs, not rereading</h3>
See removed and added words together. Unchanged runs collapse so your attention
goes to the decisions that moved.
</td>
</tr>
<tr>
<td width="50%" valign="top">
<h3>Exact feedback, not vague prompts</h3>
Select one line or a range. The agent receives your comment beside the exact
text it needs to change.
</td>
<td width="50%" valign="top">
<h3>Notes and direct edits</h3>
Add one instruction for the whole plan, or rewrite a line yourself when the
right wording is already obvious.
</td>
</tr>
<tr>
<td width="50%" valign="top">
<h3>Readable at any length</h3>
Collapse sections, feedback boxes, and unchanged diff runs. Keep the current
decision visible without deleting its context.
</td>
<td width="50%" valign="top">
<h3>Agent-agnostic hand-offs</h3>
Plan in Codex, revise in Claude Code, execute with another agent—or keep the
entire loop in one agent session.
</td>
</tr>
</table>

> [!NOTE]
> **Screenshot placeholder — version history and comparison.** Show the plan
> picker expanded to several versions beside the `v3 ← v2` review. This image
> will demonstrate versioned plans, navigation, word-level diffing, and
> collapsed unchanged runs together.

> [!NOTE]
> **Screenshot placeholder — hand-off.** Show the submit menu with revise,
> execute, and custom-agent commands. This image will demonstrate same-agent
> revision, cross-agent workflows, and execution from an exact version.

## Use the agent you want

Codex and Claude Code get first-class installation and session-aware hand-offs.
PlanX records the session that created a version, so revision can return to the
agent that already researched the repository. Execution opens from the reviewed
version in a fresh session.

You can also configure any command that accepts a trailing prompt. That makes
cross-agent workflows ordinary: one agent can plan, another can revise, and a
third can execute. The receiving agent only needs access to the PlanX skill and
CLI.

<details>
<summary><strong>Installation and agent setup</strong></summary>

PlanX requires Node.js 20.19 or newer. The npm installation adds the `planx`
CLI and writes the PlanX skill into agent directories that already exist.

If you install an agent later, refresh its skills:

```bash
planx add-skills
planx add-skills --agent codex
planx add-skills --agent claude
```

Start a new agent session after installing or refreshing the skill. Set
`PLANX_NO_POSTINSTALL=1` before npm installation to skip automatic skill setup.

To update PlanX, run `planx update`.

</details>

<details>
<summary><strong>Review controls</strong></summary>

| Key | Action |
| --- | --- |
| `↑` / `↓` | Move through the plan |
| `v` | Select one line or a range |
| `f` | Attach feedback to the selection |
| `n` | Add a whole-plan note |
| `e` | Edit selected lines directly |
| `←` / `→` | Move through versions |
| `d` | Switch between the diff and complete plan |
| `space` | Collapse or expand context |
| `s` | Submit and choose revision or execution |
| `?` | Open all controls |

</details>

<details>
<summary><strong>Configuration</strong></summary>

Open the defaults screen with:

```bash
planx defaults
```

Custom revise and execute commands let PlanX hand an exact skill prompt to
another agent CLI:

```bash
planx defaults --revise "codex exec --full-auto"
planx defaults --execute "claude"
```

PlanX appends `$planx ...` for Codex commands and `/planx ...` for other
commands. The command must accept a trailing prompt, and the receiving agent
must have the PlanX skill installed.

Set rich or plain printed output in `~/.planx/config.json`, or override one
command with `--rich` or `--plain`.

</details>

<details>
<summary><strong>CLI and non-interactive output</strong></summary>

```bash
planx                              # pick and review a plan
planx <id> [version]               # open one version directly
planx list                         # list plans and versions
planx show <id> [version] --plain  # print a complete version
planx diff <id> v2 v3 --print      # print a version diff
planx diff <id> --stat             # summarize changes
planx revise <id>                  # print review context for an agent
planx doctor                       # validate plans and rebuild the index
```

Rich output preserves color and word highlights. Plain output works in files,
pipes, scripts, and agent prompts.

</details>

<details>
<summary><strong>Plans, cleanup, and removal</strong></summary>

Plans remain available until you delete them. Use `Ctrl+D` in the picker to
delete a selected version or plan after confirmation. Deletion is permanent.

`planx doctor` validates stored plans and repairs the picker index. To remove
PlanX without silently deleting your plans:

```bash
planx remove-skills
npm uninstall --global @thisisnsh/planx
```

PlanX asks separately before removing its saved plans.

</details>

## Build plans worth executing

Planning is not a ritual you perform to make an agent feel prepared. It is the
moment you decide what will be built. PlanX gives that decision a place to be
read, challenged, revised, and approved.

```bash
npm install --global @thisisnsh/planx
```

[Website](https://planx.sh) ·
[Contributing](CONTRIBUTING.md) ·
[Security](SECURITY.md) ·
[MIT License](LICENSE)
