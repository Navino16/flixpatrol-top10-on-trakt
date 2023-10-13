/* eslint-disable no-await-in-loop */
import { CacheOptions, FlixPatrol } from './Flixpatrol';
import { logger, Utils } from './Utils';
import { TraktAPI, TraktAPIOptions } from './Trakt';
import { FlixPatrolPopular, FlixPatrolTop10, GetAndValidateConfigs } from './Utils/GetAndValidateConfigs';

Utils.ensureConfigExist();

logger.info('Loading all configurations values');
const cacheOptions: CacheOptions = GetAndValidateConfigs.getCacheOptions();
const traktOptions: TraktAPIOptions = GetAndValidateConfigs.getTraktOptions();
const flixPatrolTop10: FlixPatrolTop10[] = GetAndValidateConfigs.getFlixPatrolTop10();
const flixPatrolPopulars: FlixPatrolPopular[] = GetAndValidateConfigs.getFlixPatrolPopular();

const flixpatrol = new FlixPatrol(cacheOptions);
const trakt = new TraktAPI(traktOptions);

trakt.connect().then(async () => {
  // eslint-disable-next-line no-restricted-syntax
  for (const top10 of flixPatrolTop10) {
    const listName = `${top10.platform}-${top10.location}-top10-${top10.fallback === false ? 'without-fallback' : `with-${top10.fallback}-fallback`}`;

    const top10Movies = await flixpatrol.getTop10('Movies', top10.platform, top10.location, top10.fallback);
    logger.debug(`${top10.platform} movies: ${top10Movies}`);
    await trakt.pushToList(top10Movies, listName, 'Movies', top10.privacy);
    logger.info(`List ${listName} updated with ${top10Movies.length} new movies`);

    const top10Shows = await flixpatrol.getTop10('TV Shows', top10.platform, top10.location, top10.fallback);
    logger.debug(`${top10.platform} shows: ${top10Shows}`);
    await trakt.pushToList(top10Shows, listName, 'TV Shows', top10.privacy);
    logger.info(`List ${listName} updated with ${top10Shows.length} new shows`);
  }

  // eslint-disable-next-line no-restricted-syntax
  for (const popular of flixPatrolPopulars) {
    const listName = `${popular.platform}-popular`;

    const popularMovies = await flixpatrol.getPopular('Movies', popular.platform);
    logger.debug(`${popular.platform} movies: ${popularMovies}`);
    await trakt.pushToList(popularMovies, listName, 'Movies', popular.privacy);
    logger.info(`List ${listName} updated with ${popularMovies.length} new movies`);

    const popularShows = await flixpatrol.getPopular('TV Shows', popular.platform);
    logger.debug(`${popular.platform} shows: ${popularShows}`);
    await trakt.pushToList(popularShows, listName, 'TV Shows', popular.privacy);
    logger.info(`List ${listName} updated with ${popularShows.length} new shows`);
  }
});

process.on('SIGINT', () => {
  logger.info('System: Receive SIGINT signal');
  logger.info('System: Application stopped');
  process.exit();
});
