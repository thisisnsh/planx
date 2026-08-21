# planx help

Answer a question about PlanX from the wiki, in chat. Nothing is planned,
captured or changed on this branch.

## First, check it is this branch

`help` is a question about **PlanX itself** — a key, a command, a flag, where
something is stored, whether a workflow is supported.

`/planx help me split the auth module` is not that. It is a task with the word
help in it, and it belongs on the plan branch. The test is what the rest of the
line asks about: PlanX, or the user's own work.

When it reads both ways, ask which they meant before you fetch anything.

## 1. Read the page that covers it

Every wiki page is one file of markdown, fetchable raw:

```
https://raw.githubusercontent.com/wiki/thisisnsh/planx/<Page>.md
```

| The question is about | Page |
| --- | --- |
| installing, upgrading, where the skills and store land | `Installation` |
| invoking the skill, and the branches it dispatches on | `The-Skill` |
| what the agent does while planning, and plan shape | `Planning` |
| the picker, the review screen, and every key on both | `Reviewing` |
| line feedback, the plan-wide note, direct edits | `Feedback-and-Edits` |
| versions, and reading the diff between them | `Versions-and-Diffs` |
| `s`, the exits, and what a receiving agent gets | `Hand-offs` |
| `ctrl+r`, and getting back into a build | `Resuming-a-Build` |
| `planx defaults`, and using other agents | `Custom-Agents` |
| an exact command, flag or default | `CLI-Reference` |
| something is missing, stale or not where it should be | `Troubleshooting` |
| a short general question | `FAQ` |

Use whatever fetch tool you have; if you have none, run
`curl -fsSL <url>`. Fetch the one page that fits, and a second only if the
first sends you there.

**If no row fits, fetch `Home.md` first.** It indexes every page, and it is
current — the table above ships with the skill and the wiki moves on its own.

## 2. Answer from what you read

Answer in chat, in a few lines, in the words the wiki uses. Quote keys, flags
and commands exactly as written — a key that is nearly right sends someone
pressing it into a screen that does nothing.

Link the page you used, in its readable form:

```
https://github.com/thisisnsh/planx/wiki/<Page>
```

**The wiki decides.** Where it disagrees with what you remember about PlanX,
the wiki is right and you are out of date. `planx --help` and
`planx <command> --help` are worth running when the question is about the
version actually installed on this machine.

## 3. When the wiki does not answer it

Say that plainly, and point at
[Q&A](https://github.com/thisisnsh/planx/discussions/categories/q-a) — an
undocumented question is worth asking where it can be answered once for
everyone. If it is a request for something PlanX does not do, point at
[Ideas](https://github.com/thisisnsh/planx/discussions/categories/ideas)
instead.

Do not fill the gap with a plausible key or flag. An invented one costs the
user a session working out that it was never real.

## Stay on this branch

Run no command that writes: no `capture`, no `revise`, no `execute`. Reading is
fine — `planx list`, `planx --help`, a wiki page.

If the answer turns into work — *so how do I add that?* — do not slide into
planning it. Ask whether to start a plan, and take the plan branch if they say
yes.
