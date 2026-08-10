import Cache, { FileSystemCache } from 'file-system-cache';
import type { CacheOptions } from '../types';
import type { MediaItem, MediaKind, TargetBackend } from './ListTarget';

/**
 * Maps a media item (title + year) to one backend's identifier. Kept separate from the
 * FlixPatrol scraping cache so switching backends never re-scrapes a detail page.
 */
export class ResolutionCache {
  private readonly cache: FileSystemCache | null = null;

  constructor(cacheOptions: CacheOptions, backend: TargetBackend) {
    if (cacheOptions.enabled) {
      this.cache = Cache({
        basePath: `${cacheOptions.savePath}/resolution-${backend}`,
        ns: `flixpatrol-resolution-${backend}`,
        hash: 'sha1',
        ttl: cacheOptions.ttl,
      });
    }
  }

  // A missing year is keyed as the literal `unknown`, which no real year can collide with.
  private static key(item: MediaItem, kind: MediaKind): string {
    return `${kind}|${item.title}|${item.year ?? 'unknown'}`;
  }

  public async get(item: MediaItem, kind: MediaKind): Promise<string | null> {
    if (this.cache === null) return null;
    const hit: unknown = await this.cache.get(ResolutionCache.key(item, kind), null);
    return typeof hit === 'string' && hit.length > 0 ? hit : null;
  }

  public async set(item: MediaItem, kind: MediaKind, id: string): Promise<void> {
    if (this.cache === null) return;
    await this.cache.set(ResolutionCache.key(item, kind), id);
  }
}
