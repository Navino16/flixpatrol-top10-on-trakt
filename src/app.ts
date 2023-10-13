/* eslint-disable no-await-in-loop */
import { TraktOptions } from 'trakt.tv';
import { FlixPatrol } from './Flixpatrol';
import {
  FlixPatrolPopularConfig,
  FlixPatrolTop10Config, GetAndValidateConfigs, logger, Utils,
} from './Utils';
import { TraktAPI } from './Trakt';

Utils.ensureConfigExist();

logger.info('Loading all configurations values');
const flixPatrolTop10Configs: FlixPatrolTop10Config[] = GetAndValidateConfigs.flixPatrolTop10();
const flixPatrolPopularConfigs: FlixPatrolPopularConfig[] = GetAndValidateConfigs.flixPatrolPopular();
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
  for (const flixPatrolTop10Config of flixPatrolTop10Configs) {
    const listName = `${flixPatrolTop10Config.platform}-${flixPatrolTop10Config.location}-top10-${flixPatrolTop10Config.fallback === false ? 'without-fallback' : `with-${flixPatrolTop10Config.fallback}-fallback`}`;

    const top10Movies = await flixpatrol.getTop10('Movies', flixPatrolTop10Config.platform, flixPatrolTop10Config.location, flixPatrolTop10Config.fallback);
    logger.debug(`${flixPatrolTop10Config.platform} movies: ${top10Movies}`);
    await trakt.pushToList(top10Movies, listName, 'Movies', flixPatrolTop10Config.privacy);
    logger.info(`List ${listName} updated with ${top10Movies.length} new movies`);

    const top10Shows = await flixpatrol.getTop10('TV Shows', flixPatrolTop10Config.platform, flixPatrolTop10Config.location, flixPatrolTop10Config.fallback);
    logger.debug(`${flixPatrolTop10Config.platform} shows: ${top10Shows}`);
    await trakt.pushToList(top10Shows, listName, 'TV Shows', flixPatrolTop10Config.privacy);
    logger.info(`List ${listName} updated with ${top10Shows.length} new shows`);
  }

  // eslint-disable-next-line no-restricted-syntax
  for (const flixPatrolPopularConfig of flixPatrolPopularConfigs) {
    const listName = `${flixPatrolPopularConfig.platform}-popular`;

    const popularMovies = await flixpatrol.getPopular('Movies', flixPatrolPopularConfig.platform);
    logger.debug(`${flixPatrolPopularConfig.platform} movies: ${popularMovies}`);
    await trakt.pushToList(popularMovies, listName, 'Movies', flixPatrolPopularConfig.privacy);
    logger.info(`List ${listName} updated with ${popularMovies.length} new movies`);

    const popularShows = await flixpatrol.getPopular('TV Shows', flixPatrolPopularConfig.platform);
    logger.debug(`${flixPatrolPopularConfig.platform} shows: ${popularShows}`);
    await trakt.pushToList(popularShows, listName, 'TV Shows', flixPatrolPopularConfig.privacy);
    logger.info(`List ${listName} updated with ${popularShows.length} new shows`);
  }
});

process.on('SIGINT', () => {
  logger.info('System: Receive SIGINT signal');
  logger.info('System: Application stopped');
  process.exit();
});
