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
      fs.writeFileSync('./config/default.json', '{\n'
        + '  "FlixPatrolTop10": [\n'
        + '    {\n'
        + '      "platform": "netflix",\n'
        + '      "location": "world",\n'
        + '      "fallback": false,\n'
        + '      "privacy": "private",\n'
        + '      "limit": 10,\n'
        + '      "name": "Netflix Top 10 Movies",\n'
        + '      "normalizeName": false,\n'
        + '      "type": "movies"\n'
        + '    },\n'
        + '    {\n'
        + '      "platform": "disney",\n'
        + '      "location": "world",\n'
        + '      "fallback": false,\n'
        + '      "privacy": "private",\n'
        + '      "limit": 10,\n'
        + '      "name": "Disney Plus Top 10 Shows",\n'
        + '      "normalizeName": false,\n'
        + '      "type": "shows"\n'
        + '    },\n'
        + '    {\n'
        + '      "platform": "amazon-prime",\n'
        + '      "location": "world",\n'
        + '      "fallback": false,\n'
        + '      "privacy": "private",\n'
        + '      "limit": 10,\n'
        + '      "name": "Amazon Prime Top 10",\n'
        + '      "normalizeName": false,\n'
        + '      "type": "both"\n'
        + '    },\n'
        + '    {\n'
        + '      "platform": "apple-tv",\n'
        + '      "location": "world",\n'
        + '      "fallback": false,\n'
        + '      "privacy": "private",\n'
        + '      "limit": 10,\n'
        + '      "type": "both"\n'
        + '    },\n'
        + '    {\n'
        + '      "platform": "paramount-plus",\n'
        + '      "location": "world",\n'
        + '      "fallback": false,\n'
        + '      "privacy": "private",\n'
        + '      "limit": 10,\n'
        + '      "type": "both"\n'
        + '    },\n'
        + '    {\n'
        + '      "platform": "netflix",\n'
        + '      "location": "united-states",\n'
        + '      "fallback": false,\n'
        + '      "privacy": "private",\n'
        + '      "limit": 10,\n'
        + '      "name": "Netflix Top 10 Kids",\n'
        + '      "normalizeName": false,\n'
        + '      "type": "both",\n'
        + '      "kids": true\n'
        + '    }\n'
        + '  ],\n'
        + '  "FlixPatrolPopular": [\n'
        + '    {\n'
        + '      "platform": "movie-db",\n'
        + '      "name": "Most popular titles in Movie DBs",\n'
        + '      "privacy": "private",\n'
        + '      "limit": 100,\n'
        + '      "type": "both"\n'
        + '    },\n'
        + '    {\n'
        + '      "platform": "imdb",\n'
        + '      "privacy": "private",\n'
        + '      "limit": 100,\n'
        + '      "type": "both"\n'
        + '    }\n'
        + '  ],\n'
        + '  "FlixPatrolMostWatched": [\n'
        + '     {\n'
        + '       "enabled": true,\n'
        + '       "privacy": "public",\n'
        + '       "limit": 50,\n'
        + '       "type": "both",\n'
        + '       "year": 2024\n'
        + '     }\n'
        + '  ],\n'
        + '  "FlixPatrolMostHours": [\n'
        + '     {\n'
        + '       "enabled": true,\n'
        + '       "privacy": "public",\n'
        + '       "limit": 50,\n'
        + '       "type": "both",\n'
        + '       "period": "total"\n'
        + '     },\n'
        + '     {\n'
        + '       "enabled": true,\n'
        + '       "privacy": "public",\n'
        + '       "limit": 50,\n'
        + '       "type": "both",\n'
        + '       "period": "first-week"\n'
        + '     },\n'
        + '     {\n'
        + '       "enabled": true,\n'
        + '       "privacy": "public",\n'
        + '       "limit": 50,\n'
        + '       "type": "both",\n'
        + '       "period": "first-month",\n'
        + '       "language": "english"\n'
        + '     }\n'
        + '  ],\n'
        + '  "Trakt": {\n'
        + '    "saveFile": "./config/.trakt",\n'
        + '    "clientId": "You need to replace this client ID",\n'
        + '    "clientSecret": "You need to replace this client secret"\n'
        + '  },\n'
        + '  "Cache": {\n'
        + '    "enabled": true,\n'
        + '    "savePath": "./config/.cache",\n'
        + '    "ttl": 604800\n'
        + '  }\n'
        + '}\n');
      process.exit(0);
    }
  }
}
