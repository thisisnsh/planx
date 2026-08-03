import { Box, Text, useInput } from 'ink';
import { homedir } from 'node:os';
import { dim, green, padEnd, signal, truncate, yellow } from '../render/ansi.js';
import { bottomRule, brandTitle, frameLine, FRAME_PADDING, REPO, topRule } from './frame.js';

/**
 * A command that does several things, drawn while it does them.
 *
 * `add-skills` writes into directories the user cannot see from here, on a
 * machine that may or may not have each agent on it. A wall of ticks printed
 * afterwards says what happened; this says it as it happens, in the same frame
 * the review and the picker use, so the one thing planx draws looks like one
 * thing.
 *
 * It owns no state. The rows are handed in and redrawn, because the work is a
 * plain async function and the screen is a view of it — not the other way round.
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

export interface StepsProps {
  /** The subcommand, shown on the top rule beside the wordmark. */
  command: string;
  version: string;
  rows: readonly StepRow[];
  /** The last line: what this leaves you with. */
  closing: string | null;
  /** A yes/no question, asked on the same screen rather than in a dialog. */
  prompt: { question: string; onAnswer: (yes: boolean) => void } | null;
  width: number;
}

export function Steps(props: StepsProps) {
  const inner = props.width - FRAME_PADDING;

  useInput(
    (input, key) => {
      if (!props.prompt) return;
      if (key.return) return props.prompt.onAnswer(true);
      if (key.escape || input === 'n' || input === 'q') return props.prompt.onAnswer(false);
    },
    { isActive: props.prompt !== null },
  );

  return (
    <Box flexDirection="column">
      <Text>{topRule(props.width, brandTitle(props.version, props.command))}</Text>
      <Text>{frameLine('', inner)}</Text>
      {stepLines(props.rows, inner).map((line, i) => (
        <Text key={i}>{frameLine(line, inner)}</Text>
      ))}
      {props.closing === null ? null : <Text>{frameLine(`  ${props.closing}`, inner)}</Text>}
      {props.prompt === null ? null : (
        <>
          <Text>{frameLine(`  ${yellow(props.prompt.question)}`, inner)}</Text>
          <Text>{frameLine(dim('  enter delete · esc keep'), inner)}</Text>
        </>
      )}
      <Text>{frameLine('', inner)}</Text>
      <Text>{bottomRule(props.width, ` ★ ${REPO} `)}</Text>
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
