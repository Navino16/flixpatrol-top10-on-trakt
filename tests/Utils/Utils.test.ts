import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Utils } from '../../src/Utils/Utils';
import { logger } from '../../src/Utils/Logger';
import fs from 'fs';
import path from 'path';

// Mock fs module
vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn(),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    rmSync: vi.fn(),
    rmdirSync: vi.fn(),
  },
}));

// Mock process.exit
const mockExit = vi.spyOn(process, 'exit').mockImplementation((() => {
  throw new Error('process.exit called');
}) as unknown as (code?: number) => never);

describe('Utils', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('sleep', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should return a promise', () => {
      const result = Utils.sleep(100);
      expect(result).toBeInstanceOf(Promise);
    });

    it('should resolve after the specified time', async () => {
      const startTime = Date.now();
      const sleepPromise = Utils.sleep(1000);

      // Fast-forward time
      vi.advanceTimersByTime(1000);

      await sleepPromise;
      // The promise should resolve
      expect(true).toBe(true);
    });

    it('should not resolve before the specified time', async () => {
      let resolved = false;
      const sleepPromise = Utils.sleep(1000).then(() => {
        resolved = true;
      });

      // Advance only 500ms
      vi.advanceTimersByTime(500);
      await Promise.resolve(); // Let microtasks run

      expect(resolved).toBe(false);

      // Now advance the rest
      vi.advanceTimersByTime(500);
      await sleepPromise;

      expect(resolved).toBe(true);
    });
  });

  describe('getListName', () => {
    it('should return custom name as-is when normalizeName is false', () => {
      const config = { name: 'My Custom List', normalizeName: false };
      const result = Utils.getListName(config, 'default-name');
      expect(result).toBe('My Custom List');
    });

    it('should normalize custom name when normalizeName is not false', () => {
      const config = { name: 'My Custom List' };
      const result = Utils.getListName(config, 'default-name');
      expect(result).toBe('my-custom-list');
    });

    it('should normalize custom name when normalizeName is true', () => {
      const config = { name: 'My Custom List', normalizeName: true };
      const result = Utils.getListName(config, 'default-name');
      expect(result).toBe('my-custom-list');
    });

    it('should return default name when no custom name is provided', () => {
      const config = {};
      const result = Utils.getListName(config, 'default-name');
      expect(result).toBe('default-name');
    });

    it('should return default name when name is undefined', () => {
      const config = { name: undefined };
      const result = Utils.getListName(config, 'default-name');
      expect(result).toBe('default-name');
    });

    it('should handle multiple spaces in name', () => {
      const config = { name: 'My   Custom   List' };
      const result = Utils.getListName(config, 'default-name');
      expect(result).toBe('my-custom-list');
    });

    it('should handle leading and trailing spaces', () => {
      const config = { name: '  My List  ' };
      const result = Utils.getListName(config, 'default-name');
      expect(result).toBe('-my-list-');
    });

    it('should prepend prefix to the default name when no custom name is set', () => {
      const result = Utils.getListName({}, 'netflix-top10', '[TEST]');
      expect(result).toBe('[TEST]netflix-top10');
    });

    it('should prepend prefix after normalization', () => {
      const config = { name: 'My Custom List' };
      const result = Utils.getListName(config, 'default-name', '[TEST]');
      expect(result).toBe('[TEST]my-custom-list');
    });

    it('should prepend prefix to a non-normalized custom name', () => {
      const config = { name: 'My Custom List', normalizeName: false };
      const result = Utils.getListName(config, 'default-name', '[TEST]');
      expect(result).toBe('[TEST]My Custom List');
    });

    it('should not add any prefix when the prefix argument is undefined', () => {
      const result = Utils.getListName({}, 'default-name');
      expect(result).toBe('default-name');
    });

    it('should not add any prefix when the prefix argument is empty string', () => {
      const result = Utils.getListName({}, 'default-name', '');
      expect(result).toBe('default-name');
    });
  });

  describe('ensureConfigExist', () => {
    it('should do nothing if config file exists', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      Utils.ensureConfigExist();

      expect(fs.existsSync).toHaveBeenCalledWith('./config/default.json');
      expect(fs.writeFileSync).not.toHaveBeenCalled();
      expect(mockExit).not.toHaveBeenCalled();
    });

    it('should create config directory and file if they do not exist', () => {
      // First call for config file, second for config directory
      vi.mocked(fs.existsSync)
        .mockReturnValueOnce(false) // config/default.json does not exist
        .mockReturnValueOnce(false); // config directory does not exist

      expect(() => Utils.ensureConfigExist()).toThrow('process.exit called');

      expect(fs.existsSync).toHaveBeenCalledWith('./config/default.json');
      expect(fs.existsSync).toHaveBeenCalledWith('./config');
      expect(fs.mkdirSync).toHaveBeenCalledWith('./config');
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        './config/default.json',
        expect.stringContaining('"FlixPatrolTop10"')
      );
      expect(mockExit).toHaveBeenCalledWith(0);
    });

    it('should not create config directory if it already exists', () => {
      vi.mocked(fs.existsSync)
        .mockReturnValueOnce(false) // config/default.json does not exist
        .mockReturnValueOnce(true); // config directory exists

      expect(() => Utils.ensureConfigExist()).toThrow('process.exit called');

      expect(fs.mkdirSync).not.toHaveBeenCalled();
      expect(fs.writeFileSync).toHaveBeenCalled();
      expect(mockExit).toHaveBeenCalledWith(0);
    });

    it('should create a valid JSON config file', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      expect(() => Utils.ensureConfigExist()).toThrow('process.exit called');

      const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
      const content = writeCall[1] as string;

      // Verify it's valid JSON
      const parsed = JSON.parse(content);
      expect(parsed).toHaveProperty('FlixPatrolTop10');
      expect(parsed).toHaveProperty('FlixPatrolPopular');
      expect(parsed).toHaveProperty('FlixPatrolMostWatched');
      expect(parsed).toHaveProperty('Cache');
      expect(parsed).toHaveProperty('Schedule');
      // 3.0.0: the credentials live inside Target, and no root-level Trakt
      // block is generated any more.
      expect(parsed).not.toHaveProperty('Trakt');
      expect(parsed.Target).toEqual({
        type: 'trakt',
        saveFile: './config/.trakt',
        clientId: 'You need to replace this client ID',
        clientSecret: 'You need to replace this client secret',
      });
    });

    it('should include a disabled FlareSolverr block in the generated config', () => {
      vi.mocked(fs.existsSync)
        .mockReturnValueOnce(false) // config/default.json does not exist
        .mockReturnValueOnce(true); // config directory already exists

      expect(() => Utils.ensureConfigExist()).toThrow('process.exit called');

      const written = vi.mocked(fs.writeFileSync).mock.calls[0][1] as string;
      const parsed = JSON.parse(written) as { FlareSolverr: Record<string, unknown> };
      expect(parsed.FlareSolverr).toEqual({
        enabled: false,
        url: 'http://localhost:8191/v1',
        maxTimeout: 60000,
      });
      expect(mockExit).toHaveBeenCalledWith(0);
    });

    it('should include Netflix and Disney in FlixPatrolTop10', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      expect(() => Utils.ensureConfigExist()).toThrow('process.exit called');

      const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
      const content = writeCall[1] as string;
      const parsed = JSON.parse(content);

      const platforms = parsed.FlixPatrolTop10.map((config: { platform: string }) => config.platform);
      expect(platforms).toContain('netflix');
      expect(platforms).toContain('disney');
    });
  });

  describe('warnAboutOrphanedCaches', () => {
    it('warns once, naming both leftover directories', () => {
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => logger);
      vi.mocked(fs.existsSync).mockReturnValue(true);

      Utils.warnAboutOrphanedCaches('./config/.cache');

      expect(warn).toHaveBeenCalledTimes(1);
      const message = warn.mock.calls[0][0] as string;
      expect(message).toContain(path.join('./config/.cache', 'movies'));
      expect(message).toContain(path.join('./config/.cache', 'tv-shows'));
      expect(message).toMatch(/no longer read/);
      warn.mockRestore();
    });

    it('warns when only one of the two directories is left', () => {
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => logger);
      vi.mocked(fs.existsSync)
        .mockImplementation((target) => `${target}`.endsWith('tv-shows'));

      Utils.warnAboutOrphanedCaches('./config/.cache');

      expect(warn).toHaveBeenCalledTimes(1);
      const message = warn.mock.calls[0][0] as string;
      expect(message).toContain(path.join('./config/.cache', 'tv-shows'));
      expect(message).not.toContain(path.join('./config/.cache', 'movies'));
      warn.mockRestore();
    });

    it('stays silent when neither directory exists', () => {
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => logger);
      vi.mocked(fs.existsSync).mockReturnValue(false);

      Utils.warnAboutOrphanedCaches('./config/.cache');

      expect(warn).not.toHaveBeenCalled();
      warn.mockRestore();
    });

    it('never deletes the leftover directories', () => {
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => logger);
      vi.mocked(fs.existsSync).mockReturnValue(true);

      Utils.warnAboutOrphanedCaches('./config/.cache');

      expect(fs.rmSync).not.toHaveBeenCalled();
      expect(fs.rmdirSync).not.toHaveBeenCalled();
      warn.mockRestore();
    });
  });
});