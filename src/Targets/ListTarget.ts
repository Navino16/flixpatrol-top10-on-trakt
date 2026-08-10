/** The only two media kinds this project synchronises. */
export type MediaKind = 'movie' | 'show';

/**
 * Canonical iteration order of the media kinds, so a list is always processed
 * movies-first whatever the key order it was handed.
 */
export const MEDIA_KINDS: readonly MediaKind[] = ['movie', 'show'];

/** Privacy vocabulary of the configuration, inherited from Trakt. */
export type ListPrivacy = 'private' | 'link' | 'friends' | 'public';

export type TargetBackend = 'trakt' | 'floppy' | 'mdblist';

/**
 * A media as FlixPatrol describes it, before any resolution towards a backend.
 * `year` is null when the detail page exposes no usable year.
 */
export interface MediaItem {
  title: string;
  year: number | null;
}

/**
 * What a single `pushToList` call must make of a list, kind by kind. All three states
 * are distinct and meaningful:
 * - key absent: that kind is left untouched, its existing items stay in place;
 * - key present, non-empty: that kind's content is replaced by those ids;
 * - key present, empty: the kind was genuinely scraped empty, so its items are removed.
 *
 * The absent state is what lets one kind be written while the other is deliberately
 * spared, rather than wiping a list because a backend was failing.
 */
export type ListContent = Partial<Record<MediaKind, string[]>>;

export interface ListTarget {
  readonly backend: TargetBackend;

  /** True when the first setup requires a human interaction (Trakt device flow). */
  readonly requiresInteractiveAuth: boolean;

  /** True when the credentials at hand allow working without any interaction. */
  isAuthenticated(): boolean;

  connect(): Promise<void>;

  /**
   * Resolves media items to opaque identifiers specific to the backend.
   * Unresolved items are omitted after a warn, duplicates are discarded, and
   * the input order is preserved. The returned array can therefore be shorter.
   */
  resolveMany(items: MediaItem[], kind: MediaKind): Promise<string[]>;

  /**
   * Writes `listName` once with both media kinds, so the per-list work (lookup or
   * creation, description update) happens a single time. See `ListContent` for the
   * semantics of a present, empty or absent key.
   */
  pushToList(ids: ListContent, listName: string, privacy: ListPrivacy): Promise<void>;
}
