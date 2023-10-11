/* eslint-disable no-await-in-loop */
import axios, { AxiosRequestConfig } from 'axios';
import { JSDOM } from 'jsdom';
import Cache, { FileSystemCache } from 'file-system-cache';
import { logger } from '../Utils/Logger';

export interface FlixPatrolOptions {
  url?: string;
  agent?: string;
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

export type FlixPatrolType = 'Movies' | 'TV Shows';
type FlixPatrolMatchResult = string;
type FlixPatrolMatchResults = string[];
type FlixPatrolTMDBId = string | null;
export type FlixPatrolTMDBIds = string[];
export class FlixPatrol {
  private options: FlixPatrolOptions = {};

  private cache: FileSystemCache;

  constructor(options: FlixPatrolOptions = {}) {
    this.options.url = options.url || 'https://flixpatrol.com';
    this.options.agent = options.agent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36';
    this.cache = Cache({
      basePath: './.cache', // (optional) Path where cache files are stored (default).
      ns: 'flixpatrol', // (optional) A grouping namespace for items.
      hash: 'sha1', // (optional) A hashing algorithm used within the cache key.
      ttl: 604800, // (optional) A time-to-live (in secs) on how long an item remains cached.
    });
  }

  // eslint-disable-next-line max-len
  public static isFlixPatrolTop10Location = (x: string): x is FlixPatrolTop10Location => flixpatrolTop10Location.includes(x);

  // eslint-disable-next-line max-len
  public static isFlixPatrolTop10Platform = (x: string): x is FlixPatrolTop10Platform => flixpatrolTop10Platform.includes(x);

  // eslint-disable-next-line max-len
  public static isFlixPatrolPopularPlatform = (x: string): x is FlixPatrolPopularPlatform => flixpatrolPopularPlatform.includes(x);

  /**
   * Get one FlixPatrol HTML page and return it as a string
   * @private
   * @param path
   */
  private async getFlixPatrolHTMLPage(path: string): Promise<string | null> {
    const url = `${this.options.url}/${path}`;

    const axiosConfig: AxiosRequestConfig = {
      headers: {
        'User-Agent': this.options.agent,
      },
    };

    const res = await axios.get(url, axiosConfig);
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
  ): FlixPatrolMatchResults {
    const dom = new JSDOM(html);
    let expression;
    if (location !== 'world') {
      const searchType = platform === 'apple-tv' ? 'Overall' : type;
      expression = `//h3[text() = "TOP 10 ${searchType}"]/following-sibling::div//a[@class="hover:underline"]/@href`;
    } else {
      const id = type === 'Movies' ? 1 : 2;
      expression = `//div[@id="${platform}-${id}"]//a[contains(@class, "hover:underline")]/@href`;
    }
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
    return results;
  }

  private static parsePopularPage(
    html: string,
  ): FlixPatrolMatchResults {
    const dom = new JSDOM(html);
    const match = dom.window.document.evaluate(
      '//table[@class="card-table"]//a[@class="flex group items-center"]/@href',
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
    return results;
  }

  private async getTMDBId(result: FlixPatrolMatchResult, type: FlixPatrolType) : Promise<FlixPatrolTMDBId> {
    const html = await this.getFlixPatrolHTMLPage(result);
    if (html === null) {
      logger.error('FlixPatrol Error: unable to get FlixPatrol detail page');
      process.exit(1);
    }

    const dom = new JSDOM(html);
    const match = dom.window.document.evaluate(
      '//script[@type="application/ld+json"]',
      dom.window.document,
      null,
      dom.window.XPathResult.STRING_TYPE,
      null,
    );

    let regex;
    if (type === 'Movies') {
      regex = match.stringValue.match(/(themoviedb\.org\/movie)(\D*)(\d+)/i);
    } else {
      regex = match.stringValue.match(/(themoviedb\.org\/tv)(\D*)(\d+)/i);
    }

    return regex ? regex[3] : null;
  }

  private async convertResultsToIds(results: FlixPatrolMatchResults, type: FlixPatrolType) {
    const TMDBIds: FlixPatrolTMDBIds = [];
    // eslint-disable-next-line no-restricted-syntax
    for (const result of results) {
      let id = await this.cache.get(result, null);
      if (!id) {
        id = await this.getTMDBId(result, type);
        if (id) {
          logger.debug('New item added in cache');
          await this.cache.set(result, id);
        }
      } else {
        logger.debug('Item loaded from cache');
      }
      if (id) {
        TMDBIds.push(id);
      }
    }
    return TMDBIds;
  }

  public async getTop10(
    type: FlixPatrolType,
    platform: FlixPatrolTop10Platform,
    location: FlixPatrolTop10Location,
    fallback: FlixPatrolTop10Location | false,
  ): Promise<FlixPatrolTMDBIds> {
    const html = await this.getFlixPatrolHTMLPage(`/top10/${platform}/${location}`);
    if (html === null) {
      logger.error('FlixPatrol Error: unable to get FlixPatrol top10 page');
      process.exit(1);
    }
    const results = FlixPatrol.parseTop10Page(type, location, platform, html);
    // Fallback to world if no match
    if (fallback !== false && results.length === 0) {
      logger.warn(`No ${type} found for ${platform}, falling back to ${fallback} search`);
      return this.getTop10(type, platform, fallback, false);
    }

    return this.convertResultsToIds(results, type);
  }

  public async getPopular(
    type: FlixPatrolType,
    platform: FlixPatrolTop10Platform,
  ) {
    const urlType = type === 'Movies' ? 'movies' : 'tv-shows';
    const html = await this.getFlixPatrolHTMLPage(`/popular/${urlType}/${platform}`);
    if (html === null) {
      logger.error('FlixPatrol Error: unable to get FlixPatrol popular page');
      process.exit(1);
    }
    const results = FlixPatrol.parsePopularPage(html);
    return this.convertResultsToIds(results, type);
  }
}
