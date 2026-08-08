import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/e2e/**/*.e2e.test.ts'],
    // Les appels réseau réels sont lents et ne doivent pas se marcher dessus :
    // un seul fichier à la fois, timeout large.
    fileParallelism: false,
    testTimeout: 60000,
    hookTimeout: 60000,
  },
});
