import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import fs from 'fs';

const getFirstItemByQuery = vi.fn();
const pushToList = vi.fn();
const connect = vi.fn();

vi.mock('../../../src/Trakt', () => ({
  TraktAPI: vi.fn().mockImplementation(function TraktAPIMock() {
    return { getFirstItemByQuery, pushToList, connect };
  }),
}));

const { TraktTarget } = await import('../../../src/Targets/adapters/TraktTarget');

const traktOptions = { saveFile: './config/.trakt', clientId: 'id', clientSecret: 'secret' };
const cacheOptions = { enabled: false, savePath: './config/.cache', ttl: 1 };

describe('TraktTarget', () => {
  let target: InstanceType<typeof TraktTarget>;

  beforeEach(() => {
    vi.clearAllMocks();
    target = new TraktTarget(traktOptions, cacheOptions, false);
  });

  it('declares itself as requiring interactive auth', () => {
    expect(target.backend).toBe('trakt');
    expect(target.requiresInteractiveAuth).toBe(true);
  });

  it('reports authentication from the presence of the token file', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    expect(target.isAuthenticated()).toBe(true);
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    expect(target.isAuthenticated()).toBe(false);
  });

  it('resolves movies through the Trakt search and returns string ids', async () => {
    getFirstItemByQuery.mockResolvedValueOnce({ movie: { ids: { trakt: 16662 } } });
    const ids = await target.resolveMany([{ title: 'Inception', year: 2010 }], 'movie');
    expect(getFirstItemByQuery).toHaveBeenCalledWith('movie', 'Inception', 2010);
    expect(ids).toEqual(['16662']);
  });

  it('resolves shows through the show branch of the search result', async () => {
    getFirstItemByQuery.mockResolvedValueOnce({ show: { ids: { trakt: 1388 } } });
    expect(await target.resolveMany([{ title: 'Breaking Bad', year: 2008 }], 'show')).toEqual(['1388']);
  });

  it('passes year 0 when the media item has no year', async () => {
    getFirstItemByQuery.mockResolvedValueOnce({ movie: { ids: { trakt: 1 } } });
    await target.resolveMany([{ title: 'Movie Without Year', year: null }], 'movie');
    expect(getFirstItemByQuery).toHaveBeenCalledWith('movie', 'Movie Without Year', 0);
  });

  it('drops unresolved items and de-duplicates the rest', async () => {
    getFirstItemByQuery
      .mockResolvedValueOnce({ movie: { ids: { trakt: 1 } } })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ movie: { ids: { trakt: 1 } } });
    const ids = await target.resolveMany([
      { title: 'A', year: 2000 },
      { title: 'B', year: 2001 },
      { title: 'C', year: 2002 },
    ], 'movie');
    expect(ids).toEqual(['1']);
  });

  it('converts ids back to numbers when delegating the push', async () => {
    await target.pushToList({ movie: ['16662'], show: ['1388'] }, 'my-list', 'public');
    expect(pushToList).toHaveBeenCalledWith({ movie: [16662], show: [1388] }, 'my-list', 'public');
  });

  // Both kinds of the same list travel in ONE delegated call: a `type: "both"`
  // entry must not pay the per-list Trakt work twice.
  it('delegates a single push for a list carrying both kinds', async () => {
    await target.pushToList({ movie: ['1'], show: ['2'] }, 'my-list', 'public');
    expect(pushToList).toHaveBeenCalledTimes(1);
  });

  // The absent/present distinction is the whole point of the Partial: a kind the
  // caller omitted must reach the Trakt layer omitted, never as an empty array,
  // which would wipe it.
  it('keeps an omitted kind omitted instead of turning it into an empty array', async () => {
    await target.pushToList({ movie: ['16662'] }, 'my-list', 'public');
    const content = pushToList.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(content)).toEqual(['movie']);
    expect('show' in content).toBe(false);
  });

  // An empty array is NOT the same thing: it means "this kind scraped empty,
  // remove what is there" and must be forwarded as such.
  it('forwards an explicitly empty kind as an empty array', async () => {
    await target.pushToList({ movie: [], show: ['2'] }, 'my-list', 'public');
    expect(pushToList).toHaveBeenCalledWith({ movie: [], show: [2] }, 'my-list', 'public');
  });
});
