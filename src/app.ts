/* eslint-disable no-await-in-loop */
import { TraktOptions } from 'trakt.tv';
import { FlixPatrol } from './Flixpatrol';
import {
  FlixPatrolConfig, GetAndValidateConfigs, logger, Utils,
} from './Utils';
import { TraktAPI } from './Trakt';

Utils.ensureConfigExist();

logger.info('Loading all configurations values');
const flixPatrolConfigs: FlixPatrolConfig[] = GetAndValidateConfigs.flixPatrol();
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
  for (const flixPatrolConfig of flixPatrolConfigs) {
    const listName = `${flixPatrolConfig.platform}-${flixPatrolConfig.location}-top10-${flixPatrolConfig.fallback === false ? 'without-fallback' : `with-${flixPatrolConfig.fallback}-fallback`}`;
    const top10Movies = await flixpatrol.getTop10('Movies', flixPatrolConfig.platform, flixPatrolConfig.location, flixPatrolConfig.fallback);
    logger.debug(`${flixPatrolConfig.platform} movies: ${top10Movies}`);
    if (top10Movies.length > 0) {
      await trakt.pushToList(top10Movies, listName, 'Movies', flixPatrolConfig.privacy);
      logger.info(`List ${listName} updated with new movies`);
    } else {
      logger.warn(`No movies found for ${flixPatrolConfig.platform}`);
    }

    // Avoid rate limit on Trakt and spam FlixPatrol
    await Utils.sleep(5000);

    const top10Shows = await flixpatrol.getTop10('TV Shows', flixPatrolConfig.platform, flixPatrolConfig.location, flixPatrolConfig.fallback);
    logger.debug(`${flixPatrolConfig.platform} shows: ${top10Shows}`);
    if (top10Shows.length > 0) {
      await trakt.pushToList(top10Shows, listName, 'TV Shows', flixPatrolConfig.privacy);
      logger.info(`List ${listName} updated with new shows`);
    } else {
      logger.warn(`No shows found for ${flixPatrolConfig.platform}`);
    }
  }
});
