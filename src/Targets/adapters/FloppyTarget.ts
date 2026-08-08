import { FloppyError, logger } from '../../Utils';
import type { CacheOptions, FloppyOptions } from '../../types';
import type {
  ListContent, ListPrivacy, ListTarget, MediaItem, MediaKind, TargetBackend,
} from '../ListTarget';
import { MEDIA_KINDS } from '../ListTarget';
import { ResolutionCache } from '../ResolutionCache';

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

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

/** Extracts the `results` array of a paginated response, assuming nothing about the rest of the envelope. */
const readResults = (payload: unknown): unknown[] => {
  if (!isRecord(payload)) return [];
  return Array.isArray(payload.results) ? payload.results : [];
};

/**
 * Floppy adapter, a self-hosted media tracker exposing a REST API under `/api/v1`.
 *
 * Two peculiarities of this API dictate the shape of the adapter:
 * - shows are `tv` there, not `show`;
 * - a list's visibility and description cannot be driven, so no `PATCH` is ever
 *   emitted and the `privacy` argument is deliberately ignored.
 */
export class FloppyTarget implements ListTarget {
  public readonly backend: TargetBackend = 'floppy';

  /** The API key is enough: no device flow, no human interaction. */
  public readonly requiresInteractiveAuth = false;

  private readonly url: string;

  private readonly apiKey: string;

  private readonly dryRun: boolean;

  private readonly cache: ResolutionCache;

  constructor(options: FloppyOptions, cacheOptions: CacheOptions, dryRun: boolean) {
    this.url = options.url.replace(/\/+$/, '');
    this.apiKey = options.apiKey;
    this.dryRun = dryRun;
    this.cache = new ResolutionCache(cacheOptions, 'floppy');
  }

  public isAuthenticated(): boolean {
    // The API key is validated by the configuration schema: if the adapter
    // exists, it has what it needs to work.
    return true;
  }

  public async connect(): Promise<void> {
    // Nothing to negotiate: authentication is a static header.
  }

  // Identifier encoding: `${source}:${media_id}` — Floppy needs both to build
  // its routes. Only this adapter encodes and decodes that form.
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

  private static readLists(payload: unknown): FloppyList[] {
    return readResults(payload)
      .map((entry) => FloppyTarget.toList(entry))
      .filter((entry): entry is FloppyList => entry !== null);
  }

  private static readListItems(payload: unknown): FloppyListItem[] {
    return readResults(payload)
      .map((entry) => FloppyTarget.toListItem(entry))
      .filter((entry): entry is FloppyListItem => entry !== null);
  }

  /**
   * There is deliberately no last-resort fallback on the first result: falling
   * through the whole cascade means neither the title nor the year matched, so
   * any result left is a mismatch by definition. Returning null lets the caller
   * warn and drop the item rather than write a confidently wrong entry.
   */
  private static pickBest(results: FloppySearchResult[], item: MediaItem): FloppySearchResult | null {
    const sameTitle = (r: FloppySearchResult) => r.title.trim().toLowerCase() === item.title.trim().toLowerCase();
    const sameYear = (r: FloppySearchResult) => item.year !== null && r.year === item.year;
    return results.find((r) => sameTitle(r) && sameYear(r))
      ?? results.find(sameTitle)
      ?? results.find(sameYear)
      ?? null;
  }

  private static async readPayload(response: Response): Promise<unknown> {
    // A 204 has no body, and an infrastructure error can return HTML: in both
    // cases the absence of JSON is not an error in itself.
    try {
      return await response.json();
    } catch {
      return null;
    }
  }

  private static detailOf(payload: unknown): string {
    if (isRecord(payload) && typeof payload.detail === 'string') return `: ${payload.detail}`;
    return '';
  }

