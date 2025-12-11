# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build and Development Commands

```bash
npm install          # Install dependencies
npm run build        # Build TypeScript to build/
npm run start        # Build and run
npm run start:dev    # Development mode with nodemon hot reload
npm run lint         # Run ESLint
npm run lint-and-fix # Run ESLint with auto-fix
npm run package      # Create cross-platform binaries in bin/
```

## Architecture Overview

TypeScript CLI tool that scrapes FlixPatrol for streaming platform top 10 lists and syncs them to Trakt.tv user lists.

### Module Structure

```
src/
├── app.ts                      # Entry point
├── Flixpatrol/
│   ├── index.ts                # Exports FlixPatrol class and types
│   └── FlixPatrol.ts           # Web scraping logic
├── Trakt/
│   ├── index.ts                # Exports TraktAPI class and types
│   └── TraktAPI.ts             # Trakt.tv API wrapper
└── Utils/
    ├── index.ts                # Exports logger and Utils
    ├── Logger.ts               # Winston logger config
    ├── Utils.ts                # Helper functions (sleep, ensureConfigExist)
    └── GetAndValidateConfigs.ts # Config validation
```

### Core Components

**`src/app.ts`** - Entry point flow:
1. `Utils.ensureConfigExist()` - creates default config if missing
2. Loads and validates all configurations via `GetAndValidateConfigs`
3. Initializes `FlixPatrol` and `TraktAPI` instances
4. Calls `trakt.connect()` (OAuth device flow)
5. Processes Top10 → Popular → MostWatched lists sequentially
6. For each: scrape FlixPatrol → convert to Trakt IDs → sync list

**`src/Flixpatrol/FlixPatrol.ts`** - Web scraping:
- Platform/location constants defined as const arrays (type guards derive from these)
- Uses axios for HTTP requests with custom User-Agent
- HTML parsing via JSDOM with XPath expressions
- File-system caching with `file-system-cache` (SHA1 keys, TTL-based, separate caches for movies/TV shows)

**`src/Trakt/TraktAPI.ts`** - Trakt.tv integration:
- OAuth device flow: user visits verification_url, enters code, token saved to file
- List operations: get/create list, remove old items, add new items, update description
- Search: matches titles by name and year

**`src/Utils/GetAndValidateConfigs.ts`** - Configuration validation:
- Runtime validation of all config properties
- Exits with `process.exit(1)` on validation errors (no exception handling)

### Key Types

```typescript
// FlixPatrol types
type FlixPatrolTop10Platform = 'netflix' | 'hbo-max' | 'disney' | 'amazon-prime' | ... // 54 platforms
type FlixPatrolTop10Location = 'world' | 'france' | 'united-states' | ... // 200+ countries
type FlixPatrolPopularPlatform = 'movie-db' | 'imdb' | 'letterboxd' | ... // 14 sources
type FlixPatrolConfigType = 'movies' | 'shows' | 'both'

// Trakt types
type TraktTVId = number | null
type TraktTVIds = number[]
type TraktPrivacy = 'private' | 'link' | 'friends' | 'public'
```

### Configuration Structure

File: `config/default.json`

```typescript
{
  FlixPatrolTop10: [{
    platform: FlixPatrolTop10Platform,  // required
    location: FlixPatrolTop10Location,  // required
    fallback: FlixPatrolTop10Location | false,  // fallback location if no results
    privacy: TraktPrivacy,
    limit: number,  // >= 1
    type: 'movies' | 'shows' | 'both',
    name?: string,  // custom list name
    normalizeName?: boolean  // convert to kebab-case (default: true)
  }],
  FlixPatrolPopular: [{
    platform: FlixPatrolPopularPlatform,
    privacy: TraktPrivacy,
    limit: number,  // 1-100
    type: 'movies' | 'shows' | 'both',
    name?: string,
    normalizeName?: boolean
  }],
  FlixPatrolMostWatched: [{
    enabled: boolean,
    privacy: TraktPrivacy,
    limit: number,  // 1-50
    type: 'movies' | 'shows' | 'both',
    year: number,  // 2023-current year
    name?: string,
    normalizeName?: boolean,
    premiere?: number,  // filter by premiere year (1980+)
    country?: FlixPatrolTop10Location,
    original?: boolean,  // Netflix originals only
    orderByViews?: boolean  // sort by views instead of hours
  }],
  Trakt: {
    saveFile: string,  // OAuth token file path
    clientId: string,
    clientSecret: string
  },
  Cache: {
    enabled: boolean,
    savePath: string,  // cache directory
    ttl: number  // seconds (default: 604800 = 7 days)
  }
}
```

### XPath Expressions (FlixPatrol scraping)

Top10 (World):
```xpath
//div[h2[span[contains(., "TOP {type}")]]]/parent::div//a[contains(@class,'hover:underline')]/@href
```

Top10 (Regions) - tries multiple expressions:
```xpath
//div[h3[text() = "TOP 10 {type}"]]/parent::div//a[contains(@class,'hover:underline')]/@href
```

Popular/MostWatched:
```xpath
//table[@class="card-table"]//a[@class="flex gap-2 group items-center"]/@href
```

Detail page (title/year extraction):
```xpath
//div[contains(@class,"mb-6")]//h1[contains(@class,"mb-4")]/text()
//div[@class="mb-6"]//span[5]/span/text()
```

### Error Handling

- **Configuration errors**: `logger.error()` + `process.exit(1)`
- **API/Network errors**: `logger.error()` + `process.exit(1)` or return null
- **SIGINT**: Graceful shutdown with log message

### Rate Limiting

1-second sleep (`Utils.sleep(1000)`) between Trakt API calls to avoid rate limits:
- List creation
- Item removal/addition
- List updates

### Logging

Winston logger with format: `[YYYY-MM-DD HH:mm:ss.SSS][level] message`

Log levels via `LOG_LEVEL` env var: `error`, `warn`, `info` (default), `debug`, `silly`

Sensitive data (OAuth tokens) redacted in logs.

### Build Targets

Package creates binaries for:
- `node22-linux-x64`
- `node22-linux-arm64`
- `node22-macos-x64`
- `node22-win-x64`

### ESLint Rules

- Max line length: 120 chars (ignores strings and template literals)
- TypeScript strict mode enabled
- Ignores: `node_modules/`, `build/`
