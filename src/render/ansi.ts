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

export const red = style(31, 39);
export const green = style(32, 39);
export const yellow = style(33, 39);
export const blue = style(34, 39);
export const magenta = style(35, 39);
export const cyan = style(36, 39);
export const gray = style(90, 39);

export const bgRed = style(41, 49);
export const bgGreen = style(42, 49);

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
