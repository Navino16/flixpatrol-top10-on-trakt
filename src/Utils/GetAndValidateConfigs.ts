import config from 'config';
import type { TraktPrivacy } from 'trakt.tv';
import type { CacheOptions, FlixPatrolTop10Location, FlixPatrolTop10Platform } from '../Flixpatrol';
import { FlixPatrol } from '../Flixpatrol';
import { logger } from './Logger';
import type { TraktAPIOptions } from '../Trakt';

export interface FlixPatrolTop10 {
  platform: FlixPatrolTop10Platform;
  location: FlixPatrolTop10Location;
  fallback: FlixPatrolTop10Location | false;
  privacy: TraktPrivacy;
  limit: number;
  type: string;
  name?: string;
}

export interface FlixPatrolPopular {
  platform: FlixPatrolTop10Platform;
  privacy: TraktPrivacy;
  limit: number;
  type: string;
  name?: string;
}

export interface FlixPatrolMostWatched {
  enabled: boolean;
  privacy: TraktPrivacy;
  type: string;
  limit: number;
  name?: string;
  premiere?: number;
  country?: FlixPatrolTop10Location;
  original?: boolean;
}

export class GetAndValidateConfigs {
  private static traktPrivacy: string[] = ['private', 'link', 'friends', 'public'];

