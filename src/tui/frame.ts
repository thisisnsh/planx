import { bold, dim, padEnd, signal, stripAnsi, truncate } from '../render/ansi.js';

/**
 * The one frame, for everything planx draws.
 *
 * It started as four functions inside the review screen, which is why the
 * picker drew plain rows, `--help` printed a bare wall and `planx list` printed
 * loose lines: bare `planx` showed two unrelated visual languages before you
 * reached the plan. They are pure string builders, so the printed commands can
 * use the same edges the TUI does without mounting anything.
 *
 * The chrome rides on the border itself. A title bar drawn *inside* a border is
 * two horizontal rules stacked with a line of text between them, spending three
 * rows to say what one edge can. It is drawn by hand rather than with Ink's
 * border because Ink has no way to put anything on one.
 */
export const REPO = 'github.com/thisisnsh/planx';

/** Wide enough for a plan, narrow enough that help does not stretch. */
export const MAX_FRAME_WIDTH = 92;
/** `│ ` on the left and ` │` on the right of every row. */
export const FRAME_PADDING = 4;

export function topRule(width: number, title: string): string {
  const fill = Math.max(0, width - 3 - visible(title));
  return `${signal('╭─')}${title}${signal(`${'─'.repeat(fill)}╮`)}`;
}

export function bottomRule(width: number, footer: string): string {
  const fill = Math.max(0, width - 3 - visible(footer));
  return `${signal(`╰${'─'.repeat(fill)}`)}${dim(footer)}${signal('─╯')}`;
}

export function frameLine(content: string, inner: number): string {
  return `${signal('│')} ${padEnd(truncate(content, inner), inner)} ${signal('│')}`;
}

/** ` planx v0.2.0  <rest> ` — the title every frame wears on its top edge. */
export function brandTitle(version?: string, rest?: string): string {
  const name = `${bold(signal('planx'))}${version ? dim(` v${version}`) : ''}`;
  return ` ${name}${rest ? `  ${rest}` : ''} `;
}

export function visible(text: string): number {
  return stripAnsi(text).length;
}

export interface FrameBlockOptions {
  /** Sits on the top rule. Defaults to the planx wordmark. */
  title?: string;
  /** Sits on the bottom rule. Defaults to the repo. */
  footer?: string;
  version?: string;
  /** Total columns, edges included. Defaults to the terminal's, capped. */
  width?: number;
}

/** Frame a finished block of text — help, a listing, anything already laid out. */
export function frameBlock(lines: readonly string[], opts: FrameBlockOptions = {}): string {
  const width = opts.width ?? terminalWidth();
  const inner = width - FRAME_PADDING;
  return [
    topRule(width, opts.title ?? brandTitle(opts.version)),
    frameLine('', inner),
    ...lines.flatMap((line) => wrapToFrame(line, inner).map((part) => frameLine(part, inner))),
    frameLine('', inner),
    bottomRule(width, opts.footer ?? ` ★ ${REPO} `),
  ].join('\n');
}

export function terminalWidth(): number {
  return Math.max(40, Math.min(MAX_FRAME_WIDTH, (process.stdout.columns ?? 80) - 1));
}

/**
 * A line too wide for the frame is folded, not cut.
 *
 * `truncate` is right for a document row — the plan is still there, one arrow
 * key away — but a help line that ends in `…` has genuinely lost the half of
 * the sentence that said what the flag does. Folding is only safe because these
 * blocks are text; the review's own rows go through `frameLine` directly.
 */
function wrapToFrame(line: string, inner: number): string[] {
  if (visible(line) <= inner) return [line];
  // Styled help lines are built from padded columns, so re-flowing them would
  // mean re-measuring inside the escapes. Indent the continuation instead.
  const words = stripAnsi(line).split(' ');
  const indent = ' '.repeat(Math.min(4, Math.max(0, line.length - line.trimStart().length)));
  const out: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && candidate.length > inner) {
      out.push(current);
      current = `${indent}${word}`;
    } else {
      current = candidate;
    }
  }
  if (current) out.push(current);
  return out;
}
