/**
 * The terminal's styled string, as something a browser can draw.
 *
 * The CLI builds rows out of ANSI escapes and measures them with `stripAnsi`.
 * Here a row is a list of pieces — text plus a class — so measuring is a sum of
 * lengths and no regex has to survive the trip. The padding and truncation
 * rules are the ones in src/render/ansi.ts, because the frame only lines up if
 * every row is padded to exactly the same visible width.
 */

export interface Piece {
  t: string;
  /** A class from sim.css: sig, dim, bold, code, add, del, inv, … */
  c?: string;
}

export type Line = Piece[];

export function p(t: string, c?: string): Piece {
  return c ? { t, c } : { t };
}

export function len(line: Line): number {
  let n = 0;
  for (const piece of line) n += piece.t.length;
  return n;
}

/** Pad to `width` visible characters. Never trims. */
export function pad(line: Line, width: number): Line {
  const short = width - len(line);
  return short > 0 ? [...line, p(' '.repeat(short))] : line;
}

/** Cut to `width` visible characters, with the ellipsis the CLI uses. */
export function trunc(line: Line, width: number): Line {
  if (len(line) <= width) return line;
  const out: Line = [];
  let used = 0;
  for (const piece of line) {
    const room = width - 1 - used;
    if (room <= 0) break;
    if (piece.t.length <= room) {
      out.push(piece);
      used += piece.t.length;
      continue;
    }
    out.push(p(piece.t.slice(0, room), piece.c));
    used += room;
    break;
  }
  out.push(p('…', 'dim'));
  return out;
}

/** Fixed width: cut what overflows, pad what falls short. */
export function fit(line: Line, width: number): Line {
  return pad(trunc(line, width), width);
}

export function plain(line: Line): string {
  return line.map((piece) => piece.t).join('');
}

/** The same characters with one class over all of them — how a selected row draws. */
export function repaint(line: Line, c: string): Line {
  return [p(plain(line), c)];
}

export function spaces(n: number): Piece {
  return p(' '.repeat(Math.max(0, n)));
}
