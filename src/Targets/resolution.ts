import { logger } from '../Utils';
import type { MediaItem, MediaKind } from './ListTarget';
import type { ResolutionCache } from './ResolutionCache';

/**
 * Walks `items` in order, resolving one at a time, and collects the identifiers.
 *
 * The contract of `ListTarget.resolveMany` lives here: input order is preserved,
 * unresolved items are dropped, and duplicates are discarded. The resolution
 * stays strictly sequential — the backends this feeds are rate-limited or
 * quota-metered, so firing the searches in parallel would trade correctness for
 * a speed-up nobody asked for.
 */
export async function resolveSequentially(
  items: MediaItem[],
  resolveOne: (item: MediaItem) => Promise<string | null>,
): Promise<string[]> {
  const ids: string[] = [];
  for (const item of items) {
    const id = await resolveOne(item);
    if (id !== null && !ids.includes(id)) {
      ids.push(id);
    }
  }
  return ids;
}

/** What `resolveThroughCache` needs to turn a backend search into a cached resolution. */
export interface CachedResolution {
  cache: ResolutionCache;
  /** Backend name as it appears in the "no match" warning, e.g. `Trakt`, `Floppy`, `mdblist`. */
  backend: string;
  item: MediaItem;
  kind: MediaKind;
  /** Backend-specific search, returning the identifier to cache or null when nothing matched. */
  search: () => Promise<string | null>;
}

/**
 * Wraps a backend search with the level-2 cache and the warn-and-drop policy the
 * three adapters share: a hit short-circuits the search, a miss warns and
 * returns null, and only a successful resolution is written back.
 *
 * A miss is deliberately NOT cached: it usually means the backend's catalogue
 * lags behind FlixPatrol, and the next run should get a fresh chance rather than
 * inherit the gap for the whole TTL.
 */
export async function resolveThroughCache(resolution: CachedResolution): Promise<string | null> {
  const {
    cache, backend, item, kind, search,
  } = resolution;

  const cached = await cache.get(item, kind);
  if (cached !== null) return cached;

  const id = await search();
  if (id === null) {
    logger.warn(`No ${backend} match for ${kind} "${item.title}" (${item.year ?? 'unknown year'})`);
    return null;
  }

  await cache.set(item, kind, id);
  return id;
}