  public static getFlixPatrolTop10(): FlixPatrolTop10[] {
    let flixPatrolTop10Configs: Partial<FlixPatrolTop10>[];
    try {
      flixPatrolTop10Configs = config.get('FlixPatrolTop10');
      flixPatrolTop10Configs.forEach((flixPatrolTop10Config, index) => {
        // Check if platform property is valid
        if (!Object.prototype.hasOwnProperty.call(flixPatrolTop10Config, 'platform')) {
          logger.error(`Configuration Error: Property "FlixPatrolTop10[${index}].platform" -> property not found`);
          process.exit(1);
        }
        if (typeof flixPatrolTop10Config.platform !== 'string') {
          logger.error(`Configuration Error: Property "FlixPatrolTop10[${index}].platform" -> not a valid string`);
          process.exit(1);
        }
        if (!FlixPatrol.isFlixPatrolTop10Platform(flixPatrolTop10Config.platform)) {
          logger.error(`Configuration Error: Property "FlixPatrolTop10[${index}].platform" -> ${flixPatrolTop10Config.platform} is not a valid platform`);
          process.exit(1);
        }

        // Check if location property is valid
        if (!Object.prototype.hasOwnProperty.call(flixPatrolTop10Config, 'location')) {
          logger.error(`Configuration Error: Property "FlixPatrolTop10[${index}].location" -> property not found`);
          process.exit(1);
        }
        if (typeof flixPatrolTop10Config.location !== 'string') {
          logger.error(`Configuration Error: Property "FlixPatrolTop10[${index}].location" -> not a valid string`);
          process.exit(1);
        }
        if (!FlixPatrol.isFlixPatrolTop10Location(flixPatrolTop10Config.location)) {
          logger.error(`Configuration Error: Property "FlixPatrolTop10[${index}].location" -> ${flixPatrolTop10Config.location} is not a valid location`);
          process.exit(1);
        }

        // Check if fallback property is valid
        if (!Object.prototype.hasOwnProperty.call(flixPatrolTop10Config, 'fallback')) {
          logger.error(`Configuration Error: Property "FlixPatrolTop10[${index}].fallback" -> property not found`);
          process.exit(1);
        }
        if (typeof flixPatrolTop10Config.fallback !== 'string' && flixPatrolTop10Config.fallback !== false) {
          logger.error(`Configuration Error: Property "FlixPatrolTop10[${index}].fallback" -> not a valid string or boolean`);
          process.exit(1);
        }
        if (flixPatrolTop10Config.fallback !== false
          && !FlixPatrol.isFlixPatrolTop10Location(flixPatrolTop10Config.fallback)) {
          logger.error(`Configuration Error: "FlixPatrolTop10[${index}].location" -> ${flixPatrolTop10Config.fallback} is not a valid fallback`);
          process.exit(1);
        }

        // Check if privacy property is valid
        if (!Object.prototype.hasOwnProperty.call(flixPatrolTop10Config, 'privacy')) {
          logger.error(`Configuration Error: Property "FlixPatrolTop10[${index}].privacy" -> property not found`);
          process.exit(1);
        }
        if (typeof flixPatrolTop10Config.privacy !== 'string') {
          logger.error(`Configuration Error: Property "FlixPatrolTop10[${index}].privacy" -> not a valid string`);
          process.exit(1);
        }
        if (!GetAndValidateConfigs.traktPrivacy.includes(flixPatrolTop10Config.privacy)) {
          logger.error(`Configuration Error: Property "FlixPatrolTop10[${index}].privacy" -> ${flixPatrolTop10Config.privacy} is not a valid privacy`);
          process.exit(1);
        }

        // Check if limit property is valid
        if (!Object.prototype.hasOwnProperty.call(flixPatrolTop10Config, 'limit')) {
          logger.error(`Configuration Error: Property "FlixPatrolTop10[${index}].limit" -> property not found`);
          process.exit(1);
        }
        if (typeof flixPatrolTop10Config.limit !== 'number') {
          logger.error(`Configuration Error: Property "FlixPatrolTop10[${index}].limit" -> not a valid number`);
          process.exit(1);
        }
        if (flixPatrolTop10Config.limit < 1 || flixPatrolTop10Config.limit > 10) {
          logger.error(`Configuration Error: Property "FlixPatrolTop10[${index}].limit" -> limit should be a value between 1 and 10`);
          process.exit(1);
        }

        // Check if type property is valid
        if (!Object.prototype.hasOwnProperty.call(flixPatrolTop10Config, 'type')) {
          logger.error(`Configuration Error: Property "FlixPatrolTop10[${index}].type" -> type not found`);
          process.exit(1);
        }
        if (typeof flixPatrolTop10Config.type !== 'string') {
          logger.error(`Configuration Error: Property "FlixPatrolTop10[${index}].type" -> not a valid string`);
          process.exit(1);
        }
        if (!FlixPatrol.isFlixPatrolType(flixPatrolTop10Config.type)) {
          logger.error(`Configuration Error: Property "FlixPatrolTop10[${index}].type" -> ${flixPatrolTop10Config.type} is not a valid type. Must be 'movies', 'shows' or 'both'`);
          process.exit(1);
        }

        // Check if optional name property is valid
        if (typeof flixPatrolTop10Config.name !== 'string' && flixPatrolTop10Config.name !== undefined) {
          logger.error(`Configuration Error: Property "FlixPatrolTop10[${index}].name" -> not a valid string`);
          process.exit(1);
        }
      });
    } catch (err) {
      logger.error(`Configuration Error: ${err}`);
      process.exit(1);
    }
    return flixPatrolTop10Configs as FlixPatrolTop10[];
  }

