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
    await target.pushToList({ movie: ['27205'] }, 'my-list', 'private');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body as string)).toEqual({ name: 'my-list', private: true });
  });

  it.each(['link', 'friends', 'public'] as const)('creates a public list for %s', async (privacy) => {
    fetchMock
      .mockResolvedValueOnce(json([]))
      .mockResolvedValueOnce(json({ id: 42, slug: 'my-list' }, 201))
      .mockResolvedValueOnce(json({ movies: [], shows: [] }))
      .mockResolvedValueOnce(json({ added: { movies: 1, shows: 0 } }));
    await target.pushToList({ movie: ['27205'] }, 'my-list', privacy);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body as string)).toEqual({ name: 'my-list', private: false });
  });

  it('sends movies and shows in the right bucket of a single bulk add', async () => {
    fetchMock
      .mockResolvedValueOnce(json([{ id: 42, name: 'my-list' }]))
      .mockResolvedValueOnce(json({ movies: [], shows: [] }))
      .mockResolvedValueOnce(json({ added: { movies: 0, shows: 2 } }));
    await target.pushToList({ show: ['1396', '1399'] }, 'my-list', 'public');
    expect(JSON.parse(fetchMock.mock.calls[2][1].body as string))
      .toEqual({ shows: [{ tmdb: 1396 }, { tmdb: 1399 }] });
  });

  it('removes only the existing items of the requested kind, in one bulk call', async () => {
    fetchMock
      .mockResolvedValueOnce(json([{ id: 42, name: 'my-list' }]))
      .mockResolvedValueOnce(json({ movies: [{ id: 1 }, { id: 2 }], shows: [{ id: 9 }] }))
      .mockResolvedValueOnce(json({ removed: { movies: 2, shows: 0 } }))
      .mockResolvedValueOnce(json({ added: { movies: 1, shows: 0 } }));
    await target.pushToList({ movie: ['3'] }, 'my-list', 'public');
    expect(urlOf(fetchMock, 2)).toContain('/lists/42/items/remove');
    expect(JSON.parse(fetchMock.mock.calls[2][1].body as string))
      .toEqual({ movies: [{ tmdb: 1 }, { tmdb: 2 }] });
  });

  it('skips the remove call when the list is already empty', async () => {
    fetchMock
      .mockResolvedValueOnce(json([{ id: 42, name: 'my-list' }]))
      .mockResolvedValueOnce(json({ movies: [], shows: [] }))
      .mockResolvedValueOnce(json({ added: { movies: 1, shows: 0 } }));
    await target.pushToList({ movie: ['3'] }, 'my-list', 'public');
    expect(fetchMock.mock.calls.some((c) => (c[0] as string).includes('items/remove'))).toBe(false);
  });

  it('never attempts to write a description', async () => {
    fetchMock
      .mockResolvedValueOnce(json([{ id: 42, name: 'my-list' }]))
      .mockResolvedValueOnce(json({ movies: [], shows: [] }))
      .mockResolvedValueOnce(json({ added: { movies: 1, shows: 0 } }));
    await target.pushToList({ movie: ['27205'] }, 'my-list', 'public');
    const bodies = fetchMock.mock.calls
      .map((c) => c[1]?.body)
      .filter((b): b is string => typeof b === 'string');
    expect(bodies.some((b) => b.includes('description'))).toBe(false);
  });

  it('writes nothing in dry-run mode', async () => {
    const dry = new MdblistTarget({ apiKey: 'key' }, cacheOptions, true);
    fetchMock.mockResolvedValue(json([{ id: 42, name: 'my-list' }]));
    await dry.pushToList({ movie: ['27205'] }, 'my-list', 'public');
    const writes = fetchMock.mock.calls.filter((c) => c[1]?.method === 'POST');
    expect(writes).toHaveLength(0);
  });

  it('raises an MdblistError on a failing response', async () => {
    fetchMock.mockResolvedValueOnce(json({ error: 'boom' }, 500));
    await expect(target.pushToList({ movie: ['1'] }, 'my-list', 'public')).rejects.toThrow(MdblistError);
  });

  /**
   * Regression guard on the fused write. A `type: "both"` list used to be pushed
   * TWICE: `GET /lists/user` and `GET /lists/{id}/items` ran twice — and the
   * items endpoint already returns BOTH buckets, so half of each response was
   * discarded — plus one remove and one add per kind. That is 8 requests where 4
   * suffice, on an API that meters a daily quota.
   */
  it('writes a "both" list with one lookup, one items read and one bulk call per direction', async () => {
    fetchMock
      .mockResolvedValueOnce(json([{ id: 42, name: 'my-list' }]))
      .mockResolvedValueOnce(json({ movies: [{ id: 1 }], shows: [{ id: 9 }] }))
      .mockResolvedValueOnce(json({ removed: { movies: 1, shows: 1 } }))
      .mockResolvedValueOnce(json({ added: { movies: 1, shows: 1 } }));

    await target.pushToList({ movie: ['3'], show: ['4'] }, 'my-list', 'public');

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls.filter((c) => (c[0] as string).includes('/lists/user'))).toHaveLength(1);
    expect(fetchMock.mock.calls.filter((c) => (c[0] as string).includes('/lists/42/items?'))).toHaveLength(1);
    expect(JSON.parse(fetchMock.mock.calls[2][1].body as string))
      .toEqual({ movies: [{ tmdb: 1 }], shows: [{ tmdb: 9 }] });
    expect(JSON.parse(fetchMock.mock.calls[3][1].body as string))
      .toEqual({ movies: [{ tmdb: 3 }], shows: [{ tmdb: 4 }] });
  });

  // Leave-untouched semantics: an absent key must appear in NEITHER payload, so
  // mdblist keeps that bucket as it is.
  it('never mentions a bucket whose key is absent', async () => {
    fetchMock
      .mockResolvedValueOnce(json([{ id: 42, name: 'my-list' }]))
      .mockResolvedValueOnce(json({ movies: [{ id: 1 }], shows: [{ id: 9 }] }))
      .mockResolvedValueOnce(json({ removed: { movies: 1, shows: 0 } }))
      .mockResolvedValueOnce(json({ added: { movies: 1, shows: 0 } }));

    await target.pushToList({ movie: ['3'] }, 'my-list', 'public');

    expect(JSON.parse(fetchMock.mock.calls[2][1].body as string)).toEqual({ movies: [{ tmdb: 1 }] });
    expect(JSON.parse(fetchMock.mock.calls[3][1].body as string)).toEqual({ movies: [{ tmdb: 3 }] });
  });

  // An empty array is a deliberate wipe: the removal happens, and the add call is
  // skipped rather than sent with an empty payload.
  it('removes a bucket handed an empty array and skips the pointless add', async () => {
    fetchMock
      .mockResolvedValueOnce(json([{ id: 42, name: 'my-list' }]))
      .mockResolvedValueOnce(json({ movies: [{ id: 1 }], shows: [] }))
      .mockResolvedValueOnce(json({ removed: { movies: 1, shows: 0 } }));

    await target.pushToList({ movie: [] }, 'my-list', 'public');

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(JSON.parse(fetchMock.mock.calls[2][1].body as string)).toEqual({ movies: [{ tmdb: 1 }] });
    expect(fetchMock.mock.calls.some((c) => (c[0] as string).includes('items/add'))).toBe(false);
  });

  it('issues no request at all when no kind is given', async () => {
    await target.pushToList({}, 'my-list', 'public');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('logs the remaining daily quota at the end of a push', async () => {
    const info = vi.spyOn(logger, 'info');
    fetchMock
      .mockResolvedValueOnce(json([{ id: 42, name: 'my-list' }]))
      .mockResolvedValueOnce(json({ movies: [], shows: [] }))
      .mockResolvedValueOnce(json({ added: { movies: 1, shows: 0 } }, 200, { 'x-ratelimit-remaining': '987' }));
    await target.pushToList({ movie: ['27205'] }, 'my-list', 'public');
    expect(info).toHaveBeenCalledWith(expect.stringContaining('987'));
  });
});

