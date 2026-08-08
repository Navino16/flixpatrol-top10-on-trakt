import {
  afterAll, beforeAll, describe, expect, it,
} from 'vitest';
import { FloppyTarget } from '../../src/Targets/adapters/FloppyTarget';

/**
 * Suite E2E : elle parle à une vraie instance Floppy et n'est activée que si
 * `E2E_FLOPPY_URL` et `E2E_FLOPPY_API_KEY` sont fournis. Sans eux la suite est
 * ignorée, de sorte qu'une CI sans secrets reste verte.
 *
 * Tout ce qui est vérifié l'est en interrogeant le serveur directement en
 * `fetch`, jamais via l'adapter : c'est l'état réel du service qui fait foi.
 *
 * ── Le piège du catalogue ────────────────────────────────────────────────────
 * Le catalogue de médias de Floppy est **commun à toute l'instance**, pas propre
 * à l'utilisateur, et il ne fait que grossir. Un média déjà catalogué répond
 * 200 au premier `PUT` (chemin « chaud », une seule écriture) ; un média absent
 * du catalogue répond 404 et déclenche la séquence d'amorçage
 * `POST` → `PUT` → `DELETE` (chemin « froid »).
 *
 * Les deux chemins sont couverts ici, et le chemin froid choisit son média
 * **dynamiquement** : figer un id le condamnerait à devenir chaud dès que
 * quelqu'un l'ajoute à l'instance, et le test passerait alors en silence sans
 * plus rien couvrir.
 */
const url = process.env.E2E_FLOPPY_URL?.replace(/\/+$/, '') ?? '';
const apiKey = process.env.E2E_FLOPPY_API_KEY ?? '';
const cacheOptions = { enabled: false, savePath: './config/.cache', ttl: 1 };

// Noms uniques par exécution : deux lancements concurrents ne se détruisent pas.
const runId = `${process.pid}-${Date.now().toString(36)}`;
const listName = `e2e-probe-${runId}`;
const coldListName = `e2e-cold-${runId}`;
const scratchListName = `e2e-scratch-${runId}`;

const INCEPTION = '27205';
const FIGHT_CLUB = '550';
const BREAKING_BAD = '1396';

// Requête large : elle fournit plusieurs dizaines de candidats, donc de vrais ids
// TMDB amorçables, parmi lesquels chercher un média encore absent du catalogue.
// Les candidats sont parcourus dans l'ordre de pertinence : les entrées
// canoniques, les mieux renseignées côté TMDB, viennent en tête et sont donc les
// plus sûres à amorcer. Chaque exécution en consomme définitivement une (le
// catalogue ne rétrécit jamais), d'où la taille du vivier.
const COLD_CANDIDATES_QUERY = 'The Godfather';
const COLD_CANDIDATES_LIMIT = 100;

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

/** Appel direct à l'API, sans passer par l'adapter. Le statut est exposé, on en a besoin. */
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

const findListId = async (name: string): Promise<number | null> => {
  const { payload } = await request('GET', `/api/v1/lists/?search=${encodeURIComponent(name)}`);
  for (const entry of resultsOf(payload)) {
    if (isRecord(entry) && entry.name === name && typeof entry.id === 'number') return entry.id;
  }
  return null;
};

const createList = async (name: string): Promise<number> => {
  const { payload } = await request('POST', '/api/v1/lists/', { name });
  if (!isRecord(payload) || typeof payload.id !== 'number') throw new Error(`Could not create list "${name}"`);
  return payload.id;
};

