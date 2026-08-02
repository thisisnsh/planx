/**
 * Cleanup that survives being killed.
 *
 * `try/finally` covers a normal return and a throw. It does not cover the three
 * ways a planx process actually tends to die: ctrl-c (SIGINT), a closed
 * terminal or detached ssh session (SIGHUP), and the SIGTERM an agent harness
 * sends when it cancels or times out a call. Anything that has to be undone on
 * the way out — an inbox request that claims someone is waiting, a child agent
 * that would otherwise reparent to init — has to be registered here as well.
 */

/** The signals that mean "this process is going away". */
export const EXIT_SIGNALS: readonly NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP'];

/**
 * Run `cleanup` when one of {@link EXIT_SIGNALS} arrives, then die of that same
 * signal. Returns a detach function to call from the caller's `finally`, so the
 * handlers do not outlive the thing they were protecting.
 *
 * The signal is re-raised rather than turned into `process.exit(1)`: a caller
 * that pressed ctrl-c should see the conventional 128+signal status, and a
 * supervising shell should see a process that died the way it was told to.
 */
export function cleanupOnSignals(cleanup: () => void): () => void {
  const installed: Array<[NodeJS.Signals, () => void]> = [];

  const detach = () => {
    for (const [signal, handler] of installed) process.removeListener(signal, handler);
    installed.length = 0;
  };

  for (const signal of EXIT_SIGNALS) {
    const handler = () => {
      // Detach first: cleanup must not re-enter, and the re-raise below needs
      // the default disposition back.
      detach();
      try {
        cleanup();
      } catch {
        // Dying is not the moment to start throwing. A request left behind is
        // recoverable — it ages out on its TTL — so cleanup is best effort.
      }
      process.kill(process.pid, signal);
    };
    installed.push([signal, handler]);
    process.on(signal, handler);
  }

  return detach;
}

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
