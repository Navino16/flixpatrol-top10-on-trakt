import { logger, MdblistError } from '../../Utils';
import type { CacheOptions, MdblistOptions } from '../../types';
import type {
  ListContent, ListPrivacy, ListTarget, MediaItem, MediaKind, TargetBackend,
} from '../ListTarget';
import { MEDIA_KINDS } from '../ListTarget';
import { isPrivate } from '../privacy';
import { ResolutionCache } from '../ResolutionCache';
import {
  detailOf, isRecord, isUnsearchable, readPayload,
} from '../http';
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
 * The `pagination` envelope of `GET /lists/{id}/items`. mdblist exposes no cursor URL:
 * continuation is `has_more` plus the offset/limit of the page just read.
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

// `POST /lists/user/add` answers `{ id, slug, url }` with no `name`, so `readList` —
// which requires one for the equality lookup — cannot be reused here.
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
 * Reads the pagination envelope, or null when the response carries none.
 *
 * A missing `offset` or `limit` is deliberately kept as NaN rather than defaulted: the
 * caller refuses to advance on a non-finite next offset, so a nonsensical envelope
 * raises an error instead of looping forever.
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
 * mdblist adapter. The API key goes in the query string (`?apikey=`), never a header,
 * and writes are done in bulk rather than item by item.
 *
 * `description` is never sent: the API silently ignores it on a `PUT` alongside
 * `name`/`private`, and rejects it with a 400 on its own. `last_updated_at` covers the
 * need natively.
 */
export class MdblistTarget implements ListTarget {
  public readonly backend: TargetBackend = 'mdblist';

  public readonly requiresInteractiveAuth = false;

  private static readonly BASE = 'https://api.mdblist.com';

  /**
   * Ceiling on the pages one paginated read may follow, far beyond anything this tool
   * writes, so that a server never clearing `has_more` still terminates.
   */
  private static readonly MAX_PAGES = 100;

  private readonly apiKey: string;

  private readonly dryRun: boolean;

  private readonly cache: ResolutionCache;

  /**
   * `GET /lists/user` returns the whole collection, so one call answers every list
   * lookup of a run. Memoised as name -> id; null until the first call of the run.
   */
  private listIndex: Map<string, number> | null = null;

  constructor(options: MdblistOptions, cacheOptions: CacheOptions, dryRun: boolean) {
    this.apiKey = options.apiKey;
    this.dryRun = dryRun;
    this.cache = new ResolutionCache(cacheOptions, 'mdblist');
  }

  public isAuthenticated(): boolean {
    // The configuration schema already validated the API key.
    return true;
  }

  public async connect(): Promise<void> {
    // Nothing to negotiate — the key is static. What this does is drop the list index
    // memo: the adapter instance outlives a single run in daemon mode, so a memo kept
    // for its lifetime would go stale between ticks and could point at a list deleted
    // from the web UI in the meantime. `connect()` runs once per run, which scopes it.
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
   * A result without a `tmdbid` is discarded before matching rather than inside
   * `pickBestMatch`: it could not be written at all, so it is not an eligible
   * candidate in the first place.
   */
  private static pickBest(results: MdblistSearchResult[], item: MediaItem): number | null {
    const usable = results.filter((r) => r.ids.tmdbid !== null);
    return pickBestMatch(usable, item, (r) => r)?.ids.tmdbid ?? null;
  }

  /**
   * Single point of passage to the API, appending the key to the query string. Any
   * status outside `expected` throws an MdblistError.
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
      throw new MdblistError(
        `${method} ${path} returned ${response.status}${detailOf(payload, 'error')}`,
        response.status,
      );
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
   * This read decides what gets removed, so a truncated answer would silently leave
   * stale items behind while the fresh ones are added on top. Continuation follows
   * `has_more` and the server's own offset/limit rather than a hardcoded page size,
   * which would be a bet that breaks quietly the day it is exceeded.
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
   * `sort_by_score=true` is forced because the default ranking is poor. Unlike the list
   * reads, this one is deliberately not paginated: `limit=20` is a relevance window,
   * not a page, and a title absent from the best-scored hits is not a candidate.
   */
  private async searchId(item: MediaItem, kind: MediaKind): Promise<string | null> {
    const type = MdblistTarget.mediaType(kind);
    const title = encodeURIComponent(MdblistTarget.foldForSearch(item.title));
    const query = `query=${title}&year=${item.year ?? ''}&limit=20&sort_by_score=true`;

    let found: { payload: unknown };
    try {
      found = await this.request('GET', `/search/${type}?${query}`, undefined, [200]);
    } catch (error) {
      // A rejected query condemns this title, not the run: drop it like a search that
      // returned nothing. Anything systemic (auth, quota, 5xx) still fails the run.
      if (!isUnsearchable(error)) throw error;
      const year = item.year ?? 'unknown year';
      logger.warn(`mdblist cannot search "${item.title}" (${year}): ${(error as Error).message}. Skipping item.`);
      return null;
    }

    const tmdbid = MdblistTarget.pickBest(readSearchResults(found.payload), item);
    return tmdbid === null ? null : `${tmdbid}`;
  }

  /**
   * mdblist answers 400 `Invalid search query` for anything past Latin-1 — curly quotes,
   * dashes, ellipsis, CJK — while storing those very titles verbatim, so folding the
   * punctuation back to ASCII is what makes them findable. Measured against the live API:
   * `é` is accepted, `’` is not. CJK has no ASCII equivalent and stays unsearchable.
   *
   * Applied to the query ONLY. The scraped title still drives the match cascade, which
   * compares against what mdblist returns — the curly form.
   */
  private static foldForSearch(title: string): string {
    return title
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/[\u2013\u2014]/g, '-')
      .replace(/\u2026/g, '...');
  }

  /**
   * Fetches the full list collection and (re)builds the memo. Lookup is strict name
   * equality, so the key is the raw name and the first occurrence wins, keeping the
   * chosen id stable should mdblist hold two lists sharing a name.
   *
   * Unlike the item reads this one is not paginated: `GET /lists/user` answers a bare
   * JSON array, with no envelope and no `has_more` to follow.
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
      // A miss on an already populated memo is not proof of absence — the index may
      // predate a list created since — so confirm with one re-fetch before creating a
      // duplicate. A freshly fetched index needs no such confirmation, hence the branch.
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
    // Record it so a later lookup in the same run hits the memo instead of paying
    // another index fetch, or creating the list twice.
    index.set(listName, id);
    return id;
  }

  /**
   * Writes both buckets in a single pass, which is what the API expects: the items
   * endpoint returns `movies` and `shows` together, and both bulk writes carry the two
   * buckets at once.
   *
   * A bucket whose key is absent from `ids` appears in neither payload, so mdblist
   * leaves its items alone.
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
