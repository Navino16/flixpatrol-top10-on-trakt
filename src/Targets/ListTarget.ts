/** The only two media kinds this project synchronises. */
export type MediaKind = 'movie' | 'show';

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

  /** Entirely replaces the content of `listName` for the `kind` media type. */
  pushToList(ids: string[], listName: string, kind: MediaKind, privacy: ListPrivacy): Promise<void>;
}
