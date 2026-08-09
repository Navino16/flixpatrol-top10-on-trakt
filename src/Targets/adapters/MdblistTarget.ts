import { logger, MdblistError } from '../../Utils';
import type { CacheOptions, MdblistOptions } from '../../types';
import type {
  ListContent, ListPrivacy, ListTarget, MediaItem, MediaKind, TargetBackend,
} from '../ListTarget';
import { MEDIA_KINDS } from '../ListTarget';
import { isPrivate } from '../privacy';
import { ResolutionCache } from '../ResolutionCache';
import { detailOf, isRecord, readPayload } from '../http';
import { pickBestMatch } from '../matching';
import { resolveSequentially, resolveThroughCache } from '../resolution';

/** A single result of `GET /search/{media_type}`. */
interface MdblistSearchResult {
  title: string;
  year: number | null;
  ids: { tmdbid: number | null; imdbid: string | null };
}

/** A user list as `GET /lists/user`/`POST /lists/user/add` returns it. */
interface MdblistList {
  id: number;
  name: string;
}

/** The content of `GET /lists/{id}/items`: both buckets come back, both are used. */
interface MdblistItems {
  movies: { id: number }[];
  shows: { id: number }[];
}

/**
 * The `pagination` envelope of `GET /lists/{id}/items`. mdblist exposes no
 * cursor URL: continuation is `has_more` plus the offset/limit of the page just
 * read.
 */
interface MdblistPagination {
  offset: number;
  limit: number;
  hasMore: boolean;
}

type HttpMethod = 'GET' | 'POST' | 'PUT';
type Bucket = 'movies' | 'shows';

const readSearchResult = (value: unknown): MdblistSearchResult | null => {
  if (!isRecord(value)) return null;
  const { title } = value;
  const ids = value.ids;
  if (typeof title !== 'string' || !isRecord(ids)) return null;
  const tmdbid = ids.tmdbid;
  const imdbid = ids.imdbid;
  return {
    title,
    year: typeof value.year === 'number' ? value.year : null,
    ids: {
      tmdbid: typeof tmdbid === 'number' ? tmdbid : null,
      imdbid: typeof imdbid === 'string' ? imdbid : null,
    },
  };
};

const readSearchResults = (payload: unknown): MdblistSearchResult[] => {
  if (!isRecord(payload) || !Array.isArray(payload.search)) return [];
  return payload.search
    .map((entry) => readSearchResult(entry))
    .filter((entry): entry is MdblistSearchResult => entry !== null);
};

const readList = (value: unknown): MdblistList | null => {
  if (!isRecord(value)) return null;
  const { id, name } = value;
  if (typeof id !== 'number' || typeof name !== 'string') return null;
  return { id, name };
};

const readLists = (payload: unknown): MdblistList[] => {
  if (!Array.isArray(payload)) return [];
  return payload.map((entry) => readList(entry)).filter((entry): entry is MdblistList => entry !== null);
};

// `POST /lists/user/add` answers `{ id, slug, url }`, without `name`: hence a
// reader distinct from `readList`, which requires `name` for the strict
// equality lookup.
const readCreatedListId = (value: unknown): number | null => {
  if (!isRecord(value)) return null;
  return typeof value.id === 'number' ? value.id : null;
};

const readIdBucket = (value: unknown): { id: number }[] => {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is Record<string, unknown> => isRecord(entry) && typeof entry.id === 'number')
    .map((entry) => ({ id: entry.id as number }));
};

const readItems = (payload: unknown): MdblistItems => {
  if (!isRecord(payload)) return { movies: [], shows: [] };
  return { movies: readIdBucket(payload.movies), shows: readIdBucket(payload.shows) };
};

/**
 * Reads the pagination envelope, or null when the response carries none — an
 * older mdblist, or a route that is simply not paginated. A missing `offset` or
 * `limit` is kept as NaN rather than defaulted: the caller refuses to advance on
 * a non-finite next offset, which is how a nonsensical envelope surfaces as an
 * error instead of an endless loop.
 */
const readPagination = (payload: unknown): MdblistPagination | null => {
  if (!isRecord(payload) || !isRecord(payload.pagination)) return null;
  const page = payload.pagination;
  return {
    offset: typeof page.offset === 'number' ? page.offset : Number.NaN,
    limit: typeof page.limit === 'number' ? page.limit : Number.NaN,
    hasMore: page.has_more === true,
  };
};

