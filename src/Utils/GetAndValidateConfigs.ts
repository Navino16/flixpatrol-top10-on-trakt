import config from 'config';
import { FlixPatrol, FlixPatrolLocation, FlixPatrolPlatform } from '../Flixpatrol';
import { logger } from './Logger';

export class GetAndValidateConfigs {
  public static flixPatrolLocation(): FlixPatrolLocation {
    let flixPatrolLocation = '';
    try {
      flixPatrolLocation = config.get('FlixPatrol.location') as string;
      if (!FlixPatrol.isFlixPatrolLocation(flixPatrolLocation)) {
        logger.error(`Configuration Error: ${flixPatrolLocation} is not a valid location for FlixPatrol`);
        process.exit(1);
      }
    } catch (err) {
      logger.error('Configuration Error: FlixPatrol.location was not found in configuration file');
      process.exit(1);
    }
    return flixPatrolLocation;
  }

  public static flixPatrolPlatform(): FlixPatrolPlatform[] {
    let flixPatrolPlatforms = [];
    try {
      flixPatrolPlatforms = config.get('FlixPatrol.platform') as string[];
      flixPatrolPlatforms.forEach((flixPatrolPlatform) => {
        if (!FlixPatrol.isFlixPatrolPlatform(flixPatrolPlatform)) {
          logger.error(`Configuration Error: ${flixPatrolPlatform} is not a valid platform for FlixPatrol`);
          process.exit(1);
        }
      });
    } catch (err) {
      logger.error('Configuration Error: FlixPatrol.platform was not found in configuration file');
      process.exit(1);
    }
    return flixPatrolPlatforms;
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
