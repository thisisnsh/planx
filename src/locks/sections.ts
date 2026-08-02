export interface Section {
  /** The heading line verbatim (`## Rollout`), or null for the preamble. */
  heading: string | null;
  /** 0-based inclusive line range covering the heading and its body. */
  start: number;
  end: number;
}

const FENCE = /^\s*(`{3,}|~{3,})/;
const H2 = /^##\s+\S/;

/**
 * Split a plan on `##` headings.
 *
 * Fences are tracked because a plan that documents markdown — this project's
 * own docs, for one — contains `## ` lines inside code blocks that are content,
 * not structure. Sealing on those would carve locks at meaningless boundaries.
 */
export function splitSections(lines: string[]): Section[] {
  const starts: number[] = [];
  let inFence = false;

  lines.forEach((line, i) => {
    if (FENCE.test(line)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;
    if (H2.test(line)) starts.push(i);
  });

  const sections: Section[] = [];
  const firstHeading = starts[0] ?? lines.length;

  // Everything above the first `##` — usually the H1 and an intro paragraph.
  if (firstHeading > 0) {
    sections.push({ heading: null, start: 0, end: firstHeading - 1 });
  }

  starts.forEach((start, i) => {
    const end = (starts[i + 1] ?? lines.length) - 1;
    sections.push({ heading: lines[start]!.trim(), start, end });
  });

  // A plan with no `##` headings at all seals as one block, which is the
  // behaviour "approval locks every line of it" implies.
  if (sections.length === 0 && lines.length > 0) {
    sections.push({ heading: null, start: 0, end: lines.length - 1 });
  }

  return sections;
}

/** Locate a section by its exact heading line. */
export function findSection(lines: string[], heading: string): Section | null {
  return splitSections(lines).find((s) => s.heading === heading.trim()) ?? null;
}
