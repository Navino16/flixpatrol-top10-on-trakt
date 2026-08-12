import {
  describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';
import { FloppyTarget } from '../../../src/Targets/adapters/FloppyTarget';
import { FloppyError } from '../../../src/Utils/Errors';
import { logger } from '../../../src/Utils';

const options = { url: 'http://floppy:8000', apiKey: 'token' };
const cacheOptions = { enabled: false, savePath: './config/.cache', ttl: 1 };

const json = (body: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

const urlOf = (fetchMock: ReturnType<typeof vi.fn>, call: number) => fetchMock.mock.calls[call][0] as string;
const methodOf = (fetchMock: ReturnType<typeof vi.fn>, call: number) => (fetchMock.mock.calls[call][1]?.method ?? 'GET') as string;

describe('FloppyTarget', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let target: FloppyTarget;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    target = new FloppyTarget(options, cacheOptions, false);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('needs no interactive auth and is always authenticated', () => {
    expect(target.backend).toBe('floppy');
    expect(target.requiresInteractiveAuth).toBe(false);
    expect(target.isAuthenticated()).toBe(true);
  });

  it('sends the api key as X-API-Key', async () => {
    fetchMock.mockResolvedValueOnce(json({ results: [] }));
    await target.resolveMany([{ title: 'X', year: 2000 }], 'movie');
    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({ 'X-API-Key': 'token' });
  });

  it('maps shows to the tv media_type and movies to movie', async () => {
    fetchMock.mockResolvedValue(json({ results: [] }));
    await target.resolveMany([{ title: 'X', year: 2000 }], 'show');
    expect(urlOf(fetchMock, 0)).toContain('/api/v1/search/tv?');
    await target.resolveMany([{ title: 'X', year: 2000 }], 'movie');
    expect(urlOf(fetchMock, 1)).toContain('/api/v1/search/movie?');
  });

  it('prefers an exact title and year match over the first result', async () => {
    fetchMock.mockResolvedValueOnce(json({
      results: [
        { media_id: 999, source: 'tmdb', title: 'Inception: Music', year: 2010 },
        { media_id: 27205, source: 'tmdb', title: 'Inception', year: 2010 },
      ],
    }));
    expect(await target.resolveMany([{ title: 'Inception', year: 2010 }], 'movie')).toEqual(['tmdb:27205']);
  });

  it('drops an item when the search returns nothing', async () => {
    fetchMock.mockResolvedValueOnce(json({ results: [] }));
    expect(await target.resolveMany([{ title: 'Nope', year: 2000 }], 'movie')).toEqual([]);
  });

  it('matches on the title alone when the year differs', async () => {
    fetchMock.mockResolvedValueOnce(json({
      results: [{ media_id: 27205, source: 'tmdb', title: 'Inception', year: 2011 }],
    }));
    expect(await target.resolveMany([{ title: 'Inception', year: 2010 }], 'movie')).toEqual(['tmdb:27205']);
  });

  it('matches on the year alone when the title differs', async () => {
    fetchMock.mockResolvedValueOnce(json({
      results: [{ media_id: 27205, source: 'tmdb', title: 'Inception (Remastered)', year: 2010 }],
    }));
    expect(await target.resolveMany([{ title: 'Inception', year: 2010 }], 'movie')).toEqual(['tmdb:27205']);
  });

  it('drops and warns when no result matches the title nor the year', async () => {
    const warn = vi.spyOn(logger, 'warn');
    fetchMock.mockResolvedValueOnce(json({
      results: [
        { media_id: 999, source: 'tmdb', title: 'Inception: The Cobol Job', year: 2010 },
        { media_id: 888, source: 'tmdb', title: 'Insomnia', year: 2002 },
      ],
    }));
    expect(await target.resolveMany([{ title: 'Inception', year: 1999 }], 'movie')).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('No Floppy match'));
  });

  it('drops and warns when the item has no year and no title matches', async () => {
    const warn = vi.spyOn(logger, 'warn');
    fetchMock.mockResolvedValueOnce(json({
      results: [{ media_id: 999, source: 'tmdb', title: 'Something Else', year: 2010 }],
    }));
    expect(await target.resolveMany([{ title: 'Inception', year: null }], 'movie')).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('unknown year'));
  });

  it('adds a known media with a single PUT', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ results: [{ id: 7, name: 'my-list' }] }))
      .mockResolvedValueOnce(json({ results: [] }))
      .mockResolvedValueOnce(json([{ list_id: 7 }]));
    await target.pushToList({ movie: ['tmdb:27205'] }, 'my-list', 'public');
    expect(methodOf(fetchMock, 2)).toBe('PUT');
    expect(urlOf(fetchMock, 2)).toBe('http://floppy:8000/api/v1/media/movie/tmdb/27205/lists/7/');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('bootstraps an unknown media then removes the tracking entry it created', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ results: [{ id: 7, name: 'my-list' }] }))
      .mockResolvedValueOnce(json({ results: [] }))
      .mockResolvedValueOnce(json({ detail: 'Media not found.' }, 404)) // PUT -> 404
      .mockResolvedValueOnce(json({ id: 1 }, 201)) // POST /media/movie/
      .mockResolvedValueOnce(json([{ list_id: 7 }])) // PUT retry
      .mockResolvedValueOnce(json({}, 204)); // DELETE tracking
    await target.pushToList({ movie: ['tmdb:550'] }, 'my-list', 'public');
    expect(methodOf(fetchMock, 3)).toBe('POST');
    expect(urlOf(fetchMock, 3)).toBe('http://floppy:8000/api/v1/media/movie/');
    expect(methodOf(fetchMock, 5)).toBe('DELETE');
    expect(urlOf(fetchMock, 5)).toBe('http://floppy:8000/api/v1/media/movie/tmdb/550/');
  });

  it('never deletes a tracking entry when the first PUT succeeded', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ results: [{ id: 7, name: 'my-list' }] }))
      .mockResolvedValueOnce(json({ results: [] }))
      .mockResolvedValueOnce(json([{ list_id: 7 }]))
      // The responses below are unreachable unless a regression starts the
      // bootstrap: they are queued so the DELETE assertion is what trips,
      // not a TypeError from an exhausted mock.
      .mockResolvedValueOnce(json({ id: 1 }, 201)) // POST /media/movie/
      .mockResolvedValueOnce(json([{ list_id: 7 }])) // PUT retry
      .mockResolvedValue(json({}, 204)); // DELETE tracking, and anything after
    await target.pushToList({ movie: ['tmdb:27205'] }, 'my-list', 'public');
    const deletes = fetchMock.mock.calls.filter((c) => c[1]?.method === 'DELETE');
    expect(deletes).toHaveLength(0);
  });

  it('creates the list when no exact name match exists', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ results: [{ id: 3, name: 'my-list-other' }] }))
      .mockResolvedValueOnce(json({ id: 9, name: 'my-list' }, 201))
      .mockResolvedValueOnce(json({ results: [] }))
      .mockResolvedValueOnce(json([{ list_id: 9 }]));
    await target.pushToList({ movie: ['tmdb:1'] }, 'my-list', 'public');
    expect(methodOf(fetchMock, 1)).toBe('POST');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body as string)).toEqual({ name: 'my-list' });
  });

  it('removes only the existing items of the requested kind', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ results: [{ id: 7, name: 'my-list' }] }))
      .mockResolvedValueOnce(json({
        results: [
          { item: { media_id: '1', source: 'tmdb', media_type: 'movie' } },
          { item: { media_id: '2', source: 'tmdb', media_type: 'tv' } },
        ],
      }))
      .mockResolvedValueOnce(json({}, 204))
      .mockResolvedValueOnce(json([{ list_id: 7 }]));
    await target.pushToList({ movie: ['tmdb:3'] }, 'my-list', 'public');
    expect(urlOf(fetchMock, 2)).toBe('http://floppy:8000/api/v1/media/movie/tmdb/1/lists/7/');
    expect(methodOf(fetchMock, 2)).toBe('DELETE');
  });

  it('emits no PATCH at all, whatever the privacy', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ results: [{ id: 7, name: 'my-list' }] }))
      .mockResolvedValueOnce(json({ results: [] }))
      .mockResolvedValueOnce(json([{ list_id: 7 }]));
    await target.pushToList({ movie: ['tmdb:1'] }, 'my-list', 'private');
    expect(fetchMock.mock.calls.some((c) => c[1]?.method === 'PATCH')).toBe(false);
  });

  /**
   * The per-item PUTs are inherent to Floppy, which exposes no bulk write, so what
   * a "both" write must not duplicate is the list lookup and the items read.
   */
  it('looks the list up and reads its items once for a "both" write', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ results: [{ id: 7, name: 'my-list' }] }))
      .mockResolvedValueOnce(json({ results: [] }))
      .mockResolvedValueOnce(json([{ list_id: 7 }]))
      .mockResolvedValueOnce(json([{ list_id: 7 }]));

    await target.pushToList({ movie: ['tmdb:1'], show: ['tmdb:2'] }, 'my-list', 'public');

    const listLookups = fetchMock.mock.calls.filter((c) => (c[0] as string).includes('/api/v1/lists/?search='));
    const itemReads = fetchMock.mock.calls.filter((c) => (c[0] as string).endsWith('/api/v1/lists/7/items/'));
    expect(listLookups).toHaveLength(1);
    expect(itemReads).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(urlOf(fetchMock, 2)).toBe('http://floppy:8000/api/v1/media/movie/tmdb/1/lists/7/');
    expect(urlOf(fetchMock, 3)).toBe('http://floppy:8000/api/v1/media/tv/tmdb/2/lists/7/');
  });

  // Leave-untouched semantics: an absent key must produce neither a DELETE nor a
  // PUT for that kind, so its existing items survive.
  it('never removes the items of a kind whose key is absent', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ results: [{ id: 7, name: 'my-list' }] }))
      .mockResolvedValueOnce(json({
        results: [
          { item: { media_id: '1', source: 'tmdb', media_type: 'movie' } },
          { item: { media_id: '2', source: 'tmdb', media_type: 'tv' } },
        ],
      }))
      .mockResolvedValueOnce(json({}, 204))
      .mockResolvedValue(json([{ list_id: 7 }]));

    await target.pushToList({ movie: ['tmdb:3'] }, 'my-list', 'public');

    const deletes = fetchMock.mock.calls.filter((c) => c[1]?.method === 'DELETE').map((c) => c[0] as string);
    expect(deletes).toEqual(['http://floppy:8000/api/v1/media/movie/tmdb/1/lists/7/']);
  });

  // An empty array is a deliberate wipe, unlike an absent key.
  it('removes the items of a kind handed an empty array', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ results: [{ id: 7, name: 'my-list' }] }))
      .mockResolvedValueOnce(json({
        results: [{ item: { media_id: '1', source: 'tmdb', media_type: 'movie' } }],
      }))
      .mockResolvedValue(json({}, 204));

    await target.pushToList({ movie: [] }, 'my-list', 'public');

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(methodOf(fetchMock, 2)).toBe('DELETE');
    expect(fetchMock.mock.calls.some((c) => c[1]?.method === 'PUT')).toBe(false);
  });

  it('issues no request at all when no kind is given', async () => {
    await target.pushToList({}, 'my-list', 'public');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('writes nothing in dry-run mode', async () => {
    const dry = new FloppyTarget(options, cacheOptions, true);
    fetchMock.mockResolvedValue(json({ results: [{ id: 7, name: 'my-list' }] }));
    await dry.pushToList({ movie: ['tmdb:1'] }, 'my-list', 'public');
    const writes = fetchMock.mock.calls.filter((c) => ['PUT', 'POST', 'DELETE'].includes(c[1]?.method));
    expect(writes).toHaveLength(0);
  });

  // A server failing every attempt, not just the first: a 5xx is retried, so the
  // failure surfaces once the attempts are exhausted.
  it('raises a FloppyError when the server keeps failing', async () => {
    vi.spyOn(logger, 'warn').mockImplementation(() => logger);
    vi.spyOn(logger, 'error').mockImplementation(() => logger);
    fetchMock.mockResolvedValue(json({ detail: 'boom' }, 500));
    await expect(target.pushToList({ movie: ['tmdb:1'] }, 'my-list', 'public')).rejects.toThrow(FloppyError);
  });
});

