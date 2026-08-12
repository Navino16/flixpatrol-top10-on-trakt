# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build and Development Commands

```bash
npm install          # Install dependencies
npm run build        # Build TypeScript to build/
npm run start        # Build and run
npm run start:dev    # Development mode with nodemon hot reload
npm test             # Run the unit/integration suite once (vitest)
npm run test:watch   # Run tests in watch mode
npm run test:coverage # Run tests with coverage (reports in .reports/coverage)
npm run test:e2e     # Opt-in end-to-end suites against real services (see Testing below)
npm run lint         # Run ESLint
npm run lint-and-fix # Run ESLint with auto-fix
npm run typecheck    # Type-check src/ AND tests/ (see Testing below)
npm run package      # Create cross-platform binaries in bin/
```

### Testing

**Type-checking the tests**: `tsconfig.json` excludes `tests`, because its `rootDir: "src"` and
emit settings describe the shipped build only. `npm run typecheck` runs the separate
`tsconfig.test.json`, which covers `src/`, `tests/`, `types/` and the vitest configs with
`noEmit`. It overrides `target`/`module`/`moduleResolution` to match how vitest actually loads
test files (ESM, Vite resolution) — under the base `commonjs`/`es2016`, every top-level `await` in
a test raises a TS1378 that is a pure false positive. The **`Lint` CI job** runs it; the `Build`
job type-checks `src/` only, through the real `tsc` emit. Do not "simplify" this by dropping
`tests` from the base `exclude`: that reintroduces TS6059 on every test file.

Test helpers live in `tests/helpers/` and are not test files — `mockProcessExit()` is there
because `process.exit` returns `never`, which no mock implementation satisfies without a cast, and
that cast belongs in one place.

Two vitest configurations, deliberately separate:

- **`vitest.config.ts`** — `npm test` / `npm run test:coverage`. Includes `tests/**/*.test.ts` and
  **excludes `tests/e2e/**`**, so the default run never touches the network. CI runs
  `npm run test:coverage`.
- **`vitest.e2e.config.ts`** — `npm run test:e2e`. Includes only `tests/e2e/**/*.e2e.test.ts`,
  runs one file at a time (`fileParallelism: false`) with a 60s test/hook timeout, because real
  network calls are slow and must not step on each other.

**Coverage gate**: thresholds are enforced at **80%** for lines, functions, branches and
statements. They are declared as *top-level* keys under `coverage.thresholds`, not under a
`global` key — `global` is the Jest spelling, which Vitest reads as a glob pattern matching no
file and therefore silently disables the gate. Do not "restore" it. `src/types/**` and
**`src/app.ts`** are excluded from coverage: `app.ts` is process-level wiring (signal handlers,
`process.exit` paths), so unit-testing it would assert on the process lifecycle rather than on
behaviour; the logic it orchestrates is covered through `Pipeline/` and `Scheduler/`.

**E2E suites** hit a **real Floppy instance**, a **real Trakt account** and a **real mdblist
account** — they are excluded from `npm test` and from coverage for that reason. Each suite is
gated on environment variables and calls `describe.skipIf(...)` when they are absent, so a run
with no environment skips everything and stays green instead of failing:

| Variable | Suite | Effect when absent |
|---|---|---|
| `E2E_FLOPPY_URL` | `tests/e2e/FloppyTarget.e2e.test.ts` | suite skipped |
| `E2E_FLOPPY_API_KEY` | `tests/e2e/FloppyTarget.e2e.test.ts` | suite skipped |
| `E2E_TRAKT_CLIENT_ID` | `tests/e2e/TraktTarget.e2e.test.ts` | suite skipped |
| `E2E_TRAKT_CLIENT_SECRET` | `tests/e2e/TraktTarget.e2e.test.ts` | suite skipped |
| `E2E_TRAKT_SAVE_FILE` | `tests/e2e/TraktTarget.e2e.test.ts` | suite skipped |
| `E2E_MDBLIST_API_KEY` | `tests/e2e/MdblistTarget.e2e.test.ts` | suite skipped |

