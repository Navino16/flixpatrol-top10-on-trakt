import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reportsDirectory: '.reports/coverage',
      reporter: ['text', 'json', 'html', 'cobertura'],
      include: ['src/**/*.ts'],
      exclude: ['src/types/**'],
      thresholds: {
        global: { lines: 80, functions: 780, branches: 80, statements: 80 },
      },
    },
    reporters: ['default', 'junit'],
    outputFile: {
      junit: '.reports/junit.xml',
    },
  },
});