  public static getFlixPatrolPopular(): FlixPatrolPopular[] {
    let flixPatrolPopularConfigs: Partial<FlixPatrolPopular>[];
    try {
      flixPatrolPopularConfigs = config.get('FlixPatrolPopular');
      flixPatrolPopularConfigs.forEach((flixPatrolPopularConfig, index) => {
        // Check if platform property is valid
        if (!Object.prototype.hasOwnProperty.call(flixPatrolPopularConfig, 'platform')) {
          logger.error(`Configuration Error: Property "FlixPatrolPopular[${index}].platform" -> property not found`);
          process.exit(1);
        }
        if (typeof flixPatrolPopularConfig.platform !== 'string') {
          logger.error(`Configuration Error: Property "FlixPatrolPopular[${index}].platform" -> not a valid string`);
          process.exit(1);
        }
        if (!FlixPatrol.isFlixPatrolPopularPlatform(flixPatrolPopularConfig.platform)) {
          logger.error(`Configuration Error: Property "FlixPatrolPopular[${index}].platform" -> ${flixPatrolPopularConfig.platform} is not a valid platform`);
          process.exit(1);
        }

        // Check if privacy property is valid
        if (!Object.prototype.hasOwnProperty.call(flixPatrolPopularConfig, 'privacy')) {
          logger.error(`Configuration Error: Property "FlixPatrolPopular[${index}].privacy" -> property not found`);
          process.exit(1);
        }
        if (typeof flixPatrolPopularConfig.privacy !== 'string') {
          logger.error(`Configuration Error: Property "FlixPatrolPopular[${index}].privacy" -> not a valid string`);
          process.exit(1);
        }
        if (!GetAndValidateConfigs.traktPrivacy.includes(flixPatrolPopularConfig.privacy)) {
          logger.error(`Configuration Error: Property "FlixPatrolPopular[${index}].privacy" -> ${flixPatrolPopularConfig.privacy} is not a valid privacy`);
          process.exit(1);
        }

        // Check if limit property is valid
        if (!Object.prototype.hasOwnProperty.call(flixPatrolPopularConfig, 'limit')) {
          logger.error(`Configuration Error: Property "FlixPatrolPopular[${index}].limit" -> property not found`);
          process.exit(1);
        }
        if (typeof flixPatrolPopularConfig.limit !== 'number') {
          logger.error(`Configuration Error: Property "FlixPatrolPopular[${index}].limit" -> not a valid number`);
          process.exit(1);
        }
        if (flixPatrolPopularConfig.limit < 1 || flixPatrolPopularConfig.limit > 100) {
          logger.error(`Configuration Error: Property "FlixPatrolPopular[${index}].limit" -> limit should be a value between 1 and 100`);
          process.exit(1);
        }

        // Check if type property is valid
        if (!Object.prototype.hasOwnProperty.call(flixPatrolPopularConfig, 'type')) {
          logger.error(`Configuration Error: Property "FlixPatrolPopular[${index}].type" -> type not found`);
          process.exit(1);
        }
        if (typeof flixPatrolPopularConfig.type !== 'string') {
          logger.error(`Configuration Error: Property "FlixPatrolPopular[${index}].type" -> not a valid string`);
          process.exit(1);
        }
        if (!FlixPatrol.isFlixPatrolType(flixPatrolPopularConfig.type)) {
          logger.error(`Configuration Error: Property "FlixPatrolPopular[${index}].type" -> ${flixPatrolPopularConfig.type} is not a valid type. Must be 'movies', 'shows' or 'both'`);
          process.exit(1);
        }

        // Check if optional name property is valid
        if (typeof flixPatrolPopularConfig.name !== 'string' && flixPatrolPopularConfig.name !== undefined) {
          logger.error(`Configuration Error: Property "FlixPatrolPopular[${index}].name" -> not a valid string`);
          process.exit(1);
        }
      });
    } catch (err) {
      logger.error(`Configuration Error: ${err}`);
      process.exit(1);
    }
    return flixPatrolPopularConfigs as FlixPatrolPopular[];
  }

