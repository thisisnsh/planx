import { Box, Text, useInput } from 'ink';
import { homedir } from 'node:os';
import { dim, green, inverse, padEnd, red, signal, truncate } from '../render/ansi.js';
import { EXIT_PROMPT, useDoubleCtrlC } from './exit.js';

/**
 * A command that does several things, drawn while it does them.
 *
 * `add-skills` writes into directories the user cannot see from here, on a
 * machine that may or may not have each agent on it. A wall of ticks printed
 * afterwards says what happened; this says it as it happens.
 *
 * No border. These two commands are the ones npm runs during an install, where
 * the output is already sitting inside npm's, and a frame around it would be a
 * box drawn around part of somebody else's log. Without one the drawn form and
 * the piped form are the same rows, which is what they always were.
 *
 * And no header either. Without a border there is nowhere for the wordmark to
 * ride, so it was printed as a line — which put `planx v0.4.0 add-skills` one
 * row under the `planx add-skills` the user had just typed. The groups are the
 * headings; the work starts at the first one.
 *
 * It owns no state — including what has been typed into the prompt. The rows
 * are handed in and redrawn, because the work is a plain async function and the
 * screen is a view of it, not the other way round.
 */
export interface StepRow {
  /** The heading this row sits under: `Detecting agents`. */
  group: string;
  /** The left column: an agent, a skill, or nothing when the path says it all. */
  label: string;
  path: string;
  /** What happened, or empty while the step is still running. */
  note: string;
  ok: boolean;
}

/**
 * A question you answer by typing the word, not by pressing a key.
 *
 * The only one of these deletes the whole store. `enter` alone is one keystroke
 * away from every plan you ever wrote, so the word is the gate — and `typed`
 * lives with the caller, because this component holds no state.
 */
export interface StepsPrompt {
  question: string;
  /** What has to be typed for `enter` to mean yes. */
  word: string;
  typed: string;
  onType: (next: string) => void;
  onAnswer: (yes: boolean) => void;
}

export interface StepsProps {
  rows: readonly StepRow[];
  /** The last line: what this leaves you with. */
  closing: string | null;
  prompt: StepsPrompt | null;
  width: number;
  /** What a second ctrl+c does. Defaults to ending the process with 130. */
  onQuit?: () => void;
}

function matches(prompt: StepsPrompt): boolean {
  return prompt.typed.trim().toLowerCase() === prompt.word;
}

export function Steps(props: StepsProps) {
  // Above the prompt's handler, so it fires while the word is being typed.
  const leaving = useDoubleCtrlC({ onExit: props.onQuit });

  useInput(
    (input, key) => {
      const prompt = props.prompt;
      if (!prompt) return;
      if (key.escape) return prompt.onAnswer(false);
      // Anything short of the word is not an answer, so enter is not one either.
      if (key.return) return matches(prompt) ? prompt.onAnswer(true) : undefined;
      if (key.backspace || key.delete) return prompt.onType(prompt.typed.slice(0, -1));
      if (input && !key.ctrl && !key.meta) return prompt.onType(prompt.typed + input);
    },
    { isActive: props.prompt !== null },
  );

  const lines: string[] = [...stepLines(props.rows, props.width)];
  if (props.closing !== null) lines.push(`  ${props.closing}`);
  if (props.prompt !== null) {
    lines.push(
      `  ${red(props.prompt.question)}`,
      `  ${dim(`type ${props.prompt.word} to confirm:`)} ${props.prompt.typed}${inverse(' ')}`,
      '',
      dim(matches(props.prompt) ? '  enter delete · esc keep' : '  esc keep'),
    );
  }
  if (leaving) lines.push(`  ${red(EXIT_PROMPT)}`);
  lines.push('');

  return (
    <Box flexDirection="column">
      {lines.map((line, i) => (
        <Text key={i}>{line}</Text>
      ))}
    </Box>
  );
}

/** The indent on a step row, and the gap between its columns. */
const INDENT = 4;
const GAP = 3;

/**
 * The rows as text: a heading per group, and a blank line between groups.
 *
 * Columns are measured across every row rather than per group, so `claude` in
 * one group and `planx` in another start their paths in the same place — the
 * screen reads as one table with headings in it, not three tables stacked.
 *
 * The path is what gives when the terminal is narrow. It is the longest thing
 * on the row and the least surprising — you know where your home directory is —
 * where the outcome is the one word the row exists to say, so cutting the line
 * from the right would drop exactly the wrong end of it.
 */
export function stepLines(rows: readonly StepRow[], inner: number): string[] {
  const labels = Math.max(0, ...rows.map((r) => r.label.length));
  const notes = Math.max(1, ...rows.map((r) => r.note.length));
  const room = inner - INDENT - labels - GAP - GAP - notes;
  const paths = Math.max(12, Math.min(Math.max(0, ...rows.map((r) => short(r.path).length)), room));

  const out: string[] = [];
  let group: string | null = null;

  for (const row of rows) {
    if (row.group !== group) {
      if (group !== null) out.push('');
      out.push(`  ${signal(row.group)}`);
      group = row.group;
    }
    const label = padEnd(row.label, labels);
    const path = padEnd(dim(truncate(short(row.path), paths)), paths);
    const note = row.note ? (row.ok ? green(row.note) : dim(row.note)) : dim('…');
    out.push(truncate(`${' '.repeat(INDENT)}${label}${' '.repeat(GAP)}${path}   ${note}`, inner));
  }
  if (rows.length) out.push('');
  return out;
}

/** `~/.claude`, not `/Users/somebody/.claude`. */
function short(path: string): string {
  const home = homedir();
  return home && path.startsWith(home) ? `~${path.slice(home.length)}` : path;
}

/** The same rows, one per line, for a log nobody is watching draw. */
export function stepLine(row: StepRow): string {
  const parts = [row.label, row.path, row.note].filter((p) => p.length);
  return parts.join('  ');
}