/** Contenu réel de la liste, réduit au couple type + identifiant. */
const readListItemsById = async (listId: number): Promise<FloppyItem[]> => {
  const { payload } = await request('GET', `/api/v1/lists/${listId}/items/`);
  const items: FloppyItem[] = [];
  for (const entry of resultsOf(payload)) {
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
 * Les médias suivis par l'utilisateur. Une entrée ici après un simple ajout en
 * liste signifierait que l'adapter a laissé un statut « Planning » derrière lui.
 */
const readTrackedIds = async (type: 'movie' | 'tv'): Promise<string[]> => {
  const { payload } = await request('GET', `/api/v1/media/${type}/`);
  const ids: string[] = [];
  for (const entry of resultsOf(payload)) {
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
 * Cherche un film encore absent du catalogue de l'instance.
 *
 * Les candidats viennent de la recherche Floppy, donc ce sont de vrais ids TMDB
 * que l'amorçage saura résoudre. Et la recherche, elle, ne met rien en
 * catalogue : un `PUT` sur un candidat reste 404 après l'avoir cherché, c'est
 * vérifié sur l'instance. Le test de froideur est le `PUT` lui-même — 404
 * signifie « absent du catalogue » et n'a rien modifié côté serveur ; un
 * candidat déjà chaud atterrit dans la liste jetable, qui est détruite ensuite.
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
  // Retenu pour que le nettoyage final purge aussi le média du chemin froid.
  let coldMediaId: string | null = null;

  beforeAll(() => {
    target = new FloppyTarget({ url, apiKey }, cacheOptions, false);
  });

  afterAll(async () => {
    for (const name of [listName, coldListName, scratchListName]) {
      await deleteListByName(name);
    }
    // Filet de sécurité : ne purge que les médias que cette suite a pu suivre.
    const ownMovies = [INCEPTION, FIGHT_CLUB, ...(coldMediaId === null ? [] : [coldMediaId])];
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
    await target.pushToList([`tmdb:${INCEPTION}`], listName, 'movie', 'public');
    await target.pushToList([`tmdb:${BREAKING_BAD}`], listName, 'show', 'public');

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
    await target.pushToList([`tmdb:${FIGHT_CLUB}`], listName, 'movie', 'public');

    const items = await readListItems(listName);
    expect(items.filter((i) => i.mediaType === 'movie')).toEqual([{ mediaType: 'movie', mediaId: FIGHT_CLUB }]);
    // L'autre type n'est pas touché : un push de films ne purge pas les séries.
    expect(items.filter((i) => i.mediaType === 'tv')).toEqual([{ mediaType: 'tv', mediaId: BREAKING_BAD }]);
  });

  it('costs a single write request on the warm path, for an already-catalogued media', async () => {
    // Chemin CHAUD : tmdb:550 vient d'être ajouté par le test précédent, il est
    // donc au catalogue de l'instance et le premier PUT répondra 200.
    const real = globalThis.fetch;
    const seen: { method: string; url: string }[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push({ method: init?.method ?? 'GET', url: input instanceof Request ? input.url : String(input) });
      return real(input, init);
    }) as typeof fetch;

    try {
      await target.pushToList([`tmdb:${FIGHT_CLUB}`], listName, 'movie', 'public');
    } finally {
      globalThis.fetch = real;
    }

    const bootstrap = seen.filter((c) => c.method === 'POST' && c.url.endsWith('/api/v1/media/movie/'));
    const untrack = seen.filter(
      (c) => c.method === 'DELETE' && c.url.endsWith(`/api/v1/media/movie/tmdb/${FIGHT_CLUB}/`),
    );
    const puts = seen.filter((c) => c.method === 'PUT');

    // Ni POST d'amorçage au catalogue, ni DELETE de suivi : une seule écriture pour l'ajout.
    expect(bootstrap).toHaveLength(0);
    expect(untrack).toHaveLength(0);
    expect(puts).toHaveLength(1);
    expect(await readTrackedIds('movie')).not.toContain(FIGHT_CLUB);
  });

  it('bootstraps an uncatalogued media on the cold path and leaves no tracking entry', async (ctx) => {
    // Chemin FROID : c'est le code le plus sensible de l'adapter. L'ordre
    // PUT-d'abord garantit que le DELETE de nettoyage ne peut jamais effacer un
    // statut saisi à la main, puisqu'il ne s'exécute que sur un média que
    // l'utilisateur ne suivait pas — celui-ci n'était même pas au catalogue.
    const scratchListId = await createList(scratchListName);
    coldMediaId = await findUncataloguedMovie(scratchListId);

    if (coldMediaId === null) {
      ctx.skip(
        `No uncatalogued movie left among the "${COLD_CANDIDATES_QUERY}" search results on this Floppy `
        + 'instance: the cold path cannot be exercised. Widen COLD_CANDIDATES_QUERY or use a fresh instance.',
      );
      return;
    }

    // Journalisé : c'est la preuve, dans la sortie de test, que le chemin froid
    // a bien porté sur un média réel et lequel.
    console.info(`[E2E] cold path exercised with uncatalogued movie tmdb:${coldMediaId}`);

    // État de départ prouvé : absent du catalogue, et non suivi par l'utilisateur.
    expect(await readTrackedIds('movie')).not.toContain(coldMediaId);

    const real = globalThis.fetch;
    const seen: { method: string; url: string }[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push({ method: init?.method ?? 'GET', url: input instanceof Request ? input.url : String(input) });
      return real(input, init);
    }) as typeof fetch;

    try {
      await target.pushToList([`tmdb:${coldMediaId}`], coldListName, 'movie', 'public');
    } finally {
      globalThis.fetch = real;
    }

    // La séquence d'amorçage a bien eu lieu, et dans cet ordre précis :
    // PUT (404) → POST catalogue → PUT → DELETE du suivi créé au passage.
    const mediaRoute = `/api/v1/media/movie/tmdb/${coldMediaId}/`;
    const sequence = seen
      .filter((c) => c.url.includes(mediaRoute) || c.url.endsWith('/api/v1/media/movie/'))
      .map((c) => c.method);
    expect(sequence).toEqual(['PUT', 'POST', 'PUT', 'DELETE']);
    expect(seen.some((c) => c.method === 'POST' && c.url.endsWith('/api/v1/media/movie/'))).toBe(true);
    expect(seen.some((c) => c.method === 'DELETE' && c.url.endsWith(mediaRoute))).toBe(true);

    // La garantie que les tests unitaires ne peuvent que postuler, vérifiée
    // côté serveur : le média EST dans la liste, et il ne reste AUCUNE entrée
    // de suivi « Planning » pour l'utilisateur E2E.
    const coldListId = await findListId(coldListName);
    expect(coldListId).not.toBeNull();
    expect(await readListItemsById(coldListId as number))
      .toEqual([{ mediaType: 'movie', mediaId: coldMediaId }]);
    expect(await readTrackedIds('movie')).not.toContain(coldMediaId);
  });
});
