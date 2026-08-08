import fs from 'fs';
import { TraktAPI } from '../../Trakt';
import { logger } from '../../Utils';
import type { CacheOptions, TraktAPIOptions } from '../../types';
import type {
  ListPrivacy, ListTarget, MediaItem, MediaKind, TargetBackend,
} from '../ListTarget';
import { ResolutionCache } from '../ResolutionCache';

export class TraktTarget implements ListTarget {
  public readonly backend: TargetBackend = 'trakt';

  public readonly requiresInteractiveAuth = true;

  private readonly trakt: TraktAPI;

  private readonly saveFile: string;

  private readonly cache: ResolutionCache;

  constructor(options: TraktAPIOptions, cacheOptions: CacheOptions, dryRun: boolean) {
    this.trakt = new TraktAPI({ ...options, dryRun });
    this.saveFile = options.saveFile;
    this.cache = new ResolutionCache(cacheOptions, 'trakt');
  }

  public isAuthenticated(): boolean {
    return fs.existsSync(this.saveFile);
  }

  public async connect(): Promise<void> {
    await this.trakt.connect();
  }

  public async resolveMany(items: MediaItem[], kind: MediaKind): Promise<string[]> {
    const ids: string[] = [];
    for (const item of items) {
      const id = await this.resolveOne(item, kind);
      if (id !== null && !ids.includes(id)) {
        ids.push(id);
      }
    }
    return ids;
  }

  private async resolveOne(item: MediaItem, kind: MediaKind): Promise<string | null> {
    const cached = await this.cache.get(item, kind);
    if (cached !== null) return cached;

    // Trakt expects a number: 0 means "year unknown", and its search then
    // falls back to the first textual result.
    const found = await this.trakt.getFirstItemByQuery(kind, item.title, item.year ?? 0);
    const traktId = kind === 'movie' ? found?.movie?.ids.trakt : found?.show?.ids.trakt;
    if (traktId === undefined || traktId === null) {
      logger.warn(`No Trakt match for ${kind} "${item.title}" (${item.year ?? 'unknown year'})`);
      return null;
    }

    const id = `${traktId}`;
    await this.cache.set(item, kind, id);
    return id;
  }

  public async pushToList(
    ids: string[],
    listName: string,
    kind: MediaKind,
    privacy: ListPrivacy,
  ): Promise<void> {
    await this.trakt.pushToList(ids.map(Number), listName, kind, privacy);
  }
}
