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
 * exception, so `site/reference/cli.md` is generated from this and committed.
 */
export const COMMANDS: CommandSpec[] = [
  {
    name: 'capture',
    group: 'agent',
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
    group: 'agent',
    usage: 'planx resume <id> [version] [--json]',
    summary: 'Pick a plan back up: the feedback on it, and its locks.',
    description:
      'One read with everything asked of the plan: each comment against the lines it quotes, ' +
      'and the locked blocks. It does not return the plan itself — the agent that wrote it ' +
      'already has it, and `planx show <id> --plain` is there for a session that does not. ' +
      'Comments left on an earlier version whose quoted text is still present word for word ' +
      'are reported as probably never addressed. Safe to run twice; it waits for nothing.',
    examples: ['planx resume guard-clock-a3f9'],
  },
  {
    name: 'unlock',
    group: 'agent',
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
    group: 'common',
    usage: 'planx [diff] [id] [vA] [vB] [--print] [--plain|--rich] [--stat]',
    summary: 'Review a plan, or print a diff between two versions.',
    description:
      'In a terminal this opens the review TUI on the diff against the previous version — ' +
      'you opened v4 because v4 is new, and what is new about it is the diff. Press d to see ' +
      'the plan on its own instead. Select lines and comment, lock or unlock them, then ' +
      'submit or approve. The command name is optional in front of a plan — `planx <id>` is ' +
      'the same thing. Piped or with --print it writes the diff to stdout and exits. With no ' +
      'arguments it opens a picker.',
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
    group: 'agent',
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
    group: 'agent',
    usage: 'planx list [--here] [--approved] [--json]',
    summary: 'List stored plans, newest first.',
    flags: [
      { name: '--here', summary: 'Only plans captured in the current directory.' },
      { name: '--approved', summary: 'Only approved plans.' },
      { name: '--unapproved', summary: 'Only plans that never reached approve.' },
    ],
  },
  {
    name: 'locks',
    group: 'common',
    usage: 'planx locks <id> [--json]',
    summary: 'Show a plan’s locks and any outstanding unlock grants.',
    description:
      'The one command besides the review a person runs by hand. It is the only way to see ' +
      'that an agent issued itself an unlock and what reason it recorded, and the unlock ' +
      'handshake is worth nothing if that record cannot be read.',
  },
  {
    name: 'install',
    group: 'maintenance',
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
  {
    name: 'uninstall',
    usage: 'planx uninstall',
    summary: 'Remove what install wrote.',
    group: 'maintenance',
  },
  {
    name: 'doctor',
    group: 'maintenance',
    usage: 'planx doctor',
    summary: 'Check the store for problems and rebuild the index.',
  },
  { name: '__gen-cli-docs', usage: 'planx __gen-cli-docs', summary: 'internal', hidden: true },
];

export function findCommand(name: string): CommandSpec | undefined {
  return COMMANDS.find((c) => c.name === name);
}