/**
 * mdblist adapter, a hosted list service exposing a REST API authenticated by
 * an API key in the query string (`?apikey=`), never in a header.
 *
 * Two peculiarities of this API dictate the shape of the adapter:
 * - the default ranking of the search is bad ("Breaking Bad" only comes 4th
 *   without `sort_by_score=true`), hence that parameter on every call and the
 *   requirement of an exact title + year match;
 * - writes are done in bulk (`POST .../items/add|remove` with one `{ tmdb }`
 *   array per media), unlike Floppy which writes item by item.
 *
 * `description` is never sent: the API silently ignores it on a `PUT` combined
 * with `name`/`private`, and rejects it with a 400 on its own. The need it
 * would have served is covered natively by `last_updated_at`.
 */
export class MdblistTarget implements ListTarget {
  public readonly backend: TargetBackend = 'mdblist';

  /** The API key is enough: no device flow, no human interaction. */
  public readonly requiresInteractiveAuth = false;

  private static readonly BASE = 'https://api.mdblist.com';

  /**
   * Ceiling on the number of pages a single paginated read may follow. mdblist
   * serves 1,000 items per page, so this covers 100,000 items — orders of
   * magnitude beyond anything this tool writes — while still bounding a server
   * that never clears `has_more`.
   */
  private static readonly MAX_PAGES = 100;

  private readonly apiKey: string;

  private readonly dryRun: boolean;

  private readonly cache: ResolutionCache;

  /**
   * `GET /lists/user` returns the WHOLE list collection, so one call answers
   * every list lookup of a run. Memoised here as name -> id, and null while no
   * call has been made yet in the current run.
   */
  private listIndex: Map<string, number> | null = null;

  constructor(options: MdblistOptions, cacheOptions: CacheOptions, dryRun: boolean) {
    this.apiKey = options.apiKey;
    this.dryRun = dryRun;
    this.cache = new ResolutionCache(cacheOptions, 'mdblist');
  }

  public isAuthenticated(): boolean {
    // The API key is validated by the configuration schema: if the adapter
    // exists, it has what it needs to work.
    return true;
  }

  public async connect(): Promise<void> {
    // Nothing to negotiate: authentication is a static key in the query string.
    //
    // What DOES happen here is dropping the list index memo. The adapter is
    // built once per process and shared by every scheduled run of the daemon,
    // so a memo living for the instance lifetime would go stale between two
    // ticks hours apart: a list deleted from the mdblist web UI in the meantime
    // would still look present and the adapter would write to a dead id.
    // `runPipeline` calls `connect()` once at the start of every run, which
    // scopes the memo to exactly one run without touching the ListTarget
    // interface.
    this.listIndex = null;
  }

  // mdblist names shows `show`, unlike Floppy which names them `tv`.
  private static mediaType(kind: MediaKind): string {
    return kind === 'movie' ? 'movie' : 'show';
  }

  private static bucketOf(kind: MediaKind): Bucket {
    return kind === 'movie' ? 'movies' : 'shows';
  }

  /**
   * The default ranking of the search is bad — "Breaking Bad" only comes 4th —
   * hence `sort_by_score=true` on every call and the shared match cascade on top
   * of it. A result without a `tmdbid` is discarded BEFORE matching: without it
   * the write would be impossible, so it is not an eligible candidate at all —
   * which is why that filter stays here rather than in `pickBestMatch`.
   */
  private static pickBest(results: MdblistSearchResult[], item: MediaItem): number | null {
    const usable = results.filter((r) => r.ids.tmdbid !== null);
    return pickBestMatch(usable, item, (r) => r)?.ids.tmdbid ?? null;
  }

  /**
   * Single point of passage to the API: API key in the query string, URL
   * building, content header when there is a body. Any status outside
   * `expected` throws an MdblistError mentioning the method, the path and the
   * status.
   */
  private async request(
    method: HttpMethod,
    path: string,
    body?: unknown,
    expected: number[] = [200],
  ): Promise<{ status: number; payload: unknown; headers: Response['headers'] }> {
    const separator = path.includes('?') ? '&' : '?';
    const url = `${MdblistTarget.BASE}${path}${separator}apikey=${encodeURIComponent(this.apiKey)}`;
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : `${error}`;
      throw new MdblistError(`${method} ${path} failed: ${reason}`);
    }

