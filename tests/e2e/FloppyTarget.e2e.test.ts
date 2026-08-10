import {
  afterAll, beforeAll, describe, expect, it,
} from 'vitest';
import { FloppyTarget } from '../../src/Targets/adapters/FloppyTarget';

/**
 * E2E suite against a real Floppy instance, enabled only when `E2E_FLOPPY_URL`
 * and `E2E_FLOPPY_API_KEY` are provided; skipped otherwise so a CI without
 * secrets stays green. Assertions query the server directly with `fetch`, never
 * through the adapter.
 *
 * THE CATALOGUE TRAP. Floppy's media catalogue is shared across the whole
 * instance, not specific to the user, and it only ever grows. An
 * already-catalogued media answers 200 to the first `PUT` (the "warm" path, a
 * single write); a media absent from it answers 404 and triggers the bootstrap
 * sequence `POST` → `PUT` → `DELETE` (the "cold" path).
 *
 * Both paths are covered, and the cold path picks its media dynamically:
 * freezing an id would doom it to become warm as soon as somebody adds it to the
 * instance, and the test would then pass without covering anything.
 */
const url = process.env.E2E_FLOPPY_URL?.replace(/\/+$/, '') ?? '';
const apiKey = process.env.E2E_FLOPPY_API_KEY ?? '';
const cacheOptions = { enabled: false, savePath: './config/.cache', ttl: 1 };

// Unique per run: two concurrent runs do not destroy each other's lists.
const runId = `${process.pid}-${Date.now().toString(36)}`;
const listName = `e2e-probe-${runId}`;
const coldListName = `e2e-cold-${runId}`;
const scratchListName = `e2e-scratch-${runId}`;
const paginationListName = `e2e-pages-${runId}`;

const INCEPTION = '27205';
const FIGHT_CLUB = '550';
const BREAKING_BAD = '1396';

// Broad enough to yield several dozen real, bootstrappable TMDB ids to hunt an
// uncatalogued media in, walked in relevance order so the best-documented
// candidates come first. Each run consumes one for good, since the catalogue
// never shrinks — hence the size of the pool.
const COLD_CANDIDATES_QUERY = 'The Godfather';
const COLD_CANDIDATES_LIMIT = 100;

// Pagination case. Floppy serves 20 entries per page, so the first batch has to
// cross that boundary for the second push's items read to be forced to paginate.
// The second batch only has to be disjoint from the first, and stays small
// because each extra media costs a three-call catalogue bootstrap.
const PAGE_SIZE = 20;
const FIRST_BATCH_SIZE = 25;
const SECOND_BATCH_SIZE = 5;
const BATCH_CANDIDATES_QUERY = 'star';
const BATCH_CANDIDATES_LIMIT = 60;

