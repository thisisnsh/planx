export interface ImportedPlan {
  title: string;
  text: string;
  /** ISO timestamp the source says the plan was written. */
  created: string;
  source: string;
  sessionId: string | null;
  /** Where it came from, shown in the import summary. */
  origin: string;
}

export interface AdapterOptions {
  /** Override the agent's home directory. Exists so tests never read a real one. */
  home?: string;
  since?: number;
  limit?: number;
}

export interface Adapter {
  name: string;
  /** Where this adapter reads from, for the "nothing found" message. */
  describe(opts: AdapterOptions): string;
  collect(opts: AdapterOptions): ImportedPlan[];
}
