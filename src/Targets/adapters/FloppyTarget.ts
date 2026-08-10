import { FloppyError, logger } from '../../Utils';
import type { CacheOptions, FloppyOptions } from '../../types';
import type {
  ListContent, ListPrivacy, ListTarget, MediaItem, MediaKind, TargetBackend,
} from '../ListTarget';
import { MEDIA_KINDS } from '../ListTarget';
import { ResolutionCache } from '../ResolutionCache';
import { detailOf, isRecord, readPayload } from '../http';
import { pickBestMatch } from '../matching';
import { resolveSequentially, resolveThroughCache } from '../resolution';

/** A single result of `GET /api/v1/search/{media_type}`. */
interface FloppySearchResult {
  media_id: number | string;
  source: string;
  media_type?: string;
  title: string;
  year: number | null;
}

/** A user list as `GET`/`POST /api/v1/lists/` returns it. */
interface FloppyList {
  id: number;
  name: string;
}

/** An entry of `GET /api/v1/lists/{id}/items/`: the useful fields are nested under `item`. */
interface FloppyListItem {
  item: { media_id: string; source: string; media_type: string };
}

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

/** Extracts the `results` array of a paginated response, assuming nothing about the rest of the envelope. */
const readResults = (payload: unknown): unknown[] => {
  if (!isRecord(payload)) return [];
  return Array.isArray(payload.results) ? payload.results : [];
};

/**
 * Path component of a base URL without its trailing slash, used to re-anchor the
 * absolute cursor Floppy returns onto the URL this adapter was configured with.
 */
const pathnameOf = (url: string): string => {
  try {
    return new URL(url).pathname.replace(/\/+$/, '');
  } catch {
    return '';
  }
};

/**
 * Floppy adapter, a self-hosted media tracker exposing a REST API under `/api/v1`.
 *
 * Two API peculiarities shape it: shows are `tv` rather than `show`, and a list's
 * visibility and description cannot be driven at all, so the `privacy` argument is
 * deliberately ignored and no `PATCH` is ever emitted.
 */
export class FloppyTarget implements ListTarget {
  public readonly backend: TargetBackend = 'floppy';

  public readonly requiresInteractiveAuth = false;

  /**
   * Ceiling on the pages one paginated read may follow, far beyond anything this tool
   * writes, so that a `next` cursor which loops or never clears still terminates.
   */
  private static readonly MAX_PAGES = 500;

  private readonly url: string;

  /** Base path of `url`, hoisted once: every page cursor is re-anchored on it. */
  private readonly basePath: string;

  private readonly apiKey: string;

  private readonly dryRun: boolean;

  private readonly cache: ResolutionCache;

  constructor(options: FloppyOptions, cacheOptions: CacheOptions, dryRun: boolean) {
    this.url = options.url.replace(/\/+$/, '');
    this.basePath = pathnameOf(this.url);
    this.apiKey = options.apiKey;
    this.dryRun = dryRun;
    this.cache = new ResolutionCache(cacheOptions, 'floppy');
  }

  public isAuthenticated(): boolean {
    // The configuration schema already validated the API key.
    return true;
  }

  public async connect(): Promise<void> {
    // Nothing to negotiate: authentication is a static header.
  }

  // Floppy needs both halves to build its routes, so ids travel as `source:media_id`.
  // Only this adapter encodes and decodes that form.
  private static encodeId(source: string, mediaId: string | number): string {
    return `${source}:${mediaId}`;
  }

  private static decodeId(id: string): { source: string; mediaId: string } {
    const separator = id.indexOf(':');
    if (separator === -1) throw new FloppyError(`Malformed Floppy id "${id}"`);
    return { source: id.slice(0, separator), mediaId: id.slice(separator + 1) };
  }

  // Floppy names shows `tv`, the configuration names them `show`.
  private static mediaType(kind: MediaKind): string {
    return kind === 'movie' ? 'movie' : 'tv';
  }

  private static toSearchResult(value: unknown): FloppySearchResult | null {
    if (!isRecord(value)) return null;
    const mediaId = value.media_id;
    const { source, title } = value;
    if (typeof mediaId !== 'number' && typeof mediaId !== 'string') return null;
    if (typeof source !== 'string' || typeof title !== 'string') return null;
    return {
      media_id: mediaId,
      source,
      media_type: typeof value.media_type === 'string' ? value.media_type : undefined,
      title,
      year: typeof value.year === 'number' ? value.year : null,
    };
  }

  private static toList(value: unknown): FloppyList | null {
    if (!isRecord(value)) return null;
    const { id, name } = value;
    if (typeof id !== 'number' || typeof name !== 'string') return null;
    return { id, name };
  }

