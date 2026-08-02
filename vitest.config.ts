import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    // Runs before any test file is imported, which is the only point at which
    // Ink's CI detection can still be influenced. See test/setup.ts.
    setupFiles: ['test/setup.ts'],
    // Protocol tests spawn real subprocesses and wait on real timers.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    pool: 'forks',
  },
});
