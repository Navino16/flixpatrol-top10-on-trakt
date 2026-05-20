export type TraktTVId = number | null;
export type TraktItemRef = { trakt: number } | { tmdb: number };
export type TraktTVIds = TraktItemRef[];

export type TmdbMediaItem = { media_type: 'movie' | 'tv'; media_id: number };
export type TmdbMediaItems = TmdbMediaItem[];