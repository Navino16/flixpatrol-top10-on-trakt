import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';

const cacheGet = vi.fn();
const cacheSet = vi.fn();
const cacheFactory = vi.fn(() => ({ get: cacheGet, set: cacheSet }));

vi.mock('file-system-cache', () => ({
  default: (...args: unknown[]) => cacheFactory(...args),
}));

const { ResolutionCache } = await import('../../src/Targets/ResolutionCache');

const enabled = { enabled: true, savePath: './config/.cache', ttl: 604800 };

describe('ResolutionCache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('namespaces the cache directory per backend', () => {
    // eslint-disable-next-line no-new
    new ResolutionCache(enabled, 'floppy');
    expect(cacheFactory).toHaveBeenCalledWith(expect.objectContaining({
      basePath: './config/.cache/resolution-floppy',
      ns: 'flixpatrol-resolution-floppy',
      ttl: 604800,
    }));
  });

  it('keys entries on kind, title and year', async () => {
    const cache = new ResolutionCache(enabled, 'mdblist');
    await cache.set({ title: 'Inception', year: 2010 }, 'movie', '27205');
    expect(cacheSet).toHaveBeenCalledWith('movie|Inception|2010', '27205');
  });

  it('distinguishes the same title across kinds', async () => {
    const cache = new ResolutionCache(enabled, 'mdblist');
    await cache.set({ title: 'Fargo', year: 1996 }, 'movie', '275');
    await cache.set({ title: 'Fargo', year: 1996 }, 'show', '60622');
    expect(cacheSet.mock.calls[0][0]).not.toBe(cacheSet.mock.calls[1][0]);
  });

  it('represents a missing year explicitly so it cannot collide with a real one', async () => {
    const cache = new ResolutionCache(enabled, 'trakt');
    await cache.set({ title: 'Unknown', year: null }, 'movie', '1');
    expect(cacheSet).toHaveBeenCalledWith('movie|Unknown|unknown', '1');
  });

  it('returns null and never touches the cache when caching is disabled', async () => {
    const cache = new ResolutionCache({ ...enabled, enabled: false }, 'trakt');
    expect(cacheFactory).not.toHaveBeenCalled();
    expect(await cache.get({ title: 'Inception', year: 2010 }, 'movie')).toBeNull();
    await cache.set({ title: 'Inception', year: 2010 }, 'movie', '1');
    expect(cacheSet).not.toHaveBeenCalled();
  });

  it('returns the cached id on a hit', async () => {
    cacheGet.mockResolvedValueOnce('27205');
    const cache = new ResolutionCache(enabled, 'trakt');
    expect(await cache.get({ title: 'Inception', year: 2010 }, 'movie')).toBe('27205');
  });
});
