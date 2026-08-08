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
 */
const url = process.env.E2E_FLOPPY_URL?.replace(/\/+$/, '') ?? '';
const apiKey = process.env.E2E_FLOPPY_API_KEY ?? '';
const cacheOptions = { enabled: false, savePath: './config/.cache', ttl: 1 };

// Nom unique par exécution : deux lancements concurrents ne se détruisent pas.
const listName = `e2e-probe-${process.pid}-${Date.now().toString(36)}`;

// Les trois médias que la suite manipule, et les seuls qu'elle a le droit de nettoyer.
const INCEPTION = '27205';
const FIGHT_CLUB = '550';
const BREAKING_BAD = '1396';

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

/** Appel direct à l'API, sans passer par l'adapter. */
const api = async (path: string, method: 'GET' | 'DELETE' = 'GET'): Promise<unknown> => {
  const response = await fetch(`${url}${path}`, { method, headers: { 'X-API-Key': apiKey } });
  if (response.status === 204) return null;
  try {
    const payload: unknown = await response.json();
    return payload;
  } catch {
    return null;
  }
};

const findListId = async (name: string): Promise<number | null> => {
  const payload = await api(`/api/v1/lists/?search=${encodeURIComponent(name)}`);
  for (const entry of resultsOf(payload)) {
    if (isRecord(entry) && entry.name === name && typeof entry.id === 'number') return entry.id;
  }
  return null;
};

/** Contenu réel de la liste, réduit au couple type + identifiant. */
const readListItems = async (name: string): Promise<FloppyItem[]> => {
  const listId = await findListId(name);
  if (listId === null) return [];
  const payload = await api(`/api/v1/lists/${listId}/items/`);
  const items: FloppyItem[] = [];
  for (const entry of resultsOf(payload)) {
    if (!isRecord(entry) || !isRecord(entry.item)) continue;
    const mediaId = asId(entry.item.media_id);
    const mediaType = entry.item.media_type;
    if (mediaId !== null && typeof mediaType === 'string') items.push({ mediaType, mediaId });
  }
  return items;
};

/**
 * Les médias suivis par l'utilisateur. Une entrée ici après un simple ajout en
 * liste signifierait que l'adapter a laissé un statut « Planning » derrière lui.
 */
const readTrackedIds = async (type: 'movie' | 'tv'): Promise<string[]> => {
  const payload = await api(`/api/v1/media/${type}/`);
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
  if (listId !== null) await api(`/api/v1/lists/${listId}/`, 'DELETE');
};

/** Filet de sécurité : ne purge que les médias que cette suite a pu créer. */
const untrackOwnMedia = async (): Promise<void> => {
  for (const mediaId of [INCEPTION, FIGHT_CLUB]) {
    await api(`/api/v1/media/movie/tmdb/${mediaId}/`, 'DELETE');
  }
  await api(`/api/v1/media/tv/tmdb/${BREAKING_BAD}/`, 'DELETE');
};

describe.skipIf(!process.env.E2E_FLOPPY_URL || !process.env.E2E_FLOPPY_API_KEY)('FloppyTarget (E2E)', () => {
  let target: FloppyTarget;

  beforeAll(() => {
    target = new FloppyTarget({ url, apiKey }, cacheOptions, false);
  });

  afterAll(async () => {
    await deleteListByName(listName);
    await untrackOwnMedia();
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

  it('costs a single write request for an already-catalogued media', async () => {
    // tmdb:550 est déjà passé par le test précédent, donc connu du serveur.
    // On enveloppe fetch le temps d'un unique push pour compter les écritures.
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
});
