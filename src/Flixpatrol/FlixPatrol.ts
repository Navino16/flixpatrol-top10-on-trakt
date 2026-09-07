import Cache, { FileSystemCache } from 'file-system-cache';
import { Impit } from 'impit';
import { logger, FlixPatrolError } from '../Utils';
import type { MediaItem } from '../Targets';
import type { FlareSolverrClient } from '../FlareSolverr';
import type {
  FlixPatrolMostWatched,
  FlixPatrolMostHours,
  FlixPatrolPopular,
  FlixPatrolTop10,
  CacheOptions,
  FlixPatrolOptions,
  FlixPatrolTop10Location,
  FlixPatrolTop10Platform,
  FlixPatrolPopularPlatform,
  FlixPatrolConfigType,
  FlixPatrolType,
} from '../types';
import {
  flixpatrolTop10Location,
  flixpatrolTop10Platform,
  flixpatrolPopularPlatform,
  flixpatrolConfigType,
} from '../types';
import type { FlixPatrolMatchResult } from './parse';
import {
  parseDetailPage,
  parseMostHoursPage,
  parseMostWatchedPage,
  parsePopularPage,
  parseTop10KidsPage,
  parseTop10Page,
  toCanonicalTitlePath,
} from './parse';

const RETRY_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);
const MAX_RETRIES = 3;

export class FlixPatrol {
  private options: FlixPatrolOptions = {};

  private readonly detailCache: FileSystemCache | null = null;

  private readonly impit: Impit;

  private readonly flareSolverr?: FlareSolverrClient;

  constructor(
    cacheOptions: CacheOptions,
    options: FlixPatrolOptions = {},
    flareSolverr?: FlareSolverrClient,
  ) {
    this.options.url = options.url || 'https://flixpatrol.com';
    // Use Impit with Chrome browser impersonation to bypass Cloudflare's TLS fingerprint check.
    this.impit = new Impit({ browser: 'chrome', timeout: 30000 });
    this.flareSolverr = flareSolverr;
    if (cacheOptions.enabled) {
      // One backend-agnostic cache, storing what FlixPatrol says about the media
      // (title + year) rather than any platform's identifier. Its own path and
      // namespace, so caches written by an older version are neither read nor
      // overwritten and a rollback still finds its own intact.
      this.detailCache = Cache({
        basePath: `${cacheOptions.savePath}/details`,
        ns: 'flixpatrol-detail',
        hash: 'sha1',
        ttl: cacheOptions.ttl,
      });
    }
  }

  // eslint-disable-next-line max-len
  public static isFlixPatrolTop10Location = (x: string): x is FlixPatrolTop10Location => (flixpatrolTop10Location as readonly string[]).includes(x);

  // eslint-disable-next-line max-len
  public static isFlixPatrolTop10Platform = (x: string): x is FlixPatrolTop10Platform => (flixpatrolTop10Platform as readonly string[]).includes(x);

  // eslint-disable-next-line max-len
  public static isFlixPatrolPopularPlatform = (x: string): x is FlixPatrolPopularPlatform => (flixpatrolPopularPlatform as readonly string[]).includes(x);

  // eslint-disable-next-line max-len
  public static isFlixPatrolType = (x: string): x is FlixPatrolConfigType => (flixpatrolConfigType as readonly string[]).includes(x);

