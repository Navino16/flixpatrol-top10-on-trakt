import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Utils } from '../../src/Utils/Utils';
import fs from 'fs';

// Mock fs module
vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn(),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
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
      expect(parsed).toHaveProperty('Trakt');
      expect(parsed).toHaveProperty('Cache');
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
});