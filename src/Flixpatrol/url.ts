import type { FlixPatrolMostWatched, FlixPatrolType } from '../types';

/**
 * Chemin d'une page Most-watched, grammaire relevée le 2026-09-16 :
 * /hours/netflix/{year}/world/[{genre}-]{movies|tv-shows}[-from-{country}][-{premiere}][-grouped]/
 *
 * `netflix` et `world` sont figés : les autres plateformes n'ont pas de données annuelles,
 * et un pays dans le segment de portée ne résout pas — il passe par `-from-`.
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
