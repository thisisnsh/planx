export type RowKind = 'context' | 'add' | 'del';

/** A run of text within a row, flagged as changed by the intra-line word diff. */
export interface Segment {
  text: string;
  changed: boolean;
}

export interface DiffRow {
  kind: RowKind;
  text: string;
  /** 1-based line number in the left/old version, or null for an addition. */
  oldLine: number | null;
  /** 1-based line number in the right/new version, or null for a deletion. */
  newLine: number | null;
  /**
   * Word-level breakdown, present only on rows paired with their counterpart.
   * A reading aid: it never affects what can be selected (PLAN §8).
   */
  segments?: Segment[];
}

/**
 * A displayed run of rows, or a collapsed gap of unchanged lines the user can
 * expand. Gaps carry their rows so expanding is a local toggle, not a re-diff.
 */
export type Block =
  { kind: 'rows'; rows: DiffRow[] } | { kind: 'gap'; count: number; rows: DiffRow[] };

export interface DiffStat {
  added: number;
  removed: number;
  unchanged: number;
}