  /**
   * Get one FlixPatrol HTML page and return it as a string
   * @private
   * @param path
   */
  public async getFlixPatrolHTMLPage(path: string): Promise<string | null> {
    const url = `${this.options.url}${path}`;
    logger.silly(`Accessing URL: ${url}`);

    // When FlareSolverr is configured every request goes through it, with no attempt at
    // impit first: making the bypass conditional on the exact `cf-mitigated` header would
    // silently stop working the day Cloudflare changed that signal. No retry loop either,
    // since FlareSolverr retries internally and wrapping a slow challenge solve in an
    // exponential backoff produces pathological runtimes.
    if (this.flareSolverr) {
      return this.flareSolverr.get(url);
    }

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
      try {
        const res = await this.impit.fetch(url);
        logger.debug(`Status code: ${res.status} for ${url}`);
        if (res.status === 200) {
          return await res.text();
        }
        if (!RETRY_STATUS_CODES.has(res.status) || attempt === MAX_RETRIES) {
          // Cloudflare sets cf-mitigated when it blocks or challenges a request, which
          // separates "FlixPatrol is down" from "we got bot-blocked".
          const cfMitigated = res.headers?.get('cf-mitigated');
          const cfSuffix = cfMitigated ? ` (cf-mitigated: ${cfMitigated})` : '';
          logger.error(`Giving up on ${url}: HTTP ${res.status}${cfSuffix}`);
          return null;
        }
        logger.warn(`Retry attempt ${attempt} for ${url}: HTTP ${res.status}`);
      } catch (error) {
        if (attempt === MAX_RETRIES) {
          logger.error(`Error getting flixPatrolHTMLPage: ${error}`);
          return null;
        }
        const message = error instanceof Error ? error.message : String(error);
        logger.warn(`Retry attempt ${attempt} for ${url}: ${message}`);
      }
      // Exponential backoff: 1s, 2s, 4s
      await new Promise((resolve) => { setTimeout(resolve, 2 ** (attempt - 1) * 1000); });
    }
    return null;
  }

  public async getTop10Sections(
    config: FlixPatrolTop10,
  ): Promise<{
    movies: MediaItem[];
    shows: MediaItem[];
    rawCounts: { movies: number; shows: number; }
  }> {
    // Validate kids configuration
    if (config.kids) {
      if (config.platform !== 'netflix') {
        logger.warn(`Kids lists are only available on Netflix, but platform is "${config.platform}". Skipping.`);
        return { movies: [], shows: [], rawCounts: { movies: 0, shows: 0 } };
      }
      if (config.location === 'world') {
        logger.warn('Kids lists are not available for worldwide. Please specify a country. Skipping.');
        return { movies: [], shows: [], rawCounts: { movies: 0, shows: 0 } };
      }
    }

    const html = await this.getFlixPatrolHTMLPage(`/top10/${config.platform}/${config.location}`);
    if (html === null) {
      throw new FlixPatrolError('Unable to get FlixPatrol top10 page');
    }

    let movies: MediaItem[] = [];
    let moviesRaw: FlixPatrolMatchResult[] = [];
    if (config.type === 'movies' || config.type === 'both') {
      moviesRaw = config.kids
        ? parseTop10KidsPage('Movies', html)
        : parseTop10Page('Movies', config.location, html);
      movies = await this.convertResultsToItems(moviesRaw.slice(0, config.limit));
    }

    let shows: MediaItem[] = [];
    let showsRaw: FlixPatrolMatchResult[] = [];
    if (config.type === 'shows' || config.type === 'both') {
      showsRaw = config.kids
        ? parseTop10KidsPage('TV Shows', html)
        : parseTop10Page('TV Shows', config.location, html);
      shows = await this.convertResultsToItems(showsRaw.slice(0, config.limit));
    }

    // The fallback triggers only when the page yields no result at all, never when the
    // backend failed to resolve one: a title FlixPatrol lists but the backend does not
    // know is reported unmatched rather than swapping the whole list for another
    // location's.
    if (movies.length === 0 && shows.length === 0 && config.fallback !== false && !config.kids) {
      // Fallback to world if no match (not applicable for kids)
      logger.warn(`No items found for ${config.platform}, falling back to ${config.fallback} search`);
      const newConfig: FlixPatrolTop10 = { ...config, location: config.fallback, fallback: false };
      return this.getTop10Sections(newConfig);
    }

    return {
      movies,
      shows,
      rawCounts: {
        movies: Math.min(moviesRaw.length, config.limit),
        shows: Math.min(showsRaw.length, config.limit),
      }
    };
  }

  /**
   * Narrows an arbitrary cached payload to a MediaItem, validating the whole shape rather
   * than casting on one key: a hand-edited or half-written cache file must miss, not
   * poison every run until the TTL expires.
   */
  private static isMediaItem(value: unknown): value is MediaItem {
    if (value === null || typeof value !== 'object') return false;
    const candidate = value as Partial<Record<keyof MediaItem, unknown>>;
    if (typeof candidate.title !== 'string' || candidate.title.length === 0) return false;
    return candidate.year === null || typeof candidate.year === 'number';
  }

  private async getMediaItem(result: FlixPatrolMatchResult): Promise<MediaItem> {
    // Single choke point for every detail-page path, so only the canonical
    // `/title/<slug>/` page is ever fetched. Canonicalising here rather than in each
    // getter means a listing family added later cannot reintroduce the sub-page title
    // bug by forgetting to opt in.
    //
    // Deliberately before the cache lookup: the cache is keyed on the path, so the
    // sub-page and canonical spellings of one media share a single entry instead of
    // being stored and fetched once per link shape.
    const path = toCanonicalTitlePath(result);

    if (this.detailCache !== null) {
      const cached: unknown = await this.detailCache.get(path, null);
      if (FlixPatrol.isMediaItem(cached)) {
        logger.silly(`Found ${path} in cache: ${JSON.stringify(cached)}`);
        return cached;
      }
    }

    const html = await this.getFlixPatrolHTMLPage(path);
    if (html === null) {
      throw new FlixPatrolError(`Unable to get FlixPatrol detail page for ${path}`);
    }

    const { title, year } = parseDetailPage(html);
    const item: MediaItem = { title, year };

    // Only a fully successful parse is cached. The year is what disambiguates the later
    // backend search, so persisting a missing one would degrade every match for the whole
    // TTL after a single transient markup drift. A miss costs one re-scrape.
    if (title.length > 0 && year !== null && this.detailCache !== null) {
      await this.detailCache.set(path, item);
    }
    return item;
  }

  private async convertResultsToItems(results: FlixPatrolMatchResult[]): Promise<MediaItem[]> {
    const items: MediaItem[] = [];
    for (const result of results) {
      const item = await this.getMediaItem(result);
      if (item.title.length > 0 && !items.some((i) => i.title === item.title && i.year === item.year)) {
        items.push(item);
      }
    }
    return items;
  }

  public async getPopular(
    type: FlixPatrolType,
    config: FlixPatrolPopular,
  ): Promise<MediaItem[]> {
    const urlType = type === 'Movies' ? 'movies' : 'tv-shows';
    const html = await this.getFlixPatrolHTMLPage(`/popular/${urlType}/${config.platform}`);
    if (html === null) {
      throw new FlixPatrolError('Unable to get FlixPatrol popular page');
    }
    let results = parsePopularPage(html);
    results = results.slice(0, config.limit);
    return this.convertResultsToItems(results);
  }

  public async getMostWatched(
    type: FlixPatrolType,
    config: FlixPatrolMostWatched,
  ): Promise<MediaItem[]> {
    const urlType = type === 'Movies' ? 'movies' : 'tv-shows';
    let url = `/most-watched/${config.year}/${urlType}`;
    if (config.country !== undefined) {
      url += `-from-${config.country}`;
    }
    if (config.premiere !== undefined && config.premiere) {
      url += `-${config.premiere}`;
    }
    if (type !== 'Movies') {
      url += '-grouped';
    }
    if (config.orderByViews !== undefined && config.orderByViews) {
      url += '/by-views';
    }

    const html = await this.getFlixPatrolHTMLPage(url);
    if (html === null) {
      throw new FlixPatrolError('Unable to get FlixPatrol most-watched page');
    }
    let results = parseMostWatchedPage(html, config.original !== undefined && config.original);
    results = results.slice(0, config.limit);
    return this.convertResultsToItems(results);
  }

  public async getMostHours(
    type: FlixPatrolType,
    config: FlixPatrolMostHours,
  ): Promise<MediaItem[]> {
    const periodUrlMap: Record<string, string> = {
      'total': '/streaming-services/most-hours-total/netflix/',
      'first-week': '/streaming-services/most-hours-first-week/netflix/',
      'first-month': '/streaming-services/most-hours-first-month/netflix/',
    };
    const url = periodUrlMap[config.period];

    const html = await this.getFlixPatrolHTMLPage(url);
    if (html === null) {
      throw new FlixPatrolError(`Unable to get FlixPatrol most-hours-${config.period} page`);
    }
    let results = parseMostHoursPage(type, config.language, html);
    results = results.slice(0, config.limit);
    return this.convertResultsToItems(results);
  }
}
