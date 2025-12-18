import { FlixPatrol } from './Flixpatrol';
import { logger, Utils, AppError } from './Utils';
import type {
  CacheOptions,
  FlixPatrolMostWatched,
  FlixPatrolMostHours,
  FlixPatrolPopular,
  FlixPatrolTop10,
  TraktAPIOptions,
} from './types';
import { GetAndValidateConfigs } from './Utils/GetAndValidateConfigs';
import { TraktAPI } from './Trakt';

const dryRun = process.env.DRY_RUN === 'true';

if (dryRun) {
  logger.info('========================================');
  logger.info('DRY-RUN MODE ENABLED');
  logger.info('No changes will be made to Trakt lists.');
  logger.info('========================================');
}

Utils.ensureConfigExist();

let cacheOptions: CacheOptions;
let traktOptions: TraktAPIOptions;
let flixPatrolTop10: FlixPatrolTop10[];
let flixPatrolPopulars: FlixPatrolPopular[];
let flixPatrolMostWatched: FlixPatrolMostWatched[];
let flixPatrolMostHours: FlixPatrolMostHours[];

try {
  logger.info('Loading all configurations values');
  cacheOptions = GetAndValidateConfigs.getCacheOptions();
  traktOptions = GetAndValidateConfigs.getTraktOptions();
  flixPatrolTop10 = GetAndValidateConfigs.getFlixPatrolTop10();
  flixPatrolPopulars = GetAndValidateConfigs.getFlixPatrolPopular();
  flixPatrolMostWatched = GetAndValidateConfigs.getFlixPatrolMostWatched();
  flixPatrolMostHours = GetAndValidateConfigs.getFlixPatrolMostHours();
} catch (err) {
  logger.error(`${(err as Error).name}: ${(err as Error).message}`);
  process.exit(1);
}

logger.silly(`cacheOptions: ${JSON.stringify(cacheOptions)}`);
logger.silly(`traktOptions: ${JSON.stringify({...traktOptions, clientId: 'REDACTED', clientSecret: 'REDACTED'})}`);
logger.silly(`flixPatrolTop10: ${JSON.stringify(flixPatrolTop10)}`);
logger.silly(`flixPatrolPopulars: ${JSON.stringify(flixPatrolPopulars)}`);
logger.silly(`flixPatrolMostWatched: ${JSON.stringify(flixPatrolMostWatched)}`);
logger.silly(`flixPatrolMostHours: ${JSON.stringify(flixPatrolMostHours)}`);

const flixpatrol = new FlixPatrol(cacheOptions);
const trakt = new TraktAPI({ ...traktOptions, dryRun });

// Calculate total number of lists for progress indicator
const totalLists = flixPatrolTop10.length
  + flixPatrolPopulars.length
  + flixPatrolMostWatched.filter((m) => m.enabled).length
  + flixPatrolMostHours.filter((m) => m.enabled).length;
let currentList = 0;

