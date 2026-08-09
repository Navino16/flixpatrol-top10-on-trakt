import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  flixpatrolTop10Location,
  flixpatrolTop10Platform,
  flixpatrolPopularPlatform,
  GetAndValidateConfigs,
} from '../../src/Utils/GetAndValidateConfigs';
import { ConfigurationError } from '../../src/Utils/Errors';
import { logger } from '../../src/Utils/Logger';
import { TRAKT_TEMPLATE_CLIENT_ID, TRAKT_TEMPLATE_CLIENT_SECRET } from '../../src/types';

// Mock the config module
vi.mock('config', () => ({
  default: {
    get: vi.fn(),
    has: vi.fn(),
  },
}));

import config from 'config';

describe('GetAndValidateConfigs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Exported arrays', () => {
    describe('flixpatrolTop10Location', () => {
      it('should contain "world"', () => {
        expect(flixpatrolTop10Location).toContain('world');
      });

      it('should contain common countries', () => {
        expect(flixpatrolTop10Location).toContain('france');
        expect(flixpatrolTop10Location).toContain('united-states');
        expect(flixpatrolTop10Location).toContain('japan');
        expect(flixpatrolTop10Location).toContain('germany');
        expect(flixpatrolTop10Location).toContain('united-kingdom');
      });

      it('should have more than 100 locations', () => {
        expect(flixpatrolTop10Location.length).toBeGreaterThan(100);
      });

      it('should not contain duplicates', () => {
        const uniqueLocations = new Set(flixpatrolTop10Location);
        expect(uniqueLocations.size).toBe(flixpatrolTop10Location.length);
      });

      it('should only contain lowercase kebab-case values', () => {
        flixpatrolTop10Location.forEach((location) => {
          expect(location).toMatch(/^[a-z]+(-[a-z]+)*$/);
        });
      });
    });

    describe('flixpatrolTop10Platform', () => {
      it('should contain major streaming platforms', () => {
        expect(flixpatrolTop10Platform).toContain('netflix');
        expect(flixpatrolTop10Platform).toContain('disney');
        expect(flixpatrolTop10Platform).toContain('amazon-prime');
        expect(flixpatrolTop10Platform).toContain('hbo-max');
        expect(flixpatrolTop10Platform).toContain('apple-tv');
      });

      it('should have more than 30 platforms', () => {
        expect(flixpatrolTop10Platform.length).toBeGreaterThan(30);
      });

      it('should not contain duplicates', () => {
        const uniquePlatforms = new Set(flixpatrolTop10Platform);
        expect(uniquePlatforms.size).toBe(flixpatrolTop10Platform.length);
      });
    });

    describe('flixpatrolPopularPlatform', () => {
      it('should contain popular rating platforms', () => {
        expect(flixpatrolPopularPlatform).toContain('wikipedia');
        expect(flixpatrolPopularPlatform).toContain('youtube');
      });

      it('should not contain streaming platforms', () => {
        expect(flixpatrolPopularPlatform).not.toContain('netflix');
        expect(flixpatrolPopularPlatform).not.toContain('disney');
      });

      it('should not contain duplicates', () => {
        const uniquePlatforms = new Set(flixpatrolPopularPlatform);
        expect(uniquePlatforms.size).toBe(flixpatrolPopularPlatform.length);
      });
    });
  });

  describe('Validation functions', () => {
    describe('getFlixPatrolTop10', () => {
      it('should return valid FlixPatrolTop10 config', () => {
        const validConfig = [
          {
            platform: 'netflix',
            location: 'world',
            fallback: 'france',
            privacy: 'private',
            limit: 10,
            type: 'movies',
          },
        ];
        vi.mocked(config.get).mockReturnValue(validConfig);

        const result = GetAndValidateConfigs.getFlixPatrolTop10();

        expect(result).toEqual(validConfig);
        expect(config.get).toHaveBeenCalledWith('FlixPatrolTop10');
      });

      it('should accept fallback as false', () => {
        const validConfig = [
          {
            platform: 'disney',
            location: 'united-states',
            fallback: false,
            privacy: 'public',
            limit: 5,
            type: 'shows',
          },
        ];
        vi.mocked(config.get).mockReturnValue(validConfig);

        const result = GetAndValidateConfigs.getFlixPatrolTop10();

        expect(result).toEqual(validConfig);
      });

      it('should throw ConfigurationError for invalid platform', () => {
        const invalidConfig = [
          {
            platform: 'invalid-platform',
            location: 'world',
            fallback: false,
            privacy: 'private',
            limit: 10,
            type: 'movies',
          },
        ];
        vi.mocked(config.get).mockReturnValue(invalidConfig);

        expect(() => GetAndValidateConfigs.getFlixPatrolTop10()).toThrow(ConfigurationError);
      });

      it('should throw ConfigurationError for invalid limit', () => {
        const invalidConfig = [
          {
            platform: 'netflix',
            location: 'world',
            fallback: false,
            privacy: 'private',
            limit: 0,
            type: 'movies',
          },
        ];
        vi.mocked(config.get).mockReturnValue(invalidConfig);

        expect(() => GetAndValidateConfigs.getFlixPatrolTop10()).toThrow(ConfigurationError);
      });

      it('should throw ConfigurationError when config.get throws', () => {
        vi.mocked(config.get).mockImplementation(() => {
          throw new Error('Config not found');
        });

        expect(() => GetAndValidateConfigs.getFlixPatrolTop10()).toThrow(ConfigurationError);
      });
    });

    describe('getFlixPatrolPopular', () => {
      it('should return valid FlixPatrolPopular config', () => {
        const validConfig = [
          {
            platform: 'wikipedia',
            privacy: 'private',
            limit: 50,
            type: 'movies',
          },
        ];
        vi.mocked(config.get).mockReturnValue(validConfig);

        const result = GetAndValidateConfigs.getFlixPatrolPopular();

        expect(result).toEqual(validConfig);
        expect(config.get).toHaveBeenCalledWith('FlixPatrolPopular');
      });

      it('should throw ConfigurationError for limit > 100', () => {
        const invalidConfig = [
          {
            platform: 'trakt',
            privacy: 'private',
            limit: 101,
            type: 'movies',
          },
        ];
        vi.mocked(config.get).mockReturnValue(invalidConfig);

        expect(() => GetAndValidateConfigs.getFlixPatrolPopular()).toThrow(ConfigurationError);
      });

      it('should throw ConfigurationError for invalid platform', () => {
        const invalidConfig = [
          {
            platform: 'netflix', // This is a Top10 platform, not Popular
            privacy: 'private',
            limit: 50,
            type: 'movies',
          },
        ];
        vi.mocked(config.get).mockReturnValue(invalidConfig);

        expect(() => GetAndValidateConfigs.getFlixPatrolPopular()).toThrow(ConfigurationError);
      });
    });

    describe('getFlixPatrolMostWatched', () => {
      it('should return valid FlixPatrolMostWatched config', () => {
        const validConfig = [
          {
            enabled: true,
            privacy: 'private',
            limit: 25,
            type: 'both',
            year: 2024,
          },
        ];
        vi.mocked(config.get).mockReturnValue(validConfig);

        const result = GetAndValidateConfigs.getFlixPatrolMostWatched();

        expect(result).toEqual(validConfig);
        expect(config.get).toHaveBeenCalledWith('FlixPatrolMostWatched');
      });

      it('should accept optional fields', () => {
        const validConfig = [
          {
            enabled: true,
            privacy: 'public',
            limit: 10,
            type: 'movies',
            year: 2024,
            name: 'My List',
            normalizeName: false,
            premiere: 2020,
            country: 'france',
            original: true,
            orderByViews: true,
          },
        ];
        vi.mocked(config.get).mockReturnValue(validConfig);

        const result = GetAndValidateConfigs.getFlixPatrolMostWatched();

        expect(result).toEqual(validConfig);
      });

      it('should throw ConfigurationError for limit > 50', () => {
        const invalidConfig = [
          {
            enabled: true,
            privacy: 'private',
            limit: 51,
            type: 'movies',
            year: 2024,
          },
        ];
        vi.mocked(config.get).mockReturnValue(invalidConfig);

        expect(() => GetAndValidateConfigs.getFlixPatrolMostWatched()).toThrow(ConfigurationError);
      });

      it('should throw ConfigurationError for year < 2023', () => {
        const invalidConfig = [
          {
            enabled: true,
            privacy: 'private',
            limit: 10,
            type: 'movies',
            year: 2022,
          },
        ];
        vi.mocked(config.get).mockReturnValue(invalidConfig);

        expect(() => GetAndValidateConfigs.getFlixPatrolMostWatched()).toThrow(ConfigurationError);
      });
    });

    describe('getCacheOptions', () => {
      it('should return valid Cache options', () => {
        const validConfig = {
          enabled: true,
          savePath: './cache',
          ttl: 604800,
        };
        vi.mocked(config.get).mockReturnValue(validConfig);

        const result = GetAndValidateConfigs.getCacheOptions();

        expect(result).toEqual(validConfig);
        expect(config.get).toHaveBeenCalledWith('Cache');
      });

      it('should throw ConfigurationError for invalid enabled type', () => {
        const invalidConfig = {
          enabled: 'yes', // should be boolean
          savePath: './cache',
          ttl: 604800,
        };
        vi.mocked(config.get).mockReturnValue(invalidConfig);

        expect(() => GetAndValidateConfigs.getCacheOptions()).toThrow(ConfigurationError);
      });

      it('should throw ConfigurationError for invalid ttl type', () => {
        const invalidConfig = {
          enabled: true,
          savePath: './cache',
          ttl: '604800', // should be number
        };
        vi.mocked(config.get).mockReturnValue(invalidConfig);

        expect(() => GetAndValidateConfigs.getCacheOptions()).toThrow(ConfigurationError);
      });
    });

    describe('getNotifications', () => {
      it('returns an empty object when the Notifications block is absent', () => {
        vi.mocked(config.has).mockReturnValueOnce(false);
        expect(GetAndValidateConfigs.getNotifications()).toEqual({});
      });

      it('returns the parsed config when valid', () => {
        vi.mocked(config.has).mockReturnValueOnce(true);
        vi.mocked(config.get).mockReturnValueOnce({
          run_start: [{ type: 'webhook', url: 'https://example.com/hook' }],
          error: [{ type: 'gotify', url: 'https://gotify.example.com', token: 'tok' }],
        });
        const result = GetAndValidateConfigs.getNotifications();
        expect(result.run_start).toHaveLength(1);
        expect(result.error?.[0]).toMatchObject({ type: 'gotify', token: 'tok' });
      });

      it('rejects an unknown destination type', () => {
        vi.mocked(config.has).mockReturnValueOnce(true);
        vi.mocked(config.get).mockReturnValueOnce({
          run_end: [{ type: 'pigeon', url: 'https://example.com' }],
        });
        expect(() => GetAndValidateConfigs.getNotifications()).toThrow(/Notifications/);
      });

      it('rejects a gotify destination missing the token', () => {
        vi.mocked(config.has).mockReturnValueOnce(true);
        vi.mocked(config.get).mockReturnValueOnce({
          error: [{ type: 'gotify', url: 'https://gotify.example.com' }],
        });
        expect(() => GetAndValidateConfigs.getNotifications()).toThrow(/token/);
      });

      it('rejects an ntfy destination missing the topic', () => {
        vi.mocked(config.has).mockReturnValueOnce(true);
        vi.mocked(config.get).mockReturnValueOnce({
          run_end: [{ type: 'ntfy', url: 'https://ntfy.sh' }],
        });
        expect(() => GetAndValidateConfigs.getNotifications()).toThrow(/topic/);
      });

      it('rejects an apprise destination missing the key', () => {
        vi.mocked(config.has).mockReturnValueOnce(true);
        vi.mocked(config.get).mockReturnValueOnce({
          run_end: [{ type: 'apprise', url: 'http://apprise:8000' }],
        });
        expect(() => GetAndValidateConfigs.getNotifications()).toThrow(/key/);
      });
    });

    describe('getScheduleOptions', () => {
      it('returns disabled defaults when the Schedule block is absent', () => {
        vi.mocked(config.has).mockReturnValue(false);
        const result = GetAndValidateConfigs.getScheduleOptions();
        expect(result).toEqual({ enabled: false, crons: [], runOnStart: false });
      });

      it('returns a valid enabled schedule', () => {
        vi.mocked(config.has).mockReturnValue(true);
        vi.mocked(config.get).mockReturnValue({
          enabled: true, crons: ['0 6 * * *', '0 18 * * *'], runOnStart: true,
        });
        const result = GetAndValidateConfigs.getScheduleOptions();
        expect(result).toEqual({
          enabled: true, crons: ['0 6 * * *', '0 18 * * *'], runOnStart: true,
        });
      });

      it('throws when enabled with no crons', () => {
        vi.mocked(config.has).mockReturnValue(true);
        vi.mocked(config.get).mockReturnValue({ enabled: true, crons: [] });
        expect(() => GetAndValidateConfigs.getScheduleOptions()).toThrow(ConfigurationError);
      });

      it('throws when a cron expression is invalid', () => {
        vi.mocked(config.has).mockReturnValue(true);
        vi.mocked(config.get).mockReturnValue({ enabled: true, crons: ['not a cron'] });
        expect(() => GetAndValidateConfigs.getScheduleOptions())
          .toThrow(/invalid cron expression/i);
      });
    });

    describe('getFlareSolverrOptions', () => {
      it('returns disabled defaults when the FlareSolverr block is absent', () => {
        vi.mocked(config.has).mockReturnValue(false);
        const result = GetAndValidateConfigs.getFlareSolverrOptions();
        expect(result).toEqual({ enabled: false, maxTimeout: 60000 });
      });

      it('returns disabled defaults without error when present but disabled', () => {
        vi.mocked(config.has).mockReturnValue(true);
        vi.mocked(config.get).mockReturnValue({ enabled: false });
        const result = GetAndValidateConfigs.getFlareSolverrOptions();
        expect(result).toEqual({ enabled: false, maxTimeout: 60000 });
      });

      it('returns a valid enabled configuration', () => {
        vi.mocked(config.has).mockReturnValue(true);
        vi.mocked(config.get).mockReturnValue({
          enabled: true, url: 'http://localhost:8191/v1', maxTimeout: 90000,
        });
        const result = GetAndValidateConfigs.getFlareSolverrOptions();
        expect(result).toEqual({
          enabled: true, url: 'http://localhost:8191/v1', maxTimeout: 90000,
        });
      });

      it('defaults maxTimeout to 60000 when omitted', () => {
        vi.mocked(config.has).mockReturnValue(true);
        vi.mocked(config.get).mockReturnValue({ enabled: true, url: 'http://localhost:8191/v1' });
        const result = GetAndValidateConfigs.getFlareSolverrOptions();
        expect(result.maxTimeout).toBe(60000);
      });

      it('throws when enabled with no url', () => {
        vi.mocked(config.has).mockReturnValue(true);
        vi.mocked(config.get).mockReturnValue({ enabled: true });
        expect(() => GetAndValidateConfigs.getFlareSolverrOptions()).toThrow(ConfigurationError);
      });

      it('throws when url is not a valid URL', () => {
        vi.mocked(config.has).mockReturnValue(true);
        vi.mocked(config.get).mockReturnValue({ enabled: true, url: 'not-a-url' });
        expect(() => GetAndValidateConfigs.getFlareSolverrOptions()).toThrow(ConfigurationError);
      });
    });

    describe('getTargetOptions', () => {
      /** Wires config.has/config.get on a single in-memory configuration object. */
      const useConfig = (blocks: Record<string, unknown>) => {
        vi.mocked(config.has).mockImplementation((key: string) => key in blocks);
        vi.mocked(config.get).mockImplementation((key: string) => {
          if (key in blocks) return blocks[key];
          throw new Error(`unexpected config.get("${key}")`);
        });
      };

      it('returns the inlined trakt credentials', () => {
        useConfig({
          Target: {
            type: 'trakt', saveFile: './config/.trakt', clientId: 'id', clientSecret: 'secret',
          },
        });

        expect(GetAndValidateConfigs.getTargetOptions()).toEqual({
          type: 'trakt', saveFile: './config/.trakt', clientId: 'id', clientSecret: 'secret',
        });
      });

      it('returns the inlined floppy credentials', () => {
        useConfig({ Target: { type: 'floppy', url: 'http://floppy:8000', apiKey: 'token' } });

        expect(GetAndValidateConfigs.getTargetOptions()).toEqual({
          type: 'floppy', url: 'http://floppy:8000', apiKey: 'token',
        });
      });

      it('returns the inlined mdblist credentials', () => {
        useConfig({ Target: { type: 'mdblist', apiKey: 'key' } });

        expect(GetAndValidateConfigs.getTargetOptions()).toEqual({ type: 'mdblist', apiKey: 'key' });
      });

      it('throws when url is not a valid URL', () => {
        useConfig({ Target: { type: 'floppy', url: 'not-a-url', apiKey: 'token' } });

        expect(() => GetAndValidateConfigs.getTargetOptions()).toThrow(ConfigurationError);
      });

      it('throws when a credential is missing from the Target block', () => {
        useConfig({ Target: { type: 'mdblist' } });

        expect(() => GetAndValidateConfigs.getTargetOptions()).toThrow(ConfigurationError);
      });

      it('rejects an unknown backend', () => {
        useConfig({ Target: { type: 'plex', apiKey: 'key' } });

        expect(() => GetAndValidateConfigs.getTargetOptions()).toThrow(ConfigurationError);
      });

      it('rejects a Target that is not an object', () => {
        useConfig({ Target: 'trakt' });

        expect(() => GetAndValidateConfigs.getTargetOptions()).toThrow(ConfigurationError);
      });

      // A raw Zod dump on an unmigrated file reads "invalid discriminator value" and
      // tells the user nothing. These lock the actionable message instead.
      describe('unmigrated configurations', () => {
        it('shows the Target block to write, carrying the root Trakt values across', () => {
          useConfig({
            Trakt: { saveFile: './config/.trakt', clientId: 'my-id', clientSecret: 'my-secret' },
          });

          let message = '';
          try {
            GetAndValidateConfigs.getTargetOptions();
          } catch (err) {
            message = (err as Error).message;
          }

          expect(message).toContain('Configuration format changed in 3.0.0.');
          expect(message).toContain('Replace your root-level `Trakt` block with:');
          expect(message).toContain('"type": "trakt"');
          expect(message).toContain('"saveFile": "./config/.trakt"');
          expect(message).toContain('"clientId": "my-id"');
          expect(message).toContain('"clientSecret": "my-secret"');
          expect(message).toContain('Then remove the old `Trakt` block.');
          // Not a schema dump.
          expect(message).not.toMatch(/invalid|expected|Target\.type:/i);
        });

        // The selector-only `Target` never shipped: it existed briefly while 3.0.0
        // was being built. Detected all the same, for anyone who ran that build.
        it('carries the root Floppy values across when Target only selects the backend', () => {
          useConfig({
            Target: { type: 'floppy' },
            Floppy: { url: 'http://floppy:8000', apiKey: 'floppy-token' },
          });

          expect(() => GetAndValidateConfigs.getTargetOptions())
            .toThrow(/"url": "http:\/\/floppy:8000"/);
          expect(() => GetAndValidateConfigs.getTargetOptions())
            .toThrow(/"apiKey": "floppy-token"/);
        });

        it('uses placeholders, never invented secrets, when nothing can be carried across', () => {
          useConfig({ Target: { type: 'mdblist' }, Trakt: { clientId: 'unrelated' } });

          let message = '';
          try {
            GetAndValidateConfigs.getTargetOptions();
          } catch (err) {
            message = (err as Error).message;
          }

          expect(message).toContain('"type": "mdblist"');
          expect(message).toContain('"apiKey": "<your mdblist API key>"');
          expect(message).not.toContain('unrelated');
          expect(message).toContain('Then remove the old `Trakt` block.');
        });

        it('reports the migration when no Target and no root credential block exist at all', () => {
          useConfig({});

          expect(() => GetAndValidateConfigs.getTargetOptions())
            .toThrow(/Configuration format changed in 3\.0\.0\./);
        });
      });

      // Left in place, the shipped credentials pass every schema and only surface
      // twenty seconds later as a wall of 403s. These lock the startup guard.
      describe('unreplaced template credentials', () => {
        const templateTarget = {
          type: 'trakt',
          saveFile: './config/.trakt',
          clientId: TRAKT_TEMPLATE_CLIENT_ID,
          clientSecret: TRAKT_TEMPLATE_CLIENT_SECRET,
        };

        const messageOf = (): string => {
          try {
            GetAndValidateConfigs.getTargetOptions();
          } catch (err) {
            return (err as Error).message;
          }
          return '';
        };

        it('rejects an untouched template configuration and names both credentials', () => {
          useConfig({ Target: templateTarget });

          expect(() => GetAndValidateConfigs.getTargetOptions()).toThrow(ConfigurationError);

          const message = messageOf();
          expect(message).toContain('`Target.clientId` and `Target.clientSecret`');
          expect(message).toContain('placeholder values shipped in the configuration template');
          expect(message).toContain(`"clientId": ${JSON.stringify(TRAKT_TEMPLATE_CLIENT_ID)}`);
          expect(message).toContain(`"clientSecret": ${JSON.stringify(TRAKT_TEMPLATE_CLIENT_SECRET)}`);
          expect(message).toContain('https://trakt.tv/oauth/applications');
        });

        it('still rejects when only clientId was replaced, naming clientSecret alone', () => {
          useConfig({ Target: { ...templateTarget, clientId: 'my-real-id' } });

          expect(() => GetAndValidateConfigs.getTargetOptions()).toThrow(ConfigurationError);

          const message = messageOf();
          expect(message).toContain('`Target.clientSecret` still holds the placeholder value ');
          expect(message).not.toContain('Target.clientId');
          expect(message).not.toContain('my-real-id');
        });

        it('still rejects when only clientSecret was replaced, naming clientId alone', () => {
          useConfig({ Target: { ...templateTarget, clientSecret: 'my-real-secret' } });

          const message = messageOf();
          expect(message).toContain('`Target.clientId` still holds the placeholder value ');
          expect(message).not.toContain('Target.clientSecret');
        });

        // `./config/.trakt` is the intended default, not a placeholder: keeping it
        // must never be an error.
        it('accepts real credentials that keep the default saveFile', () => {
          useConfig({
            Target: { ...templateTarget, clientId: 'my-real-id', clientSecret: 'my-real-secret' },
          });

          expect(GetAndValidateConfigs.getTargetOptions()).toEqual({
            type: 'trakt',
            saveFile: './config/.trakt',
            clientId: 'my-real-id',
            clientSecret: 'my-real-secret',
          });
        });

        // Neither backend ships template credentials, so nothing can be left
        // unreplaced for them and the guard must stay out of the way.
        it('leaves backends without shipped templates alone', () => {
          useConfig({ Target: { type: 'mdblist', apiKey: 'key' } });
          expect(() => GetAndValidateConfigs.getTargetOptions()).not.toThrow();

          useConfig({ Target: { type: 'floppy', url: 'http://floppy:8000', apiKey: 'token' } });
          expect(() => GetAndValidateConfigs.getTargetOptions()).not.toThrow();
        });
      });

      // Dead config is not a reason to refuse to start: a correct migration that
      // left the old block behind must boot, with a warning and nothing more.
      describe('obsolete root-level blocks alongside a valid Target', () => {
        const validTarget = {
          type: 'trakt', saveFile: './config/.trakt', clientId: 'id', clientSecret: 'secret',
        };

        it('starts normally and warns once when a root Trakt block is left over', () => {
          const warn = vi.spyOn(logger, 'warn').mockImplementation(() => logger);
          useConfig({
            Target: validTarget,
            Trakt: { saveFile: './config/.trakt', clientId: 'id', clientSecret: 'secret' },
          });

          expect(GetAndValidateConfigs.getTargetOptions()).toEqual(validTarget);
          expect(warn).toHaveBeenCalledTimes(1);
          expect(warn.mock.calls[0][0]).toContain('`Trakt`');
          expect(warn.mock.calls[0][0]).toMatch(/no longer\s+read and can be deleted/);
          warn.mockRestore();
        });

        it('names every obsolete block in the single warning', () => {
          const warn = vi.spyOn(logger, 'warn').mockImplementation(() => logger);
          useConfig({
            Target: validTarget,
            Trakt: { saveFile: './config/.trakt', clientId: 'id', clientSecret: 'secret' },
            Mdblist: { apiKey: 'key' },
          });

          expect(() => GetAndValidateConfigs.getTargetOptions()).not.toThrow();
          expect(warn).toHaveBeenCalledTimes(1);
          expect(warn.mock.calls[0][0]).toContain('`Trakt`, `Mdblist`');
          warn.mockRestore();
        });

        it('stays silent on a clean migrated configuration', () => {
          const warn = vi.spyOn(logger, 'warn').mockImplementation(() => logger);
          useConfig({ Target: validTarget });

          expect(GetAndValidateConfigs.getTargetOptions()).toEqual(validTarget);
          expect(warn).not.toHaveBeenCalled();
          warn.mockRestore();
        });
      });
    });

    describe('checkTargetCompatibility', () => {
      const listEntry = (privacy: string) => ({
        platform: 'netflix',
        location: 'world',
        fallback: false,
        privacy,
        limit: 10,
        type: 'both',
      });

      /** Builds the four list blocks, only FlixPatrolTop10 being populated by default. */
      const listsWith = (privacies: string[], block = 'FlixPatrolTop10') => {
        const empty = {
          FlixPatrolTop10: [],
          FlixPatrolPopular: [],
          FlixPatrolMostWatched: [],
          FlixPatrolMostHours: [],
        } as unknown as Parameters<typeof GetAndValidateConfigs.checkTargetCompatibility>[1];
        return {
          ...empty,
          [block]: privacies.map(listEntry),
        } as Parameters<typeof GetAndValidateConfigs.checkTargetCompatibility>[1];
      };

      const mdblist = { type: 'mdblist', apiKey: 'key' } as const;
      const floppy = { type: 'floppy', url: 'http://floppy:8000', apiKey: 'token' } as const;
      const trakt = {
        type: 'trakt', saveFile: './config/.trakt', clientId: 'id', clientSecret: 'secret',
      } as const;

      it('rejects "link" on mdblist, naming the block, the index and the value', () => {
        expect(() => GetAndValidateConfigs.checkTargetCompatibility(mdblist, listsWith(['private', 'link'])))
          .toThrow(/FlixPatrolTop10\[1\]\.privacy = "link"/);
      });

      it('accepts the very same lists on trakt', () => {
        expect(() => GetAndValidateConfigs.checkTargetCompatibility(trakt, listsWith(['private', 'link'])))
          .not.toThrow();
      });

      it('rejects "friends" on floppy', () => {
        expect(() => GetAndValidateConfigs.checkTargetCompatibility(floppy, listsWith(['friends'])))
          .toThrow(ConfigurationError);
      });

      it.each(['FlixPatrolPopular', 'FlixPatrolMostWatched', 'FlixPatrolMostHours'])(
        'covers the %s block too',
        (block) => {
          expect(() => GetAndValidateConfigs.checkTargetCompatibility(mdblist, listsWith(['link'], block)))
            .toThrow(new RegExp(`${block}\\[0\\]\\.privacy = "link"`));
        },
      );

      it('accepts private and public on every backend', () => {
        expect(() => GetAndValidateConfigs.checkTargetCompatibility(mdblist, listsWith(['private', 'public'])))
          .not.toThrow();
      });

      it('warns exactly once on floppy, whatever the number of list entries', () => {
        const warn = vi.spyOn(logger, 'warn').mockImplementation(() => logger);
        const twenty = Array.from({ length: 20 }, () => 'private');

        GetAndValidateConfigs.checkTargetCompatibility(floppy, listsWith(twenty));

        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0][0]).toMatch(/cannot set list visibility/);
        warn.mockRestore();
      });

      it('does not warn about visibility on trakt or mdblist', () => {
        const warn = vi.spyOn(logger, 'warn').mockImplementation(() => logger);

        GetAndValidateConfigs.checkTargetCompatibility(trakt, listsWith(['private']));
        GetAndValidateConfigs.checkTargetCompatibility(mdblist, listsWith(['private']));

        expect(warn).not.toHaveBeenCalled();
        warn.mockRestore();
      });
    });
  });
});
