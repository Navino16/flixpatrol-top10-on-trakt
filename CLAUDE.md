# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build and Development Commands

```bash
npm install          # Install dependencies
npm run build        # Build TypeScript to build/
npm run start        # Build and run
npm run start:dev    # Development mode with nodemon hot reload
npm test             # Run the test suite once (vitest)
npm run test:watch   # Run tests in watch mode
npm run test:coverage # Run tests with coverage (reports in .reports/coverage)
npm run lint         # Run ESLint
npm run lint-and-fix # Run ESLint with auto-fix
npm run package      # Create cross-platform binaries in bin/
```

### Environment Variables

| Variable | Effect |
|---|---|
| `LOG_LEVEL` | `error`, `warn`, `info` (default), `debug`, `silly` |
| `DRY_RUN` | `true` skips every Trakt write; lists are computed and logged only |
| `LIST_NAME_PREFIX` | Prefixes every list name, e.g. `[TEST]`. Use it for local runs so real lists are never touched |

When running the app locally to verify a change by hand, always set
`LIST_NAME_PREFIX="[TEST]"` so nothing writes to the real lists.

## Architecture Overview

TypeScript CLI tool that scrapes FlixPatrol for streaming platform top 10 lists and syncs them to Trakt.tv user lists.

### Module Structure

```
src/
├── app.ts                      # Entry point: bootstrap, one-shot vs daemon mode
├── Flixpatrol/
│   ├── index.ts                # Exports FlixPatrol class and types
│   └── FlixPatrol.ts           # Web scraping logic
├── FlareSolverr/
│   ├── index.ts                # Exports FlareSolverrClient
│   └── FlareSolverrClient.ts   # FlareSolverr v1 protocol client (sessions + request.get)
├── Trakt/
│   ├── index.ts                # Exports TraktAPI class and types
│   └── TraktAPI.ts             # Trakt.tv API wrapper
├── Targets/
│   ├── index.ts                # Exports ListTarget, createTarget and target types
│   ├── ListTarget.ts           # ListTarget interface + MediaItem/MediaKind/ListPrivacy/TargetBackend
│   ├── createTarget.ts         # Factory: TargetOptions -> concrete adapter
│   ├── privacy.ts              # isPrivate() — maps the 4-level privacy vocabulary to a boolean
│   ├── ResolutionCache.ts      # Level-2 cache: media item -> backend id, one namespace per backend
│   └── adapters/               # TraktTarget, FloppyTarget, MdblistTarget
├── Pipeline/
│   ├── index.ts                # Exports runPipeline
│   └── runPipeline.ts          # One run: FlareSolverr session lifecycle + all list processing
├── Scheduler/
│   ├── index.ts                # Exports Scheduler
│   └── Scheduler.ts            # Daemon mode: cron-driven repeated runs
├── Notifications/
│   ├── index.ts                # Exports NotificationManager and types
│   ├── NotificationManager.ts  # Dispatches events to configured destinations
│   ├── Notifier.ts             # Notifier interface
│   ├── http.ts                 # POST helper with timeout and no-throw contract
│   ├── types.ts                # Notification config/event types
│   └── adapters/               # webhook, gotify, ntfy, apprise
├── types/
│   ├── index.ts                # Barrel for all types
│   ├── Config.types.ts         # Zod schemas + inferred config types
│   ├── FlixPatrol.types.ts     # Platform/location/type unions
│   └── Trakt.types.ts          # Trakt id types
└── Utils/
    ├── index.ts                # Exports logger, Utils, errors, package info
    ├── Logger.ts               # Winston logger config
    ├── Utils.ts                # Helper functions (sleep, getListName, ensureConfigExist)
    ├── Errors.ts               # AppError + Configuration/FlixPatrol/FlareSolverr + TargetError (Trakt/Floppy/Mdblist)
    ├── getPackageInfo.ts       # Reads name/version for logs and notifications
    └── GetAndValidateConfigs.ts # Config validation
```

### Core Components

**`src/app.ts`** - Entry point flow:
1. `Utils.ensureConfigExist()` - creates default config if missing
2. Builds the `NotificationManager` early, so later failures can be notified. Two failures cannot be: a config file that can't be written, and a broken `Notifications` block — no working notifier exists yet at that point.
3. Loads and validates all configurations via `GetAndValidateConfigs`
4. Branches on `Schedule.enabled`:
   - **one-shot** (default, or when no Trakt token exists yet): runs the pipeline once, then exits. `SIGINT` dispatches an `error` notification and exits 130.
   - **daemon**: hands the pipeline to `Scheduler`, which re-runs it on each cron tick. `SIGTERM`/`SIGINT` stop the scheduler gracefully.
5. Every exit path flushes pending notification dispatches before `process.exit`, so fire-and-forget notifications are not cut off.