Every suite verifies the end state by querying the service directly — `fetch` for Floppy and
mdblist, a second independent `trakt.tv` client for Trakt — never through the adapter under test,
and they name every object they create with a per-run unique suffix so two concurrent runs cannot
destroy each other's data.

The **Trakt** suite is the one that cannot be replaced by unit tests: it pins, against the live
API, that `trakt.tv` sends `type` as a QUERY parameter on `users.list.items.get` while Trakt
expects a PATH segment, so the filter is silently ignored and a "filtered" read still returns
every type. Mocking the client would only mock the lie. It also consumes an **already-obtained**
token (`E2E_TRAKT_SAVE_FILE`) because the OAuth device flow needs a human; it fails with an
explicit message rather than hanging if the file is missing. It creates a single `private` list —
a free Trakt account is capped at 5 — and deletes it in `afterAll`, never touching a list it did
not create.

**Triggering, and why it is asymmetric:**

- **Floppy is a first-class CI gate**: the `e2e-floppy` job of `.github/workflows/ci.yml`, sharing
  the `lint`/`build`/`test` trigger verbatim (every pull request to `main`/`develop`, no `paths`
  filter). It stands up its own throwaway containers (Redis + `ghcr.io/dannyvfilms/floppy:latest`,
  ~90s cold start, **polled** on `/api/v1/health` — never a fixed `sleep`) and mints its API token
  with `docker exec`, masked with `::add-mask::`. It needs **no repository secret**, which is what
  makes it safe on pull requests from forks.
- **Trakt and mdblist are local-only, on purpose.** They write to real third-party accounts, and
  the owner controls which credentials are used run by run. They belong to **no workflow** and
  depend on **no repository secret**. Do not add them to CI, and do not add a scheduled job that
  can only ever skip.

### Environment Variables

| Variable | Effect |
|---|---|
| `LOG_LEVEL` | `error`, `warn`, `info` (default), `debug`, `silly` |
| `DRY_RUN` | `true` skips every write to the configured backend; lists are computed and logged only |
| `LIST_NAME_PREFIX` | Prefixes every list name, e.g. `[TEST]`. Use it for local runs so real lists are never touched |

When running the app locally to verify a change by hand, always set
`LIST_NAME_PREFIX="[TEST]"` so nothing writes to the real lists.

## Architecture Overview

TypeScript CLI tool that scrapes FlixPatrol for streaming platform top 10 lists and syncs them to the user lists of one configured backend — Trakt.tv, Floppy or mdblist — selected by the `Target` config block.

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
3. Loads and validates all configurations via `GetAndValidateConfigs`, then runs the startup checks that need several blocks at once: `Utils.warnAboutOrphanedCaches()` and `GetAndValidateConfigs.checkTargetCompatibility()`
4. Branches on `Schedule.enabled`:
   - **one-shot** (default, or when no Trakt token exists yet): runs the pipeline once, then exits. `SIGINT` dispatches an `error` notification and exits 130.
   - **daemon**: hands the pipeline to `Scheduler`, which re-runs it on each cron tick. `SIGTERM`/`SIGINT` stop the scheduler gracefully.
5. Every exit path flushes pending notification dispatches before `process.exit`, so fire-and-forget notifications are not cut off.

**`src/Pipeline/runPipeline.ts`** - One run. It orchestrates two distinct phases — *resolution* then *writing* — and delegates both to the `ListTarget` it receives; it never talks to a backend API itself:
1. Creates the FlareSolverr session, if enabled (before any list, so a dead container fails fast)
2. Initializes `FlixPatrol`. The `ListTarget` is **not** built here: `app.ts` builds it once per process and passes it in, so the daemon auth gate and every scheduled run share one adapter and one resolution cache
3. Calls `target.connect()` (a no-op for floppy/mdblist, the OAuth device flow for trakt)
4. Dispatches `run_start`, then processes Top10 → Popular → MostWatched → MostHours sequentially. For each list: scrape FlixPatrol into `MediaItem[]` (title + year) → `target.resolveMany()` per kind for backend ids → **one** `target.pushToList()` carrying both kinds, so everything a backend does per list (list lookup, items read, description stamp) is paid once even for `type: "both"`
5. Dispatches `run_end` with a summary (lists processed, movies/shows added, duration)
6. Destroys the FlareSolverr session in a `finally` block, so it also covers the early abort paths and thrown errors

