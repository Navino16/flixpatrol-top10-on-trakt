import type {
  TraktAccessExport,
  TraktIds,
  TraktItem,
  TraktList,
  TraktPrivacy,
  TraktSearchItem,
  TraktSearchType,
  TraktType,
  UsersListItemsAddRemove,
} from 'trakt.tv';
import Trakt from 'trakt.tv';
import fs from 'fs';
import { logger, Utils, TraktError } from '../Utils';
import type { TraktAPIOptions, TraktTVIds } from '../types';

interface TraktAPIRuntimeOptions extends TraktAPIOptions {
  dryRun?: boolean;
}

export class TraktAPI {
  private trakt: Trakt;

  private readonly traktSaveFile: string;

  private readonly dryRun: boolean;

  constructor(options: TraktAPIRuntimeOptions) {
    this.trakt = new Trakt({
      client_id: options.clientId,
      client_secret: options.clientSecret,
    });
    this.traktSaveFile = options.saveFile;
    this.dryRun = options.dryRun ?? false;
  }

  public async connect(): Promise<void> {
    if (fs.existsSync(this.traktSaveFile)) {
      logger.info(`Loading trakt informations from file ${this.traktSaveFile}`);
      let token: TraktAccessExport;
      try {
        const data = fs.readFileSync(this.traktSaveFile, 'utf8');
        token = JSON.parse(data);
      } catch (err) {
        logger.error(`Error reading Trakt token file: ${err}`);
        logger.warn(`Deleting corrupted token file ${this.traktSaveFile} and reinitializing`);
        fs.unlinkSync(this.traktSaveFile);
        return this.connect();
      }
      const newToken = await this.trakt.import_token(token);
      logger.debug(`Trakt informations from file ${this.traktSaveFile} loaded`);
      fs.writeFileSync(this.traktSaveFile, JSON.stringify(newToken));
      logger.debug(`Trakt informations saved to file ${this.traktSaveFile}`);
    } else {
      logger.info(`No trakt file ${this.traktSaveFile} found, initializing a new trakt connection`);
      try {
        const traktPoll = await this.trakt.get_codes();
        logger.info(`Please open the verification url: ${traktPoll.verification_url}`);
        logger.info(`And enter the following code: ${traktPoll.user_code}`);
        await this.trakt.poll_access(traktPoll);
        logger.info('Your are now connected to Trakt');
        const token = this.trakt.export_token();
        fs.writeFileSync(this.traktSaveFile, JSON.stringify(token));
        logger.debug(`Trakt informations saved to file ${this.traktSaveFile}`);
      } catch (connectErr) {
        throw new TraktError(`Connection failed: ${(connectErr as Error).message}`);
      }
    }
  }

  private async getList(listName: string, privacy: TraktPrivacy): Promise<TraktList> {
    let list: TraktList;
    const slug = listName.toLowerCase().replace(/\s+/g, '-');
    try {
      logger.info(`Getting list "${listName}" from trakt`);
      list = await this.trakt.users.list.get({ username: 'me', id: slug });
    } catch (getErr) {
      if ((getErr as Error).message.includes('404 (Not Found)')) {
        if (this.dryRun) {
          logger.info(`[DRY-RUN] Would create list "${listName}" with privacy "${privacy}"`);
          // Return a mock list object for dry-run mode
          return {
            name: listName,
            privacy,
            ids: { trakt: 0, slug },
          } as TraktList;
        }
        logger.warn(`List "${listName}" was not found on trakt, creating it`);
        try {
          // Avoid Trakt rate limit
          await Utils.sleep(1000);
          list = await this.trakt.users.lists.create({ username: 'me', name: listName, privacy });
        } catch (createErr) {
          throw new TraktError(`Failed to create list "${listName}": ${(createErr as Error).message}`);
        }
      } else {
        throw new TraktError(`Failed to get list "${listName}": ${(getErr as Error).message}`);
      }
    }
    logger.silly(`Trakt list: ${JSON.stringify(list)}`)
    return list;
  }

  private async getListItems(list: TraktList, type: TraktType): Promise<TraktItem[]> {
    // In dry-run mode with mock list (id=0), return empty array
    if (this.dryRun && list.ids.trakt === 0) {
      logger.info(`[DRY-RUN] List "${list.name}" is new, no existing items to fetch`);
      return [];
    }
    logger.info(`Getting items from trakt list "${list.name}"`);
    let items: TraktItem[];
    try {
      items = await this.trakt.users.list.items.get({ username: 'me', id: `${list.ids.trakt}`, type });
    } catch (err) {
      throw new TraktError(`Failed to get list items for "${list.name}": ${(err as Error).message}`);
    }
    logger.silly(`Trakt list items: ${JSON.stringify(items)}`)
    return items;
  }

