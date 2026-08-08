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
      .mockResolvedValueOnce(json({ results: [{ id: 7, name: 'my-list' }] })) // GET /lists/
      .mockResolvedValueOnce(json({ results: [] })) // GET /lists/7/items/
      .mockResolvedValueOnce(json([{ list_id: 7 }])); // PUT
    await target.pushToList(['tmdb:27205'], 'my-list', 'movie', 'public');
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
    await target.pushToList(['tmdb:550'], 'my-list', 'movie', 'public');
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
      // The three calls above are all this test expects. The responses below
      // exist only so a regression that reaches the bootstrap gets valid
      // responses instead of undefined: the assertion on DELETE must be what
      // trips, not a TypeError from an exhausted mock.
      .mockResolvedValueOnce(json({ id: 1 }, 201)) // POST /media/movie/
      .mockResolvedValueOnce(json([{ list_id: 7 }])) // PUT retry
      .mockResolvedValue(json({}, 204)); // DELETE tracking, and anything after
    await target.pushToList(['tmdb:27205'], 'my-list', 'movie', 'public');
    const deletes = fetchMock.mock.calls.filter((c) => c[1]?.method === 'DELETE');
    expect(deletes).toHaveLength(0);
  });

  it('creates the list when no exact name match exists', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ results: [{ id: 3, name: 'my-list-other' }] }))
      .mockResolvedValueOnce(json({ id: 9, name: 'my-list' }, 201))
      .mockResolvedValueOnce(json({ results: [] }))
      .mockResolvedValueOnce(json([{ list_id: 9 }]));
    await target.pushToList(['tmdb:1'], 'my-list', 'movie', 'public');
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
      .mockResolvedValueOnce(json({}, 204)) // DELETE du seul film
      .mockResolvedValueOnce(json([{ list_id: 7 }]));
    await target.pushToList(['tmdb:3'], 'my-list', 'movie', 'public');
    expect(urlOf(fetchMock, 2)).toBe('http://floppy:8000/api/v1/media/movie/tmdb/1/lists/7/');
    expect(methodOf(fetchMock, 2)).toBe('DELETE');
  });

  it('emits no PATCH at all, whatever the privacy', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ results: [{ id: 7, name: 'my-list' }] }))
      .mockResolvedValueOnce(json({ results: [] }))
      .mockResolvedValueOnce(json([{ list_id: 7 }]));
    await target.pushToList(['tmdb:1'], 'my-list', 'movie', 'private');
    expect(fetchMock.mock.calls.some((c) => c[1]?.method === 'PATCH')).toBe(false);
  });

  it('writes nothing in dry-run mode', async () => {
    const dry = new FloppyTarget(options, cacheOptions, true);
    fetchMock.mockResolvedValue(json({ results: [{ id: 7, name: 'my-list' }] }));
    await dry.pushToList(['tmdb:1'], 'my-list', 'movie', 'public');
    const writes = fetchMock.mock.calls.filter((c) => ['PUT', 'POST', 'DELETE'].includes(c[1]?.method));
    expect(writes).toHaveLength(0);
  });

  it('raises a FloppyError when the server fails', async () => {
    fetchMock.mockResolvedValueOnce(json({ detail: 'boom' }, 500));
    await expect(target.pushToList(['tmdb:1'], 'my-list', 'movie', 'public')).rejects.toThrow(FloppyError);
  });
});
