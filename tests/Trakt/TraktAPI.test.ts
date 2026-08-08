import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TraktAPI } from '../../src/Trakt/TraktAPI';
import { TraktError } from '../../src/Utils/Errors';
import { Utils } from '../../src/Utils/Utils';
import fs from 'fs';

// Mock fs module
vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    unlinkSync: vi.fn(),
  },
}));

// Create mock functions for trakt.tv
const mockImportToken = vi.fn();
const mockExportToken = vi.fn();
const mockGetCodes = vi.fn();
const mockPollAccess = vi.fn();
const mockListGet = vi.fn();
const mockListUpdate = vi.fn();
const mockListItemsGet = vi.fn();
const mockListItemsAdd = vi.fn();
const mockListItemsRemove = vi.fn();
const mockListsCreate = vi.fn();
const mockSearchText = vi.fn();

// Mock trakt.tv module with a proper class
vi.mock('trakt.tv', () => {
  return {
    default: class MockTrakt {
      import_token = mockImportToken;
      export_token = mockExportToken;
      get_codes = mockGetCodes;
      poll_access = mockPollAccess;
      users = {
        list: {
          get: mockListGet,
          update: mockListUpdate,
          items: {
            get: mockListItemsGet,
            add: mockListItemsAdd,
            remove: mockListItemsRemove,
          },
        },
        lists: {
          create: mockListsCreate,
        },
      };
      search = {
        text: mockSearchText,
      };
    },
  };
});

// Mock Utils.sleep to avoid delays in tests
vi.mock('../../src/Utils/Utils', () => ({
  Utils: {
    sleep: vi.fn().mockResolvedValue(undefined),
  },
}));

