import { describe, it, expect } from 'vitest';
import type { TargetOptions } from '../../src/types';
import { createTarget } from '../../src/Targets/createTarget';

const cacheOptions = { enabled: false, savePath: './config/.cache', ttl: 1 };

describe('createTarget', () => {
  it('builds a Floppy target that needs no interactive auth', () => {
    const target = createTarget({
      id: 'main', type: 'floppy', url: 'http://floppy:8000', apiKey: 'token',
    }, cacheOptions, false);
    expect(target.backend).toBe('floppy');
    expect(target.requiresInteractiveAuth).toBe(false);
  });

  it('builds an mdblist target', () => {
    const target = createTarget({ id: 'main', type: 'mdblist', apiKey: 'k' }, cacheOptions, false);
    expect(target.backend).toBe('mdblist');
  });

  it('throws on a Target.type the schema should already have rejected', () => {
    // Only reachable past a schema bug, since TargetSchema rejects any other `type` first.
    const bogus = { type: 'plex', apiKey: 'k' } as unknown as TargetOptions;
    expect(() => createTarget(bogus, cacheOptions, false)).toThrow(/Unhandled Target\.type/);
  });
});