/**
 * Pagination. Floppy serves 20 entries per page, and both reads `pushToList`
 * depends on are collections. The items read decides what gets REMOVED, so a
 * truncated one leaves stale entries behind. And `search` on the list lookup is a
 * PARTIAL match, so the exact name can sit on page two, where a single-page read
 * reports it absent and creates a DUPLICATE list.
 */
describe('FloppyTarget pagination', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let target: FloppyTarget;

  const page = (next: string | null, results: unknown[]) => json({
    pagination: {
      total: results.length, limit: 20, offset: 0, next, previous: null,
    },
    results,
  });

  const movieEntry = (mediaId: string) => ({ item: { media_id: mediaId, source: 'tmdb', media_type: 'movie' } });

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    target = new FloppyTarget(options, cacheOptions, false);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('removes the existing items living past the first page of the items read', async () => {
    fetchMock
      .mockResolvedValueOnce(page(null, [{ id: 7, name: 'my-list' }]))
      .mockResolvedValueOnce(page('http://floppy:8000/api/v1/lists/7/items/?limit=20&offset=20', [movieEntry('1')]))
      .mockResolvedValueOnce(page(null, [movieEntry('21')]))
      .mockResolvedValueOnce(json({}, 204))
      .mockResolvedValueOnce(json({}, 204))
      .mockResolvedValue(json([{ list_id: 7 }]));

    await target.pushToList({ movie: ['tmdb:3'] }, 'my-list', 'public');

    expect(urlOf(fetchMock, 2)).toBe('http://floppy:8000/api/v1/lists/7/items/?limit=20&offset=20');

    const deletes = fetchMock.mock.calls.filter((c) => c[1]?.method === 'DELETE').map((c) => c[0] as string);
    expect(deletes).toEqual([
      'http://floppy:8000/api/v1/media/movie/tmdb/1/lists/7/',
      'http://floppy:8000/api/v1/media/movie/tmdb/21/lists/7/',
    ]);
  });

  it('finds an exact list name sitting on the second page instead of creating a duplicate', async () => {
    fetchMock
      .mockResolvedValueOnce(page(
        'http://floppy:8000/api/v1/lists/?search=my-list&limit=20&offset=20',
        [{ id: 3, name: 'my-list-kids' }],
      ))
      .mockResolvedValueOnce(page(null, [{ id: 7, name: 'my-list' }]))
      .mockResolvedValueOnce(page(null, []))
      .mockResolvedValue(json([{ list_id: 7 }]));

    await target.pushToList({ movie: ['tmdb:1'] }, 'my-list', 'public');

    expect(fetchMock.mock.calls.some((c) => c[1]?.method === 'POST')).toBe(false);
    expect(urlOf(fetchMock, 3)).toBe('http://floppy:8000/api/v1/media/movie/tmdb/1/lists/7/');
  });

  /**
   * The cursor is built from the origin the SERVER sees, which behind a reverse
   * proxy or inside a container network is not the one we were configured with.
   * Only its path and query may be reused.
   */
  it('re-anchors a cursor announcing a different origin on the configured base url', async () => {
    fetchMock
      .mockResolvedValueOnce(page(null, [{ id: 7, name: 'my-list' }]))
      .mockResolvedValueOnce(page('http://floppy-internal:9999/api/v1/lists/7/items/?offset=20', []))
      .mockResolvedValueOnce(page(null, []))
      .mockResolvedValue(json([{ list_id: 7 }]));

    await target.pushToList({ movie: ['tmdb:1'] }, 'my-list', 'public');

    expect(urlOf(fetchMock, 2)).toBe('http://floppy:8000/api/v1/lists/7/items/?offset=20');
  });

  it('strips the base path of the configured url before following a cursor', async () => {
    const behindProxy = new FloppyTarget({ url: 'http://proxy/floppy', apiKey: 'token' }, cacheOptions, false);
    fetchMock
      .mockResolvedValueOnce(page(null, [{ id: 7, name: 'my-list' }]))
      .mockResolvedValueOnce(page('http://proxy/floppy/api/v1/lists/7/items/?offset=20', []))
      .mockResolvedValueOnce(page(null, []))
      .mockResolvedValue(json([{ list_id: 7 }]));

    await behindProxy.pushToList({ movie: ['tmdb:1'] }, 'my-list', 'public');

    expect(urlOf(fetchMock, 2)).toBe('http://proxy/floppy/api/v1/lists/7/items/?offset=20');
  });

  /**
   * A partial read is precisely what corrupts the list, so an unfollowable
   * cursor must fail the run rather than pass for the end of the collection.
   */
  it('raises rather than treating an unusable cursor as the end of the collection', async () => {
    fetchMock
      .mockResolvedValueOnce(page(null, [{ id: 7, name: 'my-list' }]))
      .mockResolvedValueOnce(json({
        pagination: { next: 42 },
        results: [movieEntry('1')],
      }));

    await expect(target.pushToList({ movie: ['tmdb:3'] }, 'my-list', 'public')).rejects.toThrow(FloppyError);
  });

  /**
   * Floppy on SQLite (the self-hosted default) answers 500 when a write loses the
   * race for the single writer lock: `items.add` raises `database is locked` and the
   * view does not catch it. Observed against a real instance while pushing a 25-item
   * list, one failure out of 11 lock contentions in a single run. Retrying is what
   * separates a transient contention from a broken backend.
   */
  describe('retry on transient server errors', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.spyOn(logger, 'warn').mockImplementation(() => logger);
      vi.spyOn(logger, 'error').mockImplementation(() => logger);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('retries a 500 and succeeds when the retry does', async () => {
      fetchMock
        .mockResolvedValueOnce(json({ detail: 'Internal server error.' }, 500))
        .mockResolvedValueOnce(json({ results: [] }));

      const pending = target.resolveMany([{ title: 'X', year: 2000 }], 'movie');
      await vi.runAllTimersAsync();

      expect(await pending).toEqual([]);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('gives up with a FloppyError once the attempts are exhausted', async () => {
      fetchMock.mockResolvedValue(json({ detail: 'Internal server error.' }, 500));

      // The assertion is attached BEFORE the timers advance, otherwise the rejection
      // lands with no handler and vitest reports an unhandled error.
      const assertion = expect(
        target.resolveMany([{ title: 'X', year: 2000 }], 'movie'),
      ).rejects.toThrow(FloppyError);
      await vi.runAllTimersAsync();
      await assertion;

      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    /**
     * 404 and 409 carry meaning for the caller: a 404 is what proves a media is absent
     * from the catalogue and drives the bootstrap in `addItem`. Retrying them would
     * waste requests and delay the sequence that depends on them.
     */
    it('never retries a 4xx, which is business meaning rather than a fault', async () => {
      fetchMock.mockResolvedValue(json({ detail: 'Not found.' }, 404));

      const assertion = expect(
        target.pushToList({ movie: ['tmdb:1'] }, 'my-list', 'public'),
      ).rejects.toThrow(FloppyError);
      await vi.runAllTimersAsync();
      await assertion;

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('retries 502, 503 and 504 as well', async () => {
      for (const status of [502, 503, 504]) {
        fetchMock.mockReset();
        fetchMock
          .mockResolvedValueOnce(json({ detail: 'nope' }, status))
          .mockResolvedValueOnce(json({ results: [] }));

        const pending = target.resolveMany([{ title: 'X', year: 2000 }], 'movie');
        await vi.runAllTimersAsync();
        await pending;

        expect(fetchMock).toHaveBeenCalledTimes(2);
      }
    });
  });

  it('gives up instead of looping forever when the cursor never ends', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/api/v1/lists/?search=')) return page(null, [{ id: 7, name: 'my-list' }]);
      return page('http://floppy:8000/api/v1/lists/7/items/?offset=20', []);
    });

    await expect(target.pushToList({ movie: ['tmdb:3'] }, 'my-list', 'public')).rejects.toThrow(FloppyError);
    // Bounded: the run failed, it did not hang.
    expect(fetchMock.mock.calls.length).toBeLessThan(1000);
  });
});

/**
 * Same defect as the one reported on mdblist: a search that the backend rejects used to
 * abort the whole run, while `resolveMany` is documented to omit what it cannot resolve.
 */
describe('FloppyTarget search resilience', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let target: FloppyTarget;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    target = new FloppyTarget(options, cacheOptions, false);
    vi.spyOn(logger, 'warn').mockImplementation(() => logger);
    vi.spyOn(logger, 'error').mockImplementation(() => logger);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('drops the item and keeps going when a search returns 400', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ detail: 'Bad request.' }, 400))
      .mockResolvedValueOnce(json({
        results: [{ media_id: 42, source: 'tmdb', title: 'Other', year: 2020 }],
      }));

    const ids = await target.resolveMany(
      [{ title: 'Bad', year: 2026 }, { title: 'Other', year: 2020 }],
      'movie',
    );

    expect(ids).toEqual(['tmdb:42']);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Skipping item'));
  });

  it('drops the item on 404 and 422 as well', async () => {
    for (const status of [404, 422]) {
      fetchMock.mockReset();
      fetchMock.mockResolvedValue(json({ detail: 'nope' }, status));

      expect(await target.resolveMany([{ title: 'X', year: 2000 }], 'movie')).toEqual([]);
    }
  });

  it('still fails the run on 401, 403 and 429', async () => {
    for (const status of [401, 403, 429]) {
      fetchMock.mockReset();
      fetchMock.mockResolvedValue(json({ detail: 'nope' }, status));

      await expect(target.resolveMany([{ title: 'X', year: 2000 }], 'movie'))
        .rejects.toThrow(FloppyError);
    }
  });

  // A 5xx is retried three times first; exhausting the attempts means the backend is
  // down, which would hit every item, so it must still fail the run.
  it('still fails the run once the 5xx retries are exhausted', async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue(json({ detail: 'boom' }, 500));

    const assertion = expect(target.resolveMany([{ title: 'X', year: 2000 }], 'movie'))
      .rejects.toThrow(FloppyError);
    await vi.runAllTimersAsync();
    await assertion;

    expect(fetchMock).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });
});