`FlixPatrol` no longer knows about any backend: it returns `MediaItem[]` and nothing else. All id resolution lives behind `ListTarget`.

Guard in `resolveSection`: `pushToList` **replaces** the content of every kind whose key is present, so a scrape that produced items but resolved to zero ids returns `null` and the caller OMITS that kind's key — the kind is left untouched while the other one is still written in the same call. That combination means the backend is failing, not that the list should be emptied. A genuinely empty scrape keeps its previous behaviour: a present, empty array, hence a wipe of that kind.

Between lists, an abort checkpoint honours `SIGTERM`/`SIGINT` — it stops only after the current list write, never mid-write.

**`src/Targets/`** - Backend abstraction:
- `ListTarget` is the only interface the pipeline knows: `connect()`, `resolveMany(items, kind)` → opaque backend ids, `pushToList(ids, listName, privacy)` where `ids` is a `ListContent` = `Partial<Record<MediaKind, string[]>>`. The three states of a key are all meaningful: **absent** → that kind is left untouched; **present and non-empty** → that kind is replaced; **present and empty** → that kind is cleared
- `createTarget(TargetOptions, CacheOptions, dryRun)` picks the adapter from `Target.type`
- `TraktTarget` wraps the existing `TraktAPI` (device flow, `requiresInteractiveAuth: true`); `FloppyTarget` uses `X-API-Key` with `movie`/`tv` media types and item-by-item writes (its API has no bulk write; only the list lookup and the items read are shared between kinds); `MdblistTarget` uses `?apikey=` with `movie`/`show` and sends both buckets in a single bulk add and a single bulk remove, each skipped when its payload would be empty
- `ResolutionCache` is a second cache layer, namespaced per backend (`resolution-<backend>/`), so switching backends never re-scrapes a FlixPatrol detail page
- Adapter-specific behaviour worth remembering: Floppy ignores `privacy` (its API cannot set list visibility) and writes no description (it exposes `latest_update` natively); mdblist writes no description either (`last_updated_at` is native) and forces `sort_by_score=true` on search because the default ranking is poor
- A **search** the backend rejects drops that item instead of failing the run: `searchId` catches the error and returns `null` when `isUnsearchable(error)` — i.e. the status is 400, 404 or 422 (`src/Targets/http.ts`). That set is deliberately narrow: **401/403/429 and 5xx stay fatal**, because they hit every item alike and a run that skipped them all would report success having written nothing. This aligns Floppy and mdblist with `TraktAPI.getFirstItemByQuery`, which already warned and skipped; before it, one unsearchable title aborted a whole 31-list run
- `MdblistTarget.foldForSearch` folds curly quotes, en/em dashes and the ellipsis to ASCII **in the query only** — mdblist answers `400 Invalid search query` past Latin-1 (`é` passes, `’` does not) while storing those titles verbatim, so the fold is what makes them findable. It must never reach the title used by the match cascade, which compares against the curly form mdblist returns. Non-latin scripts have no ASCII equivalent and cannot be folded — but they do not occur: a live scrape of Crunchyroll returned 13 titles, all English or romaji, none outside Latin-1. FlixPatrol localises, so romanising here would be dead code. No alternative encoding works either: HTML entities, `\uXXXX`, raw bytes and POST are all rejected, and double percent-encoding or UTF-7 are *accepted* but match nothing — trading an explicit warning for a silent empty result, which is worse
- Neither `FloppyTarget.pickBest` nor `MdblistTarget.pickBest` has a last-resort fallback on the first usable result. Falling through the whole cascade (title+year → title → year) means nothing matched, so any remaining result is a mismatch by definition: they return `null`, the caller warns and drops the item. `TraktTarget` is the exception, because `TraktAPI.getFirstItemByQuery` does fall back to `items[0]`
- In `FloppyTarget.addItem`, the `PUT` is attempted **first, before any catalogue creation**. This is a data-safety guarantee, not an optimisation: the cleanup `DELETE` can then only ever remove a tracking row this run created, never a status or rating the user entered by hand. The 5xx retry in `request` does not weaken it: a retried `PUT` that ends up on a 404 still proves the media is absent from the catalogue, so there is no user state to lose
- **Known and deliberately not handled**: the catalogue `POST` answers **500**, not a 4xx, when TMDB does not know the id — `{"detail":"Internal Server Error.","errors":"There was an error contacting The Movie Database (HTTP 404)..."}`, measured against a real instance. Two consequences. The 5xx retry treats it as transient and burns three attempts on an error that is definitive; and since it escapes `addItem`, one such media fails the whole run, the way a rejected search did before #534. The vector is the 7-day resolution cache: an id resolved days ago and since removed from TMDB is reused without a fresh search. Left alone on purpose — the run stops with an explicit error, the current list is left amputated until the next run and the lists not yet processed keep yesterday's content, so the cost is a missed run rather than data loss. It has never been observed, including on a 960-item configuration across all three backends. Fixing it means deciding what to do when *every* add fails, since `pushToList` deletes before it adds and would otherwise empty a list silently — do not "just" swallow the error per item
- `MdblistTarget` memoizes the user list index (`GET /lists/user` returns the WHOLE collection, so one call answers every list lookup) as a `name -> id` map. The memo is **scoped to one run**: `connect()` drops it, because the adapter is built once per process by `app.ts` and shared by every daemon tick — a memo living for the instance lifetime would go stale between two ticks hours apart, and a list deleted from the mdblist web UI in the meantime would still look present, so the adapter would write to a dead id. A miss on an *already populated* memo re-fetches once before concluding the list is absent, since creating a duplicate is a visibly wrong outcome on a backend capped at four static lists

