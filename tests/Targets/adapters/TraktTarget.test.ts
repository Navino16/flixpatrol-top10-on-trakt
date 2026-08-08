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
    await target.resolveMany([{ title: 'Sans Année', year: null }], 'movie');
    expect(getFirstItemByQuery).toHaveBeenCalledWith('movie', 'Sans Année', 0);
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
    await target.pushToList(['16662', '1388'], 'my-list', 'movie', 'public');
    expect(pushToList).toHaveBeenCalledWith([16662, 1388], 'my-list', 'movie', 'public');
  });
});
