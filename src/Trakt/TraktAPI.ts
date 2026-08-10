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

/** The two Trakt item types this project writes; the others are never pushed. */
export type TraktMediaType = Extract<TraktType, 'movie' | 'show'>;

/**
 * Ids to write per media type. An absent key leaves that type untouched; a present key,
 * even empty, replaces its content.
 */
export type TraktListContent = Partial<Record<TraktMediaType, TraktTVIds>>;

const TRAKT_MEDIA_TYPES: readonly TraktMediaType[] = ['movie', 'show'];

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

  // Match Trakt's own slug normalization: lowercase, collapse any run of
  // non-alphanumeric characters into a single hyphen, trim leading/trailing
  // hyphens. Naive `replace(/\s+/g, '-')` left brackets and other punctuation
  // intact and produced slugs that did not match the canonical form Trakt
  // stores, so `.get()` could return partial data instead of 404 → crash.
  private static toTraktSlug(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }

  private static isValidList(list: unknown): list is TraktList {
    return !!list
      && typeof list === 'object'
      && 'ids' in list
      && !!(list as TraktList).ids
      && typeof (list as TraktList).ids.slug === 'string';
  }

  private async getList(listName: string, privacy: TraktPrivacy): Promise<TraktList> {
    const slug = TraktAPI.toTraktSlug(listName);
    let list: TraktList | undefined;
    let notFound = false;

    try {
      logger.info(`Getting list "${listName}" from trakt`);
      list = await this.trakt.users.list.get({ username: 'me', id: slug });
    } catch (getErr) {
      if ((getErr as Error).message.includes('404 (Not Found)')) {
        notFound = true;
      } else {
        throw new TraktError(`Failed to get list "${listName}": ${(getErr as Error).message}`);
      }
    }

    // Trakt answers some missing-list lookups with HTTP 200 and an empty body
    // (`list === ""`) rather than a 404, so the success path needs its own shape check.
    if (!notFound && !TraktAPI.isValidList(list)) {
      logger.debug(`Trakt returned malformed response for "${listName}" (got ${JSON.stringify(list)}), treating as not-found`);
      notFound = true;
    }

    if (notFound) {
      if (this.dryRun) {
        logger.info(`[DRY-RUN] Would create list "${listName}" with privacy "${privacy}"`);
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
      if (!TraktAPI.isValidList(list)) {
        throw new TraktError(`Failed to create list "${listName}": Trakt returned a malformed response`);
      }
    }

    logger.silly(`Trakt list: ${JSON.stringify(list)}`);
    return list as TraktList;
  }

  /**
   * Reads the whole list, deliberately unfiltered.
   *
   * The `trakt.tv` client sends `type` as a query parameter, while the Trakt API expects
   * it as a path segment (`/items/:type`). Trakt silently ignores the query parameter and
   * returns every item whatever `type` is passed, so filtering has to happen in memory —
   * callers narrow on `item.type` via `filterByType`.
   *
   * Do not "optimise" this back into a server-side filter without first checking that the
   * client puts `type` in the path.
   */
  private async getListItems(list: TraktList): Promise<TraktItem[]> {
    // In dry-run mode with mock list (id=0), return empty array
    if (this.dryRun && list.ids.trakt === 0) {
      logger.info(`[DRY-RUN] List "${list.name}" is new, no existing items to fetch`);
      return [];
    }
    logger.info(`Getting items from trakt list "${list.name}"`);
    let items: TraktItem[];
    try {
      items = await this.trakt.users.list.items.get({ username: 'me', id: `${list.ids.trakt}` });
    } catch (err) {
      throw new TraktError(`Failed to get list items for "${list.name}": ${(err as Error).message}`);
    }
    logger.silly(`Trakt list items: ${JSON.stringify(items)}`)
    return items;
  }

  /** Narrows an unfiltered list read down to a single media type. */
  private static filterByType(items: TraktItem[], type: TraktMediaType): TraktItem[] {
    return items.filter((item) => item.type === type);
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

  private async touchDescription(list: TraktList): Promise<void> {
    const dateOptions: Intl.DateTimeFormatOptions = {
      weekday: 'short', year: 'numeric', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', hour12: false, timeZoneName: 'short',
    };
    const currentDate = new Date().toLocaleString(undefined, dateOptions);
    const updatedString = `Last Updated: ${currentDate}`;
    if (this.dryRun) {
      logger.info(`[DRY-RUN] Would update list description to: "${updatedString}"`);
      return;
    }
    // Avoid Trakt rate limit
    await Utils.sleep(1000);
    logger.info(`Updating list description: "${updatedString}"`);
    await this.trakt.users.list.update({ username: 'me', id: `${list.ids.slug}`, description: updatedString });
  }

  /**
   * Writes both media types in a single pass over the list, so the per-list work — lookup
   * or creation, privacy alignment, the "Last Updated" description, and the items read —
   * happens exactly once whatever the number of types written. That read cannot be
   * type-filtered server side (see `getListItems`), so one read serves every kind.
   */
  public async pushToList(content: TraktListContent, listName: string, privacy: TraktPrivacy) {
    const types = TRAKT_MEDIA_TYPES.filter((type) => content[type] !== undefined);
    if (types.length === 0) {
      return;
    }

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

    // One read for the whole list, narrowed per kind in memory.
    const listItems = await this.getListItems(list);

    let added = false;
    for (const type of types) {
      const traktTVIDs = content[type] as TraktTVIds;
      const items = TraktAPI.filterByType(listItems, type);
      if (items.length > 0) {
        await this.removeListItems(list, items, type);
      }
      if (traktTVIDs.length > 0) {
        await this.addItemsToList(list, traktTVIDs, type);
        added = true;
      }
    }

    if (added) {
      await this.touchDescription(list);
    }
  }

  // eslint-disable-next-line max-len
  public async getFirstItemByQuery(searchType: TraktSearchType, title: string, year: number): Promise<TraktSearchItem | null> {
    let items: TraktSearchItem[];
    try {
      items = await this.trakt.search.text({
        type: searchType,
        query: title,
        fields: 'title',
      });
    } catch (err) {
      logger.warn(`Trakt search failed for ${searchType} "${title}" (${year}): ${(err as Error).message}. Skipping item.`);
      return null;
    }

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
