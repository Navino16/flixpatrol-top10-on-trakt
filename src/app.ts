import { TraktOptions } from 'trakt.tv';
import { FlixPatrol, FlixPatrolLocation, FlixPatrolPlatform } from './Flixpatrol';
import { GetAndValidateConfigs, logger, Utils } from './Utils';
import { TraktAPI } from './Trakt';

logger.info('Loading all configurations values');
const flixPatrolLocation: FlixPatrolLocation = GetAndValidateConfigs.flixPatrolLocation();
const flixPatrolPlatforms: FlixPatrolPlatform[] = GetAndValidateConfigs.flixPatrolPlatform();
const traktClientId: string = GetAndValidateConfigs.traktClientId();
const traktClientSecret: string = GetAndValidateConfigs.traktClientSecret();
const traktSaveFile: string = GetAndValidateConfigs.traktSaveFile();

const traktOptions: TraktOptions = {
  client_id: traktClientId,
  client_secret: traktClientSecret,
};

const flixpatrol = new FlixPatrol();
const trakt = new TraktAPI(traktOptions, traktSaveFile);
trakt.connect().then(async () => {
  // eslint-disable-next-line no-restricted-syntax
  for (const flixPatrolPlatform of flixPatrolPlatforms) {
    // eslint-disable-next-line no-await-in-loop
    const top10Movies = await flixpatrol.getTop10('Movies', flixPatrolPlatform, flixPatrolLocation);
    logger.debug(`${flixPatrolPlatform} movies: ${top10Movies}`);
    if (top10Movies.length > 0) {
      // eslint-disable-next-line no-await-in-loop
      await trakt.pushToList(top10Movies, flixPatrolPlatform, 'Movies');
      logger.info(`List ${flixPatrolPlatform} updated with new movies`);
    } else {
      logger.warn(`No movies found for ${flixPatrolPlatform}`);
    }

    // Avoid rate limit on Trakt and spam FlixPatrol
    // eslint-disable-next-line no-await-in-loop
    await Utils.sleep(5000);

    // eslint-disable-next-line no-await-in-loop
    const top10Shows = await flixpatrol.getTop10('TV Shows', flixPatrolPlatform, flixPatrolLocation);
    logger.debug(`${flixPatrolPlatform} shows: ${top10Shows}`);
    if (top10Shows.length > 0) {
      // eslint-disable-next-line no-await-in-loop
      await trakt.pushToList(top10Shows, flixPatrolPlatform, 'TV Shows');
      logger.info(`List ${flixPatrolPlatform} updated with new shows`);
    } else {
      logger.warn(`No shows found for ${flixPatrolPlatform}`);
    }
  }

  // flixPatrolPlatforms.forEach(async (flixPatrolPlatform: FlixPatrolPlatform) => {
  //   const top10Movies = await flixpatrol.getTop10('Movies', flixPatrolPlatform, flixPatrolLocation);
  //   logger.debug(`${flixPatrolPlatform} movies: ${top10Movies}`);
  //   if (top10Movies.length > 0) {
  //     await trakt.pushToList(top10Movies, flixPatrolPlatform, 'Movies');
  //     logger.info(`List ${flixPatrolPlatform} updated with new movies`);
  //   } else {
  //     logger.warn(`No movies found for ${flixPatrolPlatform}`);
  //   }
  //
  //   // Avoid rate limit on Trakt and spam FlixPatrol
  //   await Utils.sleep(5000);
  //
  //   const top10Shows = await flixpatrol.getTop10('TV Shows', flixPatrolPlatform, flixPatrolLocation);
  //   logger.debug(`${flixPatrolPlatform} shows: ${top10Shows}`);
  //   if (top10Shows.length > 0) {
  //     await trakt.pushToList(top10Shows, flixPatrolPlatform, 'TV Shows');
  //     logger.info(`List ${flixPatrolPlatform} updated with new shows`);
  //   } else {
  //     logger.warn(`No shows found for ${flixPatrolPlatform}`);
  //   }
  // });
});
