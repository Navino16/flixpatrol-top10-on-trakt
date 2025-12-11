
import type {AxiosRequestConfig} from 'axios';
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
// Correct alias: location should derive from flixpatrolTop10Location array
export type FlixPatrolTop10Location = (typeof flixpatrolTop10Location)[number];

const flixpatrolTop10Platform = ['netflix', 'hbo-max', 'disney', 'amazon', 'amazon-channels', 'amazon-prime', 'amc-plus',
  'apple-tv', 'bbc', 'canal', 'catchplay', 'cda', 'chili', 'claro-video', 'crunchyroll', 'discovery-plus', 'francetv',
  'freevee', 'globoplay', 'go3', 'google', 'hotstar', 'hrti', 'hulu', 'hulu-nippon', 'itunes', 'jiocinema', 'lemino',
  'm6plus', 'mgm-plus', 'myvideo', 'now', 'osn', 'paramount-plus', 'peacock', 'player', 'pluto-tv', 'raiplay',
  'rakuten-tv', 'rtl-plus', 'shahid', 'starz', 'streamz', 'tf1', 'tod', 'tubi', 'u-next', 'viaplay', 'videoland',
  'viki', 'vix', 'voyo', 'vudu', 'watchit', 'wavve', 'wow', 'zee5'];
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

  public async getTop10Sections(
    config: FlixPatrolTop10,
    trakt: TraktAPI,
  ): Promise<{
    movies: TraktTVIds;
    shows: TraktTVIds;
    rawCounts: { movies: number; shows: number; }
  }> {
    const html = await this.getFlixPatrolHTMLPage(`/top10/${config.platform}/${config.location}`);
    if (html === null) {
      logger.error('FlixPatrol Error: unable to get FlixPatrol top10 page');
      process.exit(1);
    }

    let movies: TraktTVIds = [];
    let moviesRaw: FlixPatrolMatchResult[] = [];
    if (config.type === 'movies' || config.type === 'both') {
      moviesRaw = FlixPatrol.parseTop10Page('Movies', config.location, html);
      movies = await this.convertResultsToIds(moviesRaw.slice(0, config.limit), 'Movies', trakt);
    }

    let shows: TraktTVIds = [];
    let showsRaw: FlixPatrolMatchResult[] = [];
    if (config.type === 'shows' || config.type === 'both') {
      showsRaw = FlixPatrol.parseTop10Page('TV Shows', config.location, html);
      shows = await this.convertResultsToIds(showsRaw.slice(0, config.limit), 'TV Shows', trakt);
    }

    if (movies.length === 0 && shows.length === 0 && config.fallback !== false) {
      // Fallback to world if no match
      logger.warn(`No items found for ${config.platform}, falling back to ${config.fallback} search`);
      const newConfig: FlixPatrolTop10 = { ...config, location: config.fallback, fallback: false };
      return this.getTop10Sections(newConfig, trakt);
    }

    return {
      movies,
      shows,
      rawCounts: { movies: moviesRaw.length, shows: showsRaw.length, }
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
      logger.error('FlixPatrol Error: unable to get FlixPatrol detail page');
      process.exit(1);
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
      logger.error('FlixPatrol Error: unable to get FlixPatrol popular page');
      process.exit(1);
    }
  let results = FlixPatrol.parsePopularPage(html!);
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
  let results = FlixPatrol.parseMostWatchedPage(html!, config);
    results = results.slice(0, config.limit);
    return this.convertResultsToIds(results, type, trakt);
  }
}
