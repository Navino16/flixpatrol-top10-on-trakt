import type {AxiosRequestConfig} from 'axios';
import axios from 'axios';
import { JSDOM } from 'jsdom';
import Cache, { FileSystemCache } from 'file-system-cache';
import { logger } from '../Utils';
import type { TraktTVId, TraktTVIds } from '../Trakt';
import { TraktAPI } from '../Trakt';
import type {FlixPatrolMostWatched, FlixPatrolPopular, FlixPatrolTop10} from '../Utils/GetAndValidateConfigs';
import type { TraktItem } from 'trakt.tv'; // <-- Add this import

// Define the missing type
// export type TraktIdWithType = { id: number; type: 'movie' | 'show' } | null; // Modified below

// Define and export the necessary types
export type TraktIdWithTypeObject = { id: number; type: 'movie' | 'show' };
export type TraktIdWithType = TraktIdWithTypeObject | null; // Exported
export type TraktIdWithTypeArrayPromise = Promise<TraktIdWithType[]>;
export type TraktIdWithTypeArrayFilteredPromise = Promise<TraktIdWithTypeObject[]>;


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

const flixpatrolTop10Platform = ['netflix', 'hbo', 'disney', 'amazon', 'amazon-channels', 'amazon-prime', 'amc-plus',
  'apple-tv', 'bbc', 'canal', 'catchplay', 'cda', 'chili', 'claro-video', 'crunchyroll', 'discovery-plus', 'francetv',
  'freevee', 'globoplay', 'go3', 'google', 'hotstar', 'hrti', 'hulu', 'hulu-nippon', 'itunes', 'jiocinema', 'lemino',
  'm6plus', 'mgm-plus', 'myvideo', 'now', 'osn', 'paramount-plus', 'peacock', 'player', 'pluto-tv', 'raiplay',
  'rakuten-tv', 'rtl-plus', 'shahid', 'starz', 'streamz', 'tf1', 'tod', 'tubi', 'u-next', 'viaplay', 'videoland',
  'viki', 'vix', 'voyo', 'vudu', 'watchit', 'wavve', 'wow', 'zee5'];
export type FlixPatrolTop10Platform = (typeof flixpatrolTop10Platform)[number];

const flixpatrolPopularPlatform = ['movie-db', 'facebook', 'twitter', 'twitter-trends', 'instagram',
  'instagram-trends', 'youtube', 'imdb', 'letterboxd', 'rotten-tomatoes', 'tmdb', 'trakt', 'wikipedia-trends', 'reddit'];
export type FlixPatrolPopularPlatform = (typeof flixpatrolPopularPlatform)[number];

const flixpatrolConfigType = ['movies', 'shows', 'both', 'overall']; // Aggiunto 'overall'
export type FlixPatrolConfigType = (typeof flixpatrolConfigType)[number];

