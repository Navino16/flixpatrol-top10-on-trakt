import { describe, it, expect } from 'vitest';
import { createTarget } from '../../src/Targets/createTarget';

const cacheOptions = { enabled: false, savePath: './config/.cache', ttl: 1 };

describe('createTarget', () => {
  it('builds a Trakt target', () => {
    const target = createTarget({
      type: 'trakt', saveFile: './x', clientId: 'a', clientSecret: 'b',
    }, cacheOptions, false);
    expect(target.backend).toBe('trakt');
    expect(target.requiresInteractiveAuth).toBe(true);
  });

  it('builds a Floppy target that needs no interactive auth', () => {
    const target = createTarget({
      type: 'floppy', url: 'http://floppy:8000', apiKey: 'token',
    }, cacheOptions, false);
    expect(target.backend).toBe('floppy');
    expect(target.requiresInteractiveAuth).toBe(false);
  });

  it('builds an mdblist target', () => {
    const target = createTarget({ type: 'mdblist', apiKey: 'k' }, cacheOptions, false);
    expect(target.backend).toBe('mdblist');
  });
});
