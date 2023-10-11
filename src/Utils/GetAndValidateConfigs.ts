import config from 'config';
import { TraktPrivacy } from 'trakt.tv';
import { FlixPatrol, FlixPatrolTop10Location, FlixPatrolTop10Platform } from '../Flixpatrol';
import { logger } from './Logger';

export interface FlixPatrolTop10Config {
  platform: FlixPatrolTop10Platform;
  location: FlixPatrolTop10Location;
  fallback: FlixPatrolTop10Location | false;
  privacy: TraktPrivacy;
}

export interface FlixPatrolPopularConfig {
  platform: FlixPatrolTop10Platform;
  privacy: TraktPrivacy;
}

export class GetAndValidateConfigs {
  public static flixPatrolTop10(): FlixPatrolTop10Config[] {
    let flixPatrolTop10Configs: FlixPatrolTop10Config[] = [];
    const traktPrivacy: string[] = ['private', 'link', 'friends', 'public'];
    try {
      flixPatrolTop10Configs = config.get('FlixPatrolTop10') as FlixPatrolTop10Config[];
      flixPatrolTop10Configs.forEach((flixPatrolTop10Config) => {
        if (!FlixPatrol.isFlixPatrolTop10Platform(flixPatrolTop10Config.platform)) {
          logger.error(`Configuration Error: ${flixPatrolTop10Config.platform} is not a valid platform for FlixPatrolTop10`);
          process.exit(1);
        }
        if (!FlixPatrol.isFlixPatrolTop10Location(flixPatrolTop10Config.location)) {
          logger.error(`Configuration Error: ${flixPatrolTop10Config.location} is not a valid location for ${flixPatrolTop10Config.platform} on FlixPatrolTop10`);
          process.exit(1);
        }
        if (
          flixPatrolTop10Config.fallback !== false
          && !FlixPatrol.isFlixPatrolTop10Location(flixPatrolTop10Config.fallback)
        ) {
          logger.error(`Configuration Error: ${flixPatrolTop10Config.fallback} is not a valid fallback for ${flixPatrolTop10Config.platform} on FlixPatrolTop10`);
          process.exit(1);
        }
        if (!traktPrivacy.includes(flixPatrolTop10Config.privacy)) {
          logger.error(`Configuration Error: ${flixPatrolTop10Config.privacy} is not a valid privacy for ${flixPatrolTop10Config.platform} on FlixPatrolTop10`);
          process.exit(1);
        }
      });
    } catch (err) {
      logger.error('Configuration Error: FlixPatrolTop10 was not found in configuration file');
      process.exit(1);
    }
    return flixPatrolTop10Configs;
  }

  public static flixPatrolPopular(): FlixPatrolPopularConfig[] {
    let flixPatrolPopularConfigs: FlixPatrolPopularConfig[] = [];
    const traktPrivacy: string[] = ['private', 'link', 'friends', 'public'];
    try {
      flixPatrolPopularConfigs = config.get('FlixPatrolPopular') as FlixPatrolPopularConfig[];
      flixPatrolPopularConfigs.forEach((flixPatrolPopularConfig) => {
        if (!FlixPatrol.isFlixPatrolPopularPlatform(flixPatrolPopularConfig.platform)) {
          logger.error(`Configuration Error: ${flixPatrolPopularConfig.platform} is not a valid platform for FlixPatrolPopular`);
          process.exit(1);
        }
        if (!traktPrivacy.includes(flixPatrolPopularConfig.privacy)) {
          logger.error(`Configuration Error: ${flixPatrolPopularConfig.privacy} is not a valid privacy for ${flixPatrolPopularConfig.platform} on FlixPatrolPopular`);
          process.exit(1);
        }
      });
    } catch (err) {
      logger.error('Configuration Error: FlixPatrolPopular was not found in configuration file');
      process.exit(1);
    }
    return flixPatrolPopularConfigs;
  }

  public static traktClientId(): string {
    let traktClientId: string;
    try {
      traktClientId = config.get('Trakt.clientId') as string;
    } catch (err) {
      logger.error('Configuration Error: Trakt.clientId was not found in configuration file');
      process.exit(1);
    }
    return traktClientId;
  }

  public static traktClientSecret(): string {
    let traktClientSecret: string;
    try {
      traktClientSecret = config.get('Trakt.clientSecret') as string;
    } catch (err) {
      logger.error('Configuration Error: Trakt.clientSecret was not found in configuration file');
      process.exit(1);
    }
    return traktClientSecret;
  }

  public static traktSaveFile(): string {
    let traktSaveFile: string;
    try {
      traktSaveFile = config.get('Trakt.saveFile') as string;
    } catch (err) {
      logger.error('Configuration Error: Trakt.saveFile was not found in configuration file');
      process.exit(1);
    }
    return traktSaveFile;
  }
}
