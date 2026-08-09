import fs from 'fs';
import {
  afterAll, beforeAll, describe, expect, it,
} from 'vitest';
import Trakt from 'trakt.tv';
import type { TraktAccessExport, TraktItem, TraktList } from 'trakt.tv';
import { TraktTarget } from '../../src/Targets/adapters/TraktTarget';

/**
 * E2E suite: it talks to a real Trakt account, and is therefore **local only**.
 * It is deliberately absent from CI and depends on no repository secret: the
 * credentials belong to a real person and the owner decides, run by run, which
 * ones are used.
 *
 * It is enabled only when `E2E_TRAKT_CLIENT_ID`, `E2E_TRAKT_CLIENT_SECRET` and
 * `E2E_TRAKT_SAVE_FILE` are all provided; without them the suite is skipped, so
 * a run with no environment stays green.
 *
 * ── Why a token FILE and not a device flow ───────────────────────────────────
 * Trakt authenticates through an OAuth device flow: a human opens a URL and
 * types a code. That cannot happen inside a test, so the suite consumes an
 * ALREADY-OBTAINED token — the very `saveFile` the application writes — and
 * never tries to authorise. If the file is missing, the suite fails with an
 * explicit message rather than hanging on a device-code poll nobody will answer.
 *
 * ── Safety rules, because this WRITES to a real account ──────────────────────
 * - a single list is created, under a run-unique name, so two runs cannot
 *   collide and a free account (capped at 5 personal lists) is not exhausted;
 * - the list is `private`, never anything else;
 * - `afterAll` deletes it whatever happens, including after a failing test;
 * - only a list whose name matches this run's exactly is ever deleted — a list
 *   the suite did not create is never touched.
 *
 * The end state is checked through a SECOND, independent `trakt.tv` client, not
 * through the adapter under test: what counts is the real state of the service.
 */
const clientId = process.env.E2E_TRAKT_CLIENT_ID ?? '';
const clientSecret = process.env.E2E_TRAKT_CLIENT_SECRET ?? '';
const saveFile = process.env.E2E_TRAKT_SAVE_FILE ?? '';
const cacheOptions = { enabled: false, savePath: './config/.cache', ttl: 1 };

// Unique name per run: two concurrent runs do not destroy each other. Kept
// slug-safe (lowercase alphanumerics and hyphens) so the name Trakt stores and
// the slug the application derives from it cannot drift apart.
const listName = `flixpatrol-e2e-${process.pid}-${Date.now().toString(36)}`;

// Trakt sleeps 1s between every write, and a push does several of them, so the
// write-heavy cases get far more than the 60s default.
const WRITE_TIMEOUT = 180000;

// Free accounts are capped at 5 personal lists; past that, list creation fails
// with a Trakt error that says nothing useful. Warn instead.
const FREE_ACCOUNT_LIST_CAP = 5;

interface Entry {
  type: string;
  title: string;
  year: number | undefined;
}

let target: TraktTarget;
// Independent of the code under test: it is authenticated from the same token
// file, but its reads never go through `TraktAPI`. It is also the only way to
// exercise the `type` option of the `trakt.tv` client, which is what the
// regression below is about.
let verifier: Trakt;

/** Reduces a list read to what is worth asserting on: kind, title, year. */
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
    // The file exists, so this imports and refreshes the token; it can never
    // fall through to the interactive device flow.
    await target.connect();

    verifier = new Trakt({ client_id: clientId, client_secret: clientSecret });
    const token = JSON.parse(fs.readFileSync(saveFile, 'utf8')) as TraktAccessExport;
    await verifier.import_token(token);

    const existing = await verifier.users.lists.get({ username: 'me' });
    if (existing.length >= FREE_ACCOUNT_LIST_CAP) {
      console.warn(
        `[E2E] the Trakt account already holds ${existing.length} personal lists; a free account is capped `
        + `at ${FREE_ACCOUNT_LIST_CAP} and creating "${listName}" may be refused.`,
      );
    }
  });

  afterAll(async () => {
    // The list must disappear whatever happened above, a failing test included:
    // a free account only tolerates five of them.
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

    // The ids are not hardcoded — a frozen Trakt id would rot — so they are
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
    // Requirement from the account owner: never anything other than private.
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
   * `/users/:username/lists/:id/items?type=`, i.e. it sends `type` as a QUERY
   * parameter, while the Trakt API expects it as a PATH segment
   * (`/items/:type`). The query parameter is silently ignored and the endpoint
   * answers with every item whatever `type` is passed.
   *
   * `TraktAPI` used to trust that filter: it believed it held only shows while
   * holding the movies it had just written, so it logged a movie count as a show
   * count and fed movie ids into a show-removal body. No unit test can catch
   * that — mocking the client means mocking the very lie. Only the live API can.
   *
   * So the read is now unfiltered and narrowed in memory, and this case pins
   * both halves: the server-side filter really is ignored, and the in-memory
   * narrowing really does yield the right items per kind on a mixed list.
   */
  it('is not filtered server-side by the `type` the client sends, and narrows correctly in memory', async () => {
    expect(listId).toBeGreaterThan(0);

    const asShows = await verifier.users.list.items.get({ username: 'me', id: `${listId}`, type: 'show' });
    // Asked for shows only; the movie is still there. This is the defect.
    expect([...asShows.map((item: TraktItem) => item.type)].sort()).toEqual(['movie', 'show']);

    // And what the production code does instead — one unfiltered read, narrowed
    // per kind in memory — gives the right answer on that same mixed list.
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
    // Replaced, not appended: Inception is gone and a single movie remains.
    expect(ofType(items, 'movie')).toEqual([{ type: 'movie', title: 'Fight Club', year: 1999 }]);
    // The other kind is untouched: a movie push does not purge the shows. Before
    // the fix, the unfiltered-read-believed-filtered confusion made exactly this
    // guarantee unreliable.
    expect(ofType(items, 'show')).toEqual([{ type: 'show', title: 'Breaking Bad', year: 2008 }]);
    expect(items).toHaveLength(2);
  }, WRITE_TIMEOUT);
});