  public static getFlixPatrolMostWatched(): FlixPatrolMostWatched {
    let flixPatrolMostWatchedConfig: Partial<FlixPatrolMostWatched>;

    try {
      flixPatrolMostWatchedConfig = config.get('FlixPatrolMostWatched');

      // Check if enabled property is valid
      if (!Object.prototype.hasOwnProperty.call(flixPatrolMostWatchedConfig, 'enabled')) {
        logger.error(`Configuration Error: Property "FlixPatrolMostWatched.enabled" -> property not found`);
        process.exit(1);
      }
      if (typeof flixPatrolMostWatchedConfig.enabled !== 'boolean') {
        logger.error(`Configuration Error: Property "FlixPatrolMostWatched.enabled" -> not a valid boolean`);
        process.exit(1);
      }

      // Check if privacy property is valid
      if (!Object.prototype.hasOwnProperty.call(flixPatrolMostWatchedConfig, 'privacy')) {
        logger.error(`Configuration Error: Property "FlixPatrolMostWatched.privacy" -> property not found`);
        process.exit(1);
      }
      if (typeof flixPatrolMostWatchedConfig.privacy !== 'string') {
        logger.error(`Configuration Error: Property "FlixPatrolMostWatched.privacy" -> not a valid string`);
        process.exit(1);
      }
      if (!GetAndValidateConfigs.traktPrivacy.includes(flixPatrolMostWatchedConfig.privacy)) {
        logger.error(`Configuration Error: Property "FlixPatrolMostWatched.privacy" -> ${flixPatrolMostWatchedConfig.privacy} is not a valid privacy`);
        process.exit(1);
      }

      // Check if limit property is valid
      if (!Object.prototype.hasOwnProperty.call(flixPatrolMostWatchedConfig, 'limit')) {
        logger.error(`Configuration Error: Property "FlixPatrolMostWatched.limit" -> property not found`);
        process.exit(1);
      }
      if (typeof flixPatrolMostWatchedConfig.limit !== 'number') {
        logger.error(`Configuration Error: Property "FlixPatrolMostWatched.limit" -> not a valid number`);
        process.exit(1);
      }
      if (flixPatrolMostWatchedConfig.limit < 1 || flixPatrolMostWatchedConfig.limit > 50) {
        logger.error(`Configuration Error: Property "FlixPatrolMostWatched.limit" -> limit should be a value between 1 and 50`);
        process.exit(1);
      }

      // Check if type property is valid
      if (!Object.prototype.hasOwnProperty.call(flixPatrolMostWatchedConfig, 'type')) {
        logger.error(`Configuration Error: Property "FlixPatrolMostWatched.type" -> type not found`);
        process.exit(1);
      }
      if (typeof flixPatrolMostWatchedConfig.type !== 'string') {
        logger.error(`Configuration Error: Property "FlixPatrolMostWatched.type" -> not a valid string`);
        process.exit(1);
      }
      if (!FlixPatrol.isFlixPatrolType(flixPatrolMostWatchedConfig.type)) {
        logger.error(`Configuration Error: Property "FlixPatrolMostWatched.type" -> ${flixPatrolMostWatchedConfig.type} is not a valid type. Must be 'movies', 'shows' or 'both'`);
        process.exit(1);
      }

      // Check if optional premiere property is valid
      if (Object.prototype.hasOwnProperty.call(flixPatrolMostWatchedConfig, 'premiere') && typeof flixPatrolMostWatchedConfig.premiere !== 'number') {
        logger.error(`Configuration Error: Property "FlixPatrolMostWatched.premiere" -> not a valid number`);
        process.exit(1);
      }
      const maxYear = new Date().getFullYear() - 1;
      if (flixPatrolMostWatchedConfig.premiere !== undefined
        && (flixPatrolMostWatchedConfig.premiere < 1980 || flixPatrolMostWatchedConfig.premiere > maxYear)) {
        logger.error(`Configuration Error: Property "FlixPatrolMostWatched.premiere" -> limit should be a value between 1980 and ${maxYear}`);
        process.exit(1);
      }

      // Check if optional country property is valid
      if (Object.prototype.hasOwnProperty.call(flixPatrolMostWatchedConfig, 'country') && typeof flixPatrolMostWatchedConfig.country !== 'string') {
        logger.error(`Configuration Error: Property "FlixPatrolMostWatched.country" -> not a valid string`);
        process.exit(1);
      }
      if (flixPatrolMostWatchedConfig.country !== undefined
        && !FlixPatrol.isFlixPatrolTop10Location(flixPatrolMostWatchedConfig.country)) {
        logger.error(`Configuration Error: Property "FlixPatrolMostWatched.country" -> ${flixPatrolMostWatchedConfig.country} is not a valid location`);
        process.exit(1);
      }

      // Check if optional original property is valid
      if (Object.prototype.hasOwnProperty.call(flixPatrolMostWatchedConfig, 'original') && typeof flixPatrolMostWatchedConfig.original !== 'boolean') {
        logger.error(`Configuration Error: Property "FlixPatrolMostWatched.original" -> not a valid boolean`);
        process.exit(1);
      }

      // Check if optional name property is valid
      if (typeof flixPatrolMostWatchedConfig.name !== 'string' && flixPatrolMostWatchedConfig.name !== undefined) {
        logger.error(`Configuration Error: Property "FlixPatrolMostWatched.name" -> not a valid string`);
        process.exit(1);
      }
    } catch (err) {
      logger.error(`Configuration Error: ${err}`);
      process.exit(1);
    }

    return flixPatrolMostWatchedConfig as FlixPatrolMostWatched;
  }

