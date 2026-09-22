import { FlixPatrol } from '../Flixpatrol';
import type {
  ListContent, ListPrivacy, ListTarget, MediaItem, MediaKind,
} from '../Targets';
import { MEDIA_KINDS } from '../Targets';
import { FlareSolverrClient } from '../FlareSolverr';
import { logger, Utils, FlixPatrolPageNotFoundError } from '../Utils';
import type {
  NotificationEvent, NotificationPayload, RunSummary,
} from '../Notifications';
import type {
  CacheOptions, FlareSolverrOptions, FlixPatrolConfigType, FlixPatrolMostWatched, FlixPatrolMostHours,
  FlixPatrolPopular, FlixPatrolTop10, FlixPatrolType, FlixPatrolWeekly,
} from '../types';

/** What every entry of the four twin blocks carries, whatever extra options it also has. */
interface ListBlockEntry {
  type: FlixPatrolConfigType;
  privacy: ListPrivacy;
  name?: string;
  normalizeName?: boolean;
}

/** One list block, reduced to the three things that actually differ between the four. */
interface ListBlock<T extends ListBlockEntry> {
  entries: T[];
  /** Absent means every entry is processed. */
  skip?: (entry: T) => boolean;
  defaultName: (entry: T) => string;
  scrape: (kind: FlixPatrolType, entry: T) => Promise<MediaItem[]>;
}

