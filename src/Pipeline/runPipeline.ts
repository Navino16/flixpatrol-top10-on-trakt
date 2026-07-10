import { FlixPatrol } from '../Flixpatrol';
import { TraktAPI } from '../Trakt';
import { logger, Utils } from '../Utils';
import type {
  NotificationEvent, NotificationPayload, RunSummary,
} from '../Notifications';
import type {
  CacheOptions, FlixPatrolMostWatched, FlixPatrolMostHours,
  FlixPatrolPopular, FlixPatrolTop10, TraktAPIOptions,
} from '../types';

export interface RunPipelineDeps {
  cacheOptions: CacheOptions;
  traktOptions: TraktAPIOptions;
  flixPatrolTop10: FlixPatrolTop10[];
  flixPatrolPopulars: FlixPatrolPopular[];
  flixPatrolMostWatched: FlixPatrolMostWatched[];
  flixPatrolMostHours: FlixPatrolMostHours[];
  dispatch: (event: NotificationEvent, payload: NotificationPayload) => Promise<void>;
  dryRun: boolean;
  listNamePrefix: string;
  appName: string;
  appVersion: string;
  signal?: AbortSignal;
}

export async function runPipeline(deps: RunPipelineDeps): Promise<RunSummary> {
  const dryRunTag = deps.dryRun ? '[DRY-RUN] ' : '';

  const enabledMostWatched = deps.flixPatrolMostWatched.filter((m) => m.enabled).length;
  const enabledMostHours = deps.flixPatrolMostHours.filter((m) => m.enabled).length;

  logger.debug(`Config loaded: ${deps.flixPatrolTop10.length} Top10, ${deps.flixPatrolPopulars.length} Popular, ${enabledMostWatched} MostWatched, ${enabledMostHours} MostHours, cache ${deps.cacheOptions.enabled ? 'enabled' : 'disabled'}`);

  logger.silly(`cacheOptions: ${JSON.stringify(deps.cacheOptions)}`);
  logger.silly(`traktOptions: ${JSON.stringify({...deps.traktOptions, clientId: 'REDACTED', clientSecret: 'REDACTED'})}`);
  logger.silly(`flixPatrolTop10: ${JSON.stringify(deps.flixPatrolTop10)}`);
  logger.silly(`flixPatrolPopulars: ${JSON.stringify(deps.flixPatrolPopulars)}`);
  logger.silly(`flixPatrolMostWatched: ${JSON.stringify(deps.flixPatrolMostWatched)}`);
  logger.silly(`flixPatrolMostHours: ${JSON.stringify(deps.flixPatrolMostHours)}`);

  const flixpatrol = new FlixPatrol(deps.cacheOptions);
  const trakt = new TraktAPI({ ...deps.traktOptions, dryRun: deps.dryRun });

  const totalLists = deps.flixPatrolTop10.length
    + deps.flixPatrolPopulars.length
    + enabledMostWatched
    + enabledMostHours;
  let currentList = 0;
  const runStartAt = Date.now();
  const summary: RunSummary = {
    listsProcessed: 0,
    moviesAdded: 0,
    showsAdded: 0,
    durationMs: 0,
  };

  await trakt.connect();

  // Fire-and-forget: do not block the pipeline on the notification round-trip.
  // The dispatch is tracked by the caller so it gets flushed before any process.exit
  // (even on a fast-failing run).
  void deps.dispatch('run_start', {
    title: `${dryRunTag}${deps.appName} v${deps.appVersion} run started`,
    body: `Processing ${totalLists} lists`,
    timestamp: new Date().toISOString(),
  });

  for (const top10 of deps.flixPatrolTop10) {
    currentList++;
    const defaultName = `${top10.platform}-${top10.location}-top10-${top10.fallback === false ? 'without-fallback' : `with-${top10.fallback}-fallback`}`;
    const baseListName = Utils.getListName(top10, defaultName, deps.listNamePrefix);
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
      if (deps.signal?.aborted) {
        logger.info('System: Graceful stop requested — halting after current Trakt write');
        return summary;
      }
      await trakt.pushToList(movies, baseListName, 'movie', top10.privacy);
      logger.info(`List ${baseListName} updated with ${movies.length} new movies`);
      summary.moviesAdded += movies.length;
    }
    if (shows.length > 0) {
      logger.info('==============================');
      if (rawCounts.shows > shows.length) {
        logger.warn(`Some shows from FlixPatrol could not be matched on Trakt (${rawCounts.shows} found, ${shows.length} matched)`);
      }
      logger.info(`Saving shows for "${baseListName}"`);
      logger.debug(`${top10.platform} shows: ${shows}`);
      if (deps.signal?.aborted) {
        logger.info('System: Graceful stop requested — halting after current Trakt write');
        return summary;
      }
      await trakt.pushToList(shows, baseListName, 'show', top10.privacy);
      logger.info(`List ${baseListName} updated with ${shows.length} new shows`);
      summary.showsAdded += shows.length;
    }
    summary.listsProcessed++;
  }


  for (const popular of deps.flixPatrolPopulars) {
    currentList++;
    const listName = Utils.getListName(popular, `${popular.platform}-popular`, deps.listNamePrefix);
    logger.info(`[${currentList}/${totalLists}] Processing "${listName}"`);

    if (popular.type === 'movies' || popular.type === 'both') {
      logger.info('==============================');
      logger.info(`Getting movies for "${listName}"`);
      const popularMovies = await flixpatrol.getPopular('Movies', popular, trakt);
      logger.debug(`${popular.platform} movies: ${popularMovies}`);
      if (deps.signal?.aborted) {
        logger.info('System: Graceful stop requested — halting after current Trakt write');
        return summary;
      }
      await trakt.pushToList(popularMovies, listName, 'movie', popular.privacy);
      logger.info(`List ${listName} updated with ${popularMovies.length} new movies`);
      summary.moviesAdded += popularMovies.length;
    }

    if (popular.type === 'shows' || popular.type === 'both') {
      logger.info('==============================');
      logger.info(`Getting shows for "${listName}"`);
      const popularShows = await flixpatrol.getPopular('TV Shows', popular, trakt);
      logger.debug(`${popular.platform} shows: ${popularShows}`);
      if (deps.signal?.aborted) {
        logger.info('System: Graceful stop requested — halting after current Trakt write');
        return summary;
      }
      await trakt.pushToList(popularShows, listName, 'show', popular.privacy);
      logger.info(`List ${listName} updated with ${popularShows.length} new shows`);
      summary.showsAdded += popularShows.length;
    }
    summary.listsProcessed++;
  }

  for (const mostWatched of deps.flixPatrolMostWatched) {
    if (mostWatched.enabled) {
      currentList++;
      let defaultName = `most-watched-${mostWatched.year}-netflix`;
      defaultName = mostWatched.original !== undefined ? `${defaultName}-original` : defaultName;
      defaultName = mostWatched.premiere !== undefined ? `${defaultName}-${mostWatched.premiere}-premiere` : defaultName;
      defaultName = mostWatched.country !== undefined ? `${defaultName}-from-${mostWatched.country}` : defaultName;
      const listName = Utils.getListName(mostWatched, defaultName, deps.listNamePrefix);
      logger.info(`[${currentList}/${totalLists}] Processing "${listName}"`);

      if (mostWatched.type === 'movies' || mostWatched.type === 'both') {
        logger.info('==============================');
        logger.info(`Getting movies for "${listName}"`);
        const mostWatchedMovies = await flixpatrol.getMostWatched('Movies', mostWatched, trakt);
        logger.debug(`most-watched movies: ${mostWatchedMovies}`);
        if (deps.signal?.aborted) {
          logger.info('System: Graceful stop requested — halting after current Trakt write');
          return summary;
        }
        await trakt.pushToList(mostWatchedMovies, listName, 'movie', mostWatched.privacy);
        logger.info(`List ${listName} updated with ${mostWatchedMovies.length} new movies`);
        summary.moviesAdded += mostWatchedMovies.length;
      }

      if (mostWatched.type === 'shows' || mostWatched.type === 'both') {
        logger.info('==============================');
        logger.info(`Getting shows for "${listName}"`);
        const mostWatchedShows = await flixpatrol.getMostWatched('TV Shows', mostWatched, trakt);
        logger.debug(`most-watched shows: ${mostWatchedShows}`);
        if (deps.signal?.aborted) {
          logger.info('System: Graceful stop requested — halting after current Trakt write');
          return summary;
        }
        await trakt.pushToList(mostWatchedShows, listName, 'show', mostWatched.privacy);
        logger.info(`List ${listName} updated with ${mostWatchedShows.length} new shows`);
        summary.showsAdded += mostWatchedShows.length;
      }
      summary.listsProcessed++;
    }
  }

  for (const mostHours of deps.flixPatrolMostHours) {
    if (mostHours.enabled) {
      currentList++;
      let defaultName = `netflix-most-hours-${mostHours.period}`;
      if (mostHours.language !== 'all') {
        defaultName += `-${mostHours.language}`;
      }
      const listName = Utils.getListName(mostHours, defaultName, deps.listNamePrefix);
      logger.info(`[${currentList}/${totalLists}] Processing "${listName}"`);

      if (mostHours.type === 'movies' || mostHours.type === 'both') {
        logger.info('==============================');
        logger.info(`Getting movies for "${listName}"`);
        const mostHoursMovies = await flixpatrol.getMostHours('Movies', mostHours, trakt);
        logger.debug(`most-hours-${mostHours.period} movies: ${mostHoursMovies}`);
        if (deps.signal?.aborted) {
          logger.info('System: Graceful stop requested — halting after current Trakt write');
          return summary;
        }
        await trakt.pushToList(mostHoursMovies, listName, 'movie', mostHours.privacy);
        logger.info(`List ${listName} updated with ${mostHoursMovies.length} new movies`);
        summary.moviesAdded += mostHoursMovies.length;
      }

      if (mostHours.type === 'shows' || mostHours.type === 'both') {
        logger.info('==============================');
        logger.info(`Getting shows for "${listName}"`);
        const mostHoursShows = await flixpatrol.getMostHours('TV Shows', mostHours, trakt);
        logger.debug(`most-hours-${mostHours.period} shows: ${mostHoursShows}`);
        if (deps.signal?.aborted) {
          logger.info('System: Graceful stop requested — halting after current Trakt write');
          return summary;
        }
        await trakt.pushToList(mostHoursShows, listName, 'show', mostHours.privacy);
        logger.info(`List ${listName} updated with ${mostHoursShows.length} new shows`);
        summary.showsAdded += mostHoursShows.length;
      }
      summary.listsProcessed++;
    }
  }

  summary.durationMs = Date.now() - runStartAt;
  const movedVerb = deps.dryRun ? 'would be added' : 'added';
  await deps.dispatch('run_end', {
    title: `${dryRunTag}${deps.appName} run finished`,
    body: `${dryRunTag}Processed ${summary.listsProcessed}/${totalLists} lists in ${Math.round(summary.durationMs / 1000)}s — ${summary.moviesAdded} movies / ${summary.showsAdded} shows ${movedVerb}`,
    timestamp: new Date().toISOString(),
    summary,
  });

  return summary;
}
