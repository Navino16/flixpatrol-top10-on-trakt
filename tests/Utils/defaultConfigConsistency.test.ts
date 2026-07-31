import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import fs, { readFileSync } from 'fs';
import { Utils } from '../../src/Utils/Utils';

// Partial mock: only the three calls ensureConfigExist() makes are stubbed, so it
// generates in memory instead of touching the working tree. Everything else — in
// particular readFileSync, used below to read the tracked config — stays real.
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
 * There are two sources of default configuration and they must agree:
 *
 *  - `config/default.json`, the version-controlled reference file, used by anyone
 *    running from a clone of the repository;
 *  - the `defaultConfig` literal inside `Utils.ensureConfigExist()`, written only
 *    when `config/default.json` is missing — a fresh install (Docker with an empty
 *    config volume, or a downloaded binary).
 *
 * Nothing in the language keeps them in sync, and they had genuinely drifted:
 * `FlixPatrolMostHours` and the Kids Top10 entry existed only in the generator,
 * and two entries were missing `normalizeName: false` — so the same release
 * produced differently-named Trakt lists depending on how it had been installed.
 *
 * This test is the lock. Add a block to one source, add it to the other.
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
});
