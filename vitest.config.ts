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
    },
    reporters: ['default', 'junit'],
    outputFile: {
      junit: '.reports/junit.xml',
    },
  },
});
