import { FlixPatrol } from '../Flixpatrol';
import type {
  ListContent, ListPrivacy, ListTarget, MediaItem, MediaKind,
} from '../Targets';
import { MEDIA_KINDS } from '../Targets';
import { FlareSolverrClient } from '../FlareSolverr';
import { logger, Utils } from '../Utils';
import type {
  NotificationEvent, NotificationPayload, RunSummary,
} from '../Notifications';
import type {
  CacheOptions, FlareSolverrOptions, FlixPatrolMostWatched, FlixPatrolMostHours,
  FlixPatrolPopular, FlixPatrolTop10,
} from '../types';

export interface RunPipelineDeps {
  cacheOptions: CacheOptions;
  /**
   * Built once by the caller (app.ts) so the daemon auth gate and every run
   * share a single adapter instance — and therefore a single resolution cache.
   */
  target: ListTarget;
  flixPatrolTop10: FlixPatrolTop10[];
  flixPatrolPopulars: FlixPatrolPopular[];
  flixPatrolMostWatched: FlixPatrolMostWatched[];
  flixPatrolMostHours: FlixPatrolMostHours[];
  flareSolverrOptions?: FlareSolverrOptions;
  dispatch: (event: NotificationEvent, payload: NotificationPayload) => Promise<void>;
  dryRun: boolean;
  listNamePrefix: string;
  appName: string;
  appVersion: string;
  signal?: AbortSignal;
}

/**
 * Owns the FlareSolverr session lifetime, which is exactly one run.
 *
 * createSession() runs before any list is processed so an unreachable container
 * fails the run immediately instead of midway through. destroySession() runs in a
 * finally — including on the early `return summary` abort paths — because a leaked
 * session keeps a Chrome resident in the container between runs in daemon mode.
 */
export async function runPipeline(deps: RunPipelineDeps): Promise<RunSummary> {
  const flareSolverr = deps.flareSolverrOptions?.enabled
    ? new FlareSolverrClient(deps.flareSolverrOptions)
    : undefined;

  if (flareSolverr) {
    await flareSolverr.createSession();
  }
  try {
    return await executeRun(deps, flareSolverr);
  } finally {
    if (flareSolverr) {
      await flareSolverr.destroySession();
    }
  }
}

function describeItems(items: MediaItem[]): string {
  return items.map((item) => (item.year === null ? item.title : `${item.title} (${item.year})`)).join(', ');
}

