/**
 * SGR mouse tracking (`\x1b[?1002h\x1b[?1006h`).
 *
 * SGR (1006) rather than the original X10 encoding because X10 packs the
 * coordinates into single bytes and dies past column 223 — a plan viewed in a
 * wide terminal would silently stop reporting. 1002 is button-event tracking:
 * presses, releases and motion *while a button is held*, which is exactly a
 * drag and nothing more.
 */
export const MOUSE_ON = '\x1b[?1002h\x1b[?1006h';
export const MOUSE_OFF = '\x1b[?1006l\x1b[?1002l';

export type MouseEventType = 'down' | 'drag' | 'up' | 'scroll';

export interface MouseEvent {
  type: MouseEventType;
  button: number;
  /** 1-based terminal coordinates, as the protocol reports them. */
  col: number;
  row: number;
  /** For scroll events: -1 up, +1 down. */
  direction: number;
}

export interface ParsedInput {
  events: MouseEvent[];
  /** The input with every mouse sequence removed, safe to treat as keystrokes. */
  rest: string;
}

const SGR = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/g;

/**
 * Split raw stdin into mouse events and everything else.
 *
 * Ink's keyboard handling and the mouse reader see the same byte stream, so the
 * sequences have to be stripped here or a drag arrives at `useInput` as a burst
 * of junk keypresses.
 */
export function parseMouse(input: string): ParsedInput {
  const events: MouseEvent[] = [];
  let rest = '';
  let last = 0;

  SGR.lastIndex = 0;
  for (let match = SGR.exec(input); match !== null; match = SGR.exec(input)) {
    rest += input.slice(last, match.index);
    last = match.index + match[0].length;

    const code = Number.parseInt(match[1]!, 10);
    const col = Number.parseInt(match[2]!, 10);
    const row = Number.parseInt(match[3]!, 10);
    const released = match[4] === 'm';

    if (code >= 64) {
      // Wheel: 64 is up, 65 is down. Terminals report these as presses.
      events.push({ type: 'scroll', button: code, col, row, direction: code === 64 ? -1 : 1 });
      continue;
    }
    if (released) {
      events.push({ type: 'up', button: code & 3, col, row, direction: 0 });
      continue;
    }
    events.push({
      type: code & 32 ? 'drag' : 'down',
      button: code & 3,
      col,
      row,
      direction: 0,
    });
  }

  rest += input.slice(last);
  return { events, rest };
}

export function hasMouseSequence(input: string): boolean {
  return /\x1b\[<\d+;\d+;\d+[Mm]/.test(input);
}