**`src/Scheduler/Scheduler.ts`** - Daemon mode:
- Runs the pipeline on `node-cron` schedules; `runOnStart` triggers an immediate first run
- Guards against overlap: a tick is skipped while a run is still in flight
- `stop()` awaits the in-flight run so a shutdown never truncates a backend write

**`src/Notifications/`** - Event dispatch:
- Three events: `run_start`, `run_end`, `error`, each with its own list of destinations
- Adapters: webhook, gotify, ntfy, apprise
- No-throw contract: a failing destination logs a warning and never breaks a run. Logs carry only the destination host, never the full URL, which would leak webhook secrets

**`src/Flixpatrol/FlixPatrol.ts`** - Web scraping:
- Platform/location constants defined as const arrays (type guards derive from these)
- Uses `impit` (Chrome impersonation) for direct HTTP requests, or an optional FlareSolverr client when configured. The impit path retries up to 3 times with 1s/2s/4s backoff on 408/429/500/502/503/504, and reports Cloudflare's `cf-mitigated` header when present — that header is what separates "FlixPatrol is down" from "we got bot-blocked". The FlareSolverr path has **no** retry loop: FlareSolverr retries internally, and wrapping a 12s challenge solve in a 3x backoff produces pathological runtimes
- `FlareSolverr.disableMedia` is forwarded on `request.get` **only when true**, never as an explicit `false`. FlareSolverr lets the request parameter override its own `DISABLE_MEDIA` env var, so sending `false` would silently defeat an operator who enabled it on the container; our default means "no opinion", not "off". It is never sent on `sessions.create`, which does not read it — the measurement in #525 confirmed session creation is unaffected. Effect: ~17% off warm requests, challenge solve unchanged, no solve failures over 80 requests. The saving lands mostly on cold-cache runs, since detail pages are cached for `Cache.ttl`
- HTML parsing via JSDOM with XPath expressions
- Returns `MediaItem[]` (title + year) and knows nothing about any backend. The Top10 `fallback` triggers when the *page* yields no result at all, no longer when no backend id could be resolved (behaviour change vs 2.17): a title FlixPatrol lists but the backend does not know is now reported as unmatched instead of silently swapping the whole list for another location's
- File-system caching with `file-system-cache` (SHA1 keys, TTL-based) under `<Cache.savePath>/details`. The second level, `<Cache.savePath>/resolution-<backend>`, lives in `src/Targets/ResolutionCache.ts`. The 2.x `movies/` and `tv-shows/` directories are orphaned; `Utils.warnAboutOrphanedCaches()` names them once at startup and never deletes them

