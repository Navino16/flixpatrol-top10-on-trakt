import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TraktAPI } from '../../src/Trakt/TraktAPI';
import { TraktError } from '../../src/Utils/Errors';
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

      await trakt.pushToList([], 'Test List', 'movie', 'private');

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

      await trakt.pushToList([], 'Test List', 'movie', 'private');

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

      await trakt.pushToList([123, 456], 'Test List', 'movie', 'private');

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

      await trakt.pushToList([123], 'Test List', 'movie', 'private');

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

      await trakt.pushToList([123], 'Test List', 'show', 'private');

      expect(traktInstance.users.list.items.remove).toHaveBeenCalled();
    });
  });
});