async function executeRun(deps: RunPipelineDeps, flareSolverr?: FlareSolverrClient): Promise<RunSummary> {
  const dryRunTag = deps.dryRun ? '[DRY-RUN] ' : '';

  const abortedBeforeWrite = async (): Promise<boolean> => {
    if (!deps.signal?.aborted) {
      return false;
    }
    logger.info('System: Graceful stop requested — halting after current list write');
    await deps.dispatch('error', {
      title: `${dryRunTag}${deps.appName} run interrupted`,
      body: 'The run was interrupted by a shutdown signal (SIGTERM/SIGINT)',
      timestamp: new Date().toISOString(),
    });
    return true;
  };

  const enabledMostWatched = deps.flixPatrolMostWatched.filter((m) => m.enabled).length;
  const enabledMostHours = deps.flixPatrolMostHours.filter((m) => m.enabled).length;

  logger.debug(`Config loaded: ${deps.flixPatrolTop10.length} Top10, ${deps.flixPatrolPopulars.length} Popular, ${enabledMostWatched} MostWatched, ${enabledMostHours} MostHours, cache ${deps.cacheOptions.enabled ? 'enabled' : 'disabled'}`);

  logger.silly(`cacheOptions: ${JSON.stringify(deps.cacheOptions)}`);
  // Only the backend name is logged: every other field of the target config is a
  // credential (token, apiKey, clientSecret) or an internal url.
  logger.silly(`target: ${JSON.stringify({ backend: deps.target.backend })}`);
  logger.silly(`flixPatrolTop10: ${JSON.stringify(deps.flixPatrolTop10)}`);
  logger.silly(`flixPatrolPopulars: ${JSON.stringify(deps.flixPatrolPopulars)}`);
  logger.silly(`flixPatrolMostWatched: ${JSON.stringify(deps.flixPatrolMostWatched)}`);
  logger.silly(`flixPatrolMostHours: ${JSON.stringify(deps.flixPatrolMostHours)}`);

  const flixpatrol = new FlixPatrol(deps.cacheOptions, {}, flareSolverr);
  const { target } = deps;

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

  /**
   * Resolves the scraped items of one kind to backend ids.
   *
   * The gap between `items` and `ids` is the *resolution* loss (the backend has no
   * match for a title): it is distinct from the scraping loss reported by the
   * callers from `rawCounts`, so both are warned about separately.
   *
   * Returns null when the kind must be LEFT UNTOUCHED, which the caller expresses
   * by omitting its key from the ListContent it hands to pushToList.
   */
  const resolveSection = async (
    items: MediaItem[],
    kind: MediaKind,
    listName: string,
  ): Promise<string[] | null> => {
    const ids = await target.resolveMany(items, kind);
    // pushToList REPLACES the content of every kind whose key is present, so
    // handing it an empty array wipes that kind. A scrape that produced items but
    // resolved to nothing means the backend is failing (outage, expired key, bad
    // search day), not that the list should be emptied — hence null, so the key
    // is omitted and the kind survives untouched while the other one is still
    // written. A genuinely empty scrape is a different case and keeps its
    // previous behaviour: an empty array, hence a wipe of that kind.
    if (items.length > 0 && ids.length === 0) {
      logger.warn(`None of the ${items.length} ${kind}s scraped from FlixPatrol could be matched on `
        + `${target.backend} — list "${listName}" left unchanged`);
      return null;
    }
    if (items.length > ids.length) {
      logger.warn(`Some ${kind}s from FlixPatrol could not be matched on ${target.backend} `
        + `(${items.length} found, ${ids.length} matched)`);
    }
    logger.info(`Saving ${kind}s for "${listName}"`);
    logger.debug(`${listName} ${kind}s: ${describeItems(items)}`);
    return ids;
  };

  /**
   * Writes a list ONCE, both kinds included, so everything the backend does per
   * list rather than per kind is paid a single time.
   *
   * Returns true when a shutdown signal was seen before the write, in which case
   * nothing was written and the caller must stop the run.
   */
  const writeList = async (
    content: ListContent,
    listName: string,
    privacy: ListPrivacy,
  ): Promise<boolean> => {
    const kinds = MEDIA_KINDS.filter((kind) => content[kind] !== undefined);
    if (kinds.length === 0) {
      return false;
    }
    // With a single write per list the abort checkpoint naturally sits between
    // two lists: a stop can no longer land between the movie half and the show
    // half of the same list.
    if (await abortedBeforeWrite()) {
      return true;
    }
    await target.pushToList(content, listName, privacy);
    for (const kind of kinds) {
      const count = (content[kind] as string[]).length;
      logger.info(`List ${listName} updated with ${count} new ${kind}s`);
      if (kind === 'movie') {
        summary.moviesAdded += count;
      } else {
        summary.showsAdded += count;
      }
    }
    return false;
  };

  await target.connect();

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

    const { movies, shows, rawCounts } = await flixpatrol.getTop10Sections(top10);

    const content: ListContent = {};
    if (movies.length > 0) {
      logger.info('==============================');
      // Scraping loss: a detail page without a usable title, or a duplicate
      // (title, year) already collected from another row of the same page.
      if (rawCounts.movies > movies.length) {
        logger.warn(`Some movies scraped from FlixPatrol were dropped (${rawCounts.movies} found, ${movies.length} kept) — their detail page had no usable title, or they were duplicates`);
      }
      const ids = await resolveSection(movies, 'movie', baseListName);
      if (ids !== null) content.movie = ids;
    }
    if (shows.length > 0) {
      logger.info('==============================');
      if (rawCounts.shows > shows.length) {
        logger.warn(`Some shows scraped from FlixPatrol were dropped (${rawCounts.shows} found, ${shows.length} kept) — their detail page had no usable title, or they were duplicates`);
      }
      const ids = await resolveSection(shows, 'show', baseListName);
      if (ids !== null) content.show = ids;
    }
    if (await writeList(content, baseListName, top10.privacy)) return summary;
    summary.listsProcessed++;
  }


  for (const popular of deps.flixPatrolPopulars) {
    currentList++;
    const listName = Utils.getListName(popular, `${popular.platform}-popular`, deps.listNamePrefix);
    logger.info(`[${currentList}/${totalLists}] Processing "${listName}"`);

    const content: ListContent = {};
    if (popular.type === 'movies' || popular.type === 'both') {
      logger.info('==============================');
      logger.info(`Getting movies for "${listName}"`);
      const popularMovies = await flixpatrol.getPopular('Movies', popular);
      const ids = await resolveSection(popularMovies, 'movie', listName);
      if (ids !== null) content.movie = ids;
    }

    if (popular.type === 'shows' || popular.type === 'both') {
      logger.info('==============================');
      logger.info(`Getting shows for "${listName}"`);
      const popularShows = await flixpatrol.getPopular('TV Shows', popular);
      const ids = await resolveSection(popularShows, 'show', listName);
      if (ids !== null) content.show = ids;
    }
    if (await writeList(content, listName, popular.privacy)) return summary;
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

      const content: ListContent = {};
      if (mostWatched.type === 'movies' || mostWatched.type === 'both') {
        logger.info('==============================');
        logger.info(`Getting movies for "${listName}"`);
        const mostWatchedMovies = await flixpatrol.getMostWatched('Movies', mostWatched);
        const ids = await resolveSection(mostWatchedMovies, 'movie', listName);
        if (ids !== null) content.movie = ids;
      }

      if (mostWatched.type === 'shows' || mostWatched.type === 'both') {
        logger.info('==============================');
        logger.info(`Getting shows for "${listName}"`);
        const mostWatchedShows = await flixpatrol.getMostWatched('TV Shows', mostWatched);
        const ids = await resolveSection(mostWatchedShows, 'show', listName);
        if (ids !== null) content.show = ids;
      }
      if (await writeList(content, listName, mostWatched.privacy)) return summary;
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

      const content: ListContent = {};
      if (mostHours.type === 'movies' || mostHours.type === 'both') {
        logger.info('==============================');
        logger.info(`Getting movies for "${listName}"`);
        const mostHoursMovies = await flixpatrol.getMostHours('Movies', mostHours);
        const ids = await resolveSection(mostHoursMovies, 'movie', listName);
        if (ids !== null) content.movie = ids;
      }

      if (mostHours.type === 'shows' || mostHours.type === 'both') {
        logger.info('==============================');
        logger.info(`Getting shows for "${listName}"`);
        const mostHoursShows = await flixpatrol.getMostHours('TV Shows', mostHours);
        const ids = await resolveSection(mostHoursShows, 'show', listName);
        if (ids !== null) content.show = ids;
      }
      if (await writeList(content, listName, mostHours.privacy)) return summary;
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
