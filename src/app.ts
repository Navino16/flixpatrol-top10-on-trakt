import { FlixPatrol } from './Flixpatrol';
import { logger, Utils, AppError } from './Utils';
import type {
  CacheOptions,
  FlixPatrolMostWatched,
  FlixPatrolMostHours,
  FlixPatrolPopular,
  FlixPatrolTop10,
  TraktAPIOptions,
  TmdbOptions,
} from './types';
import { GetAndValidateConfigs } from './Utils/GetAndValidateConfigs';
import { TraktAPI } from './Trakt';
import { TMDBAPI } from './TMDB';

const dryRun = process.env.DRY_RUN === 'true';

if (dryRun) {
  logger.info('========================================');
  logger.info('DRY-RUN MODE ENABLED');
  logger.info('No changes will be made to Trakt or TMDB lists.');
  logger.info('========================================');
}

Utils.ensureConfigExist();

let cacheOptions: CacheOptions;
let traktOptions: TraktAPIOptions | null;
let tmdbOptions: TmdbOptions | null;
let flixPatrolTop10: FlixPatrolTop10[];
let flixPatrolPopulars: FlixPatrolPopular[];
let flixPatrolMostWatched: FlixPatrolMostWatched[];
let flixPatrolMostHours: FlixPatrolMostHours[];

try {
  logger.info('Loading all configurations values');
  cacheOptions = GetAndValidateConfigs.getCacheOptions();
  traktOptions = GetAndValidateConfigs.getTraktOptions();
  tmdbOptions = GetAndValidateConfigs.getTmdbOptions();
  flixPatrolTop10 = GetAndValidateConfigs.getFlixPatrolTop10();
  flixPatrolPopulars = GetAndValidateConfigs.getFlixPatrolPopular();
  flixPatrolMostWatched = GetAndValidateConfigs.getFlixPatrolMostWatched();
  flixPatrolMostHours = GetAndValidateConfigs.getFlixPatrolMostHours();
} catch (err) {
  logger.error(`${(err as Error).name}: ${(err as Error).message}`);
  process.exit(1);
}

if (!traktOptions && !tmdbOptions) {
  logger.error('Configuration error: at least one of "Trakt" or "Tmdb" must be configured');
  process.exit(1);
}

if (!traktOptions && tmdbOptions) {
  logger.warn('Trakt is not configured — item resolution uses Trakt search, so TMDB lists will be empty');
}

logger.silly(`cacheOptions: ${JSON.stringify(cacheOptions)}`);
logger.silly(`traktOptions: ${JSON.stringify(traktOptions ? { ...traktOptions, clientId: 'REDACTED', clientSecret: 'REDACTED' } : null)}`);
logger.silly(`tmdbOptions: ${JSON.stringify(tmdbOptions ? { accessToken: 'REDACTED' } : null)}`);
logger.silly(`flixPatrolTop10: ${JSON.stringify(flixPatrolTop10)}`);
logger.silly(`flixPatrolPopulars: ${JSON.stringify(flixPatrolPopulars)}`);
logger.silly(`flixPatrolMostWatched: ${JSON.stringify(flixPatrolMostWatched)}`);
logger.silly(`flixPatrolMostHours: ${JSON.stringify(flixPatrolMostHours)}`);

const flixpatrol = new FlixPatrol(cacheOptions);
const trakt = traktOptions ? new TraktAPI({ ...traktOptions, dryRun }) : null;
const tmdb = tmdbOptions ? new TMDBAPI({ ...tmdbOptions, dryRun }) : null;

const totalLists = flixPatrolTop10.length
  + flixPatrolPopulars.length
  + flixPatrolMostWatched.filter((m) => m.enabled).length
  + flixPatrolMostHours.filter((m) => m.enabled).length;
let currentList = 0;

