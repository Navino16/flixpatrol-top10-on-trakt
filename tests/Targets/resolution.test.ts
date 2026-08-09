import {
  describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';
import { resolveSequentially, resolveThroughCache } from '../../src/Targets/resolution';
import { ResolutionCache } from '../../src/Targets/ResolutionCache';
import { logger } from '../../src/Utils';
import type { MediaItem } from '../../src/Targets/ListTarget';

const item: MediaItem = { title: 'Inception', year: 2010 };

/** A cache double: `enabled: false` would make every `set` a no-op we could not observe. */
const fakeCache = (hit: string | null = null) => {
  const set = vi.fn(async () => {});
  const get = vi.fn(async () => hit);
  return { cache: { get, set } as unknown as ResolutionCache, get, set };
};

describe('resolveSequentially', () => {
  it('preserves the input order', async () => {
    const ids = await resolveSequentially(
      [{ title: 'A', year: null }, { title: 'B', year: null }, { title: 'C', year: null }],
      async (media) => `id-${media.title}`,
    );
    expect(ids).toEqual(['id-A', 'id-B', 'id-C']);
  });

  it('drops unresolved items without interrupting the walk', async () => {
    const ids = await resolveSequentially(
      [{ title: 'A', year: null }, { title: 'B', year: null }, { title: 'C', year: null }],
      async (media) => (media.title === 'B' ? null : `id-${media.title}`),
    );
    expect(ids).toEqual(['id-A', 'id-C']);
  });

  it('de-duplicates identifiers, keeping the first occurrence', async () => {
    const ids = await resolveSequentially(
      [{ title: 'A', year: null }, { title: 'B', year: null }, { title: 'C', year: null }],
      async (media) => (media.title === 'C' ? 'id-A' : `id-${media.title}`),
    );
    expect(ids).toEqual(['id-A', 'id-B']);
  });

  it('resolves strictly one item at a time', async () => {
    let inFlight = 0;
    let overlapped = false;
    await resolveSequentially(
      [{ title: 'A', year: null }, { title: 'B', year: null }],
      async (media) => {
        inFlight += 1;
        if (inFlight > 1) overlapped = true;
        await Promise.resolve();
        inFlight -= 1;
        return media.title;
      },
    );
    expect(overlapped).toBe(false);
  });

  it('returns an empty array for an empty input', async () => {
    expect(await resolveSequentially([], async () => 'unused')).toEqual([]);
  });
});

describe('resolveThroughCache', () => {
  beforeEach(() => {
    vi.spyOn(logger, 'warn').mockImplementation(() => logger);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the cached id without searching', async () => {
    const { cache, set } = fakeCache('27205');
    const search = vi.fn(async () => 'fresh');
    expect(await resolveThroughCache({
      cache, backend: 'Trakt', item, kind: 'movie', search,
    })).toBe('27205');
    expect(search).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
  });

  it('caches a freshly resolved id under the requested kind', async () => {
    const { cache, set } = fakeCache();
    expect(await resolveThroughCache({
      cache, backend: 'Floppy', item, kind: 'show', search: async () => 'tmdb:1',
    })).toBe('tmdb:1');
    expect(set).toHaveBeenCalledWith(item, 'show', 'tmdb:1');
  });

  it('warns with the backend name and drops the item on a miss', async () => {
    const { cache, set } = fakeCache();
    expect(await resolveThroughCache({
      cache, backend: 'mdblist', item, kind: 'movie', search: async () => null,
    })).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith('No mdblist match for movie "Inception" (2010)');
    expect(set).not.toHaveBeenCalled();
  });

  it('reports an unknown year explicitly in the warning', async () => {
    const { cache } = fakeCache();
    await resolveThroughCache({
      cache, backend: 'Trakt', item: { title: 'Nope', year: null }, kind: 'show', search: async () => null,
    });
    expect(logger.warn).toHaveBeenCalledWith('No Trakt match for show "Nope" (unknown year)');
  });
});
