import fs from 'fs';
import {
  afterAll, beforeAll, describe, expect, it,
} from 'vitest';
import Trakt from 'trakt.tv';
import type { TraktAccessExport, TraktItem, TraktList } from 'trakt.tv';
import { TraktTarget } from '../../src/Targets/adapters/TraktTarget';

/**
 * E2E suite against a real Trakt account: local only, deliberately absent from
 * CI, and enabled only when `E2E_TRAKT_CLIENT_ID`, `E2E_TRAKT_CLIENT_SECRET` and
 * `E2E_TRAKT_SAVE_FILE` are all provided; skipped otherwise.
 *
 * Trakt authorises through an OAuth device flow, which needs a human, so the
 * suite consumes an ALREADY-OBTAINED token — the `saveFile` the application
 * writes — and never authorises. A missing file fails fast rather than hanging
 * on a device-code poll nobody will answer.
 *
 * This WRITES to a real account, hence: one list per run under a run-unique name
 * (a free account is capped at 5 personal lists), always `private`, deleted by
 * `afterAll` even after a failing test, and only ever a list whose name matches
 * this run's exactly.
 *
 * The end state is checked through a SECOND, independent `trakt.tv` client, not
 * through the adapter under test.
 */
const clientId = process.env.E2E_TRAKT_CLIENT_ID ?? '';
const clientSecret = process.env.E2E_TRAKT_CLIENT_SECRET ?? '';
const saveFile = process.env.E2E_TRAKT_SAVE_FILE ?? '';
const cacheOptions = { enabled: false, savePath: './config/.cache', ttl: 1 };

// Unique per run, and slug-safe (lowercase alphanumerics and hyphens) so the
// name Trakt stores and the slug the application derives cannot drift apart.
const LIST_NAME_PREFIX = 'flixpatrol-e2e-';
const listName = `${LIST_NAME_PREFIX}${process.pid}-${Date.now().toString(36)}`;

// The adapter sleeps 1s between writes and a push does several of them.
const WRITE_TIMEOUT = 180000;

// Past the cap, list creation fails with an unhelpful Trakt error; warn instead.
const FREE_ACCOUNT_LIST_CAP = 5;

interface Entry {
  type: string;
  title: string;
  year: number | undefined;
}

let target: TraktTarget;
// Authenticated from the same token file, but its reads never go through
// `TraktAPI`, and it is the only way to exercise the client's `type` option.
let verifier: Trakt;

const summarise = (items: TraktItem[]): Entry[] => items.map((item) => ({
  type: item.type,
  title: item.movie?.title ?? item.show?.title ?? '',
  year: item.movie?.year ?? item.show?.year,
}));

const findList = async (name: string): Promise<TraktList | null> => {
  const lists = await verifier.users.lists.get({ username: 'me' });
  return lists.find((list: TraktList) => list.name === name) ?? null;
};

/** Whole list, unfiltered, read directly from the service. */
const readItems = async (listId: number): Promise<TraktItem[]> => (
  verifier.users.list.items.get({ username: 'me', id: `${listId}` })
);

const ofType = (items: TraktItem[], type: string): Entry[] => summarise(items.filter((i) => i.type === type));

const skip = !clientId || !clientSecret || !saveFile;

