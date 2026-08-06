# Deleting

Plans are kept **forever** by default. Nothing expires, nothing is pruned
automatically, and there is no background GC. They are a few kilobytes each.

Deleting is something you do by hand, in the picker, on the row in front of you.

## `^d`, in the picker

Open bare `planx`, put the cursor on what you want gone, and press `^d`.

- On a **plan row**, that is the whole plan and every version of it.
- On a **version row** — press `→` on a plan to open its versions — that is
  that one version.

<PlanxPicker />

A red line at the foot names the target in full before anything happens:

```
delete guard-clock-a3f9 v3? this cannot be undone
```

`enter` confirms, `esc` backs out. `^d` is only offered when the highlighted row
can actually be deleted, so a key that is going to refuse is a key you never
see.

**It is `^d` and not `d`** because every printable character goes to the filter.
A bare `d` took the keystroke before the filter saw it, so no plan whose name
starts with a `d` could be filtered for — and finding a plan is what the list is
for.

## It is permanent

There is no trash. Deleted is gone.

planx used to soft-delete to `~/.planx/.trash/` with a `planx restore` to bring
things back, and nobody ever emptied it — a soft delete you never empty is a
directory full of plans you have already decided you do not want. The red
confirmation is what stands in its place, which is why it names the target
rather than asking about "this".

## What cannot be deleted

One version row refuses, and says so by not offering the key:

- **The latest version.** A plan with no current text is not a plan, and every
  read path assumes one exists.

Deleting the plan itself is always allowed.

## Repairing the index

`index.json` is a derived cache — `planx list` and the picker read it instead of
opening every plan directory — so an interrupted write can leave it stale.

```bash
planx doctor
```

It walks every plan, reports anything it cannot make sense of, and rebuilds the
index from the directories on disk. It is the only repair path in the tool.