  private static getItemTraktId(item: TraktItem): number | undefined {
    switch (item.type) {
      case 'movie':
        return item.movie?.ids.trakt as number | undefined;
      case 'show':
        return item.show?.ids.trakt as number | undefined;
      case 'season':
        return item.season?.ids.trakt as number | undefined;
      case 'episode':
        return item.episode?.ids.trakt as number | undefined;
      case 'person':
        return item.person?.ids.trakt as number | undefined;
      default:
        return undefined;
    }
  }

  private async removeListItems(list: TraktList, items: TraktItem[], type: TraktType): Promise<void> {
    if (this.dryRun) {
      logger.info(`[DRY-RUN] Would remove ${items.length} ${type}(s) from list "${list.name}"`);
      return;
    }
    logger.info(`Trakt list "${list.name}" contain ${items.length} ${type}, removing them`);
    const toRemove: { ids: TraktIds }[] = [];
    items.forEach((item) => {
      const id = TraktAPI.getItemTraktId(item);
      toRemove.push({ ids: { trakt: id } });
    });
    logger.silly(`Trakt id items to remove: ${JSON.stringify(toRemove)}`)
    const body: UsersListItemsAddRemove = {
      id: `${list.ids.trakt}`,
      username: 'me',
      movies: [],
      shows: [],
      seasons: [],
      episodes: [],
      people: [],
    };
    if (type === 'movie') {
      body.movies = toRemove;
    } else {
      body.shows = toRemove;
    }
    try {
      // Avoid Trakt rate limit
      await Utils.sleep(1000);
      await this.trakt.users.list.items.remove(body);
    } catch (err) {
      throw new TraktError(`Failed to remove items from list "${list.name}": ${(err as Error).message}`);
    }
  }

  private async addItemsToList(list: TraktList, traktTVIDs: TraktTVIds, type: TraktType) {
    if (this.dryRun) {
      logger.info(`[DRY-RUN] Would add ${traktTVIDs.length} ${type}(s) to list "${list.name}"`);
      return;
    }
    logger.info(`Adding ${traktTVIDs.length} ${type} into Trakt list "${list.name}"`);
    const toAdd: { ids: TraktIds }[] = [];
    traktTVIDs.forEach((traktTVID) => {
      toAdd.push({ ids: { trakt: traktTVID } });
    });
    logger.silly(`Trakt id items to add: ${JSON.stringify(toAdd)}`)
    const body: UsersListItemsAddRemove = {
      id: `${list.ids.trakt}`,
      username: 'me',
      movies: [],
      shows: [],
      seasons: [],
      episodes: [],
      people: [],
    };
    if (type === 'movie') {
      body.movies = toAdd;
    } else {
      body.shows = toAdd;
    }
    try {
      // Avoid Trakt rate limit
      await Utils.sleep(1000);
      await this.trakt.users.list.items.add(body);
    } catch (err) {
      throw new TraktError(`Failed to add items to list "${list.name}": ${(err as Error).message}`);
    }
  }

  public async pushToList(traktTVIDs: TraktTVIds, listName: string, type: TraktType, privacy: TraktPrivacy) {
    let list = await this.getList(listName, privacy);
    if (list.privacy !== privacy) {
      if (this.dryRun) {
        logger.info(`[DRY-RUN] Would update list "${list.name}" privacy from "${list.privacy}" to "${privacy}"`);
      } else {
        logger.warn(`Trakt list "${list.name}" privacy (${list.privacy}) doesn't match the wanted privacy (${privacy}), updating list privacy`);
        // Avoid Trakt rate limit
        await Utils.sleep(1000);
        list = await this.trakt.users.list.update({ username: 'me', id: `${list.ids.slug}`, privacy });
      }
    }
    const items = await this.getListItems(list, type);
    if (items.length > 0) {
      await this.removeListItems(list, items, type);
    }
    if (traktTVIDs.length > 0) {
      await this.addItemsToList(list, traktTVIDs, type);
      const dateOptions: Intl.DateTimeFormatOptions = {
        weekday: 'short', year: 'numeric', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', hour12: false, timeZoneName: 'short',
      };
      const currentDate = new Date().toLocaleString(undefined, dateOptions);
      const updatedString = `Last Updated: ${currentDate}`;
      if (this.dryRun) {
        logger.info(`[DRY-RUN] Would update list description to: "${updatedString}"`);
      } else {
        await Utils.sleep(1000);
        logger.info(`Updating list description: "${updatedString}"`);
        await this.trakt.users.list.update({ username: 'me', id: `${list.ids.slug}`, description: updatedString });
      }
    }
  }

  // eslint-disable-next-line max-len
  public async getFirstItemByQuery(searchType: TraktSearchType, title: string, year: number): Promise<TraktSearchItem | null> {
    const items = await this.trakt.search.text({
      type: searchType,
      query: title,
      fields: 'title',
    });

    logger.silly(`Items found on Trakt: ${JSON.stringify(items)}`)

    for (const item of items) {
      if (searchType === 'movie' && item.movie?.year === year) {
        return item;
      }
      if (searchType === 'show' && item.show?.year === year) {
        return item;
      }
    }

    return items.length > 0 ? items[0] : null;
  }
}
