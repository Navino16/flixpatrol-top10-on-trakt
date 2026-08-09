import fs from 'fs';
import { TraktAPI } from '../../Trakt';
import type { TraktListContent } from '../../Trakt';
import type { CacheOptions, TraktAPIOptions } from '../../types';
import type {
  ListContent, ListPrivacy, ListTarget, MediaItem, MediaKind, TargetBackend,
} from '../ListTarget';
import { ResolutionCache } from '../ResolutionCache';
import { resolveSequentially, resolveThroughCache } from '../resolution';

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
    return resolveSequentially(items, (item) => resolveThroughCache({
      cache: this.cache,
      backend: 'Trakt',
      item,
      kind,
      search: () => this.searchId(item, kind),
    }));
  }

  /**
   * Backend-specific half of the resolution. There is no shared match cascade
   * here: the Trakt client already returns a single best result, so the matching
   * happens server-side.
   */
  private async searchId(item: MediaItem, kind: MediaKind): Promise<string | null> {
    // Trakt expects a number: 0 means "year unknown", and its search then
    // falls back to the first textual result.
    const found = await this.trakt.getFirstItemByQuery(kind, item.title, item.year ?? 0);
    const traktId = kind === 'movie' ? found?.movie?.ids.trakt : found?.show?.ids.trakt;
    return traktId === undefined || traktId === null ? null : `${traktId}`;
  }

  public async pushToList(
    ids: ListContent,
    listName: string,
    privacy: ListPrivacy,
  ): Promise<void> {
    // The absent/present distinction is preserved on the way down: a kind the
    // caller omitted must stay omitted, never become an empty array, or the
    // Trakt layer would wipe it.
    const content: TraktListContent = {};
    if (ids.movie !== undefined) content.movie = ids.movie.map(Number);
    if (ids.show !== undefined) content.show = ids.show.map(Number);
    await this.trakt.pushToList(content, listName, privacy);
  }
}