**`src/Trakt/TraktAPI.ts`** - Trakt.tv integration, wrapped by `TraktTarget`:
- OAuth device flow: user visits verification_url, enters code, token saved to file. A token file that fails to parse is deleted and the flow restarts rather than crashing
- `pushToList(content, listName, privacy)` takes a `TraktListContent` = `Partial<Record<'movie'|'show', number[]>>` with the same absent/present/empty tri-state as `ListContent`, and writes the list once: list lookup or creation, privacy alignment and the "Last Updated" description are per-LIST and happen exactly once whatever the number of types. `users.list.items.get` is genuinely filtered by type on the Trakt side, so it legitimately stays one call per type
- `toTraktSlug` mirrors Trakt's own normalization (lowercase, any run of non-alphanumerics collapsed to one hyphen, trimmed). A naive `\s+ -> -` left punctuation intact and produced slugs that did not match the canonical form, so `.get()` returned partial data instead of a 404
- Trakt has been observed answering HTTP 200 with an empty body instead of 404 for a missing list, so the success path shape-checks the response and treats a malformed one as not-found
- Search: `getFirstItemByQuery` queries Trakt by **title only** (`fields: 'title'`), then prefers the first result whose year matches; if none does it falls back to the first result. Unlike the Floppy and mdblist adapters, this backend does have a last-resort fallback

**`src/Utils/GetAndValidateConfigs.ts`** - Configuration validation:
- Zod schemas validate every config block at load time
- Throws `ConfigurationError` on invalid config; `app.ts` catches it, dispatches an `error` notification, then exits 1
- Optional blocks (`FlixPatrolMostHours`, `Notifications`, `Schedule`, `FlareSolverr`) are read through `config.has()` and fall back to their defaults, so an absent block is never an error. `Target` is **not** optional since 3.0.0
- `getTargetOptions()` returns the `Target` discriminated union straight from Zod — backend and credentials in one block, so `createTarget` narrows on `type` and hands the same object to the adapter
- **Unmigrated-config detection**: `Target` absent, or present but failing the union — including the never-released intermediate shape where it carried only `type` — throws a `ConfigurationError` whose message prints the exact `Target` block to write, with the user's own values carried across verbatim from the root-level `Trakt`/`Floppy`/`Mdblist` block (placeholders otherwise — never an invented secret). The config file is never rewritten: the config directory is frequently a read-only Docker mount and users version that file
- **Obsolete blocks are not fatal**: once `Target` satisfies the union, a leftover root-level `Trakt`/`Floppy`/`Mdblist` block only produces one `warn` naming it. Rejecting a correctly migrated config over dead config would be an outage for nothing. Only `Trakt` ever shipped (2.17.0 and earlier); `Floppy` and `Mdblist` existed solely in an unreleased intermediate shape and are deliberately absent from README
- `checkTargetCompatibility(target, lists)` is the cross-check that cannot live in a schema — the `config` package loads `Target` and the list blocks independently. It rejects `link`/`friends` on non-Trakt backends across all four list blocks, naming block, index and value, and emits the single Floppy "visibility cannot be set" warning (once per run, never per list)

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

// Target types (src/Targets/ListTarget.ts) — the core vocabulary of the backend abstraction
type TargetBackend = 'trakt' | 'floppy' | 'mdblist'
type MediaKind = 'movie' | 'show'
const MEDIA_KINDS: readonly MediaKind[] = ['movie', 'show']  // canonical order, movies first
type ListPrivacy = 'private' | 'link' | 'friends' | 'public'  // inherited from Trakt

// What FlixPatrol returns, pre-resolution. `year` is null when the detail page
// exposes no usable premiere date — see "XPath Expressions" below.
interface MediaItem { title: string; year: number | null }

// Tri-state per kind. All three states are meaningful:
//   key ABSENT           -> that kind is LEFT UNTOUCHED
//   key present, non-empty -> that kind's content is REPLACED by those ids
//   key present, EMPTY     -> that kind was genuinely scraped empty, so it is CLEARED
type ListContent = Partial<Record<MediaKind, string[]>>

