# Execute a reviewed plan

Execution starts from a specific reviewed version. Press `s` in the review and
choose **Execute plan in a new session**, or copy the command into an agent:

```text
/planx execute <id> v<n>
```

<FeatureTerminal example="handoff" />

## What the agent does

The PlanX execute skill reads the stored version and its review before editing
the project. Open feedback becomes build instruction; edited lines are already
settled plan text. The skill records the version as executed before its first
project edit, then implements that version in the current session.

If the plan has no completed review, the agent stops and asks whether to
continue. If implementation reveals that the reviewed plan itself must change,
return to a revision round instead of silently building a different plan.

## Run the command yourself

Paste the exact version when you want an agent session you already control to
perform the build:

```text
/planx execute upload-limits-a3f9 v3
```

Keeping `v3` in the command makes the reviewed input unambiguous even after a
newer revision exists. The picker marks that child version as executed.

Use `/planx revise <id>` instead when the review still requests changes. See
[Review a plan](/review-loop) for the full hand-off.
