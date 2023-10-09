import config from 'config';
import { FlixPatrol, FlixPatrolLocation, FlixPatrolPlatform } from '../Flixpatrol';
import { logger } from './Logger';

export interface FlixPatrolConfig {
  platform: FlixPatrolPlatform;
  location: FlixPatrolLocation
  fallback: FlixPatrolLocation | false;
}

export class GetAndValidateConfigs {
  public static flixPatrol(): FlixPatrolConfig[] {
    let flixPatrolConfigs: FlixPatrolConfig[] = [];
    try {
      flixPatrolConfigs = config.get('FlixPatrol') as FlixPatrolConfig[];
      flixPatrolConfigs.forEach((flixPatrolConfig) => {
        if (!FlixPatrol.isFlixPatrolPlatform(flixPatrolConfig.platform)) {
          logger.error(`Configuration Error: ${flixPatrolConfig.platform} is not a valid platform for FlixPatrol`);
          process.exit(1);
        }
        if (!FlixPatrol.isFlixPatrolLocation(flixPatrolConfig.location)) {
          logger.error(`Configuration Error: ${flixPatrolConfig.location} is not a valid location for ${flixPatrolConfig.platform} on FlixPatrol`);
          process.exit(1);
        }
        if (flixPatrolConfig.fallback !== false && !FlixPatrol.isFlixPatrolLocation(flixPatrolConfig.fallback)) {
          logger.error(`Configuration Error: ${flixPatrolConfig.fallback} is not a valid fallback for ${flixPatrolConfig.platform} on FlixPatrol`);
          process.exit(1);
        }
      });
    } catch (err) {
      logger.error('Configuration Error: FlixPatrol was not found in configuration file');
      process.exit(1);
    }
    return flixPatrolConfigs;
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
