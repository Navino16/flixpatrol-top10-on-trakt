import {
  afterAll, beforeAll, describe, expect, it,
} from 'vitest';
import { MdblistTarget } from '../../src/Targets/adapters/MdblistTarget';

/**
 * E2E suite: it talks to the real mdblist service and is only enabled when
 * `E2E_MDBLIST_API_KEY` is provided. Without it the suite is skipped, so that a
 * CI without secrets stays green.
 *
 * The test account is a free account belonging to a real person, which imposes
 * three absolute rules:
 * - every list created is created as `private`, never otherwise;
 * - `afterAll` deletes the list it created, the free tier only tolerating four
 *   static lists;
 * - the budget is 1,000 requests per day, so the suite stays under about twenty
 *   calls and logs the remaining quota at the end.
 *
 * Everything that is checked is checked by querying the service directly with
 * `fetch`, never through the adapter: the real state of the service is what
 * counts.
 */
const apiKey = process.env.E2E_MDBLIST_API_KEY ?? '';
const cacheOptions = { enabled: false, savePath: './config/.cache', ttl: 1 };
const BASE = 'https://api.mdblist.com';

// Unique name per run: two concurrent runs do not destroy each other.
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

/** Direct call to the API, without going through the adapter. */
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
  // Shared between cases: re-reading them would cost requests from the daily budget.
  let listId = 0;
  let updatedBeforeReplace = '';

  beforeAll(() => {
    target = new MdblistTarget({ apiKey }, cacheOptions, false);
  });

  afterAll(async () => {
    // The list must disappear whatever happens: the free tier only tolerates
    // four of them, and an orphaned list would burn the account's quota.
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
    await target.pushToList({ movie: [`${INCEPTION}`] }, listName, 'private');
    await target.pushToList({ show: [`${BREAKING_BAD}`] }, listName, 'private');

    const list = await findList(listName);
    expect(list).not.toBeNull();
    // Requirement from the account owner: never anything other than private.
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
    await target.pushToList({ movie: [`${FIGHT_CLUB}`] }, listName, 'private');

    const items = await readListItems(listId);
    expect(items.movies).toEqual([FIGHT_CLUB]);
    // The other bucket is untouched: a movie push does not purge the shows.
    expect(items.shows).toEqual([BREAKING_BAD]);

    const after = await findList(listName);
    expect(after).not.toBeNull();
    expect(new Date(after?.lastUpdatedAt ?? 0).getTime())
      .toBeGreaterThan(new Date(updatedBeforeReplace).getTime());
  });
});
