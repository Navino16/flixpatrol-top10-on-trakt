
import type { AxiosRequestConfig } from 'axios';
import axios from 'axios';
import { JSDOM } from 'jsdom';
import Cache, { FileSystemCache } from 'file-system-cache';
import { logger } from '../Utils';
import type { TraktTVId, TraktTVIds } from '../Trakt';
import { TraktAPI } from '../Trakt';
import type {FlixPatrolMostWatched, FlixPatrolPopular, FlixPatrolTop10} from '../Utils/GetAndValidateConfigs';

export interface FlixPatrolOptions {
  url?: string;
  agent?: string;
}

export interface CacheOptions {
  enabled: boolean;
  savePath: string;
  ttl: number;
}

const flixpatrolTop10Location = ['world', 'afghanistan', 'albania', 'algeria', 'andorra', 'angola', 'antigua-and-barbuda',
  'argentina', 'armenia', 'australia', 'austria', 'azerbaijan', 'bahamas', 'bahrain', 'bangladesh', 'barbados',
  'belarus', 'belgium', 'belize', 'benin', 'bhutan', 'bolivia', 'bosnia-and-herzegovina', 'botswana', 'brazil',
  'brunei', 'bulgaria', 'burkina-faso', 'burundi', 'cambodia', 'cameroon', 'canada', 'cape-verde',
  'central-african-republic', 'chad', 'chile', 'china', 'colombia', 'comoros', 'costa-rica', 'croatia', 'cyprus',
  'czech-republic', 'democratic-republic-of-the-congo', 'denmark', 'djibouti', 'dominica', 'dominican-republic',
  'east-timor', 'ecuador', 'egypt', 'equatorial-guinea', 'eritrea', 'estonia', 'ethiopia', 'fiji', 'finland',
  'france', 'gabon', 'gambia', 'georgia', 'germany', 'ghana', 'greece', 'grenada', 'guadeloupe', 'guatemala',
  'guinea', 'guinea-bissau', 'guyana', 'haiti', 'honduras', 'hong-kong', 'hungary', 'iceland', 'india',
  'indonesia', 'iraq', 'ireland', 'israel', 'italy', 'ivory-coast', 'jamaica', 'japan', 'jordan', 'kazakhstan',
  'kenya', 'kiribati', 'kosovo', 'kuwait', 'kyrgyzstan', 'laos', 'latvia', 'lebanon', 'lesotho', 'liberia',
  'libya', 'liechtenstein', 'lithuania', 'luxembourg', 'madagascar', 'malawi', 'malaysia', 'maldives', 'mali',
  'malta', 'marshall-islands', 'martinique', 'mauritania', 'mauritius', 'mexico', 'micronesia', 'moldova',
  'monaco', 'mongolia', 'montenegro', 'morocco', 'mozambique', 'myanmar', 'namibia', 'nauru', 'nepal',
  'netherlands', 'new-caledonia', 'new-zealand', 'nicaragua', 'niger', 'nigeria', 'north-macedonia', 'norway',
  'oman', 'pakistan', 'palau', 'palestine', 'panama', 'papua-new-guinea', 'paraguay', 'peru', 'philippines',
  'poland', 'portugal', 'qatar', 'republic-of-the-congo', 'reunion', 'romania', 'russia', 'rwanda',
  'saint-kitts-and-nevis', 'saint-lucia', 'saint-vincent-and-the-grenadines', 'salvador', 'samoa', 'san-marino',
  'sao-tome-and-principe', 'saudi-arabia', 'senegal', 'serbia', 'seychelles', 'sierra-leone', 'singapore',
  'slovakia', 'slovenia', 'solomon-islands', 'somalia', 'south-africa', 'south-korea', 'south-sudan', 'spain',
  'sri-lanka', 'sudan', 'suriname', 'swaziland', 'sweden', 'switzerland', 'taiwan', 'tajikistan', 'tanzania',
  'thailand', 'togo', 'tonga', 'trinidad-and-tobago', 'tunisia', 'turkey', 'turkmenistan', 'tuvalu', 'uganda',
  'ukraine', 'united-arab-emirates', 'united-kingdom', 'united-states', 'uruguay', 'uzbekistan', 'vanuatu',
  'vatican-city', 'venezuela', 'vietnam', 'yemen', 'zambia', 'zimbabwe'];