const run = async () => {
  if (trakt) await trakt.connect();

  for (const top10 of flixPatrolTop10) {
    currentList++;
    const defaultName = `${top10.platform}-${top10.location}-top10-${top10.fallback === false ? 'without-fallback' : `with-${top10.fallback}-fallback`}`;
    const baseListName = Utils.getListName(top10, defaultName);
    logger.info('==============================');
    logger.info(`[${currentList}/${totalLists}] Processing "${baseListName}"`);

    const { movies, shows, tmdbMovies, tmdbShows, rawCounts } = await flixpatrol.getTop10Sections(top10, trakt);

    if (trakt) {
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

    if (tmdb && top10.tmdbListId) {
      const allTmdb = [...tmdbMovies, ...tmdbShows];
      if (allTmdb.length > 0) {
        logger.info('==============================');
        logger.info(`Syncing ${allTmdb.length} item(s) to TMDB list ${top10.tmdbListId}`);
        await tmdb.pushToList(allTmdb, top10.tmdbListId, top10.tmdbUpdateBanner ?? true);
        logger.info(`TMDB list ${top10.tmdbListId} updated with ${allTmdb.length} item(s)`);
      }
    }
  }

  for (const popular of flixPatrolPopulars) {
    currentList++;
    const listName = Utils.getListName(popular, `${popular.platform}-popular`);
    logger.info(`[${currentList}/${totalLists}] Processing "${listName}"`);

    const tmdbAllItems = [];

    if (popular.type === 'movies' || popular.type === 'both') {
      logger.info('==============================');
      logger.info(`Getting movies for "${listName}"`);
      const { traktIds: popularMovies, tmdbItems: tmdbMovies } = await flixpatrol.getPopular('Movies', popular, trakt);
      logger.debug(`${popular.platform} movies: ${popularMovies}`);
      if (trakt) {
        await trakt.pushToList(popularMovies, listName, 'movie', popular.privacy);
        logger.info(`List ${listName} updated with ${popularMovies.length} new movies`);
      }
      tmdbAllItems.push(...tmdbMovies);
    }

    if (popular.type === 'shows' || popular.type === 'both') {
      logger.info('==============================');
      logger.info(`Getting shows for "${listName}"`);
      const { traktIds: popularShows, tmdbItems: tmdbShows } = await flixpatrol.getPopular('TV Shows', popular, trakt);
      logger.debug(`${popular.platform} shows: ${popularShows}`);
      if (trakt) {
        await trakt.pushToList(popularShows, listName, 'show', popular.privacy);
        logger.info(`List ${listName} updated with ${popularShows.length} new shows`);
      }
      tmdbAllItems.push(...tmdbShows);
    }

    if (tmdb && popular.tmdbListId && tmdbAllItems.length > 0) {
      logger.info('==============================');
      logger.info(`Syncing ${tmdbAllItems.length} item(s) to TMDB list ${popular.tmdbListId}`);
      await tmdb.pushToList(tmdbAllItems, popular.tmdbListId, popular.tmdbUpdateBanner ?? true);
      logger.info(`TMDB list ${popular.tmdbListId} updated with ${tmdbAllItems.length} item(s)`);
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

      const tmdbAllItems = [];

      if (mostWatched.type === 'movies' || mostWatched.type === 'both') {
        logger.info('==============================');
        logger.info(`Getting movies for "${listName}"`);
        const { traktIds: mostWatchedMovies, tmdbItems: tmdbMovies } = await flixpatrol.getMostWatched('Movies', mostWatched, trakt);
        logger.debug(`most-watched movies: ${mostWatchedMovies}`);
        if (trakt) {
          await trakt.pushToList(mostWatchedMovies, listName, 'movie', mostWatched.privacy);
          logger.info(`List ${listName} updated with ${mostWatchedMovies.length} new movies`);
        }
        tmdbAllItems.push(...tmdbMovies);
      }

      if (mostWatched.type === 'shows' || mostWatched.type === 'both') {
        logger.info('==============================');
        logger.info(`Getting shows for "${listName}"`);
        const { traktIds: mostWatchedShows, tmdbItems: tmdbShows } = await flixpatrol.getMostWatched('TV Shows', mostWatched, trakt);
        logger.debug(`most-watched shows: ${mostWatchedShows}`);
        if (trakt) {
          await trakt.pushToList(mostWatchedShows, listName, 'show', mostWatched.privacy);
          logger.info(`List ${listName} updated with ${mostWatchedShows.length} new shows`);
        }
        tmdbAllItems.push(...tmdbShows);
      }

      if (tmdb && mostWatched.tmdbListId && tmdbAllItems.length > 0) {
        logger.info('==============================');
        logger.info(`Syncing ${tmdbAllItems.length} item(s) to TMDB list ${mostWatched.tmdbListId}`);
        await tmdb.pushToList(tmdbAllItems, mostWatched.tmdbListId, mostWatched.tmdbUpdateBanner ?? true);
        logger.info(`TMDB list ${mostWatched.tmdbListId} updated with ${tmdbAllItems.length} item(s)`);
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

      const tmdbAllItems = [];

      if (mostHours.type === 'movies' || mostHours.type === 'both') {
        logger.info('==============================');
        logger.info(`Getting movies for "${listName}"`);
        const { traktIds: mostHoursMovies, tmdbItems: tmdbMovies } = await flixpatrol.getMostHours('Movies', mostHours, trakt);
        logger.debug(`most-hours-${mostHours.period} movies: ${mostHoursMovies}`);
        if (trakt) {
          await trakt.pushToList(mostHoursMovies, listName, 'movie', mostHours.privacy);
          logger.info(`List ${listName} updated with ${mostHoursMovies.length} new movies`);
        }
        tmdbAllItems.push(...tmdbMovies);
      }

      if (mostHours.type === 'shows' || mostHours.type === 'both') {
        logger.info('==============================');
        logger.info(`Getting shows for "${listName}"`);
        const { traktIds: mostHoursShows, tmdbItems: tmdbShows } = await flixpatrol.getMostHours('TV Shows', mostHours, trakt);
        logger.debug(`most-hours-${mostHours.period} shows: ${mostHoursShows}`);
        if (trakt) {
          await trakt.pushToList(mostHoursShows, listName, 'show', mostHours.privacy);
          logger.info(`List ${listName} updated with ${mostHoursShows.length} new shows`);
        }
        tmdbAllItems.push(...tmdbShows);
      }

      if (tmdb && mostHours.tmdbListId && tmdbAllItems.length > 0) {
        logger.info('==============================');
        logger.info(`Syncing ${tmdbAllItems.length} item(s) to TMDB list ${mostHours.tmdbListId}`);
        await tmdb.pushToList(tmdbAllItems, mostHours.tmdbListId, mostHours.tmdbUpdateBanner ?? true);
        logger.info(`TMDB list ${mostHours.tmdbListId} updated with ${tmdbAllItems.length} item(s)`);
      }
    }
  }
};

run().catch((err: unknown) => {
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
