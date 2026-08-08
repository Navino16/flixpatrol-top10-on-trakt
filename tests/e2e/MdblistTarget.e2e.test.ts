import {
  afterAll, beforeAll, describe, expect, it,
} from 'vitest';
import { MdblistTarget } from '../../src/Targets/adapters/MdblistTarget';

/**
 * Suite E2E : elle parle au vrai service mdblist et n'est activée que si
 * `E2E_MDBLIST_API_KEY` est fournie. Sans elle la suite est ignorée, de sorte
 * qu'une CI sans secrets reste verte.
 *
 * Le compte de test est un compte gratuit appartenant à une vraie personne, ce
 * qui impose trois règles absolues :
 * - toute liste créée l'est en `private`, jamais autrement ;
 * - `afterAll` supprime la liste créée, le palier gratuit ne tolérant que
 *   quatre listes statiques ;
 * - le budget est de 1 000 requêtes par jour, donc la suite tient sous une
 *   vingtaine d'appels et journalise le quota restant à la fin.
 *
 * Tout ce qui est vérifié l'est en interrogeant le service directement en
 * `fetch`, jamais via l'adapter : c'est l'état réel du service qui fait foi.
 */
const apiKey = process.env.E2E_MDBLIST_API_KEY ?? '';
const cacheOptions = { enabled: false, savePath: './config/.cache', ttl: 1 };
const BASE = 'https://api.mdblist.com';

// Nom unique par exécution : deux lancements concurrents ne se détruisent pas.
const listName = `e2e-probe-${process.pid}-${Date.now().toString(36)}`;

const INCEPTION = 27205;
const FIGHT_CLUB = 550;
const BREAKING_BAD = 1396;

interface UserList {
  id: number;
  name: string;
  private: boolean;
  lastUpdatedAt: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

/** Appel direct à l'API, sans passer par l'adapter. */
const api = async (
  path: string,
  method: 'GET' | 'DELETE' = 'GET',
): Promise<{ payload: unknown; headers: Headers }> => {
  const separator = path.includes('?') ? '&' : '?';
  const response = await fetch(`${BASE}${path}${separator}apikey=${encodeURIComponent(apiKey)}`, { method });
  try {
    const payload: unknown = await response.json();
    return { payload, headers: response.headers };
  } catch {
    return { payload: null, headers: response.headers };
  }
};

const toUserList = (value: unknown): UserList | null => {
  if (!isRecord(value)) return null;
  const { id, name } = value;
  const updated = value.last_updated_at;
  if (typeof id !== 'number' || typeof name !== 'string' || typeof updated !== 'string') return null;
  return {
    id, name, private: value.private === true, lastUpdatedAt: updated,
  };
};

const findList = async (name: string): Promise<UserList | null> => {
  const { payload } = await api('/lists/user');
  if (!Array.isArray(payload)) return null;
  for (const entry of payload) {
    const list = toUserList(entry);
    if (list !== null && list.name === name) return list;
  }
  return null;
};

const idsOf = (value: unknown): number[] => {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is Record<string, unknown> => isRecord(entry) && typeof entry.id === 'number')
    .map((entry) => entry.id as number);
};

const readListItems = async (listId: number): Promise<{ movies: number[]; shows: number[] }> => {
  const { payload } = await api(`/lists/${listId}/items`);
  if (!isRecord(payload)) return { movies: [], shows: [] };
  return { movies: idsOf(payload.movies), shows: idsOf(payload.shows) };
};

describe.skipIf(!process.env.E2E_MDBLIST_API_KEY)('MdblistTarget (E2E)', () => {
  let target: MdblistTarget;
  // Partagés entre les cas : les relire coûterait des requêtes du budget quotidien.
  let listId = 0;
  let updatedBeforeReplace = '';

  beforeAll(() => {
    target = new MdblistTarget({ apiKey }, cacheOptions, false);
  });

  afterAll(async () => {
    // La liste doit disparaître quoi qu'il arrive : le palier gratuit n'en
    // tolère que quatre, et une liste orpheline brûlerait le quota du compte.
    const list = await findList(listName);
    if (list === null) {
      console.warn(`[E2E] mdblist list "${listName}" was already absent, nothing to clean`);
      return;
    }
    const { payload, headers } = await api(`/lists/${list.id}`, 'DELETE');
    console.info(`[E2E] deleted mdblist list ${list.id} "${listName}": ${JSON.stringify(payload)}`);
    console.info(`[E2E] mdblist x-ratelimit-remaining: ${headers.get('x-ratelimit-remaining') ?? 'unknown'}`);
  });

  it('resolves a well-known movie and a well-known show', async () => {
    expect(await target.resolveMany([{ title: 'Inception', year: 2010 }], 'movie')).toEqual([`${INCEPTION}`]);
    expect(await target.resolveMany([{ title: 'Breaking Bad', year: 2008 }], 'show')).toEqual([`${BREAKING_BAD}`]);
  });

  it('creates a private list holding movies and shows together', async () => {
    await target.pushToList([`${INCEPTION}`], listName, 'movie', 'private');
    await target.pushToList([`${BREAKING_BAD}`], listName, 'show', 'private');

    const list = await findList(listName);
    expect(list).not.toBeNull();
    // Exigence du propriétaire du compte : jamais autre chose que privé.
    expect(list?.private).toBe(true);

    listId = list?.id ?? 0;
    updatedBeforeReplace = list?.lastUpdatedAt ?? '';
    expect(listId).toBeGreaterThan(0);

    const items = await readListItems(listId);
    expect(items.movies).toEqual([INCEPTION]);
    expect(items.shows).toEqual([BREAKING_BAD]);
  });

  it('replaces the content on a second push and advances last_updated_at', async () => {
    expect(listId).toBeGreaterThan(0);
    await target.pushToList([`${FIGHT_CLUB}`], listName, 'movie', 'private');

    const items = await readListItems(listId);
    expect(items.movies).toEqual([FIGHT_CLUB]);
    // L'autre bucket n'est pas touché : un push de films ne purge pas les séries.
    expect(items.shows).toEqual([BREAKING_BAD]);

    const after = await findList(listName);
    expect(after).not.toBeNull();
    expect(new Date(after?.lastUpdatedAt ?? 0).getTime())
      .toBeGreaterThan(new Date(updatedBeforeReplace).getTime());
  });
});
