import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  flixpatrolTop10Location,
  flixpatrolTop10Platform,
  flixpatrolPopularPlatform,
  GetAndValidateConfigs,
} from '../../src/Utils/GetAndValidateConfigs';
import { ConfigurationError } from '../../src/Utils/Errors';

// Mock the config module
vi.mock('config', () => ({
  default: {
    get: vi.fn(),
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
        expect(flixpatrolPopularPlatform).toContain('imdb');
        expect(flixpatrolPopularPlatform).toContain('trakt');
        expect(flixpatrolPopularPlatform).toContain('letterboxd');
        expect(flixpatrolPopularPlatform).toContain('movie-db');
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
            platform: 'imdb',
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

    describe('getTraktOptions', () => {
      it('should return valid Trakt options', () => {
        const validConfig = {
          saveFile: './token.json',
          clientId: 'client-id-123',
          clientSecret: 'client-secret-456',
        };
        vi.mocked(config.get).mockReturnValue(validConfig);

        const result = GetAndValidateConfigs.getTraktOptions();

        expect(result).toEqual(validConfig);
        expect(config.get).toHaveBeenCalledWith('Trakt');
      });

      it('should throw ConfigurationError for missing clientId', () => {
        const invalidConfig = {
          saveFile: './token.json',
          clientSecret: 'client-secret-456',
        };
        vi.mocked(config.get).mockReturnValue(invalidConfig);

        expect(() => GetAndValidateConfigs.getTraktOptions()).toThrow(ConfigurationError);
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
  });
});