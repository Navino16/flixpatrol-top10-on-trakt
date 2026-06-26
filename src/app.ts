import { FlixPatrol } from './Flixpatrol';
import { logger, Utils, AppError, getPackageInfo } from './Utils';
import { NotificationManager } from './Notifications';
import type {
  NotificationEvent,
  NotificationPayload,
  RunSummary,
} from './Notifications';
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

const { name, version } = getPackageInfo();

logger.info('========================================');
logger.info(`${name} v${version}`);
logger.info(`Node.js ${process.version} on ${process.platform} (${process.arch})`);
logger.info(`Log level: ${logger.level}`);
logger.info('========================================');

const dryRun = process.env.DRY_RUN === 'true';
const listNamePrefix = process.env.LIST_NAME_PREFIX || '';
const dryRunTag = dryRun ? '[DRY-RUN] ' : '';

if (dryRun) {
  logger.info('========================================');
  logger.info('DRY-RUN MODE ENABLED');
  logger.info('No changes will be made to Trakt lists.');
  logger.info('========================================');
}

if (listNamePrefix) {
  logger.warn(`LIST_NAME_PREFIX "${listNamePrefix}" is active — list names will be prefixed`);
}

// Bootstrap order matters for error notifications:
//   1. ensureConfigExist() creates the default config when missing. If it throws
//      (disk full, no write permission), no notifier exists yet so the failure
//      cannot be notified — only logged.
//   2. NotificationManager is built next, synchronously. A broken Notifications
//      block in config.json also fails without a notification (we have no
//      working notifier to talk through). This is an architectural limit.
//   3. From this point on, every failure path can dispatch an 'error' notification.
Utils.ensureConfigExist();

let notifier: NotificationManager;
try {
  notifier = NotificationManager.fromConfig(GetAndValidateConfigs.getNotifications());
} catch (err) {
  logger.error(`${(err as Error).name}: ${(err as Error).message}`);
  process.exit(1);
}

// Track every dispatched notification so we can flush them before any
// process.exit — without this, fire-and-forget dispatches (run_start) and
// in-flight error dispatches can be cut off mid-flight.
const pendingDispatches = new Set<Promise<void>>();

function dispatch(event: NotificationEvent, payload: NotificationPayload): Promise<void> {
  const p = notifier.dispatch(event, payload);
  pendingDispatches.add(p);
  p.finally(() => pendingDispatches.delete(p));
  return p;
}

async function flushPendingDispatches(): Promise<void> {
  if (pendingDispatches.size === 0) return;
  await Promise.allSettled(Array.from(pendingDispatches));
}

// errorDispatchInFlight prevents the SIGINT handler from queuing a duplicate
// 'error' notification when the catch block is already dispatching one.
let errorDispatchInFlight = false;

async function dispatchErrorAndExit(err: unknown, exitCode = 1): Promise<never> {
  errorDispatchInFlight = true;
  try {
    await dispatch('error', {
      title: `${dryRunTag}${name} run failed`,
      body: `${(err as Error).name}: ${(err as Error).message}`,
      timestamp: new Date().toISOString(),
    });
  } finally {
    await flushPendingDispatches();
  }
  if (err instanceof AppError) {
    logger.error(`${err.name}: ${err.message}`);
  } else {
    logger.error(`Unexpected error: ${(err as Error).message}`);
  }
  process.exit(exitCode);
}

