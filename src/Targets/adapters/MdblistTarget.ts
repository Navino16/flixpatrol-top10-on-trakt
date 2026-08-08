import { logger, MdblistError } from '../../Utils';
import type { CacheOptions, MdblistOptions } from '../../types';
import type {
  ListContent, ListPrivacy, ListTarget, MediaItem, MediaKind, TargetBackend,
} from '../ListTarget';
import { MEDIA_KINDS } from '../ListTarget';
import { isPrivate } from '../privacy';
import { ResolutionCache } from '../ResolutionCache';

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

type HttpMethod = 'GET' | 'POST' | 'PUT';
type Bucket = 'movies' | 'shows';

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

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
   * hence `sort_by_score=true` and the requirement of an exact match. A result
   * without a `tmdbid` is discarded: without it, the write would be impossible.
   *
   * There is deliberately no last-resort fallback on the first usable result:
   * falling through the whole cascade means neither the title nor the year
   * matched, so any result left is a mismatch by definition. Returning null
   * lets the caller warn and drop the item rather than write a confidently
   * wrong entry.
   */
  private static pickBest(results: MdblistSearchResult[], item: MediaItem): number | null {
    const usable = results.filter((r) => r.ids.tmdbid !== null);
    const sameTitle = (r: MdblistSearchResult) => r.title.trim().toLowerCase() === item.title.trim().toLowerCase();
    const sameYear = (r: MdblistSearchResult) => item.year !== null && r.year === item.year;
    const best = usable.find((r) => sameTitle(r) && sameYear(r))
      ?? usable.find(sameTitle)
      ?? usable.find(sameYear);
    return best?.ids.tmdbid ?? null;
  }

  private static async readPayload(response: Response): Promise<unknown> {
    // An infrastructure error status can return HTML: in that case the absence
    // of JSON is not an error in itself, it will be reported by the status.
    try {
      return await response.json();
    } catch {
      return null;
    }
  }

  private static detailOf(payload: unknown): string {
    if (isRecord(payload) && typeof payload.error === 'string') return `: ${payload.error}`;
    return '';
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

    const payload = await MdblistTarget.readPayload(response);
    if (!expected.includes(response.status)) {
      throw new MdblistError(`${method} ${path} returned ${response.status}${MdblistTarget.detailOf(payload)}`);
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
    const ids: string[] = [];
    for (const item of items) {
      const id = await this.resolveOne(item, kind);
      if (id !== null && !ids.includes(id)) {
        ids.push(id);
      }
    }
    return ids;
  }

  private async resolveOne(item: MediaItem, kind: MediaKind): Promise<string | null> {
    const cached = await this.cache.get(item, kind);
    if (cached !== null) return cached;

    const type = MdblistTarget.mediaType(kind);
    const query = `query=${encodeURIComponent(item.title)}&year=${item.year ?? ''}&limit=20&sort_by_score=true`;
    const found = await this.request('GET', `/search/${type}?${query}`, undefined, [200]);

    const tmdbid = MdblistTarget.pickBest(readSearchResults(found.payload), item);
    if (tmdbid === null) {
      logger.warn(`No mdblist match for ${kind} "${item.title}" (${item.year ?? 'unknown year'})`);
      return null;
    }

    const id = `${tmdbid}`;
    await this.cache.set(item, kind, id);
    return id;
  }

  /**
   * Fetches the full list collection and (re)builds the memo from it. The
   * lookup is a strict name equality, so the map key is the raw name; the first
   * occurrence wins, which keeps the chosen id stable if mdblist ever holds two
   * lists sharing a name.
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

    const existing = readItems((await this.request('GET', `/lists/${listId}/items`, undefined, [200])).payload);

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
