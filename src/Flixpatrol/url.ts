import type { FlixPatrolMostWatched, FlixPatrolType } from '../types';

/**
 * Most-watched path grammar:
 * /hours/netflix/{year}/world/[{genre}-]{movies|tv-shows}[-from-{country}][-{premiere}][-grouped]/
 * `netflix`/`world` are fixed: other platforms lack yearly data; a country there won't resolve, use `-from-`.
 */
export function buildMostWatchedPath(
  config: FlixPatrolMostWatched,
  type: FlixPatrolType,
): string {
  const isMovies = type === 'Movies';
  let segment = isMovies ? 'movies' : 'tv-shows';

  if (config.genre !== undefined) {
    segment = `${config.genre}-${segment}`;
  }
  if (config.country !== undefined) {
    segment += `-from-${config.country}`;
  }
  if (config.premiere !== undefined) {
    segment += `-${config.premiere}`;
  }
  if (!isMovies) {
    segment += '-grouped';
  }

  return `/hours/netflix/${config.year}/world/${segment}/`;
}