async function run(): Promise<void> {
  // Definite-assignment via `!`: each var is assigned inside the try; on a
  // throw the catch calls dispatchErrorAndExit which terminates the process,
  // so any access after the try implicitly runs only when the assignments
  // succeeded. TS's flow analysis cannot prove this across an awaited
  // Promise<never>, hence the assertion.
  let cacheOptions!: CacheOptions;
  let traktOptions!: TraktAPIOptions;
  let flixPatrolTop10!: FlixPatrolTop10[];
  let flixPatrolPopulars!: FlixPatrolPopular[];
  let flixPatrolMostWatched!: FlixPatrolMostWatched[];
  let flixPatrolMostHours!: FlixPatrolMostHours[];

  try {
    logger.info('Loading all configurations values');
    cacheOptions = GetAndValidateConfigs.getCacheOptions();
    traktOptions = GetAndValidateConfigs.getTraktOptions();
    flixPatrolTop10 = GetAndValidateConfigs.getFlixPatrolTop10();
    flixPatrolPopulars = GetAndValidateConfigs.getFlixPatrolPopular();
    flixPatrolMostWatched = GetAndValidateConfigs.getFlixPatrolMostWatched();
    flixPatrolMostHours = GetAndValidateConfigs.getFlixPatrolMostHours();
  } catch (err) {
    await dispatchErrorAndExit(err);
  }

  const enabledMostWatched = flixPatrolMostWatched.filter((m) => m.enabled).length;
  const enabledMostHours = flixPatrolMostHours.filter((m) => m.enabled).length;

  logger.debug(`Config loaded: ${flixPatrolTop10.length} Top10, ${flixPatrolPopulars.length} Popular, ${enabledMostWatched} MostWatched, ${enabledMostHours} MostHours, cache ${cacheOptions.enabled ? 'enabled' : 'disabled'}`);

  logger.silly(`cacheOptions: ${JSON.stringify(cacheOptions)}`);
  logger.silly(`traktOptions: ${JSON.stringify({...traktOptions, clientId: 'REDACTED', clientSecret: 'REDACTED'})}`);
  logger.silly(`flixPatrolTop10: ${JSON.stringify(flixPatrolTop10)}`);
  logger.silly(`flixPatrolPopulars: ${JSON.stringify(flixPatrolPopulars)}`);
  logger.silly(`flixPatrolMostWatched: ${JSON.stringify(flixPatrolMostWatched)}`);
  logger.silly(`flixPatrolMostHours: ${JSON.stringify(flixPatrolMostHours)}`);

  const flixpatrol = new FlixPatrol(cacheOptions);
  const trakt = new TraktAPI({ ...traktOptions, dryRun });

  const totalLists = flixPatrolTop10.length
    + flixPatrolPopulars.length
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

  try {
    await trakt.connect();

    // Fire-and-forget: do not block the pipeline on the notification round-trip.
    // The dispatch is tracked in pendingDispatches so it gets flushed before
    // any process.exit (even on a fast-failing run).
    void dispatch('run_start', {
      title: `${dryRunTag}${name} v${version} run started`,
      body: `Processing ${totalLists} lists`,
      timestamp: new Date().toISOString(),
    });

    for (const top10 of flixPatrolTop10) {
      currentList++;
      const defaultName = `${top10.platform}-${top10.location}-top10-${top10.fallback === false ? 'without-fallback' : `with-${top10.fallback}-fallback`}`;
      const baseListName = Utils.getListName(top10, defaultName, listNamePrefix);
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
        summary.moviesAdded += movies.length;
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
        summary.showsAdded += shows.length;
      }
      summary.listsProcessed++;
    }


    for (const popular of flixPatrolPopulars) {
      currentList++;
      const listName = Utils.getListName(popular, `${popular.platform}-popular`, listNamePrefix);
      logger.info(`[${currentList}/${totalLists}] Processing "${listName}"`);

      if (popular.type === 'movies' || popular.type === 'both') {
        logger.info('==============================');
        logger.info(`Getting movies for "${listName}"`);
        const popularMovies = await flixpatrol.getPopular('Movies', popular, trakt);
        logger.debug(`${popular.platform} movies: ${popularMovies}`);
        await trakt.pushToList(popularMovies, listName, 'movie', popular.privacy);
        logger.info(`List ${listName} updated with ${popularMovies.length} new movies`);
        summary.moviesAdded += popularMovies.length;
      }

      if (popular.type === 'shows' || popular.type === 'both') {
        logger.info('==============================');
        logger.info(`Getting shows for "${listName}"`);
        const popularShows = await flixpatrol.getPopular('TV Shows', popular, trakt);
        logger.debug(`${popular.platform} shows: ${popularShows}`);
        await trakt.pushToList(popularShows, listName, 'show', popular.privacy);
        logger.info(`List ${listName} updated with ${popularShows.length} new shows`);
        summary.showsAdded += popularShows.length;
      }
      summary.listsProcessed++;
    }

    for (const mostWatched of flixPatrolMostWatched) {
      if (mostWatched.enabled) {
        currentList++;
        let defaultName = `most-watched-${mostWatched.year}-netflix`;
        defaultName = mostWatched.original !== undefined ? `${defaultName}-original` : defaultName;
        defaultName = mostWatched.premiere !== undefined ? `${defaultName}-${mostWatched.premiere}-premiere` : defaultName;
        defaultName = mostWatched.country !== undefined ? `${defaultName}-from-${mostWatched.country}` : defaultName;
        const listName = Utils.getListName(mostWatched, defaultName, listNamePrefix);
        logger.info(`[${currentList}/${totalLists}] Processing "${listName}"`);

        if (mostWatched.type === 'movies' || mostWatched.type === 'both') {
          logger.info('==============================');
          logger.info(`Getting movies for "${listName}"`);
          const mostWatchedMovies = await flixpatrol.getMostWatched('Movies', mostWatched, trakt);
          logger.debug(`most-watched movies: ${mostWatchedMovies}`);
          await trakt.pushToList(mostWatchedMovies, listName, 'movie', mostWatched.privacy);
          logger.info(`List ${listName} updated with ${mostWatchedMovies.length} new movies`);
          summary.moviesAdded += mostWatchedMovies.length;
        }

        if (mostWatched.type === 'shows' || mostWatched.type === 'both') {
          logger.info('==============================');
          logger.info(`Getting shows for "${listName}"`);
          const mostWatchedShows = await flixpatrol.getMostWatched('TV Shows', mostWatched, trakt);
          logger.debug(`most-watched shows: ${mostWatchedShows}`);
          await trakt.pushToList(mostWatchedShows, listName, 'show', mostWatched.privacy);
          logger.info(`List ${listName} updated with ${mostWatchedShows.length} new shows`);
          summary.showsAdded += mostWatchedShows.length;
        }
        summary.listsProcessed++;
      }
    }

    for (const mostHours of flixPatrolMostHours) {
      if (mostHours.enabled) {
        currentList++;
        let defaultName = `netflix-most-hours-${mostHours.period}`;
        if (mostHours.language !== 'all') {
          defaultName += `-${mostHours.language}`;
        }
        const listName = Utils.getListName(mostHours, defaultName, listNamePrefix);
        logger.info(`[${currentList}/${totalLists}] Processing "${listName}"`);

        if (mostHours.type === 'movies' || mostHours.type === 'both') {
          logger.info('==============================');
          logger.info(`Getting movies for "${listName}"`);
          const mostHoursMovies = await flixpatrol.getMostHours('Movies', mostHours, trakt);
          logger.debug(`most-hours-${mostHours.period} movies: ${mostHoursMovies}`);
          await trakt.pushToList(mostHoursMovies, listName, 'movie', mostHours.privacy);
          logger.info(`List ${listName} updated with ${mostHoursMovies.length} new movies`);
          summary.moviesAdded += mostHoursMovies.length;
        }

        if (mostHours.type === 'shows' || mostHours.type === 'both') {
          logger.info('==============================');
          logger.info(`Getting shows for "${listName}"`);
          const mostHoursShows = await flixpatrol.getMostHours('TV Shows', mostHours, trakt);
          logger.debug(`most-hours-${mostHours.period} shows: ${mostHoursShows}`);
          await trakt.pushToList(mostHoursShows, listName, 'show', mostHours.privacy);
          logger.info(`List ${listName} updated with ${mostHoursShows.length} new shows`);
          summary.showsAdded += mostHoursShows.length;
        }
        summary.listsProcessed++;
      }
    }

    summary.durationMs = Date.now() - runStartAt;
    const movedVerb = dryRun ? 'would be added' : 'added';
    await dispatch('run_end', {
      title: `${dryRunTag}${name} run finished`,
      body: `${dryRunTag}Processed ${summary.listsProcessed}/${totalLists} lists in ${Math.round(summary.durationMs / 1000)}s — ${summary.moviesAdded} movies / ${summary.showsAdded} shows ${movedVerb}`,
      timestamp: new Date().toISOString(),
      summary,
    });
    await flushPendingDispatches();
  } catch (err) {
    await dispatchErrorAndExit(err);
  }
}

let shuttingDown = false;
process.on('SIGINT', async () => {
  if (shuttingDown) {
    logger.warn('System: Force exit on second SIGINT signal');
    process.exit(130);
  }
  shuttingDown = true;
  logger.info('System: Receive SIGINT signal');
  // If the catch block is already dispatching an error, don't queue a duplicate
  // — the user would receive two notifications ("run failed" + "run aborted")
  // for what is logically one incident.
  if (!errorDispatchInFlight) {
    await dispatch('error', {
      title: `${dryRunTag}${name} run aborted`,
      body: 'The run was interrupted by SIGINT',
      timestamp: new Date().toISOString(),
    });
  }
  await flushPendingDispatches();
  logger.info('System: Application stopped');
  process.exit();
});

run().catch((err: unknown) => {
  logger.error(`Unexpected bootstrap error: ${(err as Error).message}`);
  process.exit(1);
});
