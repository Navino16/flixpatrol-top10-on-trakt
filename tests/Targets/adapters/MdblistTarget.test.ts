import {
  describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';
import { MdblistTarget } from '../../../src/Targets/adapters/MdblistTarget';
import { MdblistError } from '../../../src/Utils/Errors';
import { logger } from '../../../src/Utils';

const options = { apiKey: 'key' };
const cacheOptions = { enabled: false, savePath: './config/.cache', ttl: 1 };

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
  headers: { get: (name: string) => headers[name] ?? null },
});

const urlOf = (fetchMock: ReturnType<typeof vi.fn>, call: number) => fetchMock.mock.calls[call][0] as string;

describe('MdblistTarget', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let target: MdblistTarget;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    target = new MdblistTarget(options, cacheOptions, false);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('needs no interactive auth and is always authenticated', () => {
    expect(target.backend).toBe('mdblist');
    expect(target.requiresInteractiveAuth).toBe(false);
    expect(target.isAuthenticated()).toBe(true);
  });

  it('passes sort_by_score=true on every search', async () => {
    fetchMock.mockResolvedValueOnce(json({ search: [] }));
    await target.resolveMany([{ title: 'X', year: 2000 }], 'movie');
    expect(urlOf(fetchMock, 0)).toContain('sort_by_score=true');
  });

  it('keeps the api key out of the path and in the query', async () => {
    fetchMock.mockResolvedValueOnce(json({ search: [] }));
    await target.resolveMany([{ title: 'X', year: 2000 }], 'movie');
    expect(urlOf(fetchMock, 0)).toContain('apikey=key');
  });

  it('prefers the exact title and year over a higher-ranked near match', async () => {
    fetchMock.mockResolvedValueOnce(json({
      search: [
        { title: 'Breaking Bad Fortune Teller', year: 2016, ids: { tmdbid: 232533 } },
        { title: 'Breaking Bad', year: 2008, ids: { tmdbid: 1396 } },
      ],
    }));
    expect(await target.resolveMany([{ title: 'Breaking Bad', year: 2008 }], 'show')).toEqual(['1396']);
  });

  it('skips a result carrying no tmdb id', async () => {
    fetchMock.mockResolvedValueOnce(json({ search: [{ title: 'X', year: 2000, ids: { tmdbid: null } }] }));
    expect(await target.resolveMany([{ title: 'X', year: 2000 }], 'movie')).toEqual([]);
  });

  it('matches on the title alone when the year differs', async () => {
    fetchMock.mockResolvedValueOnce(json({
      search: [{ title: 'Breaking Bad', year: 2009, ids: { tmdbid: 1396 } }],
    }));
    expect(await target.resolveMany([{ title: 'Breaking Bad', year: 2008 }], 'show')).toEqual(['1396']);
  });

  it('matches on the year alone when the title differs', async () => {
    fetchMock.mockResolvedValueOnce(json({
      search: [{ title: 'Breaking Bad (US)', year: 2008, ids: { tmdbid: 1396 } }],
    }));
    expect(await target.resolveMany([{ title: 'Breaking Bad', year: 2008 }], 'show')).toEqual(['1396']);
  });

  it('drops and warns when no result matches the title nor the year', async () => {
    const warn = vi.spyOn(logger, 'warn');
    fetchMock.mockResolvedValueOnce(json({
      search: [
        { title: 'Breaking Bad Fortune Teller', year: 2016, ids: { tmdbid: 232533 } },
        { title: 'Bad Education', year: 2019, ids: { tmdbid: 550 } },
      ],
    }));
    expect(await target.resolveMany([{ title: 'Breaking Bad', year: 2008 }], 'show')).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('No mdblist match'));
  });

  it('drops and warns when the item has no year and no title matches', async () => {
    const warn = vi.spyOn(logger, 'warn');
    fetchMock.mockResolvedValueOnce(json({
      search: [{ title: 'Breaking Bad Fortune Teller', year: 2016, ids: { tmdbid: 232533 } }],
    }));
    expect(await target.resolveMany([{ title: 'Breaking Bad', year: null }], 'show')).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('unknown year'));
  });

  it('creates a private list when privacy is private', async () => {
    fetchMock
      .mockResolvedValueOnce(json([])) // GET /lists/user
      .mockResolvedValueOnce(json({ id: 42, slug: 'my-list' }, 201))
      .mockResolvedValueOnce(json({ movies: [], shows: [] }))
      .mockResolvedValueOnce(json({ added: { movies: 1, shows: 0 } }));
    await target.pushToList(['27205'], 'my-list', 'movie', 'private');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body as string)).toEqual({ name: 'my-list', private: true });
  });

  it.each(['link', 'friends', 'public'] as const)('creates a public list for %s', async (privacy) => {
    fetchMock
      .mockResolvedValueOnce(json([]))
      .mockResolvedValueOnce(json({ id: 42, slug: 'my-list' }, 201))
      .mockResolvedValueOnce(json({ movies: [], shows: [] }))
      .mockResolvedValueOnce(json({ added: { movies: 1, shows: 0 } }));
    await target.pushToList(['27205'], 'my-list', 'movie', privacy);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body as string)).toEqual({ name: 'my-list', private: false });
  });

  it('sends movies and shows in the right bucket of a single bulk add', async () => {
    fetchMock
      .mockResolvedValueOnce(json([{ id: 42, name: 'my-list' }]))
      .mockResolvedValueOnce(json({ movies: [], shows: [] }))
      .mockResolvedValueOnce(json({ added: { movies: 0, shows: 2 } }));
    await target.pushToList(['1396', '1399'], 'my-list', 'show', 'public');
    expect(JSON.parse(fetchMock.mock.calls[2][1].body as string))
      .toEqual({ shows: [{ tmdb: 1396 }, { tmdb: 1399 }] });
  });

  it('removes only the existing items of the requested kind, in one bulk call', async () => {
    fetchMock
      .mockResolvedValueOnce(json([{ id: 42, name: 'my-list' }]))
      .mockResolvedValueOnce(json({ movies: [{ id: 1 }, { id: 2 }], shows: [{ id: 9 }] }))
      .mockResolvedValueOnce(json({ removed: { movies: 2, shows: 0 } }))
      .mockResolvedValueOnce(json({ added: { movies: 1, shows: 0 } }));
    await target.pushToList(['3'], 'my-list', 'movie', 'public');
    expect(urlOf(fetchMock, 2)).toContain('/lists/42/items/remove');
    expect(JSON.parse(fetchMock.mock.calls[2][1].body as string))
      .toEqual({ movies: [{ tmdb: 1 }, { tmdb: 2 }] });
  });

  it('skips the remove call when the list is already empty', async () => {
    fetchMock
      .mockResolvedValueOnce(json([{ id: 42, name: 'my-list' }]))
      .mockResolvedValueOnce(json({ movies: [], shows: [] }))
      .mockResolvedValueOnce(json({ added: { movies: 1, shows: 0 } }));
    await target.pushToList(['3'], 'my-list', 'movie', 'public');
    expect(fetchMock.mock.calls.some((c) => (c[0] as string).includes('items/remove'))).toBe(false);
  });

  it('never attempts to write a description', async () => {
    fetchMock
      .mockResolvedValueOnce(json([{ id: 42, name: 'my-list' }]))
      .mockResolvedValueOnce(json({ movies: [], shows: [] }))
      .mockResolvedValueOnce(json({ added: { movies: 1, shows: 0 } }));
    await target.pushToList(['27205'], 'my-list', 'movie', 'public');
    const bodies = fetchMock.mock.calls
      .map((c) => c[1]?.body)
      .filter((b): b is string => typeof b === 'string');
    expect(bodies.some((b) => b.includes('description'))).toBe(false);
  });

  it('writes nothing in dry-run mode', async () => {
    const dry = new MdblistTarget({ apiKey: 'key' }, cacheOptions, true);
    fetchMock.mockResolvedValue(json([{ id: 42, name: 'my-list' }]));
    await dry.pushToList(['27205'], 'my-list', 'movie', 'public');
    const writes = fetchMock.mock.calls.filter((c) => c[1]?.method === 'POST');
    expect(writes).toHaveLength(0);
  });

  it('raises an MdblistError on a failing response', async () => {
    fetchMock.mockResolvedValueOnce(json({ error: 'boom' }, 500));
    await expect(target.pushToList(['1'], 'my-list', 'movie', 'public')).rejects.toThrow(MdblistError);
  });

  it('logs the remaining daily quota at the end of a push', async () => {
    const info = vi.spyOn(logger, 'info');
    fetchMock
      .mockResolvedValueOnce(json([{ id: 42, name: 'my-list' }]))
      .mockResolvedValueOnce(json({ movies: [], shows: [] }))
      .mockResolvedValueOnce(json({ added: { movies: 1, shows: 0 } }, 200, { 'x-ratelimit-remaining': '987' }));
    await target.pushToList(['27205'], 'my-list', 'movie', 'public');
    expect(info).toHaveBeenCalledWith(expect.stringContaining('987'));
  });
});
