import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    // Protocol tests spawn real subprocesses and wait on real timers.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    pool: 'forks',
  },
});
