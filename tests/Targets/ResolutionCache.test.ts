import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';

/**
 * Mocks file-system-cache with one in-memory store per `basePath`, shared across every
 * `Cache()` call that requests it — mirroring the real library, where two instances
 * pointed at the same basePath read and write the same directory. This is what makes
 * the "separate namespaces" test below a real regression test: without the target id
 * in the namespace, two backend-only namespaces collide on the same store.
 */
const cacheCalls: Record<string, unknown>[] = [];
const stores = new Map<string, Map<string, unknown>>();

vi.mock('file-system-cache', () => ({
  default: (options: Record<string, unknown>) => {
    cacheCalls.push(options);
    const basePath = options.basePath as string;
    if (!stores.has(basePath)) stores.set(basePath, new Map());
    const store = stores.get(basePath) as Map<string, unknown>;
    return {
      get: async (key: string, fallback: unknown = null) => (store.has(key) ? store.get(key) : fallback),
      set: async (key: string, value: unknown) => { store.set(key, value); },
    };
  },
  FileSystemCache: class MockFileSystemCache {},
}));

const { ResolutionCache } = await import('../../src/Targets/ResolutionCache');

const enabled = { enabled: true, savePath: './config/.cache', ttl: 604800 };

describe('ResolutionCache', () => {
  beforeEach(() => {
    cacheCalls.length = 0;
    stores.clear();
  });

  it('namespaces the cache directory per backend and target id', () => {
    // eslint-disable-next-line no-new
    new ResolutionCache(enabled, 'floppy', 'main');
    expect(cacheCalls).toContainEqual(expect.objectContaining({
      basePath: './config/.cache/resolution-floppy-main',
      ns: 'flixpatrol-resolution-floppy-main',
      ttl: 604800,
    }));
  });

  it('keeps two targets of the same backend in separate namespaces', async () => {
    const first = new ResolutionCache(enabled, 'floppy', 'perso');
    const second = new ResolutionCache(enabled, 'floppy', 'famille');
    const item = { title: 'Dune', year: 2021 };

    await first.set(item, 'movie', 'tmdb:438631');

    expect(await second.get(item, 'movie')).toBeNull();
    expect(cacheCalls).toContainEqual(
      expect.objectContaining({ basePath: './config/.cache/resolution-floppy-perso' }),
    );
    expect(cacheCalls).toContainEqual(
      expect.objectContaining({ basePath: './config/.cache/resolution-floppy-famille' }),
    );
  });

  it('keys entries on kind, title and year', async () => {
    const cache = new ResolutionCache(enabled, 'mdblist', 'main');
    await cache.set({ title: 'Inception', year: 2010 }, 'movie', '27205');
    expect(await cache.get({ title: 'Inception', year: 2010 }, 'movie')).toBe('27205');
  });

  it('distinguishes the same title across kinds', async () => {
    const cache = new ResolutionCache(enabled, 'mdblist', 'main');
    await cache.set({ title: 'Fargo', year: 1996 }, 'movie', '275');
    await cache.set({ title: 'Fargo', year: 1996 }, 'show', '60622');
    expect(await cache.get({ title: 'Fargo', year: 1996 }, 'movie')).toBe('275');
    expect(await cache.get({ title: 'Fargo', year: 1996 }, 'show')).toBe('60622');
  });

  it('represents a missing year explicitly so it cannot collide with a real one', async () => {
    const cache = new ResolutionCache(enabled, 'mdblist', 'main');
    await cache.set({ title: 'Unknown', year: null }, 'movie', '1');
    await cache.set({ title: 'Unknown', year: 1999 }, 'movie', '2');
    expect(await cache.get({ title: 'Unknown', year: null }, 'movie')).toBe('1');
    expect(await cache.get({ title: 'Unknown', year: 1999 }, 'movie')).toBe('2');
  });

  it('returns null and never touches the cache when caching is disabled', async () => {
    const cache = new ResolutionCache({ ...enabled, enabled: false }, 'mdblist', 'main');
    expect(cacheCalls).toHaveLength(0);
    expect(await cache.get({ title: 'Inception', year: 2010 }, 'movie')).toBeNull();
    await cache.set({ title: 'Inception', year: 2010 }, 'movie', '1');
    expect(cacheCalls).toHaveLength(0);
  });

  it('returns the cached id on a hit', async () => {
    const cache = new ResolutionCache(enabled, 'mdblist', 'main');
    await cache.set({ title: 'Inception', year: 2010 }, 'movie', '27205');
    expect(await cache.get({ title: 'Inception', year: 2010 }, 'movie')).toBe('27205');
  });
});