export type FlixPatrolTop10Location = (typeof flixpatrolTop10Platform)[number];

const flixpatrolTop10Platform = ['netflix', 'hbo', 'disney', 'amazon', 'amazon-prime', 'apple-tv', 'chili',
  'freevee', 'google', 'hulu', 'itunes', 'osn', 'paramount-plus', 'rakuten-tv', 'shahid', 'star-plus', 'starz',
  'viaplay', 'vudu'];
export type FlixPatrolTop10Platform = (typeof flixpatrolTop10Platform)[number];

const flixpatrolPopularPlatform = ['movie-db', 'facebook', 'twitter', 'twitter-trends', 'instagram',
  'instagram-trends', 'youtube', 'imdb', 'letterboxd', 'rotten-tomatoes', 'tmdb', 'trakt', 'wikipedia-trends', 'reddit'];
export type FlixPatrolPopularPlatform = (typeof flixpatrolPopularPlatform)[number];

const flixpatrolConfigType = ['movies', 'shows', 'both'];
export type FlixPatrolConfigType = (typeof flixpatrolConfigType)[number];

export type FlixPatrolType = 'Movies' | 'TV Shows';
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
  public static isFlixPatrolTop10Location = (x: string): x is FlixPatrolTop10Location => flixpatrolTop10Location.includes(x);

  // eslint-disable-next-line max-len
  public static isFlixPatrolTop10Platform = (x: string): x is FlixPatrolTop10Platform => flixpatrolTop10Platform.includes(x);

  // eslint-disable-next-line max-len
  public static isFlixPatrolPopularPlatform = (x: string): x is FlixPatrolPopularPlatform => flixpatrolPopularPlatform.includes(x);

  public static isFlixPatrolType = (x: string): x is FlixPatrolConfigType => flixpatrolConfigType.includes(x);

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
    };

    const res = await axios.get(url, axiosConfig);
    logger.silly(`Status code: ${res.status}`);
    if (res.status !== 200) {
      return null;
    }
    return res.data;
  }

  private static parseTop10Page(
    type: FlixPatrolType,
    location: FlixPatrolTop10Location,
    platform: FlixPatrolTop10Platform,
    html: string,
  ): FlixPatrolMatchResult[] {
    let expression;
    if (location !== 'world') {
      expression = `//h3[text() = "TOP 10 ${type}"]/following-sibling::div//a[@class="hover:underline"]/@href`;
    } else {
      const id = type === 'Movies' ? 1 : 2;
      expression = `//div[@id="${platform}-${id}"]//a[contains(@class, "hover:underline")]/@href`;
    }

    return FlixPatrol.parsePage(expression, html, 'top10');
  }

  private static parsePopularPage(
    html: string,
  ): FlixPatrolMatchResult[] {
    const expression = '//table[@class="card-table"]//a[@class="flex gap-2 group items-center"]/@href';

    return FlixPatrol.parsePage(expression, html, 'popular');
  }

  private static parseMostWatchedPage(
    html: string,
    config: FlixPatrolMostWatched
  ): FlixPatrolMatchResult[] {
    let expression = '//table[@class="card-table"]//a[@class="flex gap-2 group items-center"]/@href';
    if (config.original !== undefined && config.original) {
      expression = '//table[@class="card-table"]//a[@class="flex gap-2 group items-center"][.//svg]/@href'
    }

    return FlixPatrol.parsePage(expression, html, 'most-watched');
  }

  private static parsePage(expression: string, html: string, pageName: string): FlixPatrolMatchResult[] {
    const dom = new JSDOM(html);
    logger.silly(`Xpath expression for ${pageName} page: ${expression}`)
    const match = dom.window.document.evaluate(
      expression,
      dom.window.document,
      null,
      dom.window.XPathResult.UNORDERED_NODE_ITERATOR_TYPE,
      null,
    );
    const results: string[] = [];

    let p = match.iterateNext();
    while (p !== null) {
      results.push(p.textContent as string);
      p = match.iterateNext();
    }
    logger.silly(`Xpath matches: ${results}`);
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
      logger.error('FlixPatrol Error: unable to get FlixPatrol detail page');
      process.exit(1);
    }

    const dom = new JSDOM(html);
    const titleExpression = '//div[@class="mb-6"]//h1[@class="mb-3"]/text()';
    logger.silly(`Xpath expression for getting release title: ${titleExpression}`)
    const title = dom.window.document.evaluate(
      titleExpression,
      dom.window.document,
      null,
      dom.window.XPathResult.STRING_TYPE,
      null,
    ).stringValue;
    logger.silly(`Release title: ${title}`);

    const yearExpression = '//div[@class="mb-6"]//span[5]/span/text()';
    logger.silly(`Xpath expression for getting release year: ${yearExpression}`)
    const year = dom.window.document.evaluate(
      yearExpression,
      dom.window.document,
      null,
      dom.window.XPathResult.STRING_TYPE,
      null,
    ).stringValue;
    logger.silly(`Release year: ${year}`);

    let item;
    let id;
    if (type === 'Movies') {
      item = await trakt.getFirstItemByQuery('movie', title, parseInt(year, 10));
      id = item && item.movie && item.movie.ids.trakt ? item.movie.ids.trakt : null;
    } else {
      item = await trakt.getFirstItemByQuery('show', title, parseInt(year, 10));
      id = item && item.show && item.show.ids.trakt ? item.show.ids.trakt : null;
    }

    logger.silly(`Matched item: ${JSON.stringify(item)}`);
    logger.silly(`Trakt id: ${id}`);

    if (id && this.tvCache !== null && this.movieCache !== null) {
      logger.debug(`New item added in ${type} cache`);
      const cacheInfo = type === 'Movies' ? await this.movieCache.set(result, id) : await this.tvCache.set(result, id);
      logger.debug(`Cache: ${cacheInfo.path}`);
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

  public async getTop10(
    type: FlixPatrolType,
    config: FlixPatrolTop10,
    trakt: TraktAPI,
    html: string | null = null,
  ): Promise<TraktTVIds> {
    if (html === null) {
      html = await this.getFlixPatrolHTMLPage(`/top10/${config.platform}/${config.location}`);
    }

    if (html === null) {
      logger.error('FlixPatrol Error: unable to get FlixPatrol top10 page');
      process.exit(1);
    }
    let results = FlixPatrol.parseTop10Page(type, config.location, config.platform, html);
    results = results.slice(0, config.limit);

    // Fallback to world if no match
    if (config.fallback !== false && results.length === 0) {
      logger.warn(`No ${type} found for ${config.platform}, falling back to ${config.fallback} search`);
      const newConfig: FlixPatrolTop10 = { ...config, location: config.fallback, fallback: false };
      return this.getTop10(type, newConfig, trakt);
    }

    return this.convertResultsToIds(results, type, trakt);
  }

  public async getPopular(
    type: FlixPatrolType,
    config: FlixPatrolPopular,
    trakt: TraktAPI,
  ): Promise<TraktTVIds> {
    const urlType = type === 'Movies' ? 'movies' : 'tv-shows';
    const html = await this.getFlixPatrolHTMLPage(`/popular/${urlType}/${config.platform}`);
    if (html === null) {
      logger.error('FlixPatrol Error: unable to get FlixPatrol popular page');
      process.exit(1);
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
      logger.error('FlixPatrol Error: unable to get FlixPatrol most-watched page');
      process.exit(1);
    }
    let results = FlixPatrol.parseMostWatchedPage(html, config);
    results = results.slice(0, config.limit);
    return this.convertResultsToIds(results, type, trakt);
  }
}
