# Use PlanX with Claude Code

## 1. Install and restart

```bash
npm install -g @thisisnsh/planx
```

Start a new Claude Code session so it loads the PlanX skill. If Claude Code was
installed after PlanX, run `planx add-skills --agent claude` first.

## 2. Ask for a plan

```text
/planx add per-user rate limits to uploads
```

Claude Code researches the repository, captures a versioned plan, prints its
ID, and hands the turn to you.

## 3. Review it

Open another terminal and run `planx`. Select exact ranges, attach feedback,
add a whole-plan note, edit lines directly, and press `s` when the review is
ready.

## 4. Revise in context

Choose the revision action in PlanX, or paste:

```text
/planx revise <id>
```

The revision resumes the Claude Code session that wrote the plan, preserving
its repository research and planning context. Review each new version until the
plan is settled.

## 5. Execute the reviewed version

```text
/planx execute <id> v<n>
```

Claude Code reads that stored version and its review, marks it as executed, and
builds it in the current session. Continue with [Review a plan](/review-loop)
or [Execute a reviewed plan](/executing).