  public static getTraktOptions(): TraktAPIOptions {
    let traktConfig: Partial<TraktAPIOptions>;
    try {
      traktConfig = config.get('Trakt');

      if (!Object.prototype.hasOwnProperty.call(traktConfig, 'saveFile')) {
        logger.error('Configuration Error: Property "Trakt.saveFile" was not found in configuration file');
        process.exit(1);
      }
      if (typeof traktConfig.saveFile !== 'string') {
        logger.error('Configuration Error: Property "Trakt.saveFile" is not a valid string in configuration file');
        process.exit(1);
      }

      if (!Object.prototype.hasOwnProperty.call(traktConfig, 'clientId')) {
        logger.error('Configuration Error: Property "Trakt.clientId" was not found in configuration file');
        process.exit(1);
      }
      if (typeof traktConfig.clientId !== 'string') {
        logger.error('Configuration Error: Property "Trakt.clientId" is not a valid string in configuration file');
        process.exit(1);
      }

      if (!Object.prototype.hasOwnProperty.call(traktConfig, 'clientSecret')) {
        logger.error('Configuration Error: Property "Trakt.clientSecret" was not found in configuration file');
        process.exit(1);
      }
      if (typeof traktConfig.clientSecret !== 'string') {
        logger.error('Configuration Error: Property "Trakt.clientSecret" is not a valid string in configuration file');
        process.exit(1);
      }
    } catch (err) {
      logger.error(`Configuration Error: ${err}`);
      process.exit(1);
    }
    return traktConfig as TraktAPIOptions;
  }

  public static getCacheOptions(): CacheOptions {
    let cacheConfig: Partial<CacheOptions>;
    try {
      cacheConfig = config.get('Cache');

      if (!Object.prototype.hasOwnProperty.call(cacheConfig, 'enabled')) {
        logger.error('Configuration Error: Property "Cache.enabled" was not found in configuration file');
        process.exit(1);
      }
      if (typeof cacheConfig.enabled !== 'boolean') {
        logger.error('Configuration Error: Property "Cache.enabled" is not a boolean in configuration file');
        process.exit(1);
      }

      if (!Object.prototype.hasOwnProperty.call(cacheConfig, 'savePath')) {
        logger.error('Configuration Error: Property "Cache.enabled" was not found in configuration file');
        process.exit(1);
      }
      if (typeof cacheConfig.savePath !== 'string') {
        logger.error('Configuration Error: Property "Cache.savePath" is not a valid string in configuration file');
        process.exit(1);
      }

      if (!Object.prototype.hasOwnProperty.call(cacheConfig, 'ttl')) {
        logger.error('Configuration Error: Property "Cache.ttl" was not found in configuration file');
        process.exit(1);
      }
      if (typeof cacheConfig.ttl !== 'number') {
        logger.error('Configuration Error: Property "Cache.ttl" is not a valid number in configuration file');
        process.exit(1);
      }
    } catch (err) {
      logger.error(`Configuration Error: ${err}`);
      process.exit(1);
    }
    return cacheConfig as CacheOptions;
  }
}
