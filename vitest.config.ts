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
      exclude: [
        'src/types/**',
        // Process-level entry point: signal handlers, `process.exit` paths and
        // bootstrap wiring. Unit-testing it would mean asserting on the process
        // lifecycle rather than on behaviour, so it is deliberately excluded —
        // the logic it orchestrates is covered through Pipeline/ and Scheduler/.
        'src/app.ts',
      ],
      // Vitest reads threshold keys as glob patterns; a `global` key (the Jest
      // spelling) matches no file and silently disables the gate. Top-level keys
      // apply to the whole project.
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
    reporters: ['default', 'junit'],
    outputFile: {
      junit: '.reports/junit.xml',
    },
  },
});