    const payload = await readPayload(response);
    if (!expected.includes(response.status)) {
      throw new MdblistError(`${method} ${path} returned ${response.status}${detailOf(payload, 'error')}`);
    }
    return { status: response.status, payload, headers: response.headers };
  }

  private logRemainingQuota(headers: Response['headers']): void {
    const remaining = headers.get('x-ratelimit-remaining');
    if (remaining !== null) {
      logger.info(`mdblist daily quota: ${remaining} request(s) remaining`);
    }
  }

  public async resolveMany(items: MediaItem[], kind: MediaKind): Promise<string[]> {
    return resolveSequentially(items, (item) => resolveThroughCache({
      cache: this.cache,
      backend: 'mdblist',
      item,
      kind,
      search: () => this.searchId(item, kind),
    }));
  }

  /**
   * Reads `GET /lists/{id}/items` to exhaustion and returns both buckets merged.
   *
   * This read decides what gets REMOVED, so a truncated answer would leave stale
   * items in the list while the fresh ones are added on top. mdblist's page is
   * 1,000 items, far above anything written here, but the guard costs nothing
   * and the failure it prevents is silent corruption.
   *
   * Continuation follows `has_more` and the server's own offset/limit rather
   * than a hardcoded large page: a fixed size is a bet that breaks silently the
   * day it is exceeded. `offset` is omitted from the first request so the
   * overwhelmingly common single-page read stays byte-for-byte what it was.
   */
  private async fetchAllItems(listId: number): Promise<MdblistItems> {
    const all: MdblistItems = { movies: [], shows: [] };
    let offset = 0;

    for (let page = 0; page < MdblistTarget.MAX_PAGES; page += 1) {
      const path = offset === 0 ? `/lists/${listId}/items` : `/lists/${listId}/items?offset=${offset}`;
      const { payload } = await this.request('GET', path, undefined, [200]);
      const items = readItems(payload);
      all.movies.push(...items.movies);
      all.shows.push(...items.shows);

      const pagination = readPagination(payload);
      if (pagination === null || !pagination.hasMore) return all;

      const nextOffset = pagination.offset + pagination.limit;
      if (!Number.isFinite(nextOffset) || nextOffset <= offset) {
        throw new MdblistError(
          `GET /lists/${listId}/items announced another page without advancing past offset ${offset}`,
        );
      }
      offset = nextOffset;
    }

    throw new MdblistError(
      `GET /lists/${listId}/items still had pages after ${MdblistTarget.MAX_PAGES}, `
      + 'refusing to act on a partial read',
    );
  }

  /**
   * Backend-specific half of the resolution: search, then the shared match cascade.
   *
   * This read is deliberately NOT paginated: `limit=20` combined with
   * `sort_by_score=true` is a relevance window, not a page. A title matching
   * neither by name nor by year within the twenty best-scored hits is not a
   * candidate, so reading further would only burn quota.
   */
  private async searchId(item: MediaItem, kind: MediaKind): Promise<string | null> {
    const type = MdblistTarget.mediaType(kind);
    const query = `query=${encodeURIComponent(item.title)}&year=${item.year ?? ''}&limit=20&sort_by_score=true`;
    const found = await this.request('GET', `/search/${type}?${query}`, undefined, [200]);

    const tmdbid = MdblistTarget.pickBest(readSearchResults(found.payload), item);
    return tmdbid === null ? null : `${tmdbid}`;
  }

  /**
   * Fetches the full list collection and (re)builds the memo from it. The
   * lookup is a strict name equality, so the map key is the raw name; the first
   * occurrence wins, which keeps the chosen id stable if mdblist ever holds two
   * lists sharing a name.
   *
   * No pagination here, and that is checked rather than assumed: `GET
   * /lists/user` answers a BARE JSON array, with no `pagination` envelope and no
   * `has_more`, so there is no cursor to follow. Should mdblist ever wrap it,
   * `readLists` would return an empty collection and the failure would be loud —
   * every list reported absent — rather than a silent truncation.
   */
  private async fetchListIndex(): Promise<Map<string, number>> {
    const found = await this.request('GET', '/lists/user', undefined, [200]);
    const index = new Map<string, number>();
    for (const list of readLists(found.payload)) {
      if (!index.has(list.name)) index.set(list.name, list.id);
    }
    this.listIndex = index;
    return index;
  }

  private async getOrCreateList(listName: string, privacy: ListPrivacy): Promise<number> {
    let index = this.listIndex;
    if (index === null) {
      index = await this.fetchListIndex();
    } else if (!index.has(listName)) {
      // A miss on an ALREADY POPULATED memo is not proof the list is absent:
      // the index may predate a list created since. Re-fetch once before
      // concluding, because creating a duplicate would be a visibly wrong
      // outcome on a backend capped at four static lists on the free tier.
      // A miss on a freshly fetched index needs no such confirmation, hence
      // the branch.
      index = await this.fetchListIndex();
    }

    const known = index.get(listName);
    if (known !== undefined) return known;

    if (this.dryRun) {
      logger.info(`[DRY-RUN] Would create mdblist list "${listName}"`);
      return 0;
    }
    logger.warn(`List "${listName}" was not found on mdblist, creating it`);
    const created = await this.request(
      'POST',
      '/lists/user/add',
      { name: listName, private: isPrivate(privacy) },
      [200, 201],
    );
    const id = readCreatedListId(created.payload);
    if (id === null) throw new MdblistError(`Failed to create list "${listName}"`);
    // Record the new list so a later lookup in the same run hits the memo
    // instead of paying another index fetch — or, worse, creating it twice.
    index.set(listName, id);
    return id;
  }

  /**
   * Writes both buckets in a single pass: `GET /lists/{id}/items` is per-LIST
   * and happens once — the items endpoint already returns the `movies` AND
   * `shows` buckets, so the previous per-kind call threw half of each response
   * away — and both bulk writes carry the two buckets at once, which is exactly
   * what the API expects. `GET /lists/user` is not even per-list: it returns
   * the whole collection, so it is fetched once per RUN and memoised.
   *
   * A bucket whose key is absent from `ids` is never mentioned in either
   * payload, so mdblist leaves its items alone.
   */
  public async pushToList(
    ids: ListContent,
    listName: string,
    privacy: ListPrivacy,
  ): Promise<void> {
    const kinds = MEDIA_KINDS.filter((kind) => ids[kind] !== undefined);
    if (kinds.length === 0) {
      return;
    }

    const listId = await this.getOrCreateList(listName, privacy);
    if (this.dryRun) {
      for (const kind of kinds) {
        const count = (ids[kind] as string[]).length;
        const bucket = MdblistTarget.bucketOf(kind);
        logger.info(`[DRY-RUN] Would replace ${bucket} of mdblist list "${listName}" with ${count} item(s)`);
      }
      return;
    }

    const existing = await this.fetchAllItems(listId);

    const toRemove: Partial<Record<Bucket, { tmdb: number }[]>> = {};
    const toAdd: Partial<Record<Bucket, { tmdb: number }[]>> = {};
    for (const kind of kinds) {
      const bucket = MdblistTarget.bucketOf(kind);
      const stale = existing[bucket].map((i) => ({ tmdb: i.id }));
      if (stale.length > 0) {
        logger.info(`mdblist list "${listName}" contains ${stale.length} ${kind}, removing them`);
        toRemove[bucket] = stale;
      }
      const fresh = (ids[kind] as string[]).map((id) => ({ tmdb: Number(id) }));
      if (fresh.length > 0) {
        logger.info(`Adding ${fresh.length} ${kind} into mdblist list "${listName}"`);
        toAdd[bucket] = fresh;
      }
    }

    // An empty payload would burn a request — and a daily quota unit — for nothing.
    if (Object.keys(toRemove).length > 0) {
      await this.request('POST', `/lists/${listId}/items/remove`, toRemove, [200]);
    }
    if (Object.keys(toAdd).length > 0) {
      const added = await this.request('POST', `/lists/${listId}/items/add`, toAdd, [200]);
      this.logRemainingQuota(added.headers);
    }
  }
}
