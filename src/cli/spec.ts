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
    usage: 'planx capture [--plan-id ID] [--title T] [--stdin|--file F] [--parent VER]',
    summary: 'Store a version of a plan.',
    description:
      'Reads the plan from stdin or a file and appends it as a new version. Capturing content ' +
      'identical to the current latest is a no-op, so skills can call it defensively.',
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
      { name: '--source', arg: 'NAME', summary: 'Which agent produced this (claude, codex, …).' },
      { name: '--note', arg: 'N', summary: 'One line about what changed in this version.' },
      { name: '--agent', arg: 'NAME', summary: 'Agent identifier recorded on the version.' },
    ],
    examples: [
      'planx capture --stdin --title "Guard the clock regression" < plan.md',
      'planx capture --plan-id guard-clock-a3f9 --parent v2 --stdin',
    ],
  },
  {
    name: 'revise',
    group: 'agent',
    usage: 'planx revise <id> [version] [--json]',
    summary: 'Pick a plan back up: the feedback left on it.',
    description:
      'One read with everything asked of the plan: each comment against the lines it quotes, ' +
      'and every line the reviewer rewrote by hand. It does not return the plan itself — the ' +
      'agent that wrote it already has it, and `planx show <id> --plain` is there for a ' +
      'session that does not. Comments left on an earlier version whose quoted text is still ' +
      'present word for word are reported as probably never addressed. Safe to run twice; it ' +
      'waits for nothing.',
    examples: ['planx revise guard-clock-a3f9'],
  },
  {
    name: 'diff',
    group: 'agent',
    usage: 'planx [diff] [id] [vA] [vB] [--print] [--plain|--rich] [--stat]',
    summary: 'Review a plan, or print a diff between two versions.',
    description:
      'In a terminal this opens the review TUI on the diff against the previous version — ' +
      'you opened v4 because v4 is new, and what is new about it is the diff. Press d to see ' +
      'the plan on its own instead. Select lines, comment on them or rewrite them, then ' +
      'submit — an empty submit is how you say the plan is fine. The command name is ' +
      'optional in front of a plan — `planx <id>` is the same ' +
      'thing. Piped or with --print it writes the diff to stdout and exits. With no arguments ' +
      'it opens a picker.',
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
    usage: 'planx show <id> [version] [--plain|--rich]',
    summary: 'Print a stored version of a plan.',
    flags: [
      { name: '--plain', summary: 'Raw markdown source.' },
      { name: '--rich', summary: 'Syntax-highlighted.' },
    ],
  },
  {
    name: 'list',
    group: 'agent',
    usage: 'planx list [--here] [--json]',
    summary: 'List stored plans, newest first.',
    flags: [{ name: '--here', summary: 'Only plans captured in the current directory.' }],
  },
  {
    name: 'add-skills',
    group: 'maintenance',
    usage: 'planx add-skills [--no-store] [--local]',
    summary: 'Add the planx skills to your agents, and seed the store.',
    description:
      'Detects which agents are on this machine, writes a skill into each, and seeds ~/.planx, ' +
      'showing each step as it happens. Touches no agent settings files. Idempotent, and it ' +
      'marks what it wrote so `remove-skills` removes only that. npm runs this after every ' +
      'install, so an upgrade refreshes your skills without being asked twice; run it by hand ' +
      'to pick up an agent you installed since.',
    flags: [
      { name: '--no-store', summary: 'Write skills only; leave ~/.planx alone.' },
      { name: '--local', summary: 'Write into ./.claude/skills for a repo-local install.' },
      { name: '--agent', arg: 'NAME', summary: 'Only this agent. Repeatable.' },
    ],
  },
  {
    name: 'remove-skills',
    usage: 'planx remove-skills [--local]',
    summary: 'Remove what add-skills wrote, and offer to delete the store.',
    group: 'maintenance',
    description:
      'Removes only the skill directories planx wrote — one you edited by hand is left alone ' +
      'and reported. Then it asks whether to delete ~/.planx, naming the path and how many ' +
      'plans are in it. A non-interactive run never deletes and never asks.',
    flags: [{ name: '--local', summary: 'Remove from ./.claude/skills instead of $HOME.' }],
  },
  {
    name: 'update',
    group: 'maintenance',
    usage: 'planx update',
    summary: 'Install the latest planx from npm.',
    description:
      'Runs `npm install -g @thisisnsh/planx@latest --foreground-scripts` and hands the terminal ' +
      'to npm, so its output scrolls and the `add-skills` its postinstall runs is drawn live at ' +
      'the end of it. Checks the registry first and does nothing when you are already on the ' +
      'latest. npm’s exit code is this command’s exit code.',
  },
  {
    name: 'doctor',
    group: 'maintenance',
    usage: 'planx doctor',
    summary: 'Check the store for problems and rebuild the index.',
  },
  { name: '__gen-cli-docs', usage: 'planx __gen-cli-docs', summary: 'internal', hidden: true },
  { name: '__update-check', usage: 'planx __update-check', summary: 'internal', hidden: true },
];

export function findCommand(name: string): CommandSpec | undefined {
  return COMMANDS.find((c) => c.name === name);
}