**`src/Pipeline/runPipeline.ts`** - One run. It orchestrates two distinct phases — *resolution* then *writing* — and delegates both to the `ListTarget` it receives; it never talks to a backend API itself:
1. Creates the FlareSolverr session, if enabled (before any list, so a dead container fails fast)
2. Initializes `FlixPatrol`. The `ListTarget` is **not** built here: `app.ts` builds it once per process and passes it in, so the daemon auth gate and every scheduled run share one adapter and one resolution cache
3. Calls `target.connect()` (a no-op for floppy/mdblist, the OAuth device flow for trakt)
4. Dispatches `run_start`, then processes Top10 → Popular → MostWatched → MostHours sequentially. For each section: scrape FlixPatrol into `MediaItem[]` (title + year) → `target.resolveMany()` for backend ids → `target.pushToList()` to replace the list content
5. Dispatches `run_end` with a summary (lists processed, movies/shows added, duration)
6. Destroys the FlareSolverr session in a `finally` block, so it also covers the early abort paths and thrown errors

`FlixPatrol` no longer knows about any backend: it returns `MediaItem[]` and nothing else. All id resolution lives behind `ListTarget`.

Guard in `syncSection`: `pushToList` **replaces** the list content, so a scrape that produced items but resolved to zero ids leaves the list untouched instead of wiping it — that combination means the backend is failing, not that the list should be emptied. A genuinely empty scrape keeps its previous behaviour.

Between lists, an abort checkpoint honours `SIGTERM`/`SIGINT` — it stops only after the current list write, never mid-write.

**`src/Targets/`** - Backend abstraction:
- `ListTarget` is the only interface the pipeline knows: `connect()`, `resolveMany(items, kind)` → opaque backend ids, `pushToList(ids, listName, kind, privacy)` which replaces the list content for that kind
- `createTarget(TargetOptions, CacheOptions, dryRun)` picks the adapter from `Target.type`
- `TraktTarget` wraps the existing `TraktAPI` (device flow, `requiresInteractiveAuth: true`); `FloppyTarget` uses `X-API-Key` with `movie`/`tv` media types and item-by-item writes; `MdblistTarget` uses `?apikey=` with `movie`/`show` and bulk add/remove
- `ResolutionCache` is a second cache layer, namespaced per backend (`resolution-<backend>/`), so switching backends never re-scrapes a FlixPatrol detail page
- Adapter-specific behaviour worth remembering: Floppy ignores `privacy` (its API cannot set list visibility) and writes no description (it exposes `latest_update` natively); mdblist writes no description either (`last_updated_at` is native) and forces `sort_by_score=true` on search because the default ranking is poor
- In `FloppyTarget.addItem`, the `PUT` is attempted **first, before any catalogue creation**. This is a data-safety guarantee, not an optimisation: the cleanup `DELETE` can then only ever remove a tracking row this run created, never a status or rating the user entered by hand

**`src/Scheduler/Scheduler.ts`** - Daemon mode:
- Runs the pipeline on `node-cron` schedules; `runOnStart` triggers an immediate first run
- Guards against overlap: a tick is skipped while a run is still in flight
- `stop()` awaits the in-flight run so a shutdown never truncates a Trakt write

**`src/Notifications/`** - Event dispatch:
- Three events: `run_start`, `run_end`, `error`, each with its own list of destinations
- Adapters: webhook, gotify, ntfy, apprise
- No-throw contract: a failing destination logs a warning and never breaks a run. Logs carry only the destination host, never the full URL, which would leak webhook secrets

**`src/Flixpatrol/FlixPatrol.ts`** - Web scraping:
- Platform/location constants defined as const arrays (type guards derive from these)
- Uses `impit` (Chrome impersonation) for direct HTTP requests, or an optional FlareSolverr client when configured
- HTML parsing via JSDOM with XPath expressions
- File-system caching with `file-system-cache` (SHA1 keys, TTL-based, separate caches for movies/TV shows)

**`src/Trakt/TraktAPI.ts`** - Trakt.tv integration:
- OAuth device flow: user visits verification_url, enters code, token saved to file
- List operations: get/create list, remove old items, add new items, update description
- Search: matches titles by name and year

**`src/Utils/GetAndValidateConfigs.ts`** - Configuration validation:
- Zod schemas validate every config block at load time
- Throws `ConfigurationError` on invalid config; `app.ts` catches it, dispatches an `error` notification, then exits 1
- Optional blocks (`FlixPatrolMostHours`, `Notifications`, `Schedule`, `FlareSolverr`, `Target`) are read through `config.has()` and fall back to their defaults, so an absent block is never an error
- `getTargetOptions()` returns a discriminated union: an absent `Target` block resolves to `{ type: 'trakt' }`, and only then is the `Trakt` block validated. `Floppy`/`Mdblist` are validated only when the matching `type` is selected, so a user on one backend never has to fill in the others

### Key Types

