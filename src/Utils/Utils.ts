import fs from 'fs';
import { logger } from './Logger';

export class Utils {
  public static sleep(time: number) {
    return new Promise((resolve) => { setTimeout(resolve, time); });
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
        + '      "type": "movies"\n'
        + '    },\n'
        + '    {\n'
        + '      "platform": "disney",\n'
        + '      "location": "world",\n'
        + '      "fallback": false,\n'
        + '      "privacy": "private",\n'
        + '      "limit": 10,\n'
        + '      "name": "Disney Plus Top 10 Shows",\n'
        + '      "type": "shows"\n'
        + '    },\n'
        + '    {\n'
        + '      "platform": "amazon-prime",\n'
        + '      "location": "world",\n'
        + '      "fallback": false,\n'
        + '      "privacy": "private",\n'
        + '      "limit": 10,\n'
        + '      "name": "Amazon Prime Top 10",\n'
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
        + '    }\n'
        + '  ],\n'
        + '  "FlixPatrolPopular": [\n'
        + '    {\n'
        + '      "platform": "movie-db",\n'
        + '      "privacy": "private",\n'
        + '      "limit": 100\n'
        + '    }\n'
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
        + '  }'
        + '}\n');
      process.exit(0);
    }
  }
}
