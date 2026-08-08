import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Les suites E2E tapent de vrais services : elles ne doivent ni tourner
    // dans `npm test`, ni peser sur les seuils de couverture.
    exclude: ['node_modules/**', 'build/**', 'tests/e2e/**'],
    coverage: {
      provider: 'v8',
      reportsDirectory: '.reports/coverage',
      reporter: ['text', 'json', 'html', 'cobertura'],
      include: ['src/**/*.ts'],
      exclude: ['src/types/**'],
      thresholds: {
        global: { lines: 80, functions: 80, branches: 80, statements: 80 },
      },
    },
    reporters: ['default', 'junit'],
    outputFile: {
      junit: '.reports/junit.xml',
    },
  },
});