```typescript
// FlixPatrol types
type FlixPatrolTop10Platform = 'netflix' | 'hbo-max' | 'disney' | 'amazon-prime' | ... // 74 platforms
type FlixPatrolTop10Location = 'world' | 'france' | 'united-states' | ... // 199 locations
type FlixPatrolPopularPlatform = 'wikipedia' | 'youtube' // 2 sources
type FlixPatrolConfigType = 'movies' | 'shows' | 'both'
type FlixPatrolMostHoursPeriod = 'total' | 'first-week' | 'first-month'
type FlixPatrolMostHoursLanguage = 'all' | 'english' | 'non-english'

// Trakt types
type TraktTVId = number | null
type TraktTVIds = number[]
type TraktPrivacy = 'private' | 'link' | 'friends' | 'public'

// Target types
type TargetBackend = 'trakt' | 'floppy' | 'mdblist'
type MediaKind = 'movie' | 'show'
type ListPrivacy = 'private' | 'link' | 'friends' | 'public'
interface MediaItem { title: string; year: number | null }  // what FlixPatrol returns, pre-resolution
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
  FlixPatrolMostHours: [{  // optional block: absent means []
    enabled: boolean,
    privacy: TraktPrivacy,
    limit: number,  // 1-100
    type: 'movies' | 'shows' | 'both',
    period: 'total' | 'first-week' | 'first-month',
    language?: 'all' | 'english' | 'non-english',  // default: 'all'
    name?: string,
    normalizeName?: boolean
  }],
  Target: {  // optional block: absent means { type: 'trakt' }
    type: 'trakt' | 'floppy' | 'mdblist'  // default: 'trakt'
  },
  Floppy: {  // required only when Target.type === 'floppy'
    url: string,     // base URL of the instance, e.g. http://localhost:8000
    apiKey: string   // token from Settings -> Advanced (non-empty)
  },
  Mdblist: {  // required only when Target.type === 'mdblist'
    apiKey: string   // non-empty
  },
  Trakt: {  // still validated whenever Target.type resolves to 'trakt'
    saveFile: string,  // OAuth token file path
    clientId: string,
    clientSecret: string
  },
  Cache: {
    enabled: boolean,
    savePath: string,  // cache directory
    ttl: number  // seconds (default: 604800 = 7 days)
  },
  Notifications: {  // optional block: absent means {}
    run_start?: Destination[],
    run_end?: Destination[],
    error?: Destination[]
    // Destination is a discriminated union on `type`:
    //   { type: 'webhook', url }
    //   { type: 'gotify',  url, token }
    //   { type: 'ntfy',    url, topic }
    //   { type: 'apprise', url, key }
  },
  Schedule: {  // optional block: absent means disabled
    enabled: boolean,  // default: false
    crons: string[],  // default: []; must be non-empty when enabled
    runOnStart: boolean  // default: false
  },
  FlareSolverr: {  // optional block: absent means disabled
    enabled: boolean,  // default: false
    url?: string,  // mandatory when enabled, e.g. http://localhost:8191/v1
    maxTimeout: number  // default: 60000
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

Errors derive from `AppError` (`src/Utils/Errors.ts`): `ConfigurationError`, `FlixPatrolError`, `FlareSolverrError`, and `TargetError` — the common parent of `TraktError`, `FloppyError` and `MdblistError`, so callers can catch "the backend failed" without knowing which one is configured.

- **Configuration errors**: throw `ConfigurationError`, caught in `app.ts` → `error` notification → exit 1
- **Scraping failures**: `getFlixPatrolHTMLPage` returns `null` (never throws); callers turn that into `FlixPatrolError`, which fails the run
- **Notification failures**: logged as warnings only — a broken destination never fails a run
- **SIGINT / SIGTERM**: graceful. One-shot mode dispatches an `error` notification and exits 130; daemon mode stops the scheduler and awaits the in-flight run. An abort checkpoint between lists stops only after the current Trakt write completes

### Rate Limiting

1-second sleep (`Utils.sleep(1000)`) between Trakt API calls to avoid rate limits:
- List creation
- Item removal/addition
- List updates

The other two backends do not sleep. Floppy is self-hosted, so a per-item delay would make a
ten-item list absurdly slow. mdblist writes in bulk instead, and reports its remaining daily
budget through `x-ratelimit-remaining`, which `MdblistTarget` logs after each list write.

### Logging

Winston logger with format: `[YYYY-MM-DD HH:mm:ss.SSS][level] message`

Log levels via `LOG_LEVEL` env var: `error`, `warn`, `info` (default), `debug`, `silly`

Sensitive data (OAuth tokens) redacted in logs.

### Build Targets

Package creates binaries for:
- `node24-linux-x64`
- `node24-linux-arm64`
- `node24-macos-x64`
- `node24-win-x64`

### ESLint Rules

- Max line length: 120 chars (ignores strings and template literals)
- TypeScript strict mode enabled
- Ignores: `node_modules/`, `build/`

## Contributing

### Pull Requests

**Always use the PR template** located at `.github/PULL_REQUEST_TEMPLATE.md` when creating pull requests. The template includes:
- Description section
- Type of change checkboxes
- Checklist for testing and quality
- Related issues section

**Always add appropriate labels** to pull requests:
- `enhancement` - New features or plugins
- `bug` - Bug fixes
- `breaking change` - Breaking changes requiring user action
- `documentation` - Documentation updates
- `dependencies` - Dependency updates

Use `gh pr edit <number> --add-label "label1,label2"` to add labels.