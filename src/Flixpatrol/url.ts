import type { FlixPatrolMostWatched, FlixPatrolType, FlixPatrolWeekly, FlixPatrolWeeklyPlatform } from '../types';

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

/** The one page that serves every platform's latest week; also carries the week index. */
export const WEEKLY_INDEX_PATH = '/hours/';

export function buildWeeklyCountryPath(
  platform: FlixPatrolWeeklyPlatform,
  week: string,
  country: string,
): string {
  return `/hours/${platform}/${week}/${country}/`;
}

const WEEKLY_PLATFORM_LABEL: Record<FlixPatrolWeeklyPlatform, string> = {
  'netflix': 'Netflix',
  'amazon-prime': 'Amazon Prime',
};

// FlixPatrol prints "Not English"; the config says "non-english".
const WEEKLY_LANGUAGE_LABEL = { english: 'English', 'non-english': 'Not English' } as const;

export function weeklyHeadings(config: FlixPatrolWeekly, type: FlixPatrolType): string[] {
  if (config.location !== 'world') {
    return [`TOP 10 ${type} Official Rankings`];
  }
  const platform = WEEKLY_PLATFORM_LABEL[config.platform];
  const languages = config.language === 'all'
    ? (['english', 'non-english'] as const)
    : ([config.language] as const);
  return languages.map((l) => `${platform} TOP 10 ${type} (in ${WEEKLY_LANGUAGE_LABEL[l]})`);
}
