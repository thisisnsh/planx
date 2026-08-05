/**
 * The plan's markdown highlighting, ported from src/render/markdown.ts.
 *
 * Line-oriented on purpose: the input can be a diff hunk that starts halfway
 * through a list, and every branch reproduces the source characters exactly.
 * The `**` stays visible because this is a source view — the line on screen is
 * the line in the file, which is the line the reviewer selects and the agent is
 * quoted.
 */

import { p, type Line } from './text.js';

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

export function highlightLine(line: string, state: MarkdownState): Line {
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
    return [p(line, 'dim')];
  }

  if (state.inFence) return [p(line, 'code')];
  if (RULE.test(line)) return [p(line, 'dim')];

  const heading = HEADING.exec(line);
  if (heading) {
    return [p(heading[1]!), p(heading[2]!, 'dim'), p(heading[3]!), ...inline(heading[4]!, 'head')];
  }

  const quote = QUOTE.exec(line);
  if (quote) {
    return [p(quote[1]!), p(quote[2]!, 'dim'), p(quote[3]!), p(quote[4]!, 'dim')];
  }

  if (TABLE.test(line)) {
    return line.split(/(\|)/).map((part) => p(part, part === '|' ? 'dim' : undefined));
  }

  const list = LIST.exec(line);
  if (list) {
    return [p(list[1]!), p(list[2]!, 'sig'), p(list[3]!), ...inline(list[4]!)];
  }

  return inline(line);
}

// One alternation over every inline form, so each character is consumed once
// and a URL inside backticks is not also treated as a link.
const INLINE =
  /(`+)([^`]|[^`][\s\S]*?[^`])\1|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\n]+)\*|_([^_\n]+)_|\[([^\]]*)\]\(([^)]*)\)/g;

/** `base` is the class the unstyled runs carry — headings paint theirs yellow. */
function inline(text: string, base?: string): Line {
  const out: Line = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    const at = match.index ?? 0;
    if (at > last) out.push(p(text.slice(last, at), base));
    const [whole, , code, b1, b2, i1, i2, linkText, href] = match;
    if (code !== undefined) out.push(p(whole, 'code'));
    else if (b1 !== undefined) out.push(p('**', 'dim'), p(b1, 'bold'), p('**', 'dim'));
    else if (b2 !== undefined) out.push(p('__', 'dim'), p(b2, 'bold'), p('__', 'dim'));
    else if (i1 !== undefined) out.push(p('*', 'dim'), p(i1, 'italic'), p('*', 'dim'));
    else if (i2 !== undefined) out.push(p('_', 'dim'), p(i2, 'italic'), p('_', 'dim'));
    else if (linkText !== undefined) {
      out.push(p('[', 'dim'), p(linkText, 'link'), p(`](${href})`, 'dim'));
    } else out.push(p(whole, base));
    last = at + whole.length;
  }
  if (last < text.length) out.push(p(text.slice(last), base));
  return out.length ? out : [p('', base)];
}

/** The `## Heading` a line sits under, for labelling locks. */
export function sectionOf(lines: readonly string[], lineIndex: number): string | null {
  const state = initialMarkdownState();
  let current: string | null = null;
  for (let i = 0; i <= lineIndex && i < lines.length; i++) {
    const line = lines[i]!;
    if (FENCE.test(line)) {
      state.inFence = !state.inFence;
      continue;
    }
    if (state.inFence) continue;
    if (HEADING.test(line)) current = line.trim();
  }
  return current;
}
