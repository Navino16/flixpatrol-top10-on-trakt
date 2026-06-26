import { describe, it, expect } from 'vitest';
import { resolveLogLevel, VALID_LOG_LEVELS, DEFAULT_LOG_LEVEL } from '../../src/Utils/Logger';

describe('resolveLogLevel', () => {
  it('returns the default level when input is undefined', () => {
    expect(resolveLogLevel(undefined)).toEqual({ level: DEFAULT_LOG_LEVEL, warning: null });
  });

  it('returns the default level when input is an empty string', () => {
    expect(resolveLogLevel('')).toEqual({ level: DEFAULT_LOG_LEVEL, warning: null });
  });

  it.each(VALID_LOG_LEVELS)('accepts the valid level "%s"', (level) => {
    expect(resolveLogLevel(level)).toEqual({ level, warning: null });
  });

  it('rejects an unknown level and returns a warning referencing the bad value', () => {
    const { level, warning } = resolveLogLevel('foobar');
    expect(level).toBe(DEFAULT_LOG_LEVEL);
    expect(warning).toContain('"foobar"');
    expect(warning).toContain(DEFAULT_LOG_LEVEL);
  });

  it('rejects valid level names with wrong casing (Winston compares case-sensitively)', () => {
    const { level, warning } = resolveLogLevel('DEBUG');
    expect(level).toBe(DEFAULT_LOG_LEVEL);
    expect(warning).toContain('"DEBUG"');
  });

  it('lists all valid levels in the warning message', () => {
    const { warning } = resolveLogLevel('nope');
    for (const valid of VALID_LOG_LEVELS) {
      expect(warning).toContain(valid);
    }
  });
});
