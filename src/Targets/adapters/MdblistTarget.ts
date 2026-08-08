import { logger, MdblistError } from '../../Utils';
import type { CacheOptions, MdblistOptions } from '../../types';
import type {
  ListPrivacy, ListTarget, MediaItem, MediaKind, TargetBackend,
} from '../ListTarget';
import { isPrivate } from '../privacy';
import { ResolutionCache } from '../ResolutionCache';

/** Un résultat de `GET /search/{media_type}`. */
interface MdblistSearchResult {
  title: string;
  year: number | null;
  ids: { tmdbid: number | null; imdbid: string | null };
}

/** Une liste utilisateur telle que `GET /lists/user`/`POST /lists/user/add` la retourne. */
interface MdblistList {
  id: number;
  name: string;
}

/** Le contenu de `GET /lists/{id}/items` : seul le bucket concerné par `kind` est lu. */
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

// `POST /lists/user/add` répond `{ id, slug, url }`, sans `name` : un lecteur
// distinct de `readList`, qui exige `name` pour la recherche d'égalité stricte.
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
 * Adapter mdblist, service de listes hébergé exposant une API REST authentifiée
 * par clé d'API en paramètre de requête (`?apikey=`), jamais en en-tête.
 *
 * Deux particularités de cette API dictent la forme de l'adapter :
 * - le classement par défaut de la recherche est mauvais (« Breaking Bad »
 *   n'arrive qu'en 4e position sans `sort_by_score=true`), d'où ce paramètre
 *   systématique et l'exigence d'une correspondance exacte titre + année ;
 * - les écritures sont en masse (`POST .../items/add|remove` avec un tableau
 *   `{ tmdb }` par média), à la différence de Floppy qui écrit item par item.
 *
 * `description` n'est jamais envoyée : l'API l'ignore silencieusement sur un
 * `PUT` combiné à `name`/`private`, et la rejette en 400 seule. Le besoin
 * qu'elle aurait servi est couvert nativement par `last_updated_at`.
 */
export class MdblistTarget implements ListTarget {
  public readonly backend: TargetBackend = 'mdblist';

  /** La clé d'API suffit : aucun device flow, aucune interaction humaine. */
  public readonly requiresInteractiveAuth = false;

  private static readonly BASE = 'https://api.mdblist.com';

  private readonly apiKey: string;

  private readonly dryRun: boolean;

  private readonly cache: ResolutionCache;

  constructor(options: MdblistOptions, cacheOptions: CacheOptions, dryRun: boolean) {
    this.apiKey = options.apiKey;
    this.dryRun = dryRun;
    this.cache = new ResolutionCache(cacheOptions, 'mdblist');
  }

  public isAuthenticated(): boolean {
    // La clé d'API est validée par le schéma de configuration : si l'adapter
    // existe, il a de quoi travailler.
    return true;
  }

  public async connect(): Promise<void> {
    // Rien à négocier : l'authentification est une clé statique en query string.
  }

  // mdblist nomme les séries `show`, à la différence de Floppy qui les nomme `tv`.
  private static mediaType(kind: MediaKind): string {
    return kind === 'movie' ? 'movie' : 'show';
  }

  private static bucketOf(kind: MediaKind): Bucket {
    return kind === 'movie' ? 'movies' : 'shows';
  }

  /**
   * Le classement par défaut de la recherche est mauvais — « Breaking Bad »
   * n'arrive qu'en 4e position — d'où `sort_by_score=true` et l'exigence d'une
   * correspondance exacte. Un résultat sans `tmdbid` est écarté : sans lui,
   * l'écriture serait impossible.
   */
  private static pickBest(results: MdblistSearchResult[], item: MediaItem): number | null {
    const usable = results.filter((r) => r.ids.tmdbid !== null);
    const sameTitle = (r: MdblistSearchResult) => r.title.trim().toLowerCase() === item.title.trim().toLowerCase();
    const sameYear = (r: MdblistSearchResult) => item.year !== null && r.year === item.year;
    const best = usable.find((r) => sameTitle(r) && sameYear(r))
      ?? usable.find(sameTitle)
      ?? usable.find(sameYear)
      ?? usable[0];
    return best?.ids.tmdbid ?? null;
  }

  private static async readPayload(response: Response): Promise<unknown> {
    // Un statut d'erreur d'infrastructure peut renvoyer du HTML : dans ce cas
    // l'absence de JSON n'est pas une erreur en soi, elle sera signalée par le statut.
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
   * Point de passage unique vers l'API : clé d'API en query, construction
   * d'URL, en-tête de contenu quand il y a un corps. Tout statut hors de
   * `expected` lève une MdblistError mentionnant la méthode, le chemin et le
   * statut.
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

  private async getOrCreateList(listName: string, privacy: ListPrivacy): Promise<number> {
    const found = await this.request('GET', '/lists/user', undefined, [200]);
    const exact = readLists(found.payload).find((l) => l.name === listName);
    if (exact) return exact.id;

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
    return id;
  }

  public async pushToList(
    ids: string[],
    listName: string,
    kind: MediaKind,
    privacy: ListPrivacy,
  ): Promise<void> {
    const bucket = MdblistTarget.bucketOf(kind);
    const listId = await this.getOrCreateList(listName, privacy);
    if (this.dryRun) {
      logger.info(`[DRY-RUN] Would replace ${bucket} of mdblist list "${listName}" with ${ids.length} item(s)`);
      return;
    }

    const existing = await this.request('GET', `/lists/${listId}/items`, undefined, [200]);
    const stale = readItems(existing.payload)[bucket].map((i) => ({ tmdb: i.id }));
    if (stale.length > 0) {
      logger.info(`mdblist list "${listName}" contains ${stale.length} ${kind}, removing them`);
      await this.request('POST', `/lists/${listId}/items/remove`, { [bucket]: stale }, [200]);
    }

    logger.info(`Adding ${ids.length} ${kind} into mdblist list "${listName}"`);
    const payload = { [bucket]: ids.map((id) => ({ tmdb: Number(id) })) };
    const added = await this.request('POST', `/lists/${listId}/items/add`, payload, [200]);
    this.logRemainingQuota(added.headers);
  }
}
