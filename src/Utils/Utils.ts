import fs from 'fs';
import path from 'path';
import { logger } from './Logger';

/**
 * Scraping cache directories of 2.x. The move to a two-level cache
 * (`details` plus `resolution-<backend>`) left them behind, unread.
 */
const ORPHANED_CACHE_DIRECTORIES = ['movies', 'tv-shows'] as const;

export class Utils {
  public static sleep(time: number) {
    return new Promise((resolve) => { setTimeout(resolve, time); });
  }

  /**
   * Warns once when the 2.x cache directories are still on disk. They are never
   * deleted here: the app does not remove user files, and the cache directory is
   * often a mounted volume the user manages themselves.
   */
  public static warnAboutOrphanedCaches(savePath: string): void {
    const orphaned = ORPHANED_CACHE_DIRECTORIES
      .map((directory) => path.join(savePath, directory))
      .filter((directory) => fs.existsSync(directory));
    if (orphaned.length === 0) return;

    logger.warn(`Leftover cache director${orphaned.length > 1 ? 'ies' : 'y'} from a previous version `
      + `found: ${orphaned.join(', ')}. They are no longer read since the cache was split into `
      + '`details` and `resolution-<backend>`, and can safely be deleted.');
  }

  public static getListName(
    config: { name?: string; normalizeName?: boolean },
    defaultName: string,
    prefix?: string,
  ): string {
    const base = (() => {
      if (config.name && config.normalizeName === false) return config.name;
      if (config.name) return config.name.toLowerCase().replace(/\s+/g, '-');
      return defaultName;
    })();
    return prefix ? `${prefix}${base}` : base;
  }

  public static ensureConfigExist() {
    if (!fs.existsSync('./config/default.json')) {
      logger.warn('Default configuration file doesn\'t exist, creating it and exit. Please edit the config file');
      if (!fs.existsSync('./config')) {
        fs.mkdirSync('./config');
      }

      const defaultConfig = {
        FlixPatrolTop10: [
          {
            platform: 'netflix',
            location: 'world',
            fallback: false,
            privacy: 'private',
            limit: 10,
            name: 'Netflix Top 10 Movies',
            normalizeName: false,
            type: 'movies',
          },
          {
            platform: 'disney',
            location: 'world',
            fallback: false,
            privacy: 'private',
            limit: 10,
            name: 'Disney Plus Top 10 Shows',
            normalizeName: false,
            type: 'shows',
          },
          {
            platform: 'amazon-prime',
            location: 'world',
            fallback: false,
            privacy: 'private',
            limit: 10,
            name: 'Amazon Prime Top 10',
            normalizeName: false,
            type: 'both',
          },
          {
            platform: 'apple-tv',
            location: 'world',
            fallback: false,
            privacy: 'private',
            limit: 10,
            type: 'both',
          },
          {
            platform: 'paramount-plus',
            location: 'world',
            fallback: false,
            privacy: 'private',
            limit: 10,
            type: 'both',
          },
          {
            platform: 'netflix',
            location: 'united-states',
            fallback: false,
            privacy: 'private',
            limit: 10,
            name: 'Netflix Top 10 Kids',
            normalizeName: false,
            type: 'both',
            kids: true,
          },
        ],
        FlixPatrolPopular: [
          {
            platform: 'wikipedia',
            name: 'Most popular titles in Wikipedia',
            privacy: 'private',
            limit: 100,
            type: 'both',
          }
        ],
        FlixPatrolMostWatched: [
          {
            enabled: true,
            privacy: 'public',
            limit: 50,
            type: 'both',
            year: 2024,
          },
        ],
        FlixPatrolMostHours: [
          {
            enabled: true,
            privacy: 'public',
            limit: 50,
            type: 'both',
            period: 'total',
          },
          {
            enabled: true,
            privacy: 'public',
            limit: 50,
            type: 'both',
            period: 'first-week',
          },
          {
            enabled: true,
            privacy: 'public',
            limit: 50,
            type: 'both',
            period: 'first-month',
            language: 'english',
          },
        ],
        Target: {
          type: 'trakt',
          saveFile: './config/.trakt',
          clientId: 'You need to replace this client ID',
          clientSecret: 'You need to replace this client secret',
        },
        Cache: {
          enabled: true,
          savePath: './config/.cache',
          ttl: 604800,
        },
        Notifications: {
          run_start: [],
          run_end: [],
          error: [],
        },
        Schedule: {
          enabled: false,
          crons: ['0 6 * * *'],
          runOnStart: false,
        },
        FlareSolverr: {
          enabled: false,
          url: 'http://localhost:8191/v1',
          maxTimeout: 60000,
        },
      };

      fs.writeFileSync('./config/default.json', JSON.stringify(defaultConfig, null, 2) + '\n');
      process.exit(0);
    }
  }
}
