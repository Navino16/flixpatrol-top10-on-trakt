
import type { CacheOptions } from './Flixpatrol';
import { FlixPatrol } from './Flixpatrol';
import { logger, Utils } from './Utils';
import type {FlixPatrolMostWatched, FlixPatrolPopular, FlixPatrolTop10} from './Utils/GetAndValidateConfigs';
import { GetAndValidateConfigs } from './Utils/GetAndValidateConfigs';
import type { TraktAPIOptions } from './Trakt';
import { TraktAPI } from './Trakt';

Utils.ensureConfigExist();

logger.info('Loading all configurations values');
const cacheOptions: CacheOptions = GetAndValidateConfigs.getCacheOptions();
const traktOptions: TraktAPIOptions = GetAndValidateConfigs.getTraktOptions();
const flixPatrolTop10: FlixPatrolTop10[] = GetAndValidateConfigs.getFlixPatrolTop10();
const flixPatrolPopulars: FlixPatrolPopular[] = GetAndValidateConfigs.getFlixPatrolPopular();
const flixPatrolMostWatched: FlixPatrolMostWatched[] = GetAndValidateConfigs.getFlixPatrolMostWatched();

logger.silly(`cacheOptions: ${JSON.stringify(cacheOptions)}`);
logger.silly(`traktOptions: ${JSON.stringify({...traktOptions, clientId: 'REDACTED', clientSecret: 'REDACTED'})}`);
logger.silly(`flixPatrolTop10: ${JSON.stringify(flixPatrolTop10)}`);
logger.silly(`flixPatrolPopulars: ${JSON.stringify(flixPatrolPopulars)}`);
logger.silly(`flixPatrolMostWatched: ${JSON.stringify(flixPatrolMostWatched)}`);

const flixpatrol = new FlixPatrol(cacheOptions);
const trakt = new TraktAPI(traktOptions);

trakt.connect().then(async () => {

  for (const top10 of flixPatrolTop10) {
    let baseListName: string;
    if (top10.name && top10.normalizeName === false) {
      baseListName = top10.name;
    }
    else if (top10.name) {
      baseListName = top10.name.toLowerCase().replace(/\s+/g, '-');
    } else {
      baseListName = `${top10.platform}-${top10.location}-top10-${top10.fallback === false ? 'without-fallback' : `with-${top10.fallback}-fallback`}`;
    }

    if (top10.type === 'both') {
      logger.info('==============================');
      logger.info(`Getting movies, shows and overall (if present) for "${baseListName}"`);
      const sections = await flixpatrol.getTop10Sections(top10, trakt);
      const { movies, shows, overall, rawCounts } = sections;

      if (movies.length === 0 && shows.length === 0 && overall.length > 0) {
        if (rawCounts.overall > top10.limit) {
          logger.warn(`Overall list has ${rawCounts.overall} items, limiting to ${top10.limit}`);
        }
        // Only overall available: push once using base list name (treat as mixed)
        await trakt.pushToList(overall, baseListName, 'movie', top10.privacy); // attempt movie type first
        logger.info(`List ${baseListName} updated with ${overall.length} overall items (no separate movies/shows sections found)`);
      } else {
        if (movies.length > 0) {
          const moviesList = `${baseListName}-movies`;
          await trakt.pushToList(movies, moviesList, 'movie', top10.privacy);
          logger.info(`List ${moviesList} updated with ${movies.length} movies`);
        }
        if (shows.length > 0) {
          const showsList = `${baseListName}-shows`;
          await trakt.pushToList(shows, showsList, 'show', top10.privacy);
          logger.info(`List ${showsList} updated with ${shows.length} shows`);
        }
        if (overall.length > 0) {
          if (rawCounts.overall > top10.limit) {
            logger.warn(`Overall list has ${rawCounts.overall} items, limiting to ${top10.limit}`);
          }
            const overallList = `${baseListName}-overall`;
            await trakt.pushToList(overall, overallList, 'movie', top10.privacy); // treat as generic list (try movie search already executed inside)
            logger.info(`List ${overallList} updated with ${overall.length} overall items`);
        }
      }
    } else if (top10.type === 'movies') {
      logger.info('==============================');
      logger.info(`Getting movies (with overall fallback) for "${baseListName}"`);
      const sections = await flixpatrol.getTop10Sections({ ...top10, type: 'movies' }, trakt);
      let list = sections.movies;
      if (list.length === 0 && sections.overall.length > 0) {
        if (sections.rawCounts.overall > top10.limit) {
          logger.warn(`Overall list has ${sections.rawCounts.overall} items, limiting to ${top10.limit}`);
        }
        list = sections.overall;
        logger.info('Movies section not found, using overall list');
      }
      await trakt.pushToList(list, baseListName, 'movie', top10.privacy);
      logger.info(`List ${baseListName} updated with ${list.length} movies`);
    } else if (top10.type === 'shows') {
      logger.info('==============================');
      logger.info(`Getting shows (with overall fallback) for "${baseListName}"`);
      const sections = await flixpatrol.getTop10Sections({ ...top10, type: 'shows' }, trakt);
      let list = sections.shows;
      if (list.length === 0 && sections.overall.length > 0) {
        if (sections.rawCounts.overall > top10.limit) {
          logger.warn(`Overall list has ${sections.rawCounts.overall} items, limiting to ${top10.limit}`);
        }
        list = sections.overall;
        logger.info('Shows section not found, using overall list');
      }
      await trakt.pushToList(list, baseListName, 'show', top10.privacy);
      logger.info(`List ${baseListName} updated with ${list.length} shows`);
    }
  }


  for (const popular of flixPatrolPopulars) {
    let listName: string;
    if (popular.name && popular.normalizeName === false) {
      listName = popular.name;
    }
    else if (popular.name) {
      listName = popular.name.toLowerCase().replace(/\s+/g, '-');
    } else {
      listName = `${popular.platform}-popular`;
    }

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
      let listName: string;
      if (mostWatched.name && mostWatched.normalizeName === false) {
        listName = mostWatched.name;
      }
      if (mostWatched.name) {
        listName = mostWatched.name.toLowerCase().replace(/\s+/g, '-');
      } else {
        listName = `most-watched-${mostWatched.year}-netflix`;
        listName = mostWatched.original !== undefined ? `${listName}-original` : listName;
        listName = mostWatched.premiere !== undefined ? `${listName}-${mostWatched.premiere}-premiere` : listName;
        listName = mostWatched.country !== undefined ? `${listName}-from-${mostWatched.country}` : listName;
      }

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
});

process.on('SIGINT', () => {
  logger.info('System: Receive SIGINT signal');
  logger.info('System: Application stopped');
  process.exit();
});
