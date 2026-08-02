export interface FuzzyMatch<T> {
  item: T;
  score: number;
  /** Indices in the haystack that matched, for highlighting. */
  positions: number[];
}

/**
 * Subsequence matching with a bias toward word starts and runs.
 *
 * Hand-rolled rather than pulled in: the whole behaviour is "typing `gcr` finds
 * guard-clock-regression", and a dependency for that would be more code to
 * audit than the function itself (PLAN §17).
 */
export function fuzzyMatch<T>(needle: string, haystack: string, item: T): FuzzyMatch<T> | null {
  if (!needle) return { item, score: 0, positions: [] };

  const hay = haystack.toLowerCase();
  const pat = needle.toLowerCase();
  const positions: number[] = [];

  let score = 0;
  let hayIndex = 0;
  let previousMatch = -2;

  for (const char of pat) {
    const found = hay.indexOf(char, hayIndex);
    if (found === -1) return null;

    if (found === previousMatch + 1) score += 8; // consecutive characters
    if (found === 0 || /[^a-z0-9]/.test(hay[found - 1] ?? '')) score += 6; // word start
    score -= Math.min(found - hayIndex, 4); // penalise long skips, but not unboundedly

    positions.push(found);
    previousMatch = found;
    hayIndex = found + 1;
  }

  // Prefer shorter haystacks when the match quality is otherwise equal.
  score -= Math.floor(haystack.length / 40);
  return { item, score, positions };
}

export function fuzzyFilter<T>(
  needle: string,
  items: readonly T[],
  key: (item: T) => string,
): Array<FuzzyMatch<T>> {
  const out: Array<FuzzyMatch<T>> = [];
  for (const item of items) {
    const match = fuzzyMatch(needle, key(item), item);
    if (match) out.push(match);
  }
  return out.sort((a, b) => b.score - a.score);
}