/**
 * Pagination of `GET /lists/{id}/items`.
 *
 * mdblist pages at 1,000 items, which is far above anything this tool writes, so
 * unlike Floppy this has never bitten in production — and it is deliberately NOT
 * covered by an E2E suite: the test account is a real person's metered free
 * tier, and building a 1,000-item list there to cross the boundary is not an
 * acceptable cost. A fake multi-page server covers it instead.
 *
 * What is asserted is that the read which decides what gets REMOVED sees the
 * whole list: a truncated read would leave stale items behind while the fresh
 * ones are added on top.
 */
describe('MdblistTarget pagination', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let target: MdblistTarget;

  const itemsPage = (
    movies: number[],
    shows: number[],
    pagination: Record<string, unknown>,
  ) => json({
    movies: movies.map((id) => ({ id })),
    shows: shows.map((id) => ({ id })),
    seasons: [],
    episodes: [],
    pagination,
  });

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    target = new MdblistTarget(options, cacheOptions, false);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('removes the existing items living past the first page', async () => {
    fetchMock
      .mockResolvedValueOnce(json([{ id: 42, name: 'my-list' }]))
      .mockResolvedValueOnce(itemsPage([1], [9], {
        offset: 0, limit: 1, total: 2, has_more: true,
      }))
      .mockResolvedValueOnce(itemsPage([2], [], {
        offset: 1, limit: 1, total: 2, has_more: false,
      }))
      .mockResolvedValueOnce(json({ removed: { movies: 2, shows: 0 } }))
      .mockResolvedValueOnce(json({ added: { movies: 1, shows: 0 } }));

    await target.pushToList({ movie: ['3'] }, 'my-list', 'public');

    // The first page keeps the exact request shape it always had, and the
    // second is asked for at the offset the server's own envelope dictates.
    expect(urlOf(fetchMock, 1)).not.toContain('offset=');
    expect(urlOf(fetchMock, 2)).toContain('/lists/42/items?offset=1');
    expect(JSON.parse(fetchMock.mock.calls[3][1].body as string))
      .toEqual({ movies: [{ tmdb: 1 }, { tmdb: 2 }] });
  });

  it('stops after one page when the response carries no pagination envelope', async () => {
    fetchMock
      .mockResolvedValueOnce(json([{ id: 42, name: 'my-list' }]))
      .mockResolvedValueOnce(json({ movies: [{ id: 1 }], shows: [] }))
      .mockResolvedValueOnce(json({ removed: { movies: 1, shows: 0 } }))
      .mockResolvedValueOnce(json({ added: { movies: 1, shows: 0 } }));

    await target.pushToList({ movie: ['3'] }, 'my-list', 'public');

    expect(fetchMock.mock.calls.filter((c) => (c[0] as string).includes('/lists/42/items?'))).toHaveLength(1);
  });

  it('raises rather than looping when the server announces a page without advancing', async () => {
    fetchMock
      .mockResolvedValueOnce(json([{ id: 42, name: 'my-list' }]))
      .mockResolvedValue(itemsPage([1], [], {
        offset: 0, limit: 0, total: 1, has_more: true,
      }));

    await expect(target.pushToList({ movie: ['3'] }, 'my-list', 'public')).rejects.toThrow(MdblistError);
  });

  it('gives up instead of paginating forever when has_more never clears', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/lists/user?')) return json([{ id: 42, name: 'my-list' }]);
      const offset = Number(new URL(url).searchParams.get('offset') ?? '0');
      return itemsPage([], [], {
        offset, limit: 1000, total: 999999, has_more: true,
      });
    });

    await expect(target.pushToList({ movie: ['3'] }, 'my-list', 'public')).rejects.toThrow(MdblistError);
    // Bounded: the run failed, it did not hang.
    expect(fetchMock.mock.calls.length).toBeLessThan(200);
  });
});

