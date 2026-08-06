import {
  blue,
  bold,
  colorEnabled,
  dim,
  padEnd,
  signal,
  stripAnsi,
  truncate,
} from '../render/ansi.js';
import { updateNotice, type UpdateNotice } from '../update/check.js';

/**
 * The one frame, for everything planx draws.
 *
 * It started as four functions inside the review screen, which is why the
 * picker drew plain rows, `--help` printed a bare wall and `planx list` printed
 * loose lines: bare `planx` showed two unrelated visual languages before you
 * reached the plan. They are pure string builders, so the printed commands can
 * use the same edges the TUI does without mounting anything.
 *
 * Every frame is the terminal's width, review and picker and printed block
 * alike, so the edges line up whichever of them you are looking at.
 *
 * The chrome rides on the border itself. A title bar drawn *inside* a border is
 * two horizontal rules stacked with a line of text between them, spending three
 * rows to say what one edge can. It is drawn by hand rather than with Ink's
 * border because Ink has no way to put anything on one.
 */
export const REPO = 'github.com/thisisnsh/planx';

/** `│ ` on the left and ` │` on the right of every row. */
export const FRAME_PADDING = 4;
/** Narrow enough to still be a frame, wide enough for a gutter and some text. */
export const MIN_FRAME_WIDTH = 40;

/** Dashes that must survive between the wordmark and the update notice. */
const NOTICE_GAP = 2;

/**
 * The notice that fits, or nothing.
 *
 * The wordmark keeps the corner. A rule that has to choose between saying which
 * planx this is and saying a newer one exists says the former, because the
 * former is true of every frame and the latter will still be true tomorrow.
 */
function noticeFitting(width: number, titleWidth: number, notice: UpdateNotice): string | null {
  for (const text of [notice.long, notice.short]) {
    const padded = ` ${text} `;
    if (width - 4 - titleWidth - padded.length >= NOTICE_GAP) return padded;
  }
  return null;
}

/**
 * `╭─ planx v0.4.0 ──────── v0.5.0 is out · run planx update ─╮`
 *
 * The notice is right-aligned on the rule, the way the repo is on the bottom
 * one, and blue — the one thing on a frame that is not planx's own yellow. It
 * defaults to the process-wide notice so every bordered layout picks it up
 * without being told; the parameter is there for tests.
 */
export function topRule(
  width: number,
  title: string,
  notice: UpdateNotice | null = updateNotice(),
): string {
  const text = notice && noticeFitting(width, visible(title), notice);
  if (!text) {
    const fill = Math.max(0, width - 3 - visible(title));
    return `${signal('╭─')}${title}${signal(`${'─'.repeat(fill)}╮`)}`;
  }
  const fill = width - 4 - visible(title) - text.length;
  return `${signal('╭─')}${title}${signal('─'.repeat(fill))}${blue(text)}${signal('─╮')}`;
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

/**
 * The terminal, less a column so the right edge never wraps.
 *
 * Uncapped. A frame that stops at 92 columns in a 200-column terminal reads as
 * something that failed to load rather than something laid out, and the review
 * has always drawn full width — the cap was only ever a difference between the
 * two halves of the same product. `wrapToFrame` folds prose to whatever width
 * it is handed, so help text stays readable at any of them.
 */
export function terminalWidth(): number {
  return Math.max(MIN_FRAME_WIDTH, (process.stdout.columns ?? 80) - 1);
}

/**
 * A line too wide for the frame is folded, not cut.
 *
 * `truncate` is right for a document row — the plan is still there, one arrow
 * key away — but a help line ending in `…` has genuinely lost the half of the
 * sentence that said what the flag does. Folding is only safe because these
 * blocks are prose; the review's own rows go through `frameLine` directly.
 *
 * It folds on *visible* width with the escapes carried along, so a narrow
 * terminal keeps its colour. Measuring the stripped string and re-emitting it
 * would silently turn a framed listing monochrome on exactly the terminals
 * where the fold happens.
 */
function wrapToFrame(raw: string, inner: number): string[] {
  if (visible(raw) <= inner) return [raw];

  const indent = ' '.repeat(Math.min(6, raw.length - raw.trimStart().length));
  const out: string[] = [];
  let line = '';
  let lineWidth = 0;
  let word = '';
  let wordWidth = 0;

  /** Put the pending word on the line, opening a new one if it will not fit. */
  const place = () => {
    if (!wordWidth) return;
    if (lineWidth && lineWidth + wordWidth > inner) {
      out.push(closeStyles(line));
      line = indent;
      lineWidth = indent.length;
    }
    line += word;
    lineWidth += wordWidth;
    word = '';
    wordWidth = 0;
  };

  for (const unit of cells(raw)) {
    if (unit.ch === ' ') {
      place();
      // Including at the head of the line: the leading spaces are the row's
      // indent, and dropping them puts a help entry flush against the frame.
      if (lineWidth < inner) {
        line += ' ';
        lineWidth++;
      }
      continue;
    }
    word += unit.text;
    wordWidth++;
    // A single word wider than the frame has to break somewhere.
    if (wordWidth >= inner) place();
  }
  place();
  if (line.trim()) out.push(closeStyles(line));
  return out.length ? out : [raw];
}

/**
 * One visible character, with any escape sequences that precede it.
 *
 * Splitting on characters alone would strand `\x1b[36m` at the end of a folded
 * line and paint the wrong half of the next one.
 */
function cells(text: string): Array<{ text: string; ch: string }> {
  const out: Array<{ text: string; ch: string }> = [];
  const escape = /\x1b\[[0-9;]*m/y;
  let pending = '';
  let i = 0;
  while (i < text.length) {
    escape.lastIndex = i;
    const found = escape.exec(text);
    if (found) {
      pending += found[0];
      i = escape.lastIndex;
      continue;
    }
    out.push({ text: pending + text[i], ch: text[i]! });
    pending = '';
    i++;
  }
  // Trailing resets belong to the character they were closing.
  if (pending && out.length) out[out.length - 1]!.text += pending;
  return out;
}

/** A fold can land inside a style, so each piece closes whatever is open. */
function closeStyles(line: string): string {
  return colorEnabled() && line.includes('\x1b[') ? `${line}\x1b[0m` : line;
}