export type FlixPatrolType = 'Movies' | 'TV Shows' | 'Overall';
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
    platform: FlixPatrolTop10Platform,
    html: string,
  ): FlixPatrolMatchResult[] {
    let expression;
    if (location !== 'world') {
      expression = `//div[h3[text() = "TOP 10 ${type}"]]/parent::div/following-sibling::div[1]//a[@class="hover:underline"]/@href`;
    } else {
      const id = type === 'Movies' ? 'movies' : (type === 'TV Shows' ? 'tv-shows' : 'overall');
      expression = `//div[@id="toc-${platform}-${id}"]//table//a[contains(@class, "hover:underline")]/@href`;
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
  // Update the return type of getTraktTVId
  private async getTraktTVId(result: FlixPatrolMatchResult, type: FlixPatrolType, trakt: TraktAPI) : Promise<TraktIdWithType> {
    let determinedType: 'movie' | 'show' | null = null;
    let idFromCache: number | null = null;
    const searchLanguage = 'it'; // Imposta la lingua desiderata per la ricerca

    // Logica Cache (leggermente riorganizzata per chiarezza)
    if (this.tvCache !== null && this.movieCache !== null) {
        if (type === 'Overall') {
            const movieId = await this.movieCache.get(result, null);
            if (movieId) {
                logger.silly(`Found ${result} in movie cache. Id: ${movieId}`);
                // Return the new type
                return { id: movieId as number, type: 'movie' };
            }
            const tvId = await this.tvCache.get(result, null);
            if (tvId) {
                logger.silly(`Found ${result} in tv cache. Id: ${tvId}`);
                // Return the new type
                return { id: tvId as number, type: 'show' };
            }
            // Se non in cache, type rimane 'Overall', determinedType è null
        } else { // type è 'Movies' o 'TV Shows'
            determinedType = type === 'Movies' ? 'movie' : 'show';
            const cacheToCheck = determinedType === 'movie' ? this.movieCache : this.tvCache;
            idFromCache = await cacheToCheck.get(result, null);
            if (idFromCache) {
                logger.silly(`Found ${result} in ${determinedType} cache. Id: ${idFromCache}`);
                // Return the new type
                return { id: idFromCache, type: determinedType };
            }
            // Se non in cache, determinedType è già impostato, procedi a fetch/search
        }
    } else if (type !== 'Overall') {
        // Se la cache non è attiva ma il tipo è specifico, impostiamo determinedType
        determinedType = type === 'Movies' ? 'movie' : 'show';
    }
    // Se type è 'Overall' e cache disattiva/miss, determinedType rimane null per ora

    // Fetch HTML e determina il tipo se necessario (cache miss o type 'Overall')
    const html = await this.getFlixPatrolHTMLPage(result);
    if (html === null) {
      logger.error('FlixPatrol Error: unable to get FlixPatrol detail page');
      process.exit(1);
    }

    const dom = new JSDOM(html);
    const titleExpression = '//div[@class="mb-6"]//h1[@class="mb-4"]/text()';
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
    let finalDeterminedType: 'movie' | 'show' | null = determinedType; // Keep track of the final type

    // Per il tipo "Overall" o quando il tipo è 'both' (convertito a 'Overall')
    if (type === 'Overall' || type === 'both' as any) {
      // Prima proviamo come film
      item = await trakt.getFirstItemByQuery('movie', title, parseInt(year, 10));
      id = item?.movie?.ids.trakt ?? null; // Use optional chaining and nullish coalescing

      // Se non troviamo come film, proviamo come serie TV
      if (!id) {
        item = await trakt.getFirstItemByQuery('show', title, parseInt(year, 10));
        id = item?.show?.ids.trakt ?? null; // Use optional chaining and nullish coalescing

        // Se troviamo come serie TV, aggiorniamo il tipo
        if (id) {
          finalDeterminedType = 'show';
        }
      } else {
        // Se troviamo come film, aggiorniamo il tipo
        finalDeterminedType = 'movie';
      }
    } else if (type === 'Movies') {
      item = await trakt.getFirstItemByQuery('movie', title, parseInt(year, 10));
      id = item?.movie?.ids.trakt ?? null; // Use optional chaining and nullish coalescing
      finalDeterminedType = 'movie';
    } else { // type === 'TV Shows'
      item = await trakt.getFirstItemByQuery('show', title, parseInt(year, 10));
      id = item?.show?.ids.trakt ?? null; // Use optional chaining and nullish coalescing
      finalDeterminedType = 'show';
    }

    logger.silly(`Matched item: ${JSON.stringify(item)}`);
    logger.silly(`Trakt id: ${id}`);

    // Update cache and return the new type
    if (id && finalDeterminedType) {
        if (this.tvCache !== null && this.movieCache !== null) {
            logger.debug(`New item added in ${finalDeterminedType} cache: ${result} -> ${id}`); // Log result and id
            const numericId = Number(id);
            const cacheToUse = finalDeterminedType === 'movie' ? this.movieCache : this.tvCache;
            try { // Add try-catch for cache set
              const cacheInfo = await cacheToUse.set(result, numericId);
              logger.debug(`Cache set for ${result}: ${cacheInfo.path}`);
            } catch (cacheError) {
              logger.error(`Failed to set cache for ${result}: ${cacheError}`);
            }
        }
        return { id: Number(id), type: finalDeterminedType }; // Return the object
    } else {
        logger.warn(`No Trakt ID found or type determined for ${result} (Title: ${title}, Year: ${year}, Type Searched: ${type})`);
        return null; // Return null if no ID or type
    }
    // Remove any lingering old return statements like: return id ? (id as unknown as TraktTVId) : null;
  }

  // Correct convertResultsToIds to return Promise<TraktIdWithType[]> // Updated comment
  private async convertResultsToIds(results: FlixPatrolMatchResult[], type: FlixPatrolType, trakt: TraktAPI): TraktIdWithTypeArrayPromise {
    const traktItemsWithType: TraktIdWithType[] = []; // Array to hold {id, type} objects or null

    for (const result of results) {
      // getTraktTVId returns Promise<TraktIdWithType> // Updated comment
      const traktItemInfo = await this.getTraktTVId(result, type, trakt);
      // Push the entire result ({id, type} or null)
      traktItemsWithType.push(traktItemInfo); // Line 327 likely refers to usage within this loop or the return
    }
    // Return the array which might contain nulls
    return traktItemsWithType;
  }

  // Correct getTop10 return type and filter nulls
  public async getTop10(
    config: FlixPatrolTop10,
    trakt: TraktAPI,
    html: string | null = null,
  ): TraktIdWithTypeArrayFilteredPromise {
    let results: FlixPatrolMatchResult[] = [];
    let itemsWithPossibleNulls: TraktIdWithType[] = [];
    const internalTypeMap: { [key: string]: FlixPatrolType } = {
      movies: 'Movies',
      shows: 'TV Shows',
      overall: 'Overall',
      // 'both' is handled specially
    };

    // Fetch HTML only once if needed and not provided
    if (html === null && (config.type === 'movies' || config.type === 'shows' || config.type === 'overall' || config.type === 'both')) {
      const path = `/top10/${config.platform}/${config.location}`;
      html = await this.getFlixPatrolHTMLPage(path);
      if (html === null) {
          logger.error(`FlixPatrol Error: unable to get FlixPatrol top10 page: ${path}`);
          return []; // Return empty if HTML fetch fails
      }
    } else if (html === null) {
        // Should not happen if type is valid, but good to handle
        logger.error(`Invalid type or missing HTML for getTop10: ${config.type}`);
        return [];
    }


    if (config.type === 'movies' || config.type === 'shows') {
        const internalType: FlixPatrolType = internalTypeMap[config.type];
        try {
            results = FlixPatrol.parseTop10Page(internalType, config.location, config.platform, html);
            logger.silly(`Parsed ${results.length} ${internalType} for ${config.platform}/${config.location}`);
        } catch (parseError) {
            logger.error(`Error parsing Top10 page for ${config.platform}/${config.location} (Type: ${internalType}): ${parseError}`);
            // Proceed with empty results to potentially trigger fallback
        }
        results = results.slice(0, config.limit);
        itemsWithPossibleNulls = await this.convertResultsToIds(results, internalType, trakt);

    } else if (config.type === 'overall') {
        const internalType: FlixPatrolType = 'Overall'; // Keep original 'overall' behavior
        try {
            // Attempt to parse the combined/overall table first
            results = FlixPatrol.parseTop10Page(internalType, config.location, config.platform, html);
            logger.silly(`Parsed ${results.length} ${internalType} items for ${config.platform}/${config.location}`);
        } catch (parseError) {
            logger.warn(`Could not parse Overall page directly for ${config.platform}/${config.location} (Type: ${internalType}): ${parseError}. Fallback might apply.`);
            // Proceed with empty results to potentially trigger fallback
        }
        results = results.slice(0, config.limit);
        // Pass 'Overall' so convertResultsToIds determines type based on Trakt result
        itemsWithPossibleNulls = await this.convertResultsToIds(results, 'Overall', trakt);

    // Remove the stray comma here
    } else if (config.type === 'both') { // Special handling for 'both'
        let movieResultsRaw: FlixPatrolMatchResult[] = [];
        let showResultsRaw: FlixPatrolMatchResult[] = [];
        let movieItemsWithPossibleNulls: TraktIdWithType[] = [];
        let showItemsWithPossibleNulls: TraktIdWithType[] = [];

        // Parse for Movies and apply limit
        try {
            movieResultsRaw = FlixPatrol.parseTop10Page('Movies', config.location, config.platform, html);
            movieResultsRaw = movieResultsRaw.slice(0, config.limit); // Apply limit to movies
            logger.silly(`Parsed and limited to ${movieResultsRaw.length} movies for ${config.platform}/${config.location} (for 'both')`);
            // Convert movie results specifically searching for 'movie' on Trakt
            movieItemsWithPossibleNulls = await this.convertResultsToIds(movieResultsRaw, 'Movies', trakt);
        } catch (parseError) {
            logger.warn(`Could not parse or convert Movies for ${config.platform}/${config.location} (for 'both'): ${parseError}`);
        }

        // Parse for TV Shows and apply limit
        try {
            showResultsRaw = FlixPatrol.parseTop10Page('TV Shows', config.location, config.platform, html);
            showResultsRaw = showResultsRaw.slice(0, config.limit); // Apply limit to shows
            logger.silly(`Parsed and limited to ${showResultsRaw.length} shows for ${config.platform}/${config.location} (for 'both')`);
            // Convert show results specifically searching for 'show' on Trakt
            showItemsWithPossibleNulls = await this.convertResultsToIds(showResultsRaw, 'TV Shows', trakt);
        } catch (parseError) {
            logger.warn(`Could not parse or convert TV Shows for ${config.platform}/${config.location} (for 'both'): ${parseError}`);
        }

        // Combine the results AFTER converting them with the correct type context
        itemsWithPossibleNulls = [...movieItemsWithPossibleNulls, ...showItemsWithPossibleNulls];

        logger.debug(`Combined ${itemsWithPossibleNulls.length} potential Trakt items (movies + shows) for ${config.platform}/${config.location} (Type: ${config.type}) before filtering nulls`);

        // Fallback logic check needs to consider if *both* parsing attempts failed or yielded no results
        const checkResultsLengthForFallback = movieResultsRaw.length + showResultsRaw.length; // Check combined length of raw results

        if (config.fallback !== false && checkResultsLengthForFallback === 0 && typeof config.fallback === 'string' && FlixPatrol.isFlixPatrolTop10Location(config.fallback)) {
          logger.warn(`No items found for ${config.platform}/${config.location} (Type: ${config.type}), falling back to ${config.fallback} search`);
          const newConfig: FlixPatrolTop10 = { ...config, location: config.fallback, fallback: false };
          // Make recursive call, force refetch by passing null for html
          return this.getTop10(newConfig, trakt, null); // Return the result of the recursive call
        } else if (config.fallback !== false && checkResultsLengthForFallback === 0 && typeof config.fallback === 'string' && !FlixPatrol.isFlixPatrolTop10Location(config.fallback)) {
            logger.error(`Invalid fallback location specified: ${config.fallback}`);
            return []; // Return empty array if fallback is invalid
        } else if (config.fallback !== false && checkResultsLengthForFallback === 0) {
            logger.warn(`No items found for ${config.platform}/${config.location} (Type: ${config.type}) and no valid fallback location provided or fallback already attempted.`);
            return []; // Return empty array if no results and fallback exhausted/invalid
        }

        // Filter out nulls (items not found on Trakt or failed conversion) before returning for 'both' type
        const filteredItemsBoth = itemsWithPossibleNulls.filter((item): item is TraktIdWithTypeObject => item !== null);
        logger.info(`Found ${filteredItemsBoth.length} valid Trakt items for ${config.platform}/${config.location} (Type: ${config.type}) after filtering`);
        return filteredItemsBoth; // Return the filtered items for 'both'

    } else {
      // Handle potential invalid config.type if necessary, or remove if all types are covered
      logger.error(`Invalid config type encountered in getTop10: ${config.type}`);
      return []; // Return empty for unhandled types
    }

    // --- Fallback and Filtering Logic for non-'both' types ---
    // This section is reached only if config.type was 'movies', 'shows', or 'overall'
    // AND a return didn't happen earlier (e.g., HTML fetch failure).

    // Fallback check (apply if results were initially empty for non-'both' types)
    let checkResultsLengthForFallback: number = results.length; // Use 'results' which was populated for non-'both' types
    if (config.fallback !== false && checkResultsLengthForFallback === 0 && typeof config.fallback === 'string' && FlixPatrol.isFlixPatrolTop10Location(config.fallback)) {
        logger.warn(`No items found for ${config.platform}/${config.location} (Type: ${config.type}), falling back to ${config.fallback} search`);
        const newConfig: FlixPatrolTop10 = { ...config, location: config.fallback, fallback: false };
        return this.getTop10(newConfig, trakt, null); // Recursive call for fallback
    } else if (config.fallback !== false && checkResultsLengthForFallback === 0 && typeof config.fallback === 'string' && !FlixPatrol.isFlixPatrolTop10Location(config.fallback)) {
        logger.error(`Invalid fallback location specified: ${config.fallback}`);
        return []; // Invalid fallback
    } else if (config.fallback !== false && checkResultsLengthForFallback === 0) {
        logger.warn(`No items found for ${config.platform}/${config.location} (Type: ${config.type}) and no valid fallback location provided or fallback already attempted.`);
        return []; // Fallback failed or not applicable
    }


    // Final Filtering (apply if fallback didn't trigger a return for non-'both' types)
    const filteredItems = itemsWithPossibleNulls.filter((item): item is TraktIdWithTypeObject => item !== null);
    logger.info(`Found ${filteredItems.length} valid Trakt items for ${config.platform}/${config.location} (Type: ${config.type}) after filtering`);
    return filteredItems; // Return filtered items for non-'both' types
  }

  // Correct getPopular return type and filter nulls
  public async getPopular(
    config: FlixPatrolPopular,
    trakt: TraktAPI,
  ): TraktIdWithTypeArrayFilteredPromise {
    let internalType: FlixPatrolType;
    switch (config.type) {
      case 'movies':
        internalType = 'Movies';
        break;
      case 'shows':
        internalType = 'TV Shows';
        break;
      case 'both':
      case 'overall':
         logger.warn(`Type '${config.type}' is ambiguous for Popular lists. Fetching only movies for platform ${config.platform}.`);
         internalType = 'Movies'; // Defaulting to movies
         break;
      default:
        logger.error(`Invalid type in Popular config: ${config.type}`);
        return []; // Return empty array
    }

    const urlTypePath = internalType === 'Movies' ? 'movies' : 'tv-shows';
    const path = `/popular/${urlTypePath}/${config.platform}`; // Construct path
    const html = await this.getFlixPatrolHTMLPage(path); // Use path

    if (html === null) {
      logger.error(`FlixPatrol Error: unable to get FlixPatrol popular page: ${path}`);
      return []; // Return empty array on fetch error
    }

    let results: FlixPatrolMatchResult[];
     try { // Add try-catch for parsing
        results = FlixPatrol.parsePopularPage(html);
    } catch (parseError) {
        logger.error(`Error parsing Popular page for ${path}: ${parseError}`);
        return [];
    }
    results = results.slice(0, config.limit);

    const itemsWithPossibleNulls: TraktIdWithType[] = await this.convertResultsToIds(results, internalType, trakt); // Line 400: Use TraktIdWithType[]
    const filteredItems = itemsWithPossibleNulls.filter((item): item is TraktIdWithTypeObject => item !== null);
    return filteredItems;
  }


  // Correct getMostWatched return type and filter nulls
  public async getMostWatched(
    config: FlixPatrolMostWatched,
    trakt: TraktAPI,
  ): TraktIdWithTypeArrayFilteredPromise {
    let internalType: FlixPatrolType;
     switch (config.type) {
      case 'movies':
        internalType = 'Movies';
        break;
      case 'shows':
        internalType = 'TV Shows';
        break;
      case 'both':
      case 'overall':
         logger.warn(`Type '${config.type}' is ambiguous for Most Watched lists. Fetching only movies for year ${config.year}.`);
         internalType = 'Movies'; // Defaulting to movies
         break;
      default:
        logger.error(`Invalid type in MostWatched config: ${config.type}`);
        return []; // Return empty array
    }

    const urlTypePath = internalType === 'Movies' ? 'movies' : 'tv-shows';
    let path = `/most-watched/${config.year}/${urlTypePath}`; // Construct path
    if (config.country !== undefined) {
      path += `-from-${config.country}`;
    }
    // Assuming config.premiere is a string like 'premiere' if true
    if (config.premiere !== undefined && config.premiere) {
       // Ensure config.premiere is treated correctly, maybe it's just a boolean?
       // If it's boolean true, maybe the path segment is just '-premiere'? Adjust as needed.
       // Assuming it's a string value if present:
       path += `-${config.premiere}`;
    }
    if (config.original !== undefined && config.original) {
      path += '-original';
    }

    const html = await this.getFlixPatrolHTMLPage(path); // Use path
    if (html === null) {
      logger.error(`FlixPatrol Error: unable to get FlixPatrol most watched page: ${path}`);
      return []; // Return empty array on fetch error
    }

    let results: FlixPatrolMatchResult[];
    try { // Add try-catch for parsing
        results = FlixPatrol.parseMostWatchedPage(html, config);
    } catch (parseError) {
        logger.error(`Error parsing Most Watched page for ${path}: ${parseError}`);
        return [];
    }
    results = results.slice(0, config.limit);

    const itemsWithPossibleNulls: TraktIdWithType[] = await this.convertResultsToIds(results, internalType, trakt); // Line 447: Use TraktIdWithType[]
    const filteredItems = itemsWithPossibleNulls.filter((item): item is TraktIdWithTypeObject => item !== null);
    return filteredItems;
  }

  // Assuming line 507 might have been a leftover type annotation or similar.
  // If the error persists on line 507 after these changes, please provide the code around that line.

} // End of FlixPatrol class
