/**
 * Signal handling for a process that owns a child.
 *
 * `try/finally` covers a normal return and a throw. It does not cover the three
 * ways a planx process actually tends to die: ctrl-c (SIGINT), a closed
 * terminal or detached ssh session (SIGHUP), and the SIGTERM an agent harness
 * sends when it cancels or times out a call. A child left running through any
 * of those reparents to init with nothing able to stop it.
 */

/** The signals that mean "this process is going away". */
export const EXIT_SIGNALS: readonly NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP'];

/**
 * Forward {@link EXIT_SIGNALS} to a child instead of dying immediately.
 *
 * Used where the child owns the terminal: we pass the signal down and let the
 * child's exit decide ours, rather than exiting first and orphaning it.
 */
export function forwardSignals(to: (signal: NodeJS.Signals) => void): () => void {
  const installed: Array<[NodeJS.Signals, () => void]> = [];

  for (const signal of EXIT_SIGNALS) {
    const handler = () => {
      try {
        to(signal);
      } catch {
        /* the child is already gone */
      }
    };
    installed.push([signal, handler]);
    process.on(signal, handler);
  }

  return () => {
    for (const [signal, handler] of installed) process.removeListener(signal, handler);
    installed.length = 0;
  };
}
