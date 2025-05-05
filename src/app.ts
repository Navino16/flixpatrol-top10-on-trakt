import type { CacheOptions } from './Flixpatrol';
  import { FlixPatrol } from './Flixpatrol';
  import { logger, Utils } from './Utils';
  import type {FlixPatrolMostWatched, FlixPatrolPopular, FlixPatrolTop10} from './Utils/GetAndValidateConfigs';
  import { GetAndValidateConfigs } from './Utils/GetAndValidateConfigs';
  import type { TraktAPIOptions } from './Trakt';
  import { TraktAPI } from './Trakt';
  // Import the correct types, including the newly exported ones
  import type { TraktIdWithTypeObject } from './Flixpatrol/FlixPatrol'; // Importa il tipo corretto
  import type { TraktType } from 'trakt.tv'; // Import TraktType

  Utils.ensureConfigExist();

  logger.info('Loading all configurations values');
  const cacheOptions: CacheOptions = GetAndValidateConfigs.getCacheOptions();
  const traktOptions: TraktAPIOptions = GetAndValidateConfigs.getTraktOptions();
  const flixPatrolTop10: FlixPatrolTop10[] = GetAndValidateConfigs.getFlixPatrolTop10();
  const flixPatrolPopulars: FlixPatrolPopular[] = GetAndValidateConfigs.getFlixPatrolPopular();
  const flixPatrolMostWatched: FlixPatrolMostWatched[] = GetAndValidateConfigs.getFlixPatrolMostWatched();

  logger.silly(`cacheOptions: ${JSON.stringify(cacheOptions)}`);
  logger.silly(`traktOptions: ${JSON.stringify({...traktOptions, clientId: 'REDACTED', clientSecret: 'REDACTED'})}`);
  logger.silly(`flixPatrolTop10: ${JSON.stringify(flixPatrolTop10)}`);
  logger.silly(`flixPatrolPopulars: ${JSON.stringify(flixPatrolPopulars)}`);
  logger.silly(`flixPatrolMostWatched: ${JSON.stringify(flixPatrolMostWatched)}`);

  const flixpatrol = new FlixPatrol(cacheOptions);
  const trakt = new TraktAPI(traktOptions);

  trakt.connect().then(async () => {

    for (const top10 of flixPatrolTop10) {
      let listName: string;
      if (top10.name) {
        listName = top10.name.toLowerCase().replace(/\s+/g, '-');
      } else {
        // Simplified list name generation, adjust if needed
        listName = `${top10.platform}-${top10.location}-top10-${top10.type}`;
      }

      logger.info('==============================');
      logger.info(`Processing list: ${listName} (Type: ${top10.type})`);

      const html = await flixpatrol.getFlixPatrolHTMLPage(`/top10/${top10.platform}/${top10.location}`);

      // Ora riceve TraktIdWithTypeObject[] (già filtrato)
      const topItemsWithType: TraktIdWithTypeObject[] = await flixpatrol.getTop10(top10, trakt, html); // L'annotazione del tipo è corretta ora
      logger.debug(`Fetched ${topItemsWithType.length} items for ${listName}`);

      // Dividi gli elementi per tipo
      const movieItems = topItemsWithType.filter(item => item.type === 'movie');
      const showItems = topItemsWithType.filter(item => item.type === 'show');

      // Invia i film se il tipo è 'movies' o 'both'/'overall'
      if ((top10.type === 'movies' || top10.type === 'both' || top10.type === 'overall') && movieItems.length > 0) {
          logger.info(`Updating Trakt list ${listName} with ${movieItems.length} movies`);
          // Passa gli ID dei film e il tipo 'movie'
          await trakt.pushToList(movieItems.map(item => item.id), listName, 'movie' as TraktType, top10.privacy);
      } else if (top10.type === 'movies') {
          logger.info(`No movies found for ${listName}. Clearing list if necessary.`);
          await trakt.pushToList([], listName, 'movie' as TraktType, top10.privacy); // Svuota la lista
      }

      // Invia gli show se il tipo è 'shows' o 'both'/'overall'
      if ((top10.type === 'shows' || top10.type === 'both' || top10.type === 'overall') && showItems.length > 0) {
          logger.info(`Updating Trakt list ${listName} with ${showItems.length} shows`);
          // Passa gli ID degli show e il tipo 'show'
          await trakt.pushToList(showItems.map(item => item.id), listName, 'show' as TraktType, top10.privacy);
      } else if (top10.type === 'shows') {
          logger.info(`No shows found for ${listName}. Clearing list if necessary.`);
          await trakt.pushToList([], listName, 'show' as TraktType, top10.privacy); // Svuota la lista
      }
    }


    for (const popular of flixPatrolPopulars) {
      let listName: string;
      if (popular.name) {
        listName = popular.name.toLowerCase().replace(/\s+/g, '-');
      } else {
        listName = `${popular.platform}-popular-${popular.type}`;
      }

      logger.info('==============================');
      logger.info(`Processing list: ${listName} (Type: ${popular.type})`);

      // Ora riceve TraktIdWithTypeObject[]
      const popularItemsWithType: TraktIdWithTypeObject[] = await flixpatrol.getPopular(popular, trakt); // L'annotazione del tipo è corretta ora
      logger.debug(`Fetched ${popularItemsWithType.length} items for ${listName}`);

      // Dividi gli elementi per tipo
      const movieItems = popularItemsWithType.filter(item => item.type === 'movie');
      const showItems = popularItemsWithType.filter(item => item.type === 'show');

      // Invia i film se il tipo è 'movies' o 'both'/'overall'
      if ((popular.type === 'movies' || popular.type === 'both' || popular.type === 'overall') && movieItems.length > 0) {
          logger.info(`Updating Trakt list ${listName} with ${movieItems.length} movies`);
          await trakt.pushToList(movieItems.map(item => item.id), listName, 'movie' as TraktType, popular.privacy);
      } else if (popular.type === 'movies') {
          logger.info(`No movies found for ${listName}. Clearing list if necessary.`);
          await trakt.pushToList([], listName, 'movie' as TraktType, popular.privacy);
      }

      // Invia gli show se il tipo è 'shows' o 'both'/'overall'
      if ((popular.type === 'shows' || popular.type === 'both' || popular.type === 'overall') && showItems.length > 0) {
          logger.info(`Updating Trakt list ${listName} with ${showItems.length} shows`);
          await trakt.pushToList(showItems.map(item => item.id), listName, 'show' as TraktType, popular.privacy);
      } else if (popular.type === 'shows') {
          logger.info(`No shows found for ${listName}. Clearing list if necessary.`);
          await trakt.pushToList([], listName, 'show' as TraktType, popular.privacy);
      }
    }

    for (const mostWatched of flixPatrolMostWatched) {
      if (mostWatched.enabled) {
        let listName: string;
        if (mostWatched.name) {
          listName = mostWatched.name.toLowerCase().replace(/\s+/g, '-');
        } else {
          // Simplified name generation
          listName = `most-watched-${mostWatched.year}-${mostWatched.type}`;
          listName += mostWatched.original ? '-original' : '';
          listName += mostWatched.premiere ? `-${mostWatched.premiere}-premiere` : '';
          listName += mostWatched.country ? `-from-${mostWatched.country}` : '';
        }

        logger.info('==============================');
        logger.info(`Processing list: ${listName} (Type: ${mostWatched.type})`);

        // Ora riceve TraktIdWithTypeObject[]
        const mostWatchedItemsWithType: TraktIdWithTypeObject[] = await flixpatrol.getMostWatched(mostWatched, trakt); // L'annotazione del tipo è corretta ora
        logger.debug(`Fetched ${mostWatchedItemsWithType.length} items for ${listName}`);

        // Dividi gli elementi per tipo
        const movieItems = mostWatchedItemsWithType.filter(item => item.type === 'movie');
        const showItems = mostWatchedItemsWithType.filter(item => item.type === 'show');

        // Invia i film se il tipo è 'movies' o 'both'/'overall'
        if ((mostWatched.type === 'movies' || mostWatched.type === 'both' || mostWatched.type === 'overall') && movieItems.length > 0) {
            logger.info(`Updating Trakt list ${listName} with ${movieItems.length} movies`);
            await trakt.pushToList(movieItems.map(item => item.id), listName, 'movie' as TraktType, mostWatched.privacy);
        } else if (mostWatched.type === 'movies') {
            logger.info(`No movies found for ${listName}. Clearing list if necessary.`);
            await trakt.pushToList([], listName, 'movie' as TraktType, mostWatched.privacy);
        }

        // Invia gli show se il tipo è 'shows' o 'both'/'overall'
        if ((mostWatched.type === 'shows' || mostWatched.type === 'both' || mostWatched.type === 'overall') && showItems.length > 0) {
            logger.info(`Updating Trakt list ${listName} with ${showItems.length} shows`);
            await trakt.pushToList(showItems.map(item => item.id), listName, 'show' as TraktType, mostWatched.privacy);
        } else if (mostWatched.type === 'shows') {
            logger.info(`No shows found for ${listName}. Clearing list if necessary.`);
            await trakt.pushToList([], listName, 'show' as TraktType, mostWatched.privacy);
        }
      }
    }

  }).catch(error => {
    logger.error('Error during Trakt connection or processing:', error);
    process.exit(1);
  });

  process.on('SIGINT', () => {
    logger.info('System: Receive SIGINT signal');
    logger.info('System: Application stopped');
    process.exit();
  });
