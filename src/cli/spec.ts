import type { CommandSpec, FlagSpec } from './args.js';

export const GLOBAL_FLAGS: FlagSpec[] = [
  { name: '--dir', arg: 'PATH', summary: 'Use a different store instead of ~/.planx.' },
  { name: '--json', summary: 'Machine-readable output. Available on every read command.' },
  { name: '--no-color', summary: 'Disable ANSI colour. NO_COLOR is honoured too.' },
  { name: '--help', alias: '-h', summary: 'Show usage for this command.' },
];

/**
 * Every command, with the metadata `--help` and the generated reference both
 * read. Hand-maintained CLI docs go stale within two releases without
 * exception, so `site/reference/cli.md` is generated from this and committed
 * (PLAN §15).
 */
export const COMMANDS: CommandSpec[] = [
  {
    name: 'capture',
    usage: 'planx capture [--plan-id ID] [--title T] [--stdin|--file F] [--parent VER] [--splice]',
    summary: 'Store a version of a plan.',
    description:
      'Reads the plan from stdin or a file and appends it as a new version. Refuses to write ' +
      'a version that modifies a locked block, printing the offending diff and the command to ' +
      'ask for an unlock. Capturing content identical to the current latest is a no-op, so ' +
      'skills can call it defensively.',
    flags: [
      { name: '--plan-id', arg: 'ID', summary: 'Append to this plan. Omit to create a new one.' },
      { name: '--title', arg: 'T', summary: 'Plan title. Defaults to the H1 of the plan text.' },
      {
        name: '--name',
        arg: 'N',
        summary: 'Pin the plan id instead of deriving it from the title.',
      },
      { name: '--stdin', summary: 'Read the plan from stdin. Implied when stdin is a pipe.' },
      { name: '--file', arg: 'F', summary: 'Read the plan from a file.' },
      { name: '--parent', arg: 'VER', summary: 'Version this revises. Defaults to the latest.' },
      { name: '--splice', summary: 'Expand [[planx:keep …]] markers before writing.' },
      { name: '--source', arg: 'NAME', summary: 'Which agent produced this (claude, codex, …).' },
      { name: '--note', arg: 'N', summary: 'One line about what changed in this version.' },
      { name: '--agent', arg: 'NAME', summary: 'Agent identifier recorded on the version.' },
    ],
    examples: [
      'planx capture --stdin --title "Guard the clock regression" < plan.md',
      'planx capture --plan-id guard-clock-a3f9 --parent v2 --splice --stdin',
    ],
  },
  {
    name: 'resume',
    usage: 'planx resume <id> [version] [--json]',
    summary: 'Pick a plan back up: the plan, the feedback on it, and its locks.',
    description:
      'One read with everything needed to revise, including the plan text, so it works in a ' +
      'session that has never seen the plan. Comments left on an earlier version whose quoted ' +
      'text is still present word for word are reported as probably never addressed. Safe to ' +
      'run twice; it waits for nothing.',
    examples: ['planx resume guard-clock-a3f9'],
  },
  {
    name: 'submit',
    usage: 'planx submit <id> [version] [--comment "42-47:text"] [--approve] [--stdin]',
    summary: 'Submit review feedback without the TUI.',
    description:
      'The TUI is one front-end to a documented wire format, not the only way in. This posts ' +
      'the same feedback payload from a script, a hook, or another editor. With --stdin it ' +
      'reads the full JSON payload; the flags cover the common one-liners. Line ranges are ' +
      '1-based and inclusive, in the reviewed version’s coordinates.',
    flags: [
      {
        name: '--comment',
        arg: 'SPEC',
        summary: 'A comment as "START-END:text" or "LINE:text". Repeatable.',
      },
      { name: '--lock', arg: 'RANGE', summary: 'Lock "START-END" or "LINE". Repeatable.' },
      { name: '--unlock', arg: 'RANGE', summary: 'Unlock a range, splitting a lock if partial.' },
      { name: '--general', arg: 'TEXT', summary: 'A note about the plan as a whole.' },
      { name: '--approve', summary: 'Verdict approve — seals the plan.' },
      { name: '--reject', summary: 'Verdict reject — the agent stops and asks.' },
      { name: '--stdin', summary: 'Read a full feedback payload as JSON from stdin.' },
    ],
    examples: [
      'planx submit guard-clock-a3f9 v2 --comment "42-47:Wrong layer, use the R2 write path."',
      'planx submit guard-clock-a3f9 --lock 88-104 --approve',
    ],
  },
  {
    name: 'unlock',
    usage: 'planx unlock <id> <lock-id> --reason "..."',
    summary: 'Open one locked block for a single capture.',
    description:
      'Run by the agent after it has explained the change and the user has agreed. The grant ' +
      'authorises exactly one capture that may modify the block, then burns, and the lock ' +
      're-arms on whatever was written. The reason is recorded on the grant, which is what ' +
      'makes a self-issued unlock reviewable afterwards — see `planx locks`.',
    flags: [{ name: '--reason', arg: 'R', summary: 'Why the block has to change. Required.' }],
    examples: ['planx unlock guard-clock-a3f9 L2 --reason "the R2 path replaced this entirely"'],
  },
  {
    name: 'diff',
    usage: 'planx diff [id] [vA] [vB] [--print] [--plain|--rich] [--stat]',
    summary: 'Review a plan, or print a diff between two versions.',
    description:
      'In a terminal this opens the review TUI: select lines and comment, lock or unlock them, ' +
      'then submit or approve. Piped or with --print it writes the diff to stdout and exits. ' +
      'With no arguments it opens a picker.',
    flags: [
      { name: '--print', summary: 'Non-interactive: write the diff to stdout and exit.' },
      { name: '--plain', summary: 'Raw unified diff, no rich rendering.' },
      { name: '--rich', summary: 'Rich rendering (the default).' },
      { name: '--stat', summary: 'Just the summary line.' },
    ],
    examples: ['planx diff guard-clock-a3f9', 'planx diff guard-clock-a3f9 v1 v3 --print --plain'],
  },
  {
    name: 'show',
    usage: 'planx show <id> [version] [--plain|--rich] [--skeleton]',
    summary: 'Print a stored version of a plan.',
    flags: [
      { name: '--plain', summary: 'Raw markdown source.' },
      { name: '--rich', summary: 'Syntax-highlighted with a lock gutter.' },
      { name: '--skeleton', summary: 'Collapse locked blocks to [[planx:keep …]] markers.' },
    ],
  },
  {
    name: 'list',
    usage: 'planx list [--here] [--approved] [--json]',
    summary: 'List stored plans, newest first.',
    flags: [
      { name: '--here', summary: 'Only plans captured in the current directory.' },
      { name: '--approved', summary: 'Only approved plans.' },
      { name: '--unapproved', summary: 'Only plans that never reached approve.' },
    ],
  },
  { name: 'versions', usage: 'planx versions <id>', summary: 'List a plan’s version history.' },
  {
    name: 'locks',
    usage: 'planx locks <id> [--json]',
    summary: 'Show a plan’s locks and any outstanding unlock grants.',
  },
  {
    name: 'execute',
    usage: 'planx execute [id] [version] [--agent NAME] [--model M] [--dry-run]',
    summary: 'Run a plan by spawning a fresh agent process.',
    description:
      'From a terminal this spawns a new agent with the plan as its prompt. From inside an ' +
      'agent, use the /planx-execute skill instead: spawning a nested agent would lose the ' +
      'context, the permissions and your ability to intervene.',
    flags: [
      { name: '--agent', arg: 'NAME', summary: 'Which configured agent to launch.' },
      { name: '--model', arg: 'M', summary: 'Model to pass to it.' },
      { name: '--args', arg: 'STR', summary: 'Extra arguments appended to the command.' },
      { name: '--dry-run', summary: 'Print the exact argv and exit without running it.' },
    ],
  },
  {
    name: 'import',
    usage: 'planx import --from claude|codex [--latest|--all] [--since 7d]',
    summary: 'Backfill plans from an agent’s own history.',
    description:
      'Explicit and user-run. Nothing watches your agent directories in the background. ' +
      'Re-importing is safe: identical content collapses to a no-op rather than a duplicate.',
    flags: [
      { name: '--from', arg: 'NAME', summary: 'Source adapter: claude or codex.' },
      { name: '--all', summary: 'Import everything found.' },
      { name: '--latest', summary: 'Import only the most recent plan.' },
      { name: '--since', arg: 'DUR', summary: 'Only plans newer than this (e.g. 7d).' },
      { name: '--home', arg: 'PATH', summary: 'Read from a different home directory.' },
    ],
  },
  {
    name: 'clean',
    usage: 'planx clean [filters] [--purge] [--yes]',
    summary: 'Remove plans, soft-deleting to the trash.',
    description:
      'With no filters this opens a multi-select picker. Deletion is soft: plans move to ' +
      '~/.planx/.trash and `planx restore` brings them back. --purge deletes for real. The ' +
      'trash is never emptied automatically.',
    flags: [
      { name: '--older-than', arg: 'DUR', summary: 'Plans not updated within this window.' },
      { name: '--unapproved', summary: 'Plans that never reached approve.' },
      { name: '--here', summary: 'Only plans captured in the current directory.' },
      { name: '--id', arg: 'ID', summary: 'A specific plan. Repeatable.' },
      { name: '--versions-beyond', arg: 'N', summary: 'Trim history to the newest N versions.' },
      { name: '--purge', summary: 'Delete permanently instead of moving to the trash.' },
      { name: '--empty-trash', summary: 'Destroy trashed plans.' },
      { name: '--yes', summary: 'Skip the confirmation, for scripts.' },
    ],
  },
  { name: 'restore', usage: 'planx restore <id>', summary: 'Bring a plan back from the trash.' },
  { name: 'rename', usage: 'planx rename <id> <new>', summary: 'Rename a plan and its id.' },
  { name: 'on', usage: 'planx on', summary: 'Enable planx.' },
  { name: 'off', usage: 'planx off', summary: 'Disable planx, so the skills degrade quietly.' },
  {
    name: 'status',
    usage: 'planx status',
    summary: 'Show the store, config and installed skills.',
  },
  {
    name: 'config',
    usage: 'planx config get|set <key> [value]',
    summary: 'Read or write configuration.',
    description:
      'Settable keys: enabled, defaultAgent, render. Agent definitions are edited ' +
      'in config.json directly — a flag syntax for nested argv arrays would be worse than an editor.',
  },
  {
    name: 'install',
    usage: 'planx install [--skills] [--local]',
    summary: 'Write the skills and seed the store.',
    description:
      'Touches no agent settings files. Idempotent, and it marks what it wrote so uninstall ' +
      'removes only that.',
    flags: [
      { name: '--skills', summary: 'Only write skills; do not seed the store.' },
      { name: '--local', summary: 'Write into ./.claude/skills for a repo-local install.' },
      { name: '--agent', arg: 'NAME', summary: 'Only this agent. Repeatable.' },
    ],
  },
  { name: 'uninstall', usage: 'planx uninstall', summary: 'Remove what install wrote.' },
  {
    name: 'doctor',
    usage: 'planx doctor',
    summary: 'Check the store for problems and rebuild the index.',
  },
  { name: '__gen-cli-docs', usage: 'planx __gen-cli-docs', summary: 'internal', hidden: true },
];

export function findCommand(name: string): CommandSpec | undefined {
  return COMMANDS.find((c) => c.name === name);
}