// The only interface the pipeline knows about. Ids are opaque strings whose
// encoding is the adapter's business (Trakt id, `source:media_id` for Floppy, tmdb id for mdblist).
interface ListTarget {
  readonly backend: TargetBackend
  readonly requiresInteractiveAuth: boolean   // true only for Trakt's device flow
  isAuthenticated(): boolean
  connect(): Promise<void>
  resolveMany(items: MediaItem[], kind: MediaKind): Promise<string[]>  // unresolved omitted, dupes dropped, order kept
  pushToList(ids: ListContent, listName: string, privacy: ListPrivacy): Promise<void>  // ONE call, both kinds
}
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
    normalizeName?: boolean,  // convert to kebab-case (default: true)
    kids?: boolean  // Netflix Kids Top 10. Netflix-only and country-only: any other
                    // platform, or location 'world', logs a warn and skips the entry.
                    // Also disables the `fallback` path.
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
  // NEW and MANDATORY in 3.0.0. Zod discriminated union on `type`: the block carries
  // the backend AND its credentials, so an invalid pairing is unrepresentable. It
  // replaces the root-level `Trakt` block, the only backend config 2.17.0 had.
  Target:
    | { type: 'trakt',
        saveFile: string,      // OAuth token file path
        clientId: string,
        clientSecret: string }
    | { type: 'floppy',
        url: string,           // base URL of the instance, e.g. http://localhost:8000
        apiKey: string }       // token from Settings -> Advanced (non-empty)
    | { type: 'mdblist',
        apiKey: string },      // non-empty
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
    maxTimeout: number,  // default: 60000
    disableMedia: boolean  // default: false; blocks images/CSS/fonts in the solver browser
  }
}
```

### XPath Expressions (FlixPatrol scraping)

These expressions and their order are load-bearing against the live site. Do not change them
without checking a real page: FlixPatrol's markup drifts, and a silently-empty expression turns
into a wrong list rather than an error.

`{type}` below is `Movies` or `TV Shows`.

**Top10 (World)** — one expression:
```xpath
//div[h2[span[contains(., "TOP {type}")]]]/parent::div//a[contains(@class,'hover:underline')]/@href
```

**Top10 (Regions)** — three expressions, tried in order, first non-empty result wins:
```xpath
//div[h3[text() = "TOP 10 {type}"]]/parent::div//a[contains(@class,'hover:underline')]/@href
//h3[contains(., "TOP 10") and contains(., "{type}")]/ancestor::div[1]/following-sibling::div[1]//a[contains(@class,'hover:underline')]/@href
((//table)[1] | (//table)[2])//a[contains(@class,'hover:underline')]/@href
```

**Top10 Kids** (`kids: true`, Netflix + a country only) — two expressions, strict then tolerant.
`{kidsType}` is `Kids Movies` or `Kids TV Shows`:
```xpath
//h3[text() = "TOP 10 {kidsType}"]/parent::div/following-sibling::table//a[@class="hover:underline"]/@href
//h3[contains(., "TOP 10") and contains(., "{kidsType}")]/parent::div/following-sibling::table//a[@class="hover:underline"]/@href
```

**Popular / MostWatched**:
```xpath
//table[@class="card-table"]//a[@class="flex gap-2 group items-center"]/@href
```
MostWatched with `original: true` adds an `[.//svg]` predicate — the badge FlixPatrol puts on
Netflix originals:
```xpath
//table[@class="card-table"]//a[@class="flex gap-2 group items-center"][.//svg]/@href
```

**MostHours** — `{sectionId}` is `toc-movies` or `toc-tv-shows`, `{langTab}` is
`all-languages` / `english` / `non-english`. The `total` period has no language tabs, so the
second expression is its normal path, not an error case:
```xpath
//div[@id="{sectionId}"]//table[contains(@x-show, "'{langTab}'")]//a[@class="flex gap-2 group items-center"]/@href
//div[@id="{sectionId}"]//table[@class="card-table"]//a[@class="flex gap-2 group items-center"]/@href
```

**Detail page (title)** — `FlixPatrol.parseDetailTitle`, anchored on `div.info-grid-header`,
with a bare `//h1` as last resort:
```xpath
//div[contains(@class,"info-grid-header")]//h1/text()
//h1/text()
```

**Detail page (premiere year)** — `FlixPatrol.parseDetailYear`. The year is read **only** from
the premiere block inside `div.info-grid-header`, then a `/(19|20)\d{2}/` regex over that block's
text. The date is formatted MM/DD/YYYY, and no four-digit run starting with 19 or 20 can appear
before the year in that format, so the day/month ambiguity never has to be resolved:
```xpath
//div[contains(@class,"info-grid-header")]//div[@title="Premiere"]
```

**There is deliberately NO fallback for the year, and none must ever be added back.** An earlier
version scanned the text of `div.mb-6`; that selector now matches a site-wide marketing blurb
ending in "the most popular TV shows in 2021", so the regex stamped **2021 onto every single
title**. That fed the "exact title AND year" branch of each backend's match cascade, which then
selected the wrong film with full confidence, on all three backends, silently. Fixed in
`484bb03`. The asymmetry is the whole point: a **missing** year degrades the cascade to a
title-only match, which is safe; a **wrong** year is silently destructive. Never guess a year.

Consistently, `getMediaItem` caches a detail page **only when both title and year parsed**. A
missing year is not a benign gap — it is exactly what disambiguates the later backend search — so
persisting one would degrade every match for the whole TTL (7 days by default) after a single
transient markup drift. A cache miss costs one re-scrape.

### Error Handling

Errors derive from `AppError` (`src/Utils/Errors.ts`): `ConfigurationError`, `FlixPatrolError`, `FlareSolverrError`, and `TargetError` — the common parent of `TraktError`, `FloppyError` and `MdblistError`, so callers can catch "the backend failed" without knowing which one is configured.

- **Configuration errors**: throw `ConfigurationError`, caught in `app.ts` → `error` notification → exit 1
- **Scraping failures**: `getFlixPatrolHTMLPage` returns `null` (never throws); callers turn that into `FlixPatrolError`, which fails the run
- **Notification failures**: logged as warnings only — a broken destination never fails a run
- **SIGINT / SIGTERM**: graceful. One-shot mode dispatches an `error` notification and exits 130; daemon mode stops the scheduler and awaits the in-flight run. Since a list is written in a single `pushToList` call, the abort checkpoint sits *between* lists: a stop can no longer land between the movie half and the show half of the same list

### Rate Limiting

1-second sleep (`Utils.sleep(1000)`) between Trakt API calls to avoid rate limits:
- List creation
- Item removal/addition
- List updates

Every one of those sleeps still guards a call that still happens; the rate-limit protection is
unchanged. What disappeared with the fused write is the *duplicated* per-list work of a
`type: "both"` list: `users.list.get` and the "Last Updated" description now run once instead of
twice, which removes two wasted seconds per list. `users.list.items.get` is genuinely filtered by
type on the Trakt side, so it legitimately stays one call per kind.

The other two backends do not sleep between calls. Floppy is self-hosted, so a per-item delay
would make a ten-item list absurdly slow; it sleeps only to back off a retry (250ms/500ms/1s, see
below), never on the happy path. mdblist writes in bulk instead, and reports its remaining daily
budget through `x-ratelimit-remaining`, which `MdblistTarget` logs after each list write.

`FloppyTarget.request` retries **5xx only** (500/502/503/504), 3 attempts max. Floppy on SQLite —
the self-hosted default — answers 500 when a write loses the race for the single writer lock:
`api/views.py` does `user_list.items.add(item)` without catching `OperationalError`, and its
middleware turns the `database is locked` into an opaque `Internal server error.` Measured against
a real instance while pushing a 25-item list: 11 lock contentions in one run, one of which
surfaced as a 500 and failed the run. Every verb used here is idempotent (`PUT` accepts 200/409,
`DELETE` 204/404), so replaying is safe. A **4xx is never retried**: it carries meaning, and the
404 of the first `PUT` is what drives the `addItem` bootstrap. The backoff is deliberately shorter
than FlixPatrol's 1s/2s/4s — what is waited out is a lock held for milliseconds, not a remote site
under load.

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