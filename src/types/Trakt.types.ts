export type TraktTVId = number | null;
export type TraktTVIds = number[];

export type TmdbMediaItem = { media_type: 'movie' | 'tv'; media_id: number };
export type TmdbMediaItems = TmdbMediaItem[];