interface FloppyItem {
  mediaType: string;
  mediaId: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

const resultsOf = (payload: unknown): unknown[] => (
  isRecord(payload) && Array.isArray(payload.results) ? payload.results : []
);

const asId = (value: unknown): string | null => {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return `${value}`;
  return null;
};

/** Direct call to the API, without going through the adapter. The status is exposed, we need it. */
const request = async (
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<{ status: number; payload: unknown }> => {
  const headers: Record<string, string> = { 'X-API-Key': apiKey };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${url}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  try {
    const payload: unknown = await response.json();
    return { status: response.status, payload };
  } catch {
    return { status: response.status, payload: null };
  }
};

/**
 * Same call as `request`, but reads the collection to exhaustion: every Floppy
 * collection is paginated at 20 entries per page, so a read stopping at the first
 * page cannot even OBSERVE a longer list. The `next` cursor is absolute, so it is
 * followed as it comes; the page count is capped so a broken server fails the
 * test instead of hanging the suite.
 */
const requestAllPages = async (path: string): Promise<unknown[]> => {
  const entries: unknown[] = [];
  let next: string | null = `${url}${path}`;
  let pages = 0;

  while (next !== null) {
    if (pages >= 100) throw new Error(`GET ${path} never stopped paginating`);
    const response = await fetch(next, { headers: { 'X-API-Key': apiKey } });
    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    entries.push(...resultsOf(payload));
    const pagination = isRecord(payload) && isRecord(payload.pagination) ? payload.pagination : null;
    next = pagination !== null && typeof pagination.next === 'string' ? pagination.next : null;
    pages += 1;
  }
  return entries;
};

const findListId = async (name: string): Promise<number | null> => {
  for (const entry of await requestAllPages(`/api/v1/lists/?search=${encodeURIComponent(name)}`)) {
    if (isRecord(entry) && entry.name === name && typeof entry.id === 'number') return entry.id;
  }
  return null;
};

/**
 * Real TMDB ids the instance can resolve, taken from Floppy's own search rather
 * than hardcoded: a frozen list would slowly rot as ids get retired.
 */
const searchMovieIds = async (query: string, limit: number): Promise<string[]> => {
  const search = `search=${encodeURIComponent(query)}&source=tmdb&limit=${limit}`;
  const { payload } = await request('GET', `/api/v1/search/movie?${search}`);
  const ids: string[] = [];
  for (const entry of resultsOf(payload)) {
    if (!isRecord(entry)) continue;
    const mediaId = asId(entry.media_id);
    if (mediaId !== null && !ids.includes(mediaId)) ids.push(mediaId);
  }
  return ids;
};

const createList = async (name: string): Promise<number> => {
  const { payload } = await request('POST', '/api/v1/lists/', { name });
  if (!isRecord(payload) || typeof payload.id !== 'number') throw new Error(`Could not create list "${name}"`);
  return payload.id;
};

const readListItemsById = async (listId: number): Promise<FloppyItem[]> => {
  const items: FloppyItem[] = [];
  for (const entry of await requestAllPages(`/api/v1/lists/${listId}/items/`)) {
    if (!isRecord(entry) || !isRecord(entry.item)) continue;
    const mediaId = asId(entry.item.media_id);
    const mediaType = entry.item.media_type;
    if (mediaId !== null && typeof mediaType === 'string') items.push({ mediaType, mediaId });
  }
  return items;
};

const readListItems = async (name: string): Promise<FloppyItem[]> => {
  const listId = await findListId(name);
  if (listId === null) return [];
  return readListItemsById(listId);
};

/**
 * The media tracked by the user. An entry here after a plain list addition means
 * the adapter left a "Planning" status behind it.
 */
const readTrackedIds = async (type: 'movie' | 'tv'): Promise<string[]> => {
  const ids: string[] = [];
  for (const entry of await requestAllPages(`/api/v1/media/${type}/`)) {
    if (!isRecord(entry) || !isRecord(entry.item)) continue;
    const mediaId = asId(entry.item.media_id);
    if (mediaId !== null) ids.push(mediaId);
  }
  return ids;
};

const deleteListByName = async (name: string): Promise<void> => {
  const listId = await findListId(name);
  if (listId !== null) await request('DELETE', `/api/v1/lists/${listId}/`);
};

/**
 * Looks for a movie still absent from the instance catalogue.
 *
 * Searching catalogues nothing, so the candidates it returns are still cold; the
 * `PUT` is itself the coldness test, a 404 meaning "absent from the catalogue"
 * and having changed nothing server-side. An already-warm candidate therefore
 * lands in the throwaway list, which is destroyed afterwards.
 */
const findUncataloguedMovie = async (scratchListId: number): Promise<string | null> => {
  const query = `search=${encodeURIComponent(COLD_CANDIDATES_QUERY)}&source=tmdb&limit=${COLD_CANDIDATES_LIMIT}`;
  const { payload } = await request('GET', `/api/v1/search/movie?${query}`);
  for (const entry of resultsOf(payload)) {
    if (!isRecord(entry)) continue;
    const mediaId = asId(entry.media_id);
    if (mediaId === null) continue;
    const { status } = await request('PUT', `/api/v1/media/movie/tmdb/${mediaId}/lists/${scratchListId}/`);
    if (status === 404) return mediaId;
  }
  return null;
};

describe.skipIf(!process.env.E2E_FLOPPY_URL || !process.env.E2E_FLOPPY_API_KEY)('FloppyTarget (E2E)', () => {
  let target: FloppyTarget;
  // Kept so that the final cleanup also purges the cold-path media.
  let coldMediaId: string | null = null;
  // Everything the pagination case touched, so the cleanup can purge it too.
  let batchMediaIds: string[] = [];

  beforeAll(() => {
    target = new FloppyTarget({ url, apiKey }, cacheOptions, false);
  });

  afterAll(async () => {
    for (const name of [listName, coldListName, scratchListName, paginationListName]) {
      await deleteListByName(name);
    }
    // Safety net: only purges the media this suite could have tracked.
    const ownMovies = [
      INCEPTION, FIGHT_CLUB, ...(coldMediaId === null ? [] : [coldMediaId]), ...batchMediaIds,
    ];
    for (const mediaId of ownMovies) {
      await request('DELETE', `/api/v1/media/movie/tmdb/${mediaId}/`);
    }
    await request('DELETE', `/api/v1/media/tv/tmdb/${BREAKING_BAD}/`);
  });

  it('resolves a well-known movie and a well-known show', async () => {
    expect(await target.resolveMany([{ title: 'Inception', year: 2010 }], 'movie')).toEqual([`tmdb:${INCEPTION}`]);
    expect(await target.resolveMany([{ title: 'Breaking Bad', year: 2008 }], 'show'))
      .toEqual([`tmdb:${BREAKING_BAD}`]);
  });

  it('creates the list and holds movies and shows together', async () => {
    await target.pushToList({ movie: [`tmdb:${INCEPTION}`] }, listName, 'public');
    await target.pushToList({ show: [`tmdb:${BREAKING_BAD}`] }, listName, 'public');

    const items = await readListItems(listName);
    expect(items).toEqual(expect.arrayContaining([
      { mediaType: 'movie', mediaId: INCEPTION },
      { mediaType: 'tv', mediaId: BREAKING_BAD },
    ]));
    expect(items).toHaveLength(2);
  });

  it('leaves no Planning tracking entry behind', async () => {
    expect(await readTrackedIds('movie')).not.toContain(INCEPTION);
    expect(await readTrackedIds('tv')).not.toContain(BREAKING_BAD);
  });

  it('replaces the content on a second push instead of appending', async () => {
    await target.pushToList({ movie: [`tmdb:${FIGHT_CLUB}`] }, listName, 'public');

    const items = await readListItems(listName);
    expect(items.filter((i) => i.mediaType === 'movie')).toEqual([{ mediaType: 'movie', mediaId: FIGHT_CLUB }]);
    // The other type is untouched: a movie push does not purge the shows.
    expect(items.filter((i) => i.mediaType === 'tv')).toEqual([{ mediaType: 'tv', mediaId: BREAKING_BAD }]);
  });

  it('costs a single write request on the warm path, for an already-catalogued media', async () => {
    // WARM path: the previous test has just added FIGHT_CLUB, so it is in the
    // instance catalogue and the first PUT answers 200.
    const real = globalThis.fetch;
    const seen: { method: string; url: string }[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push({ method: init?.method ?? 'GET', url: input instanceof Request ? input.url : String(input) });
      return real(input, init);
    }) as typeof fetch;

    try {
      await target.pushToList({ movie: [`tmdb:${FIGHT_CLUB}`] }, listName, 'public');
    } finally {
      globalThis.fetch = real;
    }

    const bootstrap = seen.filter((c) => c.method === 'POST' && c.url.endsWith('/api/v1/media/movie/'));
    const untrack = seen.filter(
      (c) => c.method === 'DELETE' && c.url.endsWith(`/api/v1/media/movie/tmdb/${FIGHT_CLUB}/`),
    );
    const puts = seen.filter((c) => c.method === 'PUT');

    expect(bootstrap).toHaveLength(0);
    expect(untrack).toHaveLength(0);
    expect(puts).toHaveLength(1);
    expect(await readTrackedIds('movie')).not.toContain(FIGHT_CLUB);
  });

  it('bootstraps an uncatalogued media on the cold path and leaves no tracking entry', async (ctx) => {
    // COLD path. The PUT-first order is what guarantees the cleanup DELETE can
    // never erase a hand-entered status: it only ever runs on a media the user
    // was not tracking, this one not even being in the catalogue.
    const scratchListId = await createList(scratchListName);
    coldMediaId = await findUncataloguedMovie(scratchListId);

    if (coldMediaId === null) {
      ctx.skip(
        `No uncatalogued movie left among the "${COLD_CANDIDATES_QUERY}" search results on this Floppy `
        + 'instance: the cold path cannot be exercised. Widen COLD_CANDIDATES_QUERY or use a fresh instance.',
      );
      return;
    }

    // Logged so the test output names which real media the cold path acted on.
    console.info(`[E2E] cold path exercised with uncatalogued movie tmdb:${coldMediaId}`);

    expect(await readTrackedIds('movie')).not.toContain(coldMediaId);

    const real = globalThis.fetch;
    const seen: { method: string; url: string }[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push({ method: init?.method ?? 'GET', url: input instanceof Request ? input.url : String(input) });
      return real(input, init);
    }) as typeof fetch;

    try {
      await target.pushToList({ movie: [`tmdb:${coldMediaId}`] }, coldListName, 'public');
    } finally {
      globalThis.fetch = real;
    }

    // PUT (404) → POST catalogue → PUT → DELETE of the tracking the POST created.
    const mediaRoute = `/api/v1/media/movie/tmdb/${coldMediaId}/`;
    const sequence = seen
      .filter((c) => c.url.includes(mediaRoute) || c.url.endsWith('/api/v1/media/movie/'))
      .map((c) => c.method);
    expect(sequence).toEqual(['PUT', 'POST', 'PUT', 'DELETE']);
    expect(seen.some((c) => c.method === 'POST' && c.url.endsWith('/api/v1/media/movie/'))).toBe(true);
    expect(seen.some((c) => c.method === 'DELETE' && c.url.endsWith(mediaRoute))).toBe(true);

    const coldListId = await findListId(coldListName);
    expect(coldListId).not.toBeNull();
    expect(await readListItemsById(coldListId as number))
      .toEqual([{ mediaType: 'movie', mediaId: coldMediaId }]);
    expect(await readTrackedIds('movie')).not.toContain(coldMediaId);
  });

  /**
   * `pushToList` replaces a list's contents by reading the existing items and
   * removing the ones of the kind being written. Floppy serves 20 items per page,
   * so a read stopping at the first page leaves items 21+ in place and the next
   * push piles its content on top of them. The first batch therefore deliberately
   * crosses the page boundary, the second is disjoint from it, and what is
   * checked is the SERVER's state afterwards.
   *
   * Slow by construction — every uncatalogued media costs a three-call bootstrap
   * — hence a timeout generous compared to its neighbours.
   */
  it('replaces a list bigger than one page instead of keeping the items past the boundary', async (ctx) => {
    const candidates = await searchMovieIds(BATCH_CANDIDATES_QUERY, BATCH_CANDIDATES_LIMIT);
    if (candidates.length < FIRST_BATCH_SIZE + SECOND_BATCH_SIZE) {
      ctx.skip(
        `The "${BATCH_CANDIDATES_QUERY}" search returned ${candidates.length} movies, `
        + `fewer than the ${FIRST_BATCH_SIZE + SECOND_BATCH_SIZE} needed to cross the page boundary.`,
      );
      return;
    }

    const first = candidates.slice(0, FIRST_BATCH_SIZE);
    const second = candidates.slice(FIRST_BATCH_SIZE, FIRST_BATCH_SIZE + SECOND_BATCH_SIZE);
    batchMediaIds = [...first, ...second];
    expect(first.length).toBeGreaterThan(PAGE_SIZE);
    expect(first.filter((id) => second.includes(id))).toEqual([]);

    await target.pushToList({ movie: first.map((id) => `tmdb:${id}`) }, paginationListName, 'public');

    const listId = await findListId(paginationListName);
    expect(listId).not.toBeNull();
    const afterFirst = await readListItemsById(listId as number);
    expect([...afterFirst.map((i) => i.mediaId)].sort()).toEqual([...first].sort());

    await target.pushToList({ movie: second.map((id) => `tmdb:${id}`) }, paginationListName, 'public');

    // The whole first batch is gone, including everything that sat past the first
    // page of the items read.
    const afterSecond = await readListItemsById(listId as number);
    expect([...afterSecond.map((i) => i.mediaId)].sort()).toEqual([...second].sort());

    // No tracking entry survived the bootstraps the two pushes had to perform.
    const tracked = await readTrackedIds('movie');
    expect(batchMediaIds.filter((id) => tracked.includes(id))).toEqual([]);
  }, 900000);
});
