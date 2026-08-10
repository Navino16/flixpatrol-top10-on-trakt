import fs from 'fs';
import path from 'path';
import { defineConfig } from 'vitest/config';

const ENV_FILE = '.env.e2e';

/**
 * Reads the git-ignored `.env.e2e`, which holds credentials for real
 * third-party accounts, so the suites can run from a bare `npm run test:e2e`.
 * Variables already set in the environment win, so one-off overrides work.
 *
 * Hand-parsed rather than adding `dotenv`: the format is `KEY=value` with `#`
 * comments, not worth a production dependency for a test-only convenience.
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
    // These suites hit real third-party accounts and API quotas, so files must
    // not step on each other: one at a time.
    fileParallelism: false,
    testTimeout: 60000,
    hookTimeout: 60000,
    env: readEnvFile(),
  },
});