describe.skipIf(skip)('TraktTarget (E2E)', () => {
  // Shared between the cases: the whole suite works on ONE list.
  let listId = 0;
  let inceptionId = '';
  let breakingBadId = '';

  beforeAll(async () => {
    if (!fs.existsSync(saveFile)) {
      throw new Error(
        `E2E_TRAKT_SAVE_FILE points at "${saveFile}", which does not exist. This suite consumes an `
        + 'already-obtained Trakt token and never runs the OAuth device flow: run the application once '
        + 'to authorise, then point this variable at the token file it wrote.',
      );
    }

    target = new TraktTarget({ saveFile, clientId, clientSecret }, cacheOptions, false);
    // The file exists, so this imports and refreshes the token instead of
    // falling through to the interactive device flow.
    await target.connect();

    verifier = new Trakt({ client_id: clientId, client_secret: clientSecret });
    const token = JSON.parse(fs.readFileSync(saveFile, 'utf8')) as TraktAccessExport;
    await verifier.import_token(token);

    // Sweep BEFORE counting: the account survives between runs, so an interrupted
    // run leaves a list that counts against the cap for ever. Everything this
    // suite creates carries the same prefix, so it is safe to reclaim.
    const orphans = (await verifier.users.lists.get({ username: 'me' }))
      .filter((list: TraktList) => list.name.startsWith(LIST_NAME_PREFIX));
    for (const orphan of orphans) {
      console.warn(`[E2E] reclaiming orphaned Trakt list "${orphan.name}" from an interrupted run`);
      await verifier.users.list.delete({ username: 'me', id: `${orphan.ids.trakt}` });
    }

    const existing = await verifier.users.lists.get({ username: 'me' });
    if (existing.length >= FREE_ACCOUNT_LIST_CAP) {
      console.warn(
        `[E2E] the Trakt account already holds ${existing.length} personal lists; a free account is capped `
        + `at ${FREE_ACCOUNT_LIST_CAP} and creating "${listName}" may be refused.`,
      );
    }
  });

  afterAll(async () => {
    // Must run whatever happened above, a failing test included: a leftover list
    // burns one of the five slots the account has.
    if (verifier === undefined) return;
    const list = await findList(listName);
    if (list === null) {
      console.warn(`[E2E] Trakt list "${listName}" was already absent, nothing to clean`);
      return;
    }
    await verifier.users.list.delete({ username: 'me', id: `${list.ids.trakt}` });
    console.info(`[E2E] deleted Trakt list ${list.ids.trakt} "${listName}"`);
  });

  it('resolves a well-known movie and a well-known show', async () => {
    [inceptionId] = await target.resolveMany([{ title: 'Inception', year: 2010 }], 'movie');
    [breakingBadId] = await target.resolveMany([{ title: 'Breaking Bad', year: 2008 }], 'show');

    expect(inceptionId).toMatch(/^\d+$/);
    expect(breakingBadId).toMatch(/^\d+$/);

    // Not hardcoded — a frozen Trakt id would rot — so the resolved ids are
    // confirmed against the live API instead.
    const [movie] = await verifier.search.id({ id_type: 'trakt', id: inceptionId, type: 'movie' });
    expect(movie?.movie).toMatchObject({ title: 'Inception', year: 2010 });
    const [show] = await verifier.search.id({ id_type: 'trakt', id: breakingBadId, type: 'show' });
    expect(show?.show).toMatchObject({ title: 'Breaking Bad', year: 2008 });
  });

  it('creates a private list holding movies and shows together', async () => {
    await target.pushToList({ movie: [inceptionId] }, listName, 'private');
    await target.pushToList({ show: [breakingBadId] }, listName, 'private');

    const list = await findList(listName);
    expect(list).not.toBeNull();
    expect(list?.privacy).toBe('private');

    listId = list?.ids.trakt ?? 0;
    expect(listId).toBeGreaterThan(0);

    const items = await readItems(listId);
    expect(items).toHaveLength(2);
    expect(ofType(items, 'movie')).toEqual([{ type: 'movie', title: 'Inception', year: 2010 }]);
    expect(ofType(items, 'show')).toEqual([{ type: 'show', title: 'Breaking Bad', year: 2008 }]);
  }, WRITE_TIMEOUT);

  /**
   * The regression this whole suite exists for.
   *
   * `trakt.tv` maps `users.list.items.get` to
   * `/users/:username/lists/:id/items?type=`, sending `type` as a QUERY
   * parameter, while the Trakt API expects it as a PATH segment (`/items/:type`).
   * The query parameter is silently ignored and every item comes back whatever
   * `type` is passed, so `TraktAPI` reads unfiltered and narrows in memory. No
   * unit test can pin this: mocking the client means mocking the very lie.
   */
  it('is not filtered server-side by the `type` the client sends, and narrows correctly in memory', async () => {
    expect(listId).toBeGreaterThan(0);

    const asShows = await verifier.users.list.items.get({ username: 'me', id: `${listId}`, type: 'show' });
    // Asked for shows only; the movie is still there. This is the defect.
    expect([...asShows.map((item: TraktItem) => item.type)].sort()).toEqual(['movie', 'show']);

    // And the in-memory narrowing production uses gives the right answer on that
    // same mixed list.
    expect(ofType(asShows, 'movie')).toEqual([{ type: 'movie', title: 'Inception', year: 2010 }]);
    expect(ofType(asShows, 'show')).toEqual([{ type: 'show', title: 'Breaking Bad', year: 2008 }]);
  });

  it('replaces one kind on a second push without disturbing the other', async () => {
    expect(listId).toBeGreaterThan(0);

    const [fightClubId] = await target.resolveMany([{ title: 'Fight Club', year: 1999 }], 'movie');
    expect(fightClubId).toMatch(/^\d+$/);
    expect(fightClubId).not.toBe(inceptionId);

    await target.pushToList({ movie: [fightClubId] }, listName, 'private');

    const items = await readItems(listId);
    expect(ofType(items, 'movie')).toEqual([{ type: 'movie', title: 'Fight Club', year: 1999 }]);
    // The other kind is untouched: a movie push does not purge the shows.
    expect(ofType(items, 'show')).toEqual([{ type: 'show', title: 'Breaking Bad', year: 2008 }]);
    expect(items).toHaveLength(2);
  }, WRITE_TIMEOUT);
});