describe('TraktAPI', () => {
  const mockOptions = {
    saveFile: './test-token.json',
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Constructor', () => {
    it('should create TraktAPI instance', () => {
      const trakt = new TraktAPI(mockOptions);
      expect(trakt).toBeInstanceOf(TraktAPI);
    });
  });

  describe('connect', () => {
    it('should load token from existing file', async () => {
      const mockToken = { access_token: 'test-token' };
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockToken));

      const trakt = new TraktAPI(mockOptions);
      // Access private trakt instance via prototype
      const traktInstance = (trakt as unknown as { trakt: { import_token: ReturnType<typeof vi.fn> } }).trakt;
      traktInstance.import_token.mockResolvedValue(mockToken);

      await trakt.connect();

      expect(fs.existsSync).toHaveBeenCalledWith(mockOptions.saveFile);
      expect(fs.readFileSync).toHaveBeenCalledWith(mockOptions.saveFile, 'utf8');
      expect(fs.writeFileSync).toHaveBeenCalled();
    });

    it('should handle corrupted token file', async () => {
      vi.mocked(fs.existsSync)
        .mockReturnValueOnce(true)  // First call - file exists
        .mockReturnValueOnce(false); // Second call after unlink - file doesn't exist
      vi.mocked(fs.readFileSync).mockImplementation(() => {
        throw new Error('Invalid JSON');
      });

      const trakt = new TraktAPI(mockOptions);
      const traktInstance = (trakt as unknown as { trakt: { get_codes: ReturnType<typeof vi.fn>; poll_access: ReturnType<typeof vi.fn>; export_token: ReturnType<typeof vi.fn> } }).trakt;
      traktInstance.get_codes.mockResolvedValue({
        verification_url: 'https://trakt.tv/activate',
        user_code: 'TEST123',
      });
      traktInstance.poll_access.mockResolvedValue(undefined);
      traktInstance.export_token.mockReturnValue({ access_token: 'new-token' });

      await trakt.connect();

      expect(fs.unlinkSync).toHaveBeenCalledWith(mockOptions.saveFile);
    });

    it('should initialize new connection when no token file exists', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const trakt = new TraktAPI(mockOptions);
      const traktInstance = (trakt as unknown as { trakt: { get_codes: ReturnType<typeof vi.fn>; poll_access: ReturnType<typeof vi.fn>; export_token: ReturnType<typeof vi.fn> } }).trakt;
      traktInstance.get_codes.mockResolvedValue({
        verification_url: 'https://trakt.tv/activate',
        user_code: 'TEST123',
      });
      traktInstance.poll_access.mockResolvedValue(undefined);
      traktInstance.export_token.mockReturnValue({ access_token: 'new-token' });

      await trakt.connect();

      expect(traktInstance.get_codes).toHaveBeenCalled();
      expect(traktInstance.poll_access).toHaveBeenCalled();
      expect(fs.writeFileSync).toHaveBeenCalled();
    });

    it('should throw TraktError when connection fails', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const trakt = new TraktAPI(mockOptions);
      const traktInstance = (trakt as unknown as { trakt: { get_codes: ReturnType<typeof vi.fn> } }).trakt;
      traktInstance.get_codes.mockRejectedValue(new Error('Connection timeout'));

      await expect(trakt.connect()).rejects.toThrow(TraktError);
    });
  });

  describe('getFirstItemByQuery', () => {
    it('should return movie matching year', async () => {
      const mockMovie = {
        movie: { title: 'Test Movie', year: 2024, ids: { trakt: 123 } },
      };
      const trakt = new TraktAPI(mockOptions);
      const traktInstance = (trakt as unknown as { trakt: { search: { text: ReturnType<typeof vi.fn> } } }).trakt;
      traktInstance.search.text.mockResolvedValue([mockMovie]);

      const result = await trakt.getFirstItemByQuery('movie', 'Test Movie', 2024);

      expect(result).toEqual(mockMovie);
    });

    it('should return show matching year', async () => {
      const mockShow = {
        show: { title: 'Test Show', year: 2023, ids: { trakt: 456 } },
      };
      const trakt = new TraktAPI(mockOptions);
      const traktInstance = (trakt as unknown as { trakt: { search: { text: ReturnType<typeof vi.fn> } } }).trakt;
      traktInstance.search.text.mockResolvedValue([mockShow]);

      const result = await trakt.getFirstItemByQuery('show', 'Test Show', 2023);

      expect(result).toEqual(mockShow);
    });

    it('should return first item if no year match', async () => {
      const mockMovie = {
        movie: { title: 'Test Movie', year: 2020, ids: { trakt: 123 } },
      };
      const trakt = new TraktAPI(mockOptions);
      const traktInstance = (trakt as unknown as { trakt: { search: { text: ReturnType<typeof vi.fn> } } }).trakt;
      traktInstance.search.text.mockResolvedValue([mockMovie]);

      const result = await trakt.getFirstItemByQuery('movie', 'Test Movie', 2024);

      expect(result).toEqual(mockMovie);
    });

    it('should return null if no items found', async () => {
      const trakt = new TraktAPI(mockOptions);
      const traktInstance = (trakt as unknown as { trakt: { search: { text: ReturnType<typeof vi.fn> } } }).trakt;
      traktInstance.search.text.mockResolvedValue([]);

      const result = await trakt.getFirstItemByQuery('movie', 'Non Existent', 2024);

      expect(result).toBeNull();
    });

    it('should return null when Trakt search throws, without bubbling the error', async () => {
      const trakt = new TraktAPI(mockOptions);
      const traktInstance = (trakt as unknown as { trakt: { search: { text: ReturnType<typeof vi.fn> } } }).trakt;
      traktInstance.search.text.mockRejectedValue(new Error('Response code 500 (Internal Server Error)'));

      const result = await trakt.getFirstItemByQuery('movie', 'Trolls', 2016);

      expect(result).toBeNull();
    });
  });

  describe('pushToList', () => {
    it('should create list if not found', async () => {
      const mockList = {
        name: 'Test List',
        privacy: 'private',
        ids: { trakt: 1, slug: 'test-list' },
      };

      const trakt = new TraktAPI(mockOptions);
      const traktInstance = (trakt as unknown as { trakt: {
        users: {
          list: {
            get: ReturnType<typeof vi.fn>;
            update: ReturnType<typeof vi.fn>;
            items: { get: ReturnType<typeof vi.fn>; add: ReturnType<typeof vi.fn> };
          };
          lists: { create: ReturnType<typeof vi.fn> };
        };
      } }).trakt;

      traktInstance.users.list.get.mockRejectedValue(new Error('404 (Not Found)'));
      traktInstance.users.lists.create.mockResolvedValue(mockList);
      traktInstance.users.list.items.get.mockResolvedValue([]);

      await trakt.pushToList({ movie: [] }, 'Test List', 'private');

      expect(traktInstance.users.lists.create).toHaveBeenCalled();
    });

    it('should update privacy if different', async () => {
      const mockList = {
        name: 'Test List',
        privacy: 'public',
        ids: { trakt: 1, slug: 'test-list' },
      };
      const updatedList = { ...mockList, privacy: 'private' };

      const trakt = new TraktAPI(mockOptions);
      const traktInstance = (trakt as unknown as { trakt: {
        users: {
          list: {
            get: ReturnType<typeof vi.fn>;
            update: ReturnType<typeof vi.fn>;
            items: { get: ReturnType<typeof vi.fn>; add: ReturnType<typeof vi.fn> };
          };
        };
      } }).trakt;

      traktInstance.users.list.get.mockResolvedValue(mockList);
      traktInstance.users.list.update.mockResolvedValue(updatedList);
      traktInstance.users.list.items.get.mockResolvedValue([]);

      await trakt.pushToList({ movie: [] }, 'Test List', 'private');

      expect(traktInstance.users.list.update).toHaveBeenCalled();
    });

    it('should add items to list', async () => {
      const mockList = {
        name: 'Test List',
        privacy: 'private',
        ids: { trakt: 1, slug: 'test-list' },
      };

      const trakt = new TraktAPI(mockOptions);
      const traktInstance = (trakt as unknown as { trakt: {
        users: {
          list: {
            get: ReturnType<typeof vi.fn>;
            update: ReturnType<typeof vi.fn>;
            items: { get: ReturnType<typeof vi.fn>; add: ReturnType<typeof vi.fn> };
          };
        };
      } }).trakt;

      traktInstance.users.list.get.mockResolvedValue(mockList);
      traktInstance.users.list.items.get.mockResolvedValue([]);
      traktInstance.users.list.items.add.mockResolvedValue(undefined);
      traktInstance.users.list.update.mockResolvedValue(mockList);

      await trakt.pushToList({ movie: [123, 456] }, 'Test List', 'private');

      expect(traktInstance.users.list.items.add).toHaveBeenCalled();
    });

    it('should remove existing items before adding new ones', async () => {
      const mockList = {
        name: 'Test List',
        privacy: 'private',
        ids: { trakt: 1, slug: 'test-list' },
      };
      const existingItems = [
        { type: 'movie', movie: { ids: { trakt: 789 } } },
      ];

      const trakt = new TraktAPI(mockOptions);
      const traktInstance = (trakt as unknown as { trakt: {
        users: {
          list: {
            get: ReturnType<typeof vi.fn>;
            update: ReturnType<typeof vi.fn>;
            items: { get: ReturnType<typeof vi.fn>; add: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> };
          };
        };
      } }).trakt;

      traktInstance.users.list.get.mockResolvedValue(mockList);
      traktInstance.users.list.items.get.mockResolvedValue(existingItems);
      traktInstance.users.list.items.remove.mockResolvedValue(undefined);
      traktInstance.users.list.items.add.mockResolvedValue(undefined);
      traktInstance.users.list.update.mockResolvedValue(mockList);

      await trakt.pushToList({ movie: [123] }, 'Test List', 'private');

      expect(traktInstance.users.list.items.remove).toHaveBeenCalled();
      expect(traktInstance.users.list.items.add).toHaveBeenCalled();
    });

    it('should handle shows type', async () => {
      const mockList = {
        name: 'Test List',
        privacy: 'private',
        ids: { trakt: 1, slug: 'test-list' },
      };
      const existingItems = [
        { type: 'show', show: { ids: { trakt: 789 } } },
      ];

      const trakt = new TraktAPI(mockOptions);
      const traktInstance = (trakt as unknown as { trakt: {
        users: {
          list: {
            get: ReturnType<typeof vi.fn>;
            update: ReturnType<typeof vi.fn>;
            items: { get: ReturnType<typeof vi.fn>; add: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> };
          };
        };
      } }).trakt;

      traktInstance.users.list.get.mockResolvedValue(mockList);
      traktInstance.users.list.items.get.mockResolvedValue(existingItems);
      traktInstance.users.list.items.remove.mockResolvedValue(undefined);
      traktInstance.users.list.items.add.mockResolvedValue(undefined);
      traktInstance.users.list.update.mockResolvedValue(mockList);

      await trakt.pushToList({ show: [123] }, 'Test List', 'private');

      expect(traktInstance.users.list.items.remove).toHaveBeenCalled();
    });

    it('normalizes list names with brackets to match Trakt slug format', async () => {
      // Regression for the crash observed with LIST_NAME_PREFIX="[TEST]":
      // naive slug `[test]netflix-france-...` did not match Trakt's canonical
      // `test-netflix-france-...`, so `.get()` returned partial data and the
      // privacy-update path crashed on `list.ids.slug` (ids was undefined).
      const mockList = {
        name: '[TEST]netflix-france-top10-with-world-fallback',
        privacy: 'private',
        ids: { trakt: 1, slug: 'test-netflix-france-top10-with-world-fallback' },
      };

      const trakt = new TraktAPI(mockOptions);
      const traktInstance = (trakt as unknown as { trakt: {
        users: {
          list: {
            get: ReturnType<typeof vi.fn>;
            items: { get: ReturnType<typeof vi.fn>; add: ReturnType<typeof vi.fn> };
          };
        };
      } }).trakt;

      traktInstance.users.list.get.mockResolvedValue(mockList);
      traktInstance.users.list.items.get.mockResolvedValue([]);
      traktInstance.users.list.items.add.mockResolvedValue(undefined);

      await trakt.pushToList({ movie: [123] }, '[TEST]netflix-france-top10-with-world-fallback', 'private');

      expect(traktInstance.users.list.get).toHaveBeenCalledWith({
        username: 'me',
        id: 'test-netflix-france-top10-with-world-fallback',
      });
    });

    it('treats Trakt returning an empty-string body as not-found and creates the list', async () => {
      // Regression: Trakt's API has been observed returning HTTP 200 with an
      // empty body (`""`) instead of a proper 404 for some missing-list
      // lookups. The previous code accepted that as a valid response, then
      // crashed on `list.ids.slug` in the privacy-update branch.
      const createdList = {
        name: '[TEST]new-list',
        privacy: 'private',
        ids: { trakt: 99, slug: 'test-new-list' },
      };

      const trakt = new TraktAPI(mockOptions);
      const traktInstance = (trakt as unknown as { trakt: {
        users: {
          list: {
            get: ReturnType<typeof vi.fn>;
            items: { get: ReturnType<typeof vi.fn>; add: ReturnType<typeof vi.fn> };
          };
          lists: { create: ReturnType<typeof vi.fn> };
        };
      } }).trakt;

      traktInstance.users.list.get.mockResolvedValue('');
      traktInstance.users.lists.create.mockResolvedValue(createdList);
      traktInstance.users.list.items.get.mockResolvedValue([]);
      traktInstance.users.list.items.add.mockResolvedValue(undefined);

      await trakt.pushToList({ movie: [123] }, '[TEST]new-list', 'private');

      expect(traktInstance.users.lists.create).toHaveBeenCalledWith({
        username: 'me',
        name: '[TEST]new-list',
        privacy: 'private',
      });
    });

    it('throws a clear error when the create response itself is malformed', async () => {
      const trakt = new TraktAPI(mockOptions);
      const traktInstance = (trakt as unknown as { trakt: {
        users: {
          list: { get: ReturnType<typeof vi.fn> };
          lists: { create: ReturnType<typeof vi.fn> };
        };
      } }).trakt;

      traktInstance.users.list.get.mockResolvedValue('');
      traktInstance.users.lists.create.mockResolvedValue('');

      await expect(
        trakt.pushToList({ movie: [123] }, '[TEST]borked', 'private'),
      ).rejects.toThrow(/malformed response/);
    });

    it('collapses runs of special characters and trims hyphens for the Trakt slug', async () => {
      const mockList = {
        name: 'Foo (Bar) & Baz!',
        privacy: 'private',
        ids: { trakt: 2, slug: 'foo-bar-baz' },
      };

      const trakt = new TraktAPI(mockOptions);
      const traktInstance = (trakt as unknown as { trakt: {
        users: {
          list: {
            get: ReturnType<typeof vi.fn>;
            items: { get: ReturnType<typeof vi.fn>; add: ReturnType<typeof vi.fn> };
          };
        };
      } }).trakt;

      traktInstance.users.list.get.mockResolvedValue(mockList);
      traktInstance.users.list.items.get.mockResolvedValue([]);
      traktInstance.users.list.items.add.mockResolvedValue(undefined);

      await trakt.pushToList({ movie: [123] }, 'Foo (Bar) & Baz!', 'private');

      expect(traktInstance.users.list.get).toHaveBeenCalledWith({
        username: 'me',
        id: 'foo-bar-baz',
      });
    });
  });

  describe('pushToList call budget', () => {
    const foundList = {
      name: 'Test List',
      privacy: 'private',
      ids: { trakt: 1, slug: 'test-list' },
    };

    const armHappyPath = () => {
      mockListGet.mockResolvedValue(foundList);
      mockListItemsGet.mockResolvedValue([]);
      mockListItemsAdd.mockResolvedValue(undefined);
      mockListItemsRemove.mockResolvedValue(undefined);
      mockListUpdate.mockResolvedValue(foundList);
    };

    /**
     * Regression guard on the fused write. A `type: "both"` list used to be
     * pushed TWICE, so the per-list work was paid twice: two `users.list.get`,
     * two description updates (the second silently overwriting the first) and
     * four rate-limit sleeps — two of which were pure waste, i.e. two seconds
     * per list. Reintroducing a per-kind call must break these numbers.
     */
    it('pays the per-list work once when both kinds are written together', async () => {
      armHappyPath();
      const trakt = new TraktAPI(mockOptions);

      await trakt.pushToList({ movie: [123], show: [456] }, 'Test List', 'private');

      // Per LIST: once each (was twice).
      expect(mockListGet).toHaveBeenCalledTimes(1);
      expect(mockListUpdate).toHaveBeenCalledTimes(1);
      // Per KIND: `users.list.items.get` is genuinely type-filtered by Trakt, so
      // it legitimately stays at one call per kind, and so does the add.
      expect(mockListItemsGet).toHaveBeenCalledTimes(2);
      expect(mockListItemsAdd).toHaveBeenCalledTimes(2);
      // Two adds + one description update; the two sleeps that guarded the
      // duplicated list read and description write are gone.
      expect(Utils.sleep).toHaveBeenCalledTimes(3);
    });

    it('writes the description exactly once, so it is never overwritten by a twin', async () => {
      armHappyPath();
      const trakt = new TraktAPI(mockOptions);

      await trakt.pushToList({ movie: [123], show: [456] }, 'Test List', 'private');

      const descriptionUpdates = mockListUpdate.mock.calls
        .filter((c) => typeof (c[0] as { description?: string }).description === 'string');
      expect(descriptionUpdates).toHaveLength(1);
    });

    // Leave-untouched semantics, backend side: an absent key must never reach
    // the items read nor the remove call for that kind.
    it('never touches a kind whose key is absent', async () => {
      armHappyPath();
      mockListItemsGet.mockResolvedValue([{ type: 'show', show: { ids: { trakt: 789 } } }]);
      const trakt = new TraktAPI(mockOptions);

      await trakt.pushToList({ movie: [123] }, 'Test List', 'private');

      expect(mockListItemsGet).toHaveBeenCalledTimes(1);
      expect(mockListItemsGet).toHaveBeenCalledWith(expect.objectContaining({ type: 'movie' }));
      const removedTypes = mockListItemsRemove.mock.calls
        .map((c) => c[0] as { movies: unknown[]; shows: unknown[] });
      expect(removedTypes.every((body) => body.shows.length === 0)).toBe(true);
    });

    // An empty array is a deliberate wipe, not an absent key: the removal must happen.
    it('removes a kind handed an explicitly empty array', async () => {
      armHappyPath();
      mockListItemsGet.mockResolvedValue([{ type: 'movie', movie: { ids: { trakt: 789 } } }]);
      const trakt = new TraktAPI(mockOptions);

      await trakt.pushToList({ movie: [] }, 'Test List', 'private');

      expect(mockListItemsRemove).toHaveBeenCalledTimes(1);
      expect(mockListItemsAdd).not.toHaveBeenCalled();
      // Nothing was added, so there is nothing to date-stamp.
      expect(mockListUpdate).not.toHaveBeenCalled();
    });

    it('does not even look the list up when no kind is given', async () => {
      armHappyPath();
      const trakt = new TraktAPI(mockOptions);

      await trakt.pushToList({}, 'Test List', 'private');

      expect(mockListGet).not.toHaveBeenCalled();
    });
  });
});