/**
 * The memo over `GET /lists/user`. That endpoint returns the user's WHOLE list
 * collection, so re-fetching it per config entry means N identical round trips
 * on an API that meters a daily quota.
 *
 * These tests drive a stateful fake server rather than a queue of canned
 * responses: the point is which requests are NOT made, and what the server ends
 * up holding, neither of which a fixed response sequence can express.
 */
describe('MdblistTarget list index memo', () => {
  interface FakeList { id: number; name: string }
  interface FakeInit { method: string; headers: Record<string, string>; body?: string }

  const BASE = 'https://api.mdblist.com';

  /** A fake mdblist holding a mutable list collection, so a run can observe a change. */
  const fakeServer = (initial: FakeList[]) => {
    const state = { lists: [...initial], nextId: 100 };
    const handler = vi.fn(async (url: string, init?: FakeInit) => {
      const path = url.slice(BASE.length);
      if (path.startsWith('/lists/user?')) return json(state.lists);
      if (path.startsWith('/lists/user/add')) {
        const body = JSON.parse(init?.body ?? '{}') as { name: string };
        const created = { id: state.nextId, name: body.name };
        state.nextId += 1;
        state.lists.push(created);
        return json({ id: created.id, slug: created.name }, 201);
      }
      if (/^\/lists\/\d+\/items\?/.test(path)) return json({ movies: [], shows: [] });
      if (path.includes('/items/add') || path.includes('/items/remove')) return json({});
      throw new Error(`Unexpected request: ${path}`);
    });
    return { handler, state };
  };

  type Handler = ReturnType<typeof fakeServer>['handler'];

  const urls = (handler: Handler) => handler.mock.calls.map((c) => c[0]);
  // `/lists/user?` matches the index only: the creation route is `/lists/user/add?`.
  const indexFetches = (handler: Handler) => urls(handler).filter((u) => u.includes('/lists/user?')).length;
  const creations = (handler: Handler) => urls(handler).filter((u) => u.includes('/lists/user/add')).length;
  const wroteTo = (handler: Handler, id: number) => urls(handler).some((u) => u.includes(`/lists/${id}/items/add`));

  const build = (handler: Handler) => {
    vi.stubGlobal('fetch', handler);
    return new MdblistTarget(options, cacheOptions, false);
  };

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('fetches the user list index once for two lists written in the same run', async () => {
    const { handler } = fakeServer([{ id: 42, name: 'list-a' }, { id: 43, name: 'list-b' }]);
    const t = build(handler);

    await t.connect();
    await t.pushToList({ movie: ['1'] }, 'list-a', 'public');
    await t.pushToList({ movie: ['2'] }, 'list-b', 'public');

    expect(indexFetches(handler)).toBe(1);
    // Both lists were still written, to their own id.
    expect(wroteTo(handler, 42)).toBe(true);
    expect(wroteTo(handler, 43)).toBe(true);
  });

  /**
   * The daemon-staleness guarantee. The adapter is built once per process and
   * shared by every scheduled run, so an instance-lifetime memo would keep
   * serving a list the user deleted from the web UI hours earlier, and the
   * adapter would write to a dead id.
   */
  it('drops the memo on connect(), so the next run re-reads the index instead of trusting a dead id', async () => {
    const { handler, state } = fakeServer([{ id: 42, name: 'list-a' }]);
    const t = build(handler);

    await t.connect();
    await t.pushToList({ movie: ['1'] }, 'list-a', 'public');
    expect(indexFetches(handler)).toBe(1);
    expect(wroteTo(handler, 42)).toBe(true);

    // Between two daemon ticks the user deletes the list from the mdblist web UI.
    state.lists = [];

    await t.connect();
    await t.pushToList({ movie: ['1'] }, 'list-a', 'public');

    expect(indexFetches(handler)).toBe(2);
    // The run noticed the deletion: it recreated the list and wrote to the NEW id.
    expect(creations(handler)).toBe(1);
    expect(wroteTo(handler, 100)).toBe(true);
  });

  /**
   * Belt and braces: a miss on a populated memo is not proof of absence. On a
   * backend capped at four static lists on the free tier, creating a duplicate
   * is a visible mistake, so the index is re-read before any creation.
   */
  it('re-fetches the index on a memo miss and creates nothing when the list does exist', async () => {
    const { handler, state } = fakeServer([{ id: 42, name: 'list-a' }]);
    const t = build(handler);

    await t.connect();
    await t.pushToList({ movie: ['1'] }, 'list-a', 'public');
    // "list-b" appears after the index was taken — another process, or a run
    // that created it just now.
    state.lists.push({ id: 43, name: 'list-b' });

    await t.pushToList({ movie: ['2'] }, 'list-b', 'public');

    expect(indexFetches(handler)).toBe(2);
    expect(creations(handler)).toBe(0);
    expect(wroteTo(handler, 43)).toBe(true);
    expect(state.lists).toHaveLength(2);
  });

  it('serves a list created earlier in the run from the memo, without a second index fetch', async () => {
    const { handler, state } = fakeServer([]);
    const t = build(handler);

    await t.connect();
    await t.pushToList({ movie: ['1'] }, 'new-list', 'public');
    expect(indexFetches(handler)).toBe(1);
    expect(creations(handler)).toBe(1);

    await t.pushToList({ show: ['2'] }, 'new-list', 'public');

    // The creation registered the id in the memo: no re-read, and above all no
    // second list of the same name.
    expect(indexFetches(handler)).toBe(1);
    expect(creations(handler)).toBe(1);
    expect(state.lists).toEqual([{ id: 100, name: 'new-list' }]);
  });
});
