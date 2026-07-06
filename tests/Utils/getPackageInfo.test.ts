import { describe, it, expect } from 'vitest';
import {
  parsePackageInfo,
  getPackageInfo,
  DEFAULT_PACKAGE_INFO,
} from '../../src/Utils/getPackageInfo';

describe('parsePackageInfo', () => {
  it('returns both fields when present and non-empty', () => {
    expect(parsePackageInfo({ name: 'my-app', version: '1.2.3' })).toEqual({
      name: 'my-app',
      version: '1.2.3',
    });
  });

  it('falls back to the default name when name is missing', () => {
    expect(parsePackageInfo({ version: '1.2.3' })).toEqual({
      name: DEFAULT_PACKAGE_INFO.name,
      version: '1.2.3',
    });
  });

  it('falls back to the default version when version is missing', () => {
    expect(parsePackageInfo({ name: 'my-app' })).toEqual({
      name: 'my-app',
      version: DEFAULT_PACKAGE_INFO.version,
    });
  });

  it('returns the full defaults for an empty object', () => {
    expect(parsePackageInfo({})).toEqual(DEFAULT_PACKAGE_INFO);
  });

  it('treats empty-string fields as missing', () => {
    expect(parsePackageInfo({ name: '', version: '' })).toEqual(DEFAULT_PACKAGE_INFO);
  });

  it('ignores non-string field types', () => {
    expect(parsePackageInfo({ name: 42, version: true })).toEqual(DEFAULT_PACKAGE_INFO);
  });

  it.each([null, undefined, 'not an object', 123, true])('returns defaults for non-object input (%p)', (value) => {
    expect(parsePackageInfo(value)).toEqual(DEFAULT_PACKAGE_INFO);
  });

  it('does not mutate the returned defaults across calls', () => {
    const first = parsePackageInfo({ name: 'custom' });
    const second = parsePackageInfo({});
    expect(second.name).toBe(DEFAULT_PACKAGE_INFO.name);
    expect(first.name).toBe('custom');
  });
});

describe('getPackageInfo', () => {
  it('reads the actual package.json and returns the project name and a valid-looking version', () => {
    const info = getPackageInfo();
    expect(info.name).toBe('flixpatrol-top10');
    expect(info.version).toMatch(/^\d+\.\d+\.\d+/);
  });
});
