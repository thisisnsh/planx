let forced: boolean | null = null;

/** Force colour on or off for this process; `null` restores auto-detection. */
export function setColorEnabled(value: boolean | null): void {
  forced = value;
}

export function colorEnabled(): boolean {
  if (forced !== null) return forced;
  // https://no-color.org — any non-empty value disables colour.
  const noColor = process.env.NO_COLOR;
  if (noColor !== undefined && noColor !== '') return false;
  const force = process.env.FORCE_COLOR;
  if (force !== undefined && force !== '') return force !== '0';
  return Boolean(process.stdout.isTTY);
}

/**
 * Each style closes with its specific reset (22, 39, …) rather than a blanket
 * `0m`, so nesting bold inside colour does not strip the colour on the way out.
 */
function style(open: number, close: number) {
  return (text: string): string => (colorEnabled() ? `\x1b[${open}m${text}\x1b[${close}m` : text);
}

export const bold = style(1, 22);
export const dim = style(2, 22);
export const italic = style(3, 23);
export const underline = style(4, 24);
export const inverse = style(7, 27);
export const strikethrough = style(9, 29);

/**
 * Every colour planx draws is truecolor, and none of them are the sixteen.
 *
 * SGR 31–36 name *slots*, not colours: what comes out is whatever the user's
 * theme put in ANSI 1–6, which in every default theme is the dark half of the
 * palette — a mustard yellow, a navy blue, a brick red. The frame has always
 * been truecolor, so the old palette put a `#ffd400` border two columns away
 * from a `#a68a00` question and the question read as broken rather than
 * merely darker. One system, not two: these are the colours, everywhere.
 *
 * Terminals without truecolor fall back to their nearest colour rather than
 * dropping the sequence, so nothing is lost on the ones that cannot.
 */
function rgb(r: number, g: number, b: number) {
  return (text: string): string =>
    colorEnabled() ? `\x1b[38;2;${r};${g};${b}m${text}\x1b[39m` : text;
}

function bgRgb(r: number, g: number, b: number) {
  return (text: string): string =>
    colorEnabled() ? `\x1b[48;2;${r};${g};${b}m${text}\x1b[49m` : text;
}

/**
 * The one accent colour, matching the yellow the docs are built on (#ffd400).
 *
 * `yellow` is the same value: planx has one yellow, and a question drawn in it
 * is drawn in the colour of the frame around it.
 */
export const SIGNAL_RGB = [255, 212, 0] as const;

export const signal = rgb(...SIGNAL_RGB);

export const yellow = rgb(...SIGNAL_RGB);
export const red = rgb(255, 95, 86);
export const green = rgb(61, 214, 140);
export const blue = rgb(77, 166, 255);
export const magenta = rgb(255, 122, 198);
export const cyan = rgb(77, 225, 232);
/** The grey that is a colour, not an alpha — `dim` over a dark row is mud. */
export const gray = rgb(138, 138, 148);

// Dark enough that the text laid over them stays readable.
export const bgRed = bgRgb(122, 38, 32);
export const bgGreen = bgRgb(31, 92, 61);

const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, '');
}

/** Display width ignoring escape codes — what padding and truncation need. */
export function visibleLength(text: string): number {
  return stripAnsi(text).length;
}

export function padEnd(text: string, width: number): string {
  const pad = width - visibleLength(text);
  return pad > 0 ? text + ' '.repeat(pad) : text;
}

export function padStart(text: string, width: number): string {
  const pad = width - visibleLength(text);
  return pad > 0 ? ' '.repeat(pad) + text : text;
}

/**
 * A line being typed, scrolled horizontally under the caret.
 *
 * Every editable line planx draws uses this one: the note box, the `e` line
 * editor, the hand-off command and the defaults screen. A line wider than the
 * column it is in runs off the right edge, and a caret you cannot see is a
 * caret you cannot type at — so the window follows it, pinning it to the last
 * column once there is more line than there is room.
 *
 * It lives here rather than in a screen because it is a pure text function with
 * no React in it, next to the padding and truncation it is drawn beside.
 */
export function caretLine(draft: string, caret: number, width: number): string {
  const room = Math.max(1, width - 1);
  const start = Math.max(0, caret - room + 1);
  const visible = draft.slice(start, start + room);
  const at = caret - start;
  return `${visible.slice(0, at)}${inverse(draft[caret] ?? ' ')}${visible.slice(at + 1)}`;
}

/** Truncate to `width` visible characters, preserving escape sequences. */
export function truncate(text: string, width: number): string {
  if (visibleLength(text) <= width) return text;
  let visible = 0;
  let out = '';
  let i = 0;
  while (i < text.length && visible < width - 1) {
    const match = new RegExp(ANSI_PATTERN.source, 'y');
    match.lastIndex = i;
    const found = match.exec(text);
    if (found) {
      out += found[0];
      i = match.lastIndex;
      continue;
    }
    out += text[i];
    visible++;
    i++;
  }
  // Close any style the cut landed inside of, so the ellipsis and everything
  // after it on the line is not painted with a half-open colour.
  return colorEnabled() ? `${out}\x1b[0m…` : `${out}…`;
}