  /**
   * Single point of passage to the API: authentication header, URL building,
   * content header when there is a body. Any status outside `expected` throws a
   * FloppyError mentioning the method, the path and the status.
   *
   * No delay between two calls: the server is self-hosted, one second per item
   * would make a list of ten elements absurdly slow.
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

    const payload = await FloppyTarget.readPayload(response);
    if (!expected.includes(response.status)) {
      throw new FloppyError(`${method} ${path} returned ${response.status}${FloppyTarget.detailOf(payload)}`);
    }
    return { status: response.status, payload };
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

    const type = FloppyTarget.mediaType(kind);
    const query = `search=${encodeURIComponent(item.title)}&source=tmdb&limit=20`;
    const found = await this.request('GET', `/api/v1/search/${type}?${query}`, undefined, [200]);

    const best = FloppyTarget.pickBest(FloppyTarget.readSearchResults(found.payload), item);
    if (best === null) {
      logger.warn(`No Floppy match for ${kind} "${item.title}" (${item.year ?? 'unknown year'})`);
      return null;
    }

    const id = FloppyTarget.encodeId(best.source, best.media_id);
    await this.cache.set(item, kind, id);
    return id;
  }

  private async getOrCreateList(listName: string): Promise<number> {
    const found = await this.request(
      'GET', `/api/v1/lists/?search=${encodeURIComponent(listName)}`, undefined, [200],
    );
    // `search` is a partial match on the Floppy side: we require strict equality
    // so "netflix-france-top10-kids" is not reused instead of "netflix-france-top10".
    const exact = FloppyTarget.readLists(found.payload).find((l) => l.name === listName);
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
   * Adds a media to a list. The PUT is tried FIRST, and this is not an
   * optimisation: it only triggers the creation sequence on a 404, hence for a
   * media absent from the catalogue, hence necessarily not tracked by the
   * user. The DELETE of step 3 can therefore never erase a status or a rating
   * entered by hand. Should a future version of Floppy purge orphan catalogue
   * entries, this path would simply go through the full sequence again.
   */
  private async addItem(id: string, listId: number, kind: MediaKind): Promise<void> {
    const { source, mediaId } = FloppyTarget.decodeId(id);
    const type = FloppyTarget.mediaType(kind);
    const listRoute = `/api/v1/media/${type}/${source}/${mediaId}/lists/${listId}/`;

    const first = await this.request('PUT', listRoute, undefined, [200, 404, 409]);
    // Only a 404 proves the media is absent from the catalogue (200 = added,
    // 409 = already in the list). Any other status means the media is known to
    // Floppy, and the bootstrap below — which ends on a DELETE that would wipe
    // the user's watch status, rating and history — must never run for it.
    if (first.status !== 404) return;

    // The media is unknown to the catalogue: we create it there, which also
    // creates a tracking entry with a Planning status that we do not want.
    await this.request('POST', `/api/v1/media/${type}/`, { source, media_id: mediaId }, [200, 201]);
    await this.request('PUT', listRoute, undefined, [200, 409]);
    await this.request('DELETE', `/api/v1/media/${type}/${source}/${mediaId}/`, undefined, [204, 404]);
  }

  /**
   * Writes both media kinds in a single pass over the list.
   *
   * Floppy exposes no bulk write, so adds and removes stay one HTTP request per
   * item — that is inherent to the API. What is fused here is the per-LIST work:
   * the list lookup/creation and the items read now happen once instead of once
   * per kind.
   *
   * A kind whose key is absent from `ids` is never looked at, so its existing
   * items are left in place.
   */
  public async pushToList(
    ids: ListContent,
    listName: string,
    privacy: ListPrivacy,
  ): Promise<void> {
    // `privacy` is deliberately unused: the Floppy API exposes no way to set the
    // visibility of a list. See the spec, "Floppy special case" section.
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

    const existing = await this.request(
      'GET', `/api/v1/lists/${listId}/items/`, undefined, [200],
    );
    const existingItems = FloppyTarget.readListItems(existing.payload);

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
