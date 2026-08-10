import fs from 'fs';
import path from 'path';
import { defineConfig } from 'vitest/config';

const ENV_FILE = '.env.e2e';

/**
 * Reads `.env.e2e` into a plain record, so the suites can be launched with a
 * bare `npm run test:e2e` instead of a line of exported variables.
 *
 * The file is git-ignored and holds credentials for real third-party accounts,
 * so it is never committed and never read from anywhere else. Variables already
 * present in the environment win, which keeps one-off overrides possible:
 *
 *     E2E_MDBLIST_API_KEY=other-key npm run test:e2e
 *
 * Deliberately hand-parsed rather than pulling in `dotenv`: the format needed
 * here is `KEY=value` with `#` comments, and a production dependency for a
 * test-only convenience is not worth it.
 */
function readEnvFile(): Record<string, string> {
  const file = path.resolve(process.cwd(), ENV_FILE);
  if (!fs.existsSync(file)) return {};

  const entries: Record<string, string> = {};
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    // Strip surrounding quotes so both `KEY=value` and `KEY="value"` work.
    const value = trimmed.slice(separator + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
    if (key.length > 0 && process.env[key] === undefined) entries[key] = value;
  }
  return entries;
}

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
    env: readEnvFile(),
  },
});
