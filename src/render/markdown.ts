import { bold, cyan, dim, green, italic, underline, yellow } from './ansi.js';

/**
 * Enough markdown highlighting to read a plan comfortably, and no more.
 *
 * This is deliberately a line-oriented tokenizer rather than a real markdown
 * parser: the input is a diff where a hunk can start halfway through a list and
 * a real parser would either refuse it or invent structure that is not there.
 */
export interface MarkdownState {
  inFence: boolean;
  fenceMarker: string;
}

export function initialMarkdownState(): MarkdownState {
  return { inFence: false, fenceMarker: '' };
}

const FENCE = /^(\s*)(`{3,}|~{3,})(.*)$/;
const HEADING = /^(\s*)(#{1,6})(\s+)(.*)$/;
const LIST = /^(\s*)([-*+]|\d+[.)])(\s+)(.*)$/;
const QUOTE = /^(\s*)(>+)(\s*)(.*)$/;
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;
const TABLE = /^\s*\|.*\|\s*$/;

/**
 * Highlight one line, advancing `state`. Mutating the caller's state is the
 * point: fenced code spans lines, and a renderer walking a document needs to
 * know it is inside a fence when it reaches line 40.
 */
export function highlightLine(line: string, state: MarkdownState): string {
  const fence = FENCE.exec(line);
  if (fence) {
    const marker = fence[2]!;
    if (state.inFence && marker.startsWith(state.fenceMarker[0] ?? '`')) {
      state.inFence = false;
      state.fenceMarker = '';
    } else if (!state.inFence) {
      state.inFence = true;
      state.fenceMarker = marker;
    }
    return dim(line);
  }

  if (state.inFence) return green(line);

  if (RULE.test(line)) return dim(line);

  const heading = HEADING.exec(line);
  if (heading) {
    return `${heading[1]}${dim(heading[2]!)}${heading[3]}${bold(cyan(inline(heading[4]!)))}`;
  }

  const quote = QUOTE.exec(line);
  if (quote) {
    return `${quote[1]}${dim(quote[2]!)}${quote[3]}${dim(inline(quote[4]!))}`;
  }

  if (TABLE.test(line)) {
    return line.replace(/\|/g, (p) => dim(p));
  }

  const list = LIST.exec(line);
  if (list) {
    return `${list[1]}${yellow(list[2]!)}${list[3]}${inline(list[4]!)}`;
  }

  return inline(line);
}

// One alternation over every inline form, so each character is consumed once
// and a URL inside backticks is not also treated as a link.
const INLINE =
  /(`+)([^`]|[^`][\s\S]*?[^`])\1|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\n]+)\*|_([^_\n]+)_|\[([^\]]*)\]\(([^)]*)\)/g;

/**
 * Every branch reproduces the source characters exactly and only adds escapes.
 *
 * Hiding the `**` the way a markdown *renderer* would is wrong here: this is a
 * source view. The line on screen has to be the line in the file, because that
 * is the line the reader is selecting and the line the agent will be quoted.
 * It also keeps the text column aligned for gutter hit-testing.
 */
function inline(text: string): string {
  return text.replace(INLINE, (match, _ticks, code, b1, b2, i1, i2, linkText, href) => {
    if (code !== undefined) return yellow(match);
    if (b1 !== undefined) return `${dim('**')}${bold(b1)}${dim('**')}`;
    if (b2 !== undefined) return `${dim('__')}${bold(b2)}${dim('__')}`;
    if (i1 !== undefined) return `${dim('*')}${italic(i1)}${dim('*')}`;
    if (i2 !== undefined) return `${dim('_')}${italic(i2)}${dim('_')}`;
    if (linkText !== undefined) {
      return `${dim('[')}${underline(linkText)}${dim(`](${href})`)}`;
    }
    return match;
  });
}

/** Highlight a whole document, threading fence state through it. */
export function highlightMarkdown(lines: string[]): string[] {
  const state = initialMarkdownState();
  return lines.map((line) => highlightLine(line, state));
}

/**
 * The `## Heading` a given line sits under, for labelling annotations and locks.
 * Returns null for lines above the first heading.
 */
export function sectionOf(lines: string[], lineIndex: number): string | null {
  const state = initialMarkdownState();
  let current: string | null = null;
  for (let i = 0; i <= lineIndex && i < lines.length; i++) {
    const line = lines[i]!;
    const fence = FENCE.exec(line);
    if (fence) {
      state.inFence = !state.inFence;
      continue;
    }
    if (state.inFence) continue;
    const heading = HEADING.exec(line);
    if (heading) current = line.trim();
  }
  return current;
}