trakt.connect().then(async () => {

  for (const top10 of flixPatrolTop10) {
    currentList++;
    const defaultName = `${top10.platform}-${top10.location}-top10-${top10.fallback === false ? 'without-fallback' : `with-${top10.fallback}-fallback`}`;
    const baseListName = Utils.getListName(top10, defaultName);
    logger.info('==============================');
    logger.info(`[${currentList}/${totalLists}] Processing "${baseListName}"`);

    const { movies, shows, rawCounts } = await flixpatrol.getTop10Sections(top10, trakt);

    if (movies.length > 0) {
      logger.info('==============================');
      if (rawCounts.movies > movies.length) {
        logger.warn(`Some movies from FlixPatrol could not be matched on Trakt (${rawCounts.movies} found, ${movies.length} matched)`);
      }
      logger.info(`Saving movies for "${baseListName}"`);
      logger.debug(`${top10.platform} movies: ${movies}`);
      await trakt.pushToList(movies, baseListName, 'movie', top10.privacy);
      logger.info(`List ${baseListName} updated with ${movies.length} new movies`);
    }
    if (shows.length > 0) {
      logger.info('==============================');
      if (rawCounts.shows > shows.length) {
        logger.warn(`Some shows from FlixPatrol could not be matched on Trakt (${rawCounts.shows} found, ${shows.length} matched)`);
      }
      logger.info(`Saving shows for "${baseListName}"`);
      logger.debug(`${top10.platform} shows: ${shows}`);
      await trakt.pushToList(shows, baseListName, 'show', top10.privacy);
      logger.info(`List ${baseListName} updated with ${shows.length} new shows`);
    }
  }


  for (const popular of flixPatrolPopulars) {
    currentList++;
    const listName = Utils.getListName(popular, `${popular.platform}-popular`);
    logger.info(`[${currentList}/${totalLists}] Processing "${listName}"`);

    if (popular.type === 'movies' || popular.type === 'both') {
      logger.info('==============================');
      logger.info(`Getting movies for "${listName}"`);
      const popularMovies = await flixpatrol.getPopular('Movies', popular, trakt);
      logger.debug(`${popular.platform} movies: ${popularMovies}`);
      await trakt.pushToList(popularMovies, listName, 'movie', popular.privacy);
      logger.info(`List ${listName} updated with ${popularMovies.length} new movies`);
    }

    if (popular.type === 'shows' || popular.type === 'both') {
      logger.info('==============================');
      logger.info(`Getting shows for "${listName}"`);
      const popularShows = await flixpatrol.getPopular('TV Shows', popular, trakt);
      logger.debug(`${popular.platform} shows: ${popularShows}`);
      await trakt.pushToList(popularShows, listName, 'show', popular.privacy);
      logger.info(`List ${listName} updated with ${popularShows.length} new shows`);
    }
  }

  for (const mostWatched of flixPatrolMostWatched) {
    if (mostWatched.enabled) {
      currentList++;
      let defaultName = `most-watched-${mostWatched.year}-netflix`;
      defaultName = mostWatched.original !== undefined ? `${defaultName}-original` : defaultName;
      defaultName = mostWatched.premiere !== undefined ? `${defaultName}-${mostWatched.premiere}-premiere` : defaultName;
      defaultName = mostWatched.country !== undefined ? `${defaultName}-from-${mostWatched.country}` : defaultName;
      const listName = Utils.getListName(mostWatched, defaultName);
      logger.info(`[${currentList}/${totalLists}] Processing "${listName}"`);

      if (mostWatched.type === 'movies' || mostWatched.type === 'both') {
        logger.info('==============================');
        logger.info(`Getting movies for "${listName}"`);
        const mostWatchedMovies = await flixpatrol.getMostWatched('Movies', mostWatched, trakt);
        logger.debug(`most-watched movies: ${mostWatchedMovies}`);
        await trakt.pushToList(mostWatchedMovies, listName, 'movie', mostWatched.privacy);
        logger.info(`List ${listName} updated with ${mostWatchedMovies.length} new movies`);
      }

      if (mostWatched.type === 'shows' || mostWatched.type === 'both') {
        logger.info('==============================');
        logger.info(`Getting shows for "${listName}"`);
        const mostWatchedShows = await flixpatrol.getMostWatched('TV Shows', mostWatched, trakt);
        logger.debug(`most-watched shows: ${mostWatchedShows}`);
        await trakt.pushToList(mostWatchedShows, listName, 'show', mostWatched.privacy);
        logger.info(`List ${listName} updated with ${mostWatchedShows.length} new shows`);
      }
    }
  }

  for (const mostHours of flixPatrolMostHours) {
    if (mostHours.enabled) {
      currentList++;
      let defaultName = `netflix-most-hours-${mostHours.period}`;
      if (mostHours.language !== 'all') {
        defaultName += `-${mostHours.language}`;
      }
      const listName = Utils.getListName(mostHours, defaultName);
      logger.info(`[${currentList}/${totalLists}] Processing "${listName}"`);

      if (mostHours.type === 'movies' || mostHours.type === 'both') {
        logger.info('==============================');
        logger.info(`Getting movies for "${listName}"`);
        const mostHoursMovies = await flixpatrol.getMostHours('Movies', mostHours, trakt);
        logger.debug(`most-hours-${mostHours.period} movies: ${mostHoursMovies}`);
        await trakt.pushToList(mostHoursMovies, listName, 'movie', mostHours.privacy);
        logger.info(`List ${listName} updated with ${mostHoursMovies.length} new movies`);
      }

      if (mostHours.type === 'shows' || mostHours.type === 'both') {
        logger.info('==============================');
        logger.info(`Getting shows for "${listName}"`);
        const mostHoursShows = await flixpatrol.getMostHours('TV Shows', mostHours, trakt);
        logger.debug(`most-hours-${mostHours.period} shows: ${mostHoursShows}`);
        await trakt.pushToList(mostHoursShows, listName, 'show', mostHours.privacy);
        logger.info(`List ${listName} updated with ${mostHoursShows.length} new shows`);
      }
    }
  }
}).catch((err: unknown) => {
  if (err instanceof AppError) {
    logger.error(`${err.name}: ${err.message}`);
  } else {
    logger.error(`Unexpected error: ${(err as Error).message}`);
  }
  process.exit(1);
});

process.on('SIGINT', () => {
  logger.info('System: Receive SIGINT signal');
  logger.info('System: Application stopped');
  process.exit();
});
