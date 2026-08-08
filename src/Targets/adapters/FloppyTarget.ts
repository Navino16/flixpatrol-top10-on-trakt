import { FloppyError, logger } from '../../Utils';
import type { CacheOptions, FloppyOptions } from '../../types';
import type {
  ListPrivacy, ListTarget, MediaItem, MediaKind, TargetBackend,
} from '../ListTarget';
import { ResolutionCache } from '../ResolutionCache';

/** Un résultat de `GET /api/v1/search/{media_type}`. */
interface FloppySearchResult {
  media_id: number | string;
  source: string;
  media_type?: string;
  title: string;
  year: number | null;
}

/** Une liste utilisateur telle que `GET`/`POST /api/v1/lists/` la retourne. */
interface FloppyList {
  id: number;
  name: string;
}

/** Une entrée de `GET /api/v1/lists/{id}/items/` : les champs utiles sont imbriqués sous `item`. */
interface FloppyListItem {
  item: { media_id: string; source: string; media_type: string };
}

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

/** Extrait le tableau `results` d'une réponse paginée, sans rien supposer du reste de l'enveloppe. */
const readResults = (payload: unknown): unknown[] => {
  if (!isRecord(payload)) return [];
  return Array.isArray(payload.results) ? payload.results : [];
};

/**
 * Adapter Floppy, tracker de médias auto-hébergé exposant une API REST sur `/api/v1`.
 *
 * Deux particularités de cette API dictent la forme de l'adapter :
 * - les séries y sont des `tv`, pas des `show` ;
 * - la visibilité et la description d'une liste ne sont pas pilotables, donc
 *   aucun `PATCH` n'est émis et l'argument `privacy` est volontairement ignoré.
 */
export class FloppyTarget implements ListTarget {
  public readonly backend: TargetBackend = 'floppy';

  /** La clé d'API suffit : aucun device flow, aucune interaction humaine. */
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
    // La clé d'API est validée par le schéma de configuration : si l'adapter
    // existe, il a de quoi travailler.
    return true;
  }

  public async connect(): Promise<void> {
    // Rien à négocier : l'authentification est un en-tête statique.
  }

  // Encodage d'identifiant : `${source}:${media_id}` — Floppy a besoin des deux
  // pour construire ses routes. Seul cet adapter encode et décode cette forme.
  private static encodeId(source: string, mediaId: string | number): string {
    return `${source}:${mediaId}`;
  }

  private static decodeId(id: string): { source: string; mediaId: string } {
    const separator = id.indexOf(':');
    if (separator === -1) throw new FloppyError(`Malformed Floppy id "${id}"`);
    return { source: id.slice(0, separator), mediaId: id.slice(separator + 1) };
  }

  // Floppy nomme les séries `tv`, la configuration les nomme `show`.
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

  private static pickBest(results: FloppySearchResult[], item: MediaItem): FloppySearchResult | null {
    const sameTitle = (r: FloppySearchResult) => r.title.trim().toLowerCase() === item.title.trim().toLowerCase();
    const sameYear = (r: FloppySearchResult) => item.year !== null && r.year === item.year;
    return results.find((r) => sameTitle(r) && sameYear(r))
      ?? results.find(sameTitle)
      ?? results.find(sameYear)
      ?? results[0]
      ?? null;
  }

  private static async readPayload(response: Response): Promise<unknown> {
    // Un 204 n'a pas de corps, et une erreur d'infrastructure peut renvoyer du
    // HTML : dans les deux cas l'absence de JSON n'est pas une erreur en soi.
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
   * Point de passage unique vers l'API : en-tête d'authentification, construction
   * d'URL, en-tête de contenu quand il y a un corps. Tout statut hors de `expected`
   * lève une FloppyError mentionnant la méthode, le chemin et le statut.
   *
   * Aucune temporisation entre deux appels : le serveur est auto-hébergé, une
   * seconde par item rendrait une liste de dix éléments absurdement lente.
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
    // `search` est une correspondance partielle côté Floppy : on exige l'égalité stricte
    // pour ne pas réutiliser "netflix-france-top10-kids" à la place de "netflix-france-top10".
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
   * Ajoute un média à une liste. Le PUT est tenté EN PREMIER, et ce n'est pas
   * une optimisation : il ne déclenche la séquence de création que sur un 404,
   * donc pour un média absent du catalogue, donc forcément non suivi par
   * l'utilisateur. Le DELETE de l'étape 3 ne peut ainsi jamais effacer un statut
   * ou une note saisis à la main. Si une version future de Floppy purgeait les
   * entrées de catalogue orphelines, ce chemin se contenterait de repasser par
   * la séquence complète.
   */
  private async addItem(id: string, listId: number, kind: MediaKind): Promise<void> {
    const { source, mediaId } = FloppyTarget.decodeId(id);
    const type = FloppyTarget.mediaType(kind);
    const listRoute = `/api/v1/media/${type}/${source}/${mediaId}/lists/${listId}/`;

    const first = await this.request('PUT', listRoute, undefined, [200, 404, 409]);
    if (first.status === 200 || first.status === 409) return; // 409 = déjà dans la liste

    // Le média est inconnu du catalogue : on l'y crée, ce qui crée aussi un
    // suivi au statut Planning dont on ne veut pas.
    await this.request('POST', `/api/v1/media/${type}/`, { source, media_id: mediaId }, [200, 201]);
    await this.request('PUT', listRoute, undefined, [200, 409]);
    await this.request('DELETE', `/api/v1/media/${type}/${source}/${mediaId}/`, undefined, [204, 404]);
  }

  public async pushToList(
    ids: string[],
    listName: string,
    kind: MediaKind,
    privacy: ListPrivacy,
  ): Promise<void> {
    // `privacy` est volontairement inutilisé : l'API Floppy n'expose aucun moyen de
    // régler la visibilité d'une liste. Voir la spec, section « Cas particulier de Floppy ».
    void privacy;

    const listId = await this.getOrCreateList(listName);
    if (this.dryRun) {
      logger.info(`[DRY-RUN] Would replace ${kind}s of Floppy list "${listName}" with ${ids.length} item(s)`);
      return;
    }

    const type = FloppyTarget.mediaType(kind);
    const existing = await this.request(
      'GET', `/api/v1/lists/${listId}/items/`, undefined, [200],
    );
    const toRemove = FloppyTarget.readListItems(existing.payload).filter((r) => r.item.media_type === type);
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

    logger.info(`Adding ${ids.length} ${kind} into Floppy list "${listName}"`);
    for (const id of ids) {
      await this.addItem(id, listId, kind);
    }
  }
}