export interface RunPipelineDeps {
  cacheOptions: CacheOptions;
  /**
   * Built once by the caller so the daemon auth gate and every run share one adapter
   * instance, and therefore one resolution cache.
   */
  target: ListTarget;
  flixPatrolTop10: FlixPatrolTop10[];
  flixPatrolPopulars: FlixPatrolPopular[];
  flixPatrolMostWatched: FlixPatrolMostWatched[];
  flixPatrolMostHours: FlixPatrolMostHours[];
  flixPatrolWeekly: FlixPatrolWeekly[];
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
 * The session is created before any list so an unreachable container fails the run
 * immediately rather than midway, and destroyed in a `finally` — early abort paths
 * included — because a leaked session keeps a Chrome resident between daemon runs.
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

/** "3 movies" / "1 movie", so a single-item list never reads as "1 movies". */
function countLabel(count: number, kind: MediaKind): string {
  return `${count} ${kind}${count === 1 ? '' : 's'}`;
}

/** Names the kinds a list covers, for the line announcing its FlixPatrol scrape. */
function kindsLabel(type: FlixPatrolConfigType): string {
  if (type === 'movies') {
    return 'movies';
  }
  if (type === 'shows') {
    return 'shows';
  }
  return 'movies and shows';
}

/**
 * Amazon publishes no per-country weekly page. Shared by the counter and the loop so
 * `totalLists` and the loop's skip can never drift apart.
 */
function isAmazonCountryWeekly(weekly: FlixPatrolWeekly): boolean {
  return weekly.location !== 'world' && weekly.platform === 'amazon-prime';
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
  const enabledWeekly = deps.flixPatrolWeekly.filter((w) => w.enabled && !isAmazonCountryWeekly(w)).length;

  logger.debug(`Config loaded: ${deps.flixPatrolTop10.length} Top10, ${deps.flixPatrolPopulars.length} Popular, ${enabledMostWatched} MostWatched, ${enabledMostHours} MostHours, ${enabledWeekly} Weekly, cache ${deps.cacheOptions.enabled ? 'enabled' : 'disabled'}`);

  logger.silly(`cacheOptions: ${JSON.stringify(deps.cacheOptions)}`);
  // Only the backend name is logged: every other field of the target config is a
  // credential or an internal url.
  logger.silly(`target: ${JSON.stringify({ backend: deps.target.backend })}`);
  logger.silly(`flixPatrolTop10: ${JSON.stringify(deps.flixPatrolTop10)}`);
  logger.silly(`flixPatrolPopulars: ${JSON.stringify(deps.flixPatrolPopulars)}`);
  logger.silly(`flixPatrolMostWatched: ${JSON.stringify(deps.flixPatrolMostWatched)}`);
  logger.silly(`flixPatrolMostHours: ${JSON.stringify(deps.flixPatrolMostHours)}`);
  logger.silly(`flixPatrolWeekly: ${JSON.stringify(deps.flixPatrolWeekly)}`);

  const flixpatrol = new FlixPatrol(deps.cacheOptions, {}, flareSolverr);
  const { target } = deps;

  const totalLists = deps.flixPatrolTop10.length
    + deps.flixPatrolPopulars.length
    + enabledMostWatched
    + enabledMostHours
    + enabledWeekly;
  let currentList = 0;
  const runStartAt = Date.now();
  const summary: RunSummary = {
    listsProcessed: 0,
    moviesAdded: 0,
    showsAdded: 0,
    durationMs: 0,
    deadPaths: [],
  };

  /**
   * A `FlixPatrolPageNotFoundError` means that entry's FlixPatrol page is dead —
   * reported and skipped, entry left untouched, rather than aborting the other lists
   * still queued. Any other `FlixPatrolError` — typically a fetch failure — stays fatal,
   * since it would hit every list alike.
   */
  const skipIfDeadPath = async (listName: string, run: () => Promise<void>): Promise<boolean> => {
    try {
      await run();
      return false;
    } catch (err) {
      if (err instanceof FlixPatrolPageNotFoundError) {
        logger.error(`Skipping "${listName}": ${err.message}`);
        // The weekly index page is memoized per FlixPatrol instance: if it is the dead
        // page, every weekly entry re-throws the same path.
        if (!summary.deadPaths.includes(err.path)) {
          summary.deadPaths.push(err.path);
        }
        return true;
      }
      throw err;
    }
  };

  /**
   * Resolves the scraped items of one kind to backend ids.
   *
   * The gap between `items` and `ids` is resolution loss — the backend knows no match
   * for a title — which is a different failure from the scraping loss the callers report
   * from `rawCounts`, hence two separate warnings.
   *
   * Returns null when the kind must be left untouched.
   */
  const resolveSection = async (
    items: MediaItem[],
    kind: MediaKind,
    listName: string,
  ): Promise<string[] | null> => {
    // An empty scrape is never an instruction to empty the list. A dead FlixPatrol URL
    // answers 200 with a "Page Not Found" body, so nothing downstream can tell a chart
    // that is empty today from one whose page no longer exists. Omitting the key leaves
    // the kind untouched; only `getFlixPatrolHTMLPage`'s callers report a dead path.
    if (items.length === 0) {
      logger.warn(`FlixPatrol returned no ${kind} for "${listName}" — list left unchanged`);
      return null;
    }

    const ids = await target.resolveMany(items, kind);
    // Items scraped but nothing resolved means the backend is failing, not that the list
    // should be emptied — so return null and let the key be omitted, which spares this
    // kind while the other is still written. A genuinely empty scrape returns an empty
    // array instead, and does wipe the kind.
    if (items.length > 0 && ids.length === 0) {
      logger.warn(`None of the ${items.length} ${kind}s scraped from FlixPatrol could be matched on `
        + `${target.backend} — list "${listName}" left unchanged`);
      return null;
    }
    if (items.length > ids.length) {
      logger.warn(`Some ${kind}s from FlixPatrol could not be matched on ${target.backend} `
        + `(${items.length} found, ${ids.length} matched)`);
    }
    logger.info(`Resolved ${ids.length}/${countLabel(items.length, kind)} for "${listName}" on ${target.backend}`);
    logger.debug(`${listName} ${kind}s: ${describeItems(items)}`);
    return ids;
  };

  /**
   * Writes a list once with both kinds, so whatever the backend does per list rather
   * than per kind is paid a single time.
   *
   * Returns true when a shutdown signal arrived before the write, meaning nothing was
   * written and the run must stop.
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
    // One write per list puts the abort checkpoint between two lists, so a stop cannot
    // land between the movie half and the show half of the same list.
    if (await abortedBeforeWrite()) {
      return true;
    }
    await target.pushToList(content, listName, privacy);
    const written: string[] = [];
    for (const kind of kinds) {
      const count = (content[kind] as string[]).length;
      written.push(countLabel(count, kind));
      if (kind === 'movie') {
        summary.moviesAdded += count;
      } else {
        summary.showsAdded += count;
      }
    }
    const verb = deps.dryRun ? 'Would update' : 'Updated';
    logger.info(`${verb} "${listName}" with ${written.join(' and ')}`);
    return false;
  };

  /**
   * Runs one of the four blocks that share this exact shape. Top10 is deliberately not one
   * of them: its getter returns both kinds in a single call and reports scraping loss.
   *
   * Returns true when a shutdown signal stopped the run, so the caller returns the summary.
   */
  const processBlock = async <T extends ListBlockEntry>(block: ListBlock<T>): Promise<boolean> => {
    for (const entry of block.entries) {
      if (block.skip?.(entry) === true) continue;

      currentList++;
      const listName = Utils.getListName(entry, block.defaultName(entry), deps.listNamePrefix);
      logger.info('==============================');
      logger.info(`[${currentList}/${totalLists}] Processing "${listName}"`);
      logger.info(`Scraping FlixPatrol ${kindsLabel(entry.type)} for "${listName}"`);

      const content: ListContent = {};
      const skipped = await skipIfDeadPath(listName, async () => {
        if (entry.type === 'movies' || entry.type === 'both') {
          const items = await block.scrape('Movies', entry);
          const ids = await resolveSection(items, 'movie', listName);
          if (ids !== null) content.movie = ids;
        }

        if (entry.type === 'shows' || entry.type === 'both') {
          const items = await block.scrape('TV Shows', entry);
          const ids = await resolveSection(items, 'show', listName);
          if (ids !== null) content.show = ids;
        }
      });
      if (skipped) continue;
      if (await writeList(content, listName, entry.privacy)) return true;
      summary.listsProcessed++;
    }
    return false;
  };

  await target.connect();

  // Fire-and-forget so the pipeline never waits on a notification round-trip. The caller
  // tracks the dispatch and flushes it before any process.exit.
  void deps.dispatch('run_start', {
    title: `${dryRunTag}${deps.appName} v${deps.appVersion} run started`,
    body: `Processing ${totalLists} lists`,
    timestamp: new Date().toISOString(),
  });

  // Not a processBlock call: getTop10Sections returns both kinds in one call and reports
  // how many scraped items were dropped, which no other block does.
  for (const top10 of deps.flixPatrolTop10) {
    currentList++;
    const defaultName = `${top10.platform}-${top10.location}-top10-${top10.fallback === false ? 'without-fallback' : `with-${top10.fallback}-fallback`}`;
    const baseListName = Utils.getListName(top10, defaultName, deps.listNamePrefix);
    logger.info('==============================');
    logger.info(`[${currentList}/${totalLists}] Processing "${baseListName}"`);
    logger.info(`Scraping FlixPatrol ${kindsLabel(top10.type)} for "${baseListName}"`);

    const content: ListContent = {};
    const skipped = await skipIfDeadPath(baseListName, async () => {
      const { movies, shows, rawCounts } = await flixpatrol.getTop10Sections(top10);

      if (movies.length > 0) {
        if (rawCounts.movies > movies.length) {
          logger.warn(`Some movies scraped from FlixPatrol were dropped (${rawCounts.movies} found, ${movies.length} kept) — their detail page had no usable title, or they were duplicates`);
        }
        const ids = await resolveSection(movies, 'movie', baseListName);
        if (ids !== null) content.movie = ids;
      }
      if (shows.length > 0) {
        if (rawCounts.shows > shows.length) {
          logger.warn(`Some shows scraped from FlixPatrol were dropped (${rawCounts.shows} found, ${shows.length} kept) — their detail page had no usable title, or they were duplicates`);
        }
        const ids = await resolveSection(shows, 'show', baseListName);
        if (ids !== null) content.show = ids;
      }
    });
    if (skipped) continue;
    if (await writeList(content, baseListName, top10.privacy)) return summary;
    summary.listsProcessed++;
  }


  if (await processBlock({
    entries: deps.flixPatrolPopulars,
    defaultName: (popular) => `${popular.platform}-popular`,
    scrape: (kind, popular) => flixpatrol.getPopular(kind, popular),
  })) return summary;

  if (await processBlock({
    entries: deps.flixPatrolMostWatched,
    skip: (mostWatched) => !mostWatched.enabled,
    defaultName: (mostWatched) => {
      let name = `most-watched-${mostWatched.year}-netflix`;
      name = mostWatched.genre !== undefined ? `${name}-${mostWatched.genre}` : name;
      name = mostWatched.original !== undefined ? `${name}-original` : name;
      name = mostWatched.premiere !== undefined ? `${name}-${mostWatched.premiere}-premiere` : name;
      name = mostWatched.country !== undefined ? `${name}-from-${mostWatched.country}` : name;
      return name;
    },
    scrape: (kind, mostWatched) => flixpatrol.getMostWatched(kind, mostWatched),
  })) return summary;

  if (await processBlock({
    entries: deps.flixPatrolMostHours,
    skip: (mostHours) => !mostHours.enabled,
    defaultName: (mostHours) => {
      const name = `netflix-most-hours-${mostHours.period}`;
      return mostHours.language === 'all' ? name : `${name}-${mostHours.language}`;
    },
    scrape: (kind, mostHours) => flixpatrol.getMostHours(kind, mostHours),
  })) return summary;

  if (await processBlock({
    entries: deps.flixPatrolWeekly,
    // checkTargetCompatibility already warned about the amazon-prime + country combination
    // at config-validation time, so it is skipped silently here.
    skip: (weekly) => !weekly.enabled || isAmazonCountryWeekly(weekly),
    defaultName: (weekly) => (weekly.location !== 'world'
      ? `${weekly.platform}-weekly-${weekly.location}`
      : `${weekly.platform}-weekly${weekly.language === 'all' ? '' : `-${weekly.language}`}`),
    scrape: (kind, weekly) => flixpatrol.getWeekly(kind, weekly),
  })) return summary;

  summary.durationMs = Date.now() - runStartAt;
  const movedVerb = deps.dryRun ? 'would be added' : 'added';
  const deadPathsSuffix = summary.deadPaths.length > 0
    ? ` — ${summary.deadPaths.length} dead path(s) skipped: ${summary.deadPaths.join('; ')}`
    : '';
  await deps.dispatch('run_end', {
    title: `${dryRunTag}${deps.appName} run finished`,
    body: `${dryRunTag}Processed ${summary.listsProcessed}/${totalLists} lists in ${Math.round(summary.durationMs / 1000)}s — ${summary.moviesAdded} movies / ${summary.showsAdded} shows ${movedVerb}${deadPathsSuffix}`,
    timestamp: new Date().toISOString(),
    summary,
  });

  return summary;
}
