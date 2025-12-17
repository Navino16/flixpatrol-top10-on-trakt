import type {AxiosRequestConfig} from 'axios';
import axios from 'axios';
import axiosRetry from 'axios-retry';
import { JSDOM } from 'jsdom';
import Cache, { FileSystemCache } from 'file-system-cache';
import { logger, FlixPatrolError } from '../Utils';
import type { TraktTVId, TraktTVIds } from '../types';
import { TraktAPI } from '../Trakt';
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

// Configure axios-retry with exponential backoff
axiosRetry(axios, {
  retries: 3,
  retryDelay: axiosRetry.exponentialDelay,
  retryCondition: (error) => {
    return axiosRetry.isNetworkOrIdempotentRequestError(error)
      || error.response?.status === 429;
  },
  onRetry: (retryCount, error) => {
    logger.warn(`Retry attempt ${retryCount} for ${error.config?.url}: ${error.message}`);
  },
});

type FlixPatrolMatchResult = string;

export class FlixPatrol {
  private options: FlixPatrolOptions = {};

  private readonly tvCache: FileSystemCache | null = null;

  private readonly movieCache: FileSystemCache | null = null;

  constructor(cacheOptions: CacheOptions, options: FlixPatrolOptions = {}) {
    this.options.url = options.url || 'https://flixpatrol.com';
    this.options.agent = options.agent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36';
    if (cacheOptions.enabled) {
      this.tvCache = Cache({
        basePath: `${cacheOptions.savePath}/tv-shows`, // (optional) Path where cache files are stored (default).
        ns: 'flixpatrol-tv', // (optional) A grouping namespace for items.
        hash: 'sha1', // (optional) A hashing algorithm used within the cache key.
        ttl: cacheOptions.ttl, // (optional) A time-to-live (in secs) on how long an item remains cached.
      });
      this.movieCache = Cache({
        basePath: `${cacheOptions.savePath}/movies`, // (optional) Path where cache files are stored (default).
        ns: 'flixpatrol-movie', // (optional) A grouping namespace for items.
        hash: 'sha1', // (optional) A hashing algorithm used within the cache key.
        ttl: cacheOptions.ttl, // (optional) A time-to-live (in secs) on how long an item remains cached.
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
    const axiosConfig: AxiosRequestConfig = {
      headers: {
        'User-Agent': this.options.agent,
      },
      timeout: 30000,
    };

    try {
      const res = await axios.get(url, axiosConfig);
      logger.silly(`Status code: ${res.status}`);
      if (res.status !== 200) {
        return null;
      }
      return res.data;
    } catch (error) {
      logger.error(`Error getting flixPatrolHTMLPage: ${error}`);
      return null;
    }
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
    trakt: TraktAPI,
  ): Promise<{
    movies: TraktTVIds;
    shows: TraktTVIds;
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

    let movies: TraktTVIds = [];
    let moviesRaw: FlixPatrolMatchResult[] = [];
    if (config.type === 'movies' || config.type === 'both') {
      moviesRaw = config.kids
        ? FlixPatrol.parseTop10KidsPage('Movies', html)
        : FlixPatrol.parseTop10Page('Movies', config.location, html);
      movies = await this.convertResultsToIds(moviesRaw.slice(0, config.limit), 'Movies', trakt);
    }

    let shows: TraktTVIds = [];
    let showsRaw: FlixPatrolMatchResult[] = [];
    if (config.type === 'shows' || config.type === 'both') {
      showsRaw = config.kids
        ? FlixPatrol.parseTop10KidsPage('TV Shows', html)
        : FlixPatrol.parseTop10Page('TV Shows', config.location, html);
      shows = await this.convertResultsToIds(showsRaw.slice(0, config.limit), 'TV Shows', trakt);
    }

    if (movies.length === 0 && shows.length === 0 && config.fallback !== false && !config.kids) {
      // Fallback to world if no match (not applicable for kids)
      logger.warn(`No items found for ${config.platform}, falling back to ${config.fallback} search`);
      const newConfig: FlixPatrolTop10 = { ...config, location: config.fallback, fallback: false };
      return this.getTop10Sections(newConfig, trakt);
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

  // eslint-disable-next-line max-len
  private async getTraktTVId(result: FlixPatrolMatchResult, type: FlixPatrolType, trakt: TraktAPI) : Promise<TraktTVId> {
    if (this.tvCache !== null && this.movieCache !== null) {
      const id = type === 'Movies' ? await this.movieCache.get(result, null) : await this.tvCache.get(result, null);
      if (id) {
        logger.silly(`Found ${result} in cache. Id: ${id}`);
        return id;
      }
    }
    const html = await this.getFlixPatrolHTMLPage(result);
    if (html === null) {
      throw new FlixPatrolError(`Unable to get FlixPatrol detail page for ${result}`);
    }

    const dom = new JSDOM(html);
    // Title with fallback (kept)
    let title = dom.window.document.evaluate(
      '//div[contains(@class,"mb-6")]//h1[contains(@class,"mb-4")]/text()',
      dom.window.document,
      null,
      dom.window.XPathResult.STRING_TYPE,
      null,
    ).stringValue.trim();
    if (!title) {
      title = dom.window.document.evaluate(
        '//h1/text()',
        dom.window.document,
        null,
        dom.window.XPathResult.STRING_TYPE,
        null,
      ).stringValue.trim();
    }

    // Flexible type detection
    let flixType = dom.window.document.evaluate(
      '//div[contains(@class,"mb-6")]//span[contains(. ,"Movie") or contains(. ,"TV Show")][1]/text()',
      dom.window.document,
      null,
      dom.window.XPathResult.STRING_TYPE,
      null,
    ).stringValue.trim();
    if (!flixType) {
      const headerText = dom.window.document.querySelector('div.mb-6')?.textContent || '';
      if (/Movie/i.test(headerText)) flixType = 'Movie';
      else if (/TV Show/i.test(headerText)) flixType = 'TV Show';
    }

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

    const tryLookup = async (searchType: 'movie' | 'show'): Promise<TraktTVId> => {
      const looked = await trakt.getFirstItemByQuery(searchType, title, Number.isNaN(year) ? 0 : year);
      if (!looked) return null;
      return searchType === 'movie' ? looked.movie?.ids.trakt ?? null : looked.show?.ids.trakt ?? null;
    };

    let id: TraktTVId = null;
    if (type === 'Movies') {
      if (flixType === 'Movie' || !flixType) id = await tryLookup('movie');
    } else {
      if (flixType === 'TV Show' || !flixType) id = await tryLookup('show');
    }

    if (id && this.tvCache !== null && this.movieCache !== null) {
      if (type === 'Movies') await this.movieCache.set(result, id);
      else await this.tvCache.set(result, id);
    }
    return id;
  }

  private async convertResultsToIds(results: FlixPatrolMatchResult[], type: FlixPatrolType, trakt: TraktAPI) {
    const traktTVIds: TraktTVIds = [];

    for (const result of results) {
      const id = await this.getTraktTVId(result, type, trakt);
      if (id) {
        traktTVIds.push(id);
  }
    }
    return traktTVIds;
  }

  public async getPopular(
    type: FlixPatrolType,
    config: FlixPatrolPopular,
    trakt: TraktAPI,
  ): Promise<TraktTVIds> {
    const urlType = type === 'Movies' ? 'movies' : 'tv-shows';
    const html = await this.getFlixPatrolHTMLPage(`/popular/${urlType}/${config.platform}`);
    if (html === null) {
      throw new FlixPatrolError('Unable to get FlixPatrol popular page');
    }
    let results = FlixPatrol.parsePopularPage(html);
    results = results.slice(0, config.limit);
    return this.convertResultsToIds(results, type, trakt);
  }

  public async getMostWatched(
    type: FlixPatrolType,
    config: FlixPatrolMostWatched,
    trakt: TraktAPI,
  ): Promise<TraktTVIds> {
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
    return this.convertResultsToIds(results, type, trakt);
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
    trakt: TraktAPI,
  ): Promise<TraktTVIds> {
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
    return this.convertResultsToIds(results, type, trakt);
  }
}
