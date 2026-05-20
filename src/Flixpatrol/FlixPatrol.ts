import { JSDOM } from 'jsdom';
import Cache, { FileSystemCache } from 'file-system-cache';
import { Impit } from 'impit';
import { logger, FlixPatrolError } from '../Utils';
import type { TraktTVId, TraktTVIds, TmdbMediaItems, TmdbMediaItem } from '../types';
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

const RETRY_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);
const MAX_RETRIES = 3;

type FlixPatrolMatchResult = string;

export class FlixPatrol {
  private options: FlixPatrolOptions = {};

  private readonly tvCache: FileSystemCache | null = null;

  private readonly movieCache: FileSystemCache | null = null;

  private readonly tvTmdbCache: FileSystemCache | null = null;

  private readonly movieTmdbCache: FileSystemCache | null = null;

  private readonly impit: Impit;

  constructor(cacheOptions: CacheOptions, options: FlixPatrolOptions = {}) {
    this.options.url = options.url || 'https://flixpatrol.com';
    // Use Impit with Chrome browser impersonation to bypass Cloudflare's TLS fingerprint check.
    this.impit = new Impit({ browser: 'chrome', timeout: 30000 });
    if (cacheOptions.enabled) {
      this.tvCache = Cache({
        basePath: `${cacheOptions.savePath}/tv-shows`,
        ns: 'flixpatrol-tv',
        hash: 'sha1',
        ttl: cacheOptions.ttl,
      });
      this.movieCache = Cache({
        basePath: `${cacheOptions.savePath}/movies`,
        ns: 'flixpatrol-movie',
        hash: 'sha1',
        ttl: cacheOptions.ttl,
      });
      this.tvTmdbCache = Cache({
        basePath: `${cacheOptions.savePath}/tv-shows`,
        ns: 'flixpatrol-tv-tmdb',
        hash: 'sha1',
        ttl: cacheOptions.ttl,
      });
      this.movieTmdbCache = Cache({
        basePath: `${cacheOptions.savePath}/movies`,
        ns: 'flixpatrol-movie-tmdb',
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

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
      try {
        const res = await this.impit.fetch(url);
        logger.silly(`Status code: ${res.status}`);
        if (res.status === 200) {
          return await res.text();
        }
        if (!RETRY_STATUS_CODES.has(res.status) || attempt === MAX_RETRIES) {
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
    trakt: TraktAPI | null,
  ): Promise<{
    movies: TraktTVIds;
    shows: TraktTVIds;
    tmdbMovies: TmdbMediaItems;
    tmdbShows: TmdbMediaItems;
    rawCounts: { movies: number; shows: number; }
  }> {
    if (config.kids) {
      if (config.platform !== 'netflix') {
        logger.warn(`Kids lists are only available on Netflix, but platform is "${config.platform}". Skipping.`);
        return { movies: [], shows: [], tmdbMovies: [], tmdbShows: [], rawCounts: { movies: 0, shows: 0 } };
      }
      if (config.location === 'world') {
        logger.warn('Kids lists are not available for worldwide. Please specify a country. Skipping.');
        return { movies: [], shows: [], tmdbMovies: [], tmdbShows: [], rawCounts: { movies: 0, shows: 0 } };
      }
    }

    const html = await this.getFlixPatrolHTMLPage(`/top10/${config.platform}/${config.location}`);
    if (html === null) {
      throw new FlixPatrolError('Unable to get FlixPatrol top10 page');
    }

    let movies: TraktTVIds = [];
    let tmdbMovies: TmdbMediaItems = [];
    let moviesRaw: FlixPatrolMatchResult[] = [];
    if (config.type === 'movies' || config.type === 'both') {
      moviesRaw = config.kids
        ? FlixPatrol.parseTop10KidsPage('Movies', html)
        : FlixPatrol.parseTop10Page('Movies', config.location, html);
      ({ traktIds: movies, tmdbItems: tmdbMovies } = await this.convertResultsToIds(
        moviesRaw.slice(0, config.limit), 'Movies', trakt,
      ));
    }

    let shows: TraktTVIds = [];
    let tmdbShows: TmdbMediaItems = [];
    let showsRaw: FlixPatrolMatchResult[] = [];
    if (config.type === 'shows' || config.type === 'both') {
      showsRaw = config.kids
        ? FlixPatrol.parseTop10KidsPage('TV Shows', html)
        : FlixPatrol.parseTop10Page('TV Shows', config.location, html);
      ({ traktIds: shows, tmdbItems: tmdbShows } = await this.convertResultsToIds(
        showsRaw.slice(0, config.limit), 'TV Shows', trakt,
      ));
    }

    if (movies.length === 0 && shows.length === 0 && config.fallback !== false && !config.kids) {
      logger.warn(`No items found for ${config.platform}, falling back to ${config.fallback} search`);
      const newConfig: FlixPatrolTop10 = { ...config, location: config.fallback, fallback: false };
      return this.getTop10Sections(newConfig, trakt);
    }

    return {
      movies,
      shows,
      tmdbMovies,
      tmdbShows,
      rawCounts: {
        movies: Math.min(moviesRaw.length, config.limit),
        shows: Math.min(showsRaw.length, config.limit),
      },
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

  private async getTraktTVId(
    result: FlixPatrolMatchResult,
    type: FlixPatrolType,
    trakt: TraktAPI | null,
  ): Promise<{ traktId: TraktTVId; tmdbId: number | null }> {
    if (!trakt) return { traktId: null, tmdbId: null };
    const isMovie = type === 'Movies';
    if (this.tvCache !== null && this.movieCache !== null) {
      const cachedTraktId: TraktTVId = isMovie
        ? await this.movieCache.get(result, null)
        : await this.tvCache.get(result, null);
      if (cachedTraktId) {
        const cachedTmdbId: number | null = this.movieTmdbCache !== null && this.tvTmdbCache !== null
          ? (isMovie
            ? await this.movieTmdbCache.get(result, null)
            : await this.tvTmdbCache.get(result, null)) ?? null
          : null;
        if (cachedTmdbId !== null) {
          logger.silly(`Found ${result} in cache. Trakt: ${cachedTraktId}, TMDB: ${cachedTmdbId}`);
          return { traktId: cachedTraktId, tmdbId: cachedTmdbId };
        }
        logger.silly(`Found ${result} Trakt ID in cache but no TMDB ID — fetching from Trakt to populate TMDB cache`);
      }
    }

    const html = await this.getFlixPatrolHTMLPage(result);
    if (html === null) {
      throw new FlixPatrolError(`Unable to get FlixPatrol detail page for ${result}`);
    }

    const dom = new JSDOM(html);
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

    const tryLookup = async (searchType: 'movie' | 'show'): Promise<{ traktId: TraktTVId; tmdbId: number | null }> => {
      const looked = await trakt.getFirstItemByQuery(searchType, title, Number.isNaN(year) ? 0 : year);
      if (!looked) return { traktId: null, tmdbId: null };
      if (searchType === 'movie') {
        return {
          traktId: looked.movie?.ids.trakt ?? null,
          tmdbId: (looked.movie?.ids as unknown as { tmdb?: number })?.tmdb ?? null,
        };
      }
      return {
        traktId: looked.show?.ids.trakt ?? null,
        tmdbId: (looked.show?.ids as unknown as { tmdb?: number })?.tmdb ?? null,
      };
    };

    let traktId: TraktTVId = null;
    let tmdbId: number | null = null;
    if (isMovie) {
      if (flixType === 'Movie' || !flixType) ({ traktId, tmdbId } = await tryLookup('movie'));
    } else {
      if (flixType === 'TV Show' || !flixType) ({ traktId, tmdbId } = await tryLookup('show'));
    }

    if (traktId && this.tvCache !== null && this.movieCache !== null) {
      if (isMovie) await this.movieCache.set(result, traktId);
      else await this.tvCache.set(result, traktId);
    }
    if (tmdbId && this.tvTmdbCache !== null && this.movieTmdbCache !== null) {
      if (isMovie) await this.movieTmdbCache.set(result, tmdbId);
      else await this.tvTmdbCache.set(result, tmdbId);
    }
    return { traktId, tmdbId };
  }

  private async convertResultsToIds(
    results: FlixPatrolMatchResult[],
    type: FlixPatrolType,
    trakt: TraktAPI | null,
  ): Promise<{ traktIds: TraktTVIds; tmdbItems: TmdbMediaItems }> {
    const traktIds: TraktTVIds = [];
    const tmdbItems: TmdbMediaItems = [];
    const mediaType: TmdbMediaItem['media_type'] = type === 'Movies' ? 'movie' : 'tv';

    for (const result of results) {
      const { traktId, tmdbId } = await this.getTraktTVId(result, type, trakt);
      if (traktId && !traktIds.includes(traktId)) {
        traktIds.push(traktId);
      }
      if (tmdbId && !tmdbItems.some((i) => i.media_id === tmdbId)) {
        tmdbItems.push({ media_type: mediaType, media_id: tmdbId });
      }
    }
    return { traktIds, tmdbItems };
  }

  public async getPopular(
    type: FlixPatrolType,
    config: FlixPatrolPopular,
    trakt: TraktAPI | null,
  ): Promise<{ traktIds: TraktTVIds; tmdbItems: TmdbMediaItems }> {
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
    trakt: TraktAPI | null,
  ): Promise<{ traktIds: TraktTVIds; tmdbItems: TmdbMediaItems }> {
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
    trakt: TraktAPI | null,
  ): Promise<{ traktIds: TraktTVIds; tmdbItems: TmdbMediaItems }> {
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
