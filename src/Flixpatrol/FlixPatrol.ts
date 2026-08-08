import { JSDOM } from 'jsdom';
import Cache, { FileSystemCache } from 'file-system-cache';
import { Impit } from 'impit';
import { logger, FlixPatrolError } from '../Utils';
import type { MediaItem } from '../Targets';
import type { FlareSolverrClient } from '../FlareSolverr';
import type {
  FlixPatrolMostWatched,
  FlixPatrolMostHours,
  FlixPatrolMostHoursLanguage,
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

const RETRY_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);
const MAX_RETRIES = 3;

type FlixPatrolMatchResult = string;

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
      // A single, backend-agnostic cache: it stores what FlixPatrol says about the
      // media (title + year), not the identifier of one given platform.
      // New path and new namespace, so the 2.17 caches are ignored rather than
      // overwritten — a rollback still finds its own caches intact.
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

    // When FlareSolverr is configured, every request goes through it. We do not try
    // impit first: FlixPatrol currently answers 403 (cf-mitigated: challenge) to
    // any non-browser client, and making the bypass conditional on that exact
    // header would silently stop working if Cloudflare changed the signal.
    // No retry loop here — FlareSolverr retries internally, and wrapping a 12s
    // challenge solve in a 3x exponential backoff produces pathological runtimes.
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
          // Cloudflare sets cf-mitigated when it blocks or challenges a request, which is the
          // difference between "FlixPatrol is down" and "we got bot-blocked".
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

  private static parseTop10Page(
    type: FlixPatrolType,
    location: FlixPatrolTop10Location,
    html: string,
  ): FlixPatrolMatchResult[] {
    const expressions: string[] = [];
    if (location === 'world') {
      expressions.push(`//div[h2[span[contains(., "TOP ${type}")]]]/parent::div//a[contains(@class,'hover:underline')]/@href`);
    } else {
      // Original strict
      expressions.push(`//div[h3[text() = "TOP 10 ${type}"]]/parent::div//a[contains(@class,'hover:underline')]/@href`);
      // More tolerant headline match
      expressions.push(`//h3[contains(., "TOP 10") and contains(., "${type === 'Movies' ? 'Movies' : 'TV Shows'}")]/ancestor::div[1]/following-sibling::div[1]//a[contains(@class,'hover:underline')]/@href`);
      // Generic first tables fallback
      expressions.push(`((//table)[1] | (//table)[2])//a[contains(@class,'hover:underline')]/@href`);
    }
    for (const expr of expressions) {
      const res = FlixPatrol.parsePage(expr, html);
      if (res.length > 0){
        logger.silly(`Found ${res.length} ${type} in ${expr}`);
        return res;
      }
    }
    return [];
  }

  private static parseTop10KidsPage(
    type: FlixPatrolType,
    html: string,
  ): FlixPatrolMatchResult[] {
    const kidsType = type === 'Movies' ? 'Kids Movies' : 'Kids TV Shows';
    const expressions: string[] = [
      // Match h3 with "TOP 10 Kids Movies/TV Shows" followed by table
      `//h3[text() = "TOP 10 ${kidsType}"]/parent::div/following-sibling::table//a[@class="hover:underline"]/@href`,
      // Fallback with contains for more tolerance
      `//h3[contains(., "TOP 10") and contains(., "${kidsType}")]/parent::div/following-sibling::table//a[@class="hover:underline"]/@href`,
    ];

    for (const expr of expressions) {
      const res = FlixPatrol.parsePage(expr, html);
      if (res.length > 0) {
        logger.silly(`Found ${res.length} ${kidsType} in ${expr}`);
        return res;
      }
    }
    return [];
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
        ? FlixPatrol.parseTop10KidsPage('Movies', html)
        : FlixPatrol.parseTop10Page('Movies', config.location, html);
      movies = await this.convertResultsToItems(moviesRaw.slice(0, config.limit));
    }

    let shows: MediaItem[] = [];
    let showsRaw: FlixPatrolMatchResult[] = [];
    if (config.type === 'shows' || config.type === 'both') {
      showsRaw = config.kids
        ? FlixPatrol.parseTop10KidsPage('TV Shows', html)
        : FlixPatrol.parseTop10Page('TV Shows', config.location, html);
      shows = await this.convertResultsToItems(showsRaw.slice(0, config.limit));
    }

    // Behaviour change vs. 2.17: the fallback now triggers when the page yields no
    // result at all, no longer when no backend id could be resolved. A title listed
    // by FlixPatrol but unknown to the backend is reported as unmatched instead of
    // silently swapping the whole list for another location's.
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

  private static parsePopularPage(
    html: string,
  ): FlixPatrolMatchResult[] {
    const expression = '//table[@class="card-table"]//a[@class="flex gap-2 group items-center"]/@href';

    return FlixPatrol.parsePage(expression, html);
  }

  private static parseMostWatchedPage(
    html: string,
    config: FlixPatrolMostWatched
  ): FlixPatrolMatchResult[] {
    let expression = '//table[@class="card-table"]//a[@class="flex gap-2 group items-center"]/@href';
    if (config.original !== undefined && config.original) {
      expression = '//table[@class="card-table"]//a[@class="flex gap-2 group items-center"][.//svg]/@href'
    }

    return FlixPatrol.parsePage(expression, html);
  }

  private static parsePage(expression: string, html: string): FlixPatrolMatchResult[] {
    const dom = new JSDOM(html);
    const match = dom.window.document.evaluate(
      expression,
      dom.window.document,
      null,
      dom.window.XPathResult.UNORDERED_NODE_ITERATOR_TYPE,
      null,
    );
    const results: string[] = [];

    try {
      let p = match.iterateNext();
      while (p !== null) {
        if (p.textContent) {
          results.push(p.textContent);
        }
        p = match.iterateNext();
      }
    } catch (err) {
      logger.error(`Error parsing XPath: ${err}`);
      return [];
    }
    return results;
  }

  /**
   * Title as FlixPatrol prints it on a detail page.
   * The two expressions and their order are load-bearing against the live site:
   * do not touch them without re-checking a real detail page.
   */
  private static parseDetailTitle(dom: JSDOM): string {
    // Title with fallback (kept)
    const title = dom.window.document.evaluate(
      '//div[contains(@class,"mb-6")]//h1[contains(@class,"mb-4")]/text()',
      dom.window.document,
      null,
      dom.window.XPathResult.STRING_TYPE,
      null,
    ).stringValue.trim();
    if (title) {
      return title;
    }
    return dom.window.document.evaluate(
      '//h1/text()',
      dom.window.document,
      null,
      dom.window.XPathResult.STRING_TYPE,
      null,
    ).stringValue.trim();
  }

  /**
   * Release year, or null when the detail page exposes nothing usable.
   */
  private static parseDetailYear(dom: JSDOM): number | null {
    // Year with regex fallback
    let yearStr = dom.window.document.evaluate(
      '//div[@class="mb-6"]//span[5]/span/text()',
      dom.window.document,
      null,
      dom.window.XPathResult.STRING_TYPE,
      null,
    ).stringValue.trim();
    if (!/^(19|20)\d{2}$/.test(yearStr)) {
      const headerBlock = dom.window.document.querySelector('div.mb-6')?.textContent || '';
      const match = headerBlock.match(/(19|20)\d{2}/);
      if (match) yearStr = match[0];
    }
    const year = parseInt(yearStr, 10);
    return Number.isNaN(year) ? null : year;
  }

  private async getMediaItem(result: FlixPatrolMatchResult): Promise<MediaItem> {
    if (this.detailCache !== null) {
      const cached: unknown = await this.detailCache.get(result, null);
      if (cached && typeof cached === 'object' && 'title' in cached) {
        logger.silly(`Found ${result} in cache: ${JSON.stringify(cached)}`);
        return cached as MediaItem;
      }
    }

    const html = await this.getFlixPatrolHTMLPage(result);
    if (html === null) {
      throw new FlixPatrolError(`Unable to get FlixPatrol detail page for ${result}`);
    }

    const dom = new JSDOM(html);
    const title = FlixPatrol.parseDetailTitle(dom);
    const year = FlixPatrol.parseDetailYear(dom);
    const item: MediaItem = { title, year };

    // Never cache a titleless scrape: it would pin a parsing accident for the
    // whole TTL, while a re-scrape costs one page.
    if (title.length > 0 && this.detailCache !== null) {
      await this.detailCache.set(result, item);
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
    let results = FlixPatrol.parsePopularPage(html);
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
    let results = FlixPatrol.parseMostWatchedPage(html, config);
    results = results.slice(0, config.limit);
    return this.convertResultsToItems(results);
  }

  private static parseMostHoursPage(
    type: FlixPatrolType,
    language: FlixPatrolMostHoursLanguage,
    html: string,
  ): FlixPatrolMatchResult[] {
    const sectionId = type === 'Movies' ? 'toc-movies' : 'toc-tv-shows';
    const langMap: Record<FlixPatrolMostHoursLanguage, string> = {
      'all': 'all-languages',
      'english': 'english',
      'non-english': 'non-english',
    };
    const langTab = langMap[language];

    // For language-specific tables, we need to find the correct table within the section
    // The tables use x-show="isCurrent('all-languages')" etc.
    const expression = `//div[@id="${sectionId}"]//table[contains(@x-show, "'${langTab}'")]//a[@class="flex gap-2 group items-center"]/@href`;
    let results = FlixPatrol.parsePage(expression, html);

    // Fallback for 'total' period which doesn't have language tabs
    if (results.length === 0) {
      const fallbackExpr = `//div[@id="${sectionId}"]//table[@class="card-table"]//a[@class="flex gap-2 group items-center"]/@href`;
      results = FlixPatrol.parsePage(fallbackExpr, html);
    }

    return results;
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
    let results = FlixPatrol.parseMostHoursPage(type, config.language, html);
    results = results.slice(0, config.limit);
    return this.convertResultsToItems(results);
  }
}
