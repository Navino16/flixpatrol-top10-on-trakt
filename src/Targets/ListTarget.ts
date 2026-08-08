/** Les deux seuls types de médias que ce projet synchronise. */
export type MediaKind = 'movie' | 'show';

/** Vocabulaire de confidentialité de la configuration, hérité de Trakt. */
export type ListPrivacy = 'private' | 'link' | 'friends' | 'public';

export type TargetBackend = 'trakt' | 'floppy' | 'mdblist';

/**
 * Un média tel que FlixPatrol le décrit, avant toute résolution vers un backend.
 * `year` vaut null quand la page de détail n'expose pas d'année exploitable.
 */
export interface MediaItem {
  title: string;
  year: number | null;
}

export interface ListTarget {
  readonly backend: TargetBackend;

  /** Vrai quand le premier setup exige une interaction humaine (device flow Trakt). */
  readonly requiresInteractiveAuth: boolean;

  /** Vrai quand les credentials présents permettent de travailler sans interaction. */
  isAuthenticated(): boolean;

  connect(): Promise<void>;

  /**
   * Résout des médias vers des identifiants opaques propres au backend.
   * Les items non résolus sont omis après un warn, les doublons écartés,
   * l'ordre d'entrée préservé. Le tableau retourné peut donc être plus court.
   */
  resolveMany(items: MediaItem[], kind: MediaKind): Promise<string[]>;

  /** Remplace intégralement le contenu de `listName` pour le type `kind`. */
  pushToList(ids: string[], listName: string, kind: MediaKind, privacy: ListPrivacy): Promise<void>;
}
