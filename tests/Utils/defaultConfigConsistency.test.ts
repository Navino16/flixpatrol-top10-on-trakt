import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import fs, { readFileSync } from 'fs';
import { Utils } from '../../src/Utils/Utils';
import { TRAKT_TEMPLATE_CLIENT_ID, TRAKT_TEMPLATE_CLIENT_SECRET } from '../../src/types';

// Partial mock: only the three calls ensureConfigExist() makes are stubbed, so it
// generates in memory. readFileSync stays real, to read the tracked config below.
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  const stubbed = {
    ...actual,
    existsSync: vi.fn(),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
  };
  return { ...stubbed, default: stubbed };
});

vi.spyOn(process, 'exit').mockImplementation((() => {
  throw new Error('process.exit called');
}) as unknown as typeof process.exit);

/** Recursively sort object keys so the comparison ignores key ordering. */
function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.keys(record)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = sortKeysDeep(record[key]);
        return acc;
      }, {});
  }
  return value;
}

/**
 * Two sources of default configuration must agree: the tracked `config/default.json`
 * used when running from a clone, and the `defaultConfig` literal inside
 * `Utils.ensureConfigExist()` written on a fresh install. Nothing in the language
 * keeps them in sync, so this test is the lock.
 */
describe('default configuration consistency', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('config/default.json matches the defaultConfig generated on a fresh install', () => {
    vi.mocked(fs.existsSync)
      .mockReturnValueOnce(false) // config/default.json is missing
      .mockReturnValueOnce(true); // the config directory already exists

    expect(() => Utils.ensureConfigExist()).toThrow('process.exit called');

    const written = vi.mocked(fs.writeFileSync).mock.calls[0][1] as string;
    const generated: unknown = JSON.parse(written);
    const tracked: unknown = JSON.parse(readFileSync('config/default.json', 'utf8'));

    expect(sortKeysDeep(generated)).toEqual(sortKeysDeep(tracked));
  });

  /**
   * The startup guard recognises template credentials by comparing against these
   * constants. `config/default.json` is plain JSON and cannot import them, so
   * rewording the template alone would silently stop the guard from matching.
   */
  it('config/default.json ships exactly the template credentials the guard matches', () => {
    const tracked = JSON.parse(readFileSync('config/default.json', 'utf8')) as {
      Target: Record<string, unknown>;
    };

    expect(tracked.Target.clientId).toBe(TRAKT_TEMPLATE_CLIENT_ID);
    expect(tracked.Target.clientSecret).toBe(TRAKT_TEMPLATE_CLIENT_SECRET);
  });
});
