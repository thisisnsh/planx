# Delete plans and versions

PlanX keeps plans until you delete them. Open the picker with `planx`, move to a
plan, and press `^d`.

- On a plan row, `^d` targets the plan and every version.
- On a version row, `^d` targets that version.

The confirmation names the full target:

```text
delete upload-limits-a3f9 v2? this cannot be undone
```

Press `enter` to confirm or `esc` to keep it. Deletion is permanent and has no
trash or restore command.

The latest version cannot be removed by itself because every plan needs current
text. Deleting the whole plan remains available.

## Repair the picker index

`index.json` is a derived cache used by the picker and list command. Rebuild it
from the stored plan directories with:

```bash
planx doctor
```

See [Storage](/reference/storage) for the files PlanX keeps.
