import fs from 'fs';
import { logger } from './Logger';

export class Utils {
  public static sleep(time: number) {
    return new Promise((resolve) => { setTimeout(resolve, time); });
  }

  public static getListName(
    config: { name?: string; normalizeName?: boolean },
    defaultName: string
  ): string {
    if (config.name && config.normalizeName === false) {
      return config.name;
    }
    if (config.name) {
      return config.name.toLowerCase().replace(/\s+/g, '-');
    }
    return defaultName;
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
            platform: 'movie-db',
            name: 'Most popular titles in Movie DBs',
            privacy: 'private',
            limit: 100,
            type: 'both',
          },
          {
            platform: 'imdb',
            privacy: 'private',
            limit: 100,
            type: 'both',
          },
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
        Trakt: {
          saveFile: './config/.trakt',
          clientId: 'You need to replace this client ID',
          clientSecret: 'You need to replace this client secret',
        },
        Cache: {
          enabled: true,
          savePath: './config/.cache',
          ttl: 604800,
        },
      };

      fs.writeFileSync('./config/default.json', JSON.stringify(defaultConfig, null, 2) + '\n');
      process.exit(0);
    }
  }
}
