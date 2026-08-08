/** The only two media kinds this project synchronises. */
export type MediaKind = 'movie' | 'show';

/**
 * Canonical iteration order of the media kinds. Every write path walks it so a
 * list is always processed movies-first, whatever the order of the keys it was
 * handed.
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
 * What a single `pushToList` call must make of a list, kind by kind.
 *
 * The three states are distinct and all three are meaningful:
 * - key ABSENT: that kind is LEFT UNTOUCHED — its existing items stay in place;
 * - key present with a non-empty array: that kind's content is replaced by those ids;
 * - key present with an EMPTY array: the kind was genuinely scraped empty, so its
 *   existing items are removed.
 *
 * The absent state is what lets a caller write one kind while deliberately not
 * touching the other — the pipeline relies on it when a kind resolved to nothing
 * because the backend is failing, a case where wiping the list would lose user data.
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
   * Writes `listName` ONCE, both media kinds included, so everything that is
   * per-list (list lookup or creation, description update) happens a single
   * time whatever the number of kinds. See `ListContent` for the semantics of
   * a present, empty or absent key.
   */
  pushToList(ids: ListContent, listName: string, privacy: ListPrivacy): Promise<void>;
}
