# PlanX

A skill for coding agents and a terminal interface that helps you plan like never before. **[planx.sh](https://planx.sh)**

[![npm](https://img.shields.io/npm/v/@thisisnsh/planx?color=ffd400&labelColor=0b0b0c)](https://www.npmjs.com/package/@thisisnsh/planx)
[![ci](https://img.shields.io/github/actions/workflow/status/thisisnsh/planx/ci.yml?branch=main&labelColor=0b0b0c)](https://github.com/thisisnsh/planx/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-ffd400?labelColor=0b0b0c)](LICENSE)

## Build plans worth executing

Planning is not a ritual you perform to make an agent feel prepared. It is the
moment you decide what will be built.

PlanX turns the giant blob of text you read once and lose in chat into a versioned artifact you can actually review — compare revisions, comment on exact lines, make edits, and execute only the version you approve.

```bash
npm install --global @thisisnsh/planx
```

Start a new agent session, then ask for a reviewable plan:

```text
Codex       $planx <task>
Claude Code /planx <task>
```
PlanX installs its skill into existing Codex and Claude Code installations.

<p align="center">
  <img src="https://raw.githubusercontent.com/thisisnsh/planx/main/assets/planx-review.png" alt="PlanX comparing two versions of a plan with a collapsed unchanged section, an edited line, and feedback attached to an exact line" width="920">
</p>

## The workflow

`PLAN → REVIEW → REVISE → EXECUTE`

1. **Plan in an agent.** The agent researches the work and captures a version
   instead of burying its plan in chat.
2. **Review outside the agent.** Run `planx`, read the plan, collapse sections,
   select exact lines, leave feedback, add a whole-plan note, or edit directly.
3. **Revise with context.** Send the review back to the same agent session, or
   hand it to another agent. Every revision becomes a new version you can compare.
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
See removed and added words together. Unchanged sections collapse so your attention
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

## Use the agent you want

Codex and Claude Code get first-class installation and session-aware hand-offs.
PlanX records the session that created a version, so revision can return to the
agent that already researched the repository. Execution opens from the reviewed
version in a fresh session.

You can also configure any command that accepts a trailing prompt. That makes
cross-agent workflows ordinary: one agent can plan, another can revise, and a
third can execute. The receiving agent only needs access to the PlanX skill and
CLI.

#### Installation and agent setup

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

## Configuration

Open the defaults screen with:

```bash
planx defaults
```

Custom revise and execute commands let you use PlanX with custom agent CLIs:

```bash
planx defaults --revise "custom-agent exec --arg"
planx defaults --execute "custom-agent --some-arg"
```

The command must accept a trailing prompt, and the receiving agent
must have the PlanX skill installed.

## Remove the best way to plan

```bash
planx remove-skills
npm uninstall --global @thisisnsh/planx
```

---

[Website](https://planx.sh) ·
[Contributing](CONTRIBUTING.md) ·
[Security](SECURITY.md) ·
[MIT License](LICENSE)
