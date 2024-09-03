
import type { CacheOptions } from './Flixpatrol';
import { FlixPatrol } from './Flixpatrol';
import { logger, Utils } from './Utils';
import type { FlixPatrolPopular, FlixPatrolTop10 } from './Utils/GetAndValidateConfigs';
import { GetAndValidateConfigs } from './Utils/GetAndValidateConfigs';
import type { TraktAPIOptions } from './Trakt';
import { TraktAPI } from './Trakt';

Utils.ensureConfigExist();

logger.info('Loading all configurations values');
const cacheOptions: CacheOptions = GetAndValidateConfigs.getCacheOptions();
const traktOptions: TraktAPIOptions = GetAndValidateConfigs.getTraktOptions();
const flixPatrolTop10: FlixPatrolTop10[] = GetAndValidateConfigs.getFlixPatrolTop10();
const flixPatrolPopulars: FlixPatrolPopular[] = GetAndValidateConfigs.getFlixPatrolPopular();

logger.silly(`cacheOptions: ${JSON.stringify(cacheOptions)}`);
logger.silly(`traktOptions: ${JSON.stringify({...traktOptions, clientId: 'REDACTED', clientSecret: 'REDACTED'})}`);
logger.silly(`flixPatrolTop10: ${JSON.stringify(flixPatrolTop10)}`);
logger.silly(`flixPatrolPopulars: ${JSON.stringify(flixPatrolPopulars)}`);

const flixpatrol = new FlixPatrol(cacheOptions);
const trakt = new TraktAPI(traktOptions);

trakt.connect().then(async () => {

  for (const top10 of flixPatrolTop10) {
    let listName: string;
    if (top10.name) {
      listName = top10.name.toLowerCase().replace(/\s+/g, '-');
    } else {
      listName = `${top10.platform}-${top10.location}-top10-${top10.fallback === false ? 'without-fallback' : `with-${top10.fallback}-fallback`}`;
    }

    if (top10.type === 'movies' || top10.type === 'both') {
      logger.info('==============================');
      logger.info(`Getting movies for ${listName}`);
      const top10Movies = await flixpatrol.getTop10('Movies', top10, trakt);
      logger.debug(`${top10.platform} movies: ${top10Movies}`);
      await trakt.pushToList(top10Movies, listName, 'movie', top10.privacy);
      logger.info(`List ${listName} updated with ${top10Movies.length} new movies`);
    }
    if (top10.type === 'shows' || top10.type === 'both') {
      logger.info('==============================');
      logger.info(`Getting shows for ${listName}`);
      const top10Shows = await flixpatrol.getTop10('TV Shows', top10, trakt);
      logger.debug(`${top10.platform} shows: ${top10Shows}`);
      await trakt.pushToList(top10Shows, listName, 'show', top10.privacy);
      logger.info(`List ${listName} updated with ${top10Shows.length} new shows`);
    }
  }


  for (const popular of flixPatrolPopulars) {
    let listName: string;
    if (popular.name) {
      listName = popular.name.toLowerCase().replace(/\s+/g, '-');
    } else {
      listName = `${popular.platform}-popular`;
    }

    if (popular.type === 'movies' || popular.type === 'both') {
      logger.info('==============================');
      logger.info(`Getting movies for ${listName}`);
      const popularMovies = await flixpatrol.getPopular('Movies', popular, trakt);
      logger.debug(`${popular.platform} movies: ${popularMovies}`);
      await trakt.pushToList(popularMovies, listName, 'movie', popular.privacy);
      logger.info(`List ${listName} updated with ${popularMovies.length} new movies`);
    }

    if (popular.type === 'shows' || popular.type === 'both') {
      logger.info('==============================');
      logger.info(`Getting shows for ${listName}`);
      const popularShows = await flixpatrol.getPopular('TV Shows', popular, trakt);
      logger.debug(`${popular.platform} shows: ${popularShows}`);
      await trakt.pushToList(popularShows, listName, 'show', popular.privacy);
      logger.info(`List ${listName} updated with ${popularShows.length} new shows`);
    }
  }
});

process.on('SIGINT', () => {
  logger.info('System: Receive SIGINT signal');
  logger.info('System: Application stopped');
  process.exit();
});