  private static toListItem(value: unknown): FloppyListItem | null {
    if (!isRecord(value) || !isRecord(value.item)) return null;
    const mediaId = value.item.media_id;
    const mediaType = value.item.media_type;
    const { source } = value.item;
    if (typeof mediaId !== 'number' && typeof mediaId !== 'string') return null;
    if (typeof source !== 'string' || typeof mediaType !== 'string') return null;
    return { item: { media_id: `${mediaId}`, source, media_type: mediaType } };
  }

  private static readSearchResults(payload: unknown): FloppySearchResult[] {
    return readResults(payload)
      .map((entry) => FloppyTarget.toSearchResult(entry))
      .filter((entry): entry is FloppySearchResult => entry !== null);
  }

  // The two readers below take already-concatenated entries rather than one payload,
  // because their sources are read across every page.
  private static readLists(entries: unknown[]): FloppyList[] {
    return entries
      .map((entry) => FloppyTarget.toList(entry))
      .filter((entry): entry is FloppyList => entry !== null);
  }

  private static readListItems(entries: unknown[]): FloppyListItem[] {
    return entries
      .map((entry) => FloppyTarget.toListItem(entry))
      .filter((entry): entry is FloppyListItem => entry !== null);
  }

  /**
   * Single point of passage to the API. Any status outside `expected` throws a
   * FloppyError.
   *
   * Unlike the Trakt path there is no delay between calls: the server is self-hosted,
   * so the per-item sleep rate limits exist to respect would only slow it down.
   */
  private async request(
    method: HttpMethod,
    path: string,
    body?: unknown,
    expected: number[] = [200],
  ): Promise<{ status: number; payload: unknown }> {
    const headers: Record<string, string> = { 'X-API-Key': this.apiKey };
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    let response: Response;
    try {
      response = await fetch(`${this.url}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : `${error}`;
      throw new FloppyError(`${method} ${path} failed: ${reason}`);
    }

    const payload = await readPayload(response);
    if (!expected.includes(response.status)) {
      throw new FloppyError(`${method} ${path} returned ${response.status}${detailOf(payload, 'detail')}`);
    }
    return { status: response.status, payload };
  }

  /**
   * Turns the `pagination.next` cursor of a Floppy response into a path this adapter
   * can request, or null once the collection is exhausted.
   *
   * `next` is an absolute URL built from the origin the server sees, which behind a
   * reverse proxy or a container hostname is not the one configured here. Only path and
   * query survive, base path stripped, so `request` re-anchors them on `this.url`.
   *
   * A cursor that is present but unusable throws instead of being read as the end of
   * the collection, which would be the truncated read this mechanism exists to prevent.
   */
  private nextPathOf(payload: unknown): string | null {
    if (!isRecord(payload) || !isRecord(payload.pagination)) return null;
    const { next } = payload.pagination;
    if (next === null || next === undefined) return null;
    if (typeof next !== 'string' || next === '') {
      throw new FloppyError(`Unusable pagination cursor ${JSON.stringify(next)} in a Floppy response`);
    }

    let parsed: URL;
    try {
      parsed = new URL(next, `${this.url}/`);
    } catch {
      throw new FloppyError(`Unusable pagination cursor "${next}" in a Floppy response`);
    }
    const path = this.basePath !== '' && parsed.pathname.startsWith(`${this.basePath}/`)
      ? parsed.pathname.slice(this.basePath.length)
      : parsed.pathname;
    return `${path}${parsed.search}`;
  }

  /**
   * Reads a paginated collection to exhaustion and returns every `results` entry.
   *
   * The cursor is followed rather than a large `limit` requested, since a hardcoded
   * page size silently truncates the day it is exceeded. Hitting the page cap throws
   * instead of returning a partial collection, because callers derive what to remove
   * from this read and a short answer would leave stale items behind.
   */
  private async requestAllPages(path: string): Promise<unknown[]> {
    const entries: unknown[] = [];
    let next: string | null = path;
    let pages = 0;

    while (next !== null) {
      if (pages >= FloppyTarget.MAX_PAGES) {
        throw new FloppyError(
          `GET ${path} still had pages after ${FloppyTarget.MAX_PAGES}, refusing to act on a partial read`,
        );
      }
      const { payload } = await this.request('GET', next, undefined, [200]);
      entries.push(...readResults(payload));
      next = this.nextPathOf(payload);
      pages += 1;
    }
    return entries;
  }

  public async resolveMany(items: MediaItem[], kind: MediaKind): Promise<string[]> {
    return resolveSequentially(items, (item) => resolveThroughCache({
      cache: this.cache,
      backend: 'Floppy',
      item,
      kind,
      search: () => this.searchId(item, kind),
    }));
  }

  /**
   * Backend-specific half of the resolution: search, then the shared match cascade.
   *
   * Unlike the list reads this one is deliberately not paginated, though the route is:
   * `limit=20` on ranked results is a relevance window, not a page, and a title absent
   * from the top hits is not a candidate.
   */
  private async searchId(item: MediaItem, kind: MediaKind): Promise<string | null> {
    const type = FloppyTarget.mediaType(kind);
    const query = `search=${encodeURIComponent(item.title)}&source=tmdb&limit=20`;
    const found = await this.request('GET', `/api/v1/search/${type}?${query}`, undefined, [200]);

    const best = pickBestMatch(FloppyTarget.readSearchResults(found.payload), item, (r) => r);
    return best === null ? null : FloppyTarget.encodeId(best.source, best.media_id);
  }

  private async getOrCreateList(listName: string): Promise<number> {
    // Floppy's `search` is a partial match, which forces both of the next two lines:
    // read every page, since a name sharing a substring with many others can push the
    // exact match past page one and make it look absent, then require strict equality
    // so "netflix-france-top10-kids" is not reused for "netflix-france-top10".
    const found = await this.requestAllPages(`/api/v1/lists/?search=${encodeURIComponent(listName)}`);
    const exact = FloppyTarget.readLists(found).find((l) => l.name === listName);
    if (exact) return exact.id;

    if (this.dryRun) {
      logger.info(`[DRY-RUN] Would create Floppy list "${listName}"`);
      return 0;
    }
    logger.warn(`List "${listName}" was not found on Floppy, creating it`);
    const created = await this.request('POST', '/api/v1/lists/', { name: listName }, [200, 201]);
    const list = FloppyTarget.toList(created.payload);
    if (list === null) throw new FloppyError(`Failed to create list "${listName}"`);
    return list.id;
  }

  /**
   * Adds a media to a list. The `PUT` is attempted before any catalogue creation, and
   * that ordering is a data-safety guarantee rather than an optimisation: only a 404
   * starts the creation sequence, so it only ever runs for a media absent from the
   * catalogue and therefore not tracked by the user. That is what makes the closing
   * `DELETE` unable to erase a watch status or rating entered by hand.
   */
  private async addItem(id: string, listId: number, kind: MediaKind): Promise<void> {
    const { source, mediaId } = FloppyTarget.decodeId(id);
    const type = FloppyTarget.mediaType(kind);
    const listRoute = `/api/v1/media/${type}/${source}/${mediaId}/lists/${listId}/`;

    const first = await this.request('PUT', listRoute, undefined, [200, 404, 409]);
    // Only a 404 proves the media is absent from the catalogue (200 = added, 409 =
    // already in the list). For any other status the media is known to Floppy, and the
    // bootstrap below must never run: its closing DELETE would wipe the user's watch
    // status, rating and history.
    if (first.status !== 404) return;

    // Creating the media also creates a tracking entry with a Planning status, which is
    // what the DELETE below exists to undo.
    await this.request('POST', `/api/v1/media/${type}/`, { source, media_id: mediaId }, [200, 201]);
    await this.request('PUT', listRoute, undefined, [200, 409]);
    await this.request('DELETE', `/api/v1/media/${type}/${source}/${mediaId}/`, undefined, [204, 404]);
  }

  /**
   * Writes both media kinds in a single pass over the list, so the per-list work
   * (lookup or creation, items read) happens once. Floppy exposes no bulk write, so the
   * adds and removes themselves stay one request per item.
   *
   * A kind whose key is absent from `ids` is never looked at, so its items stay put.
   */
  public async pushToList(
    ids: ListContent,
    listName: string,
    privacy: ListPrivacy,
  ): Promise<void> {
    // `privacy` is deliberately unused: the Floppy API exposes no way to set a list's
    // visibility.
    void privacy;

    const kinds = MEDIA_KINDS.filter((kind) => ids[kind] !== undefined);
    if (kinds.length === 0) {
      return;
    }

    const listId = await this.getOrCreateList(listName);
    if (this.dryRun) {
      for (const kind of kinds) {
        const count = (ids[kind] as string[]).length;
        logger.info(`[DRY-RUN] Would replace ${kind}s of Floppy list "${listName}" with ${count} item(s)`);
      }
      return;
    }

    // Read to exhaustion: this read decides what gets removed, so stopping at page one
    // would leave later items in place while fresh ones are added on top, growing the
    // list at every run.
    const existingItems = FloppyTarget.readListItems(
      await this.requestAllPages(`/api/v1/lists/${listId}/items/`),
    );

    for (const kind of kinds) {
      const type = FloppyTarget.mediaType(kind);
      const toRemove = existingItems.filter((r) => r.item.media_type === type);
      if (toRemove.length > 0) {
        logger.info(`Floppy list "${listName}" contains ${toRemove.length} ${kind}, removing them`);
        for (const { item } of toRemove) {
          await this.request(
            'DELETE',
            `/api/v1/media/${type}/${item.source}/${item.media_id}/lists/${listId}/`,
            undefined,
            [204, 404],
          );
        }
      }

      const toAdd = ids[kind] as string[];
      logger.info(`Adding ${toAdd.length} ${kind} into Floppy list "${listName}"`);
      for (const id of toAdd) {
        await this.addItem(id, listId, kind);
      }
    }
  }
}
