import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/e2e/**/*.e2e.test.ts'],
    // Real network calls are slow and must not step on each other: one file at
    // a time, with a generous timeout.
    fileParallelism: false,
    testTimeout: 60000,
    hookTimeout: 60000,
  },
});
