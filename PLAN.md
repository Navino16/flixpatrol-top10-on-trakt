# PLAN.md - Code Improvements Roadmap

This document tracks identified issues and improvements for the flixpatrol-top10-on-trakt project.

## Critical Issues

### 1. Logic bug in MostWatched list name construction
**File:** `src/app.ts:98-109`
**Status:** DONE (PR #396)
**Description:** The second `if` should be `else if`. Currently, if `normalizeName === false`, the name still gets normalized because the second condition overwrites it.
```typescript
// CURRENT (BUGGY)
if (mostWatched.name && mostWatched.normalizeName === false) {
  listName = mostWatched.name;
}
if (mostWatched.name) {  // BUG: should be 'else if'
  listName = mostWatched.name.toLowerCase().replace(/\s+/g, '-');
}

// FIX
if (mostWatched.name && mostWatched.normalizeName === false) {
  listName = mostWatched.name;
} else if (mostWatched.name) {
  listName = mostWatched.name.toLowerCase().replace(/\s+/g, '-');
} else {
  // default name logic
}
```

### 2. Unhandled Promise rejection in main app
**File:** `src/app.ts:28`
**Status:** DONE (PR #396)
**Description:** `trakt.connect().then()` has no `.catch()` handler. If the promise rejects, the application crashes silently.
```typescript
// FIX
trakt.connect()
  .then(async () => { ... })
  .catch((err) => {
    logger.error(`Fatal error: ${(err as Error).message}`);
    process.exit(1);
  });
```

### 3. XPath parsing without error handling
**File:** `src/Flixpatrol/FlixPatrol.ts:220-235`
**Status:** DONE (PR #396)
**Description:** `textContent` can be null, but it's cast to string without validation. `iterateNext()` can throw on malformed DOM.
```typescript
// FIX
try {
  let p = match.iterateNext();
  while (p !== null) {
    if (p.textContent) results.push(p.textContent);
    p = match.iterateNext();
  }
} catch (err) {
  logger.error(`Error parsing XPath: ${err}`);
  return [];
}
```

---

## High Priority Issues

### 4. No timeout on Axios requests
**File:** `src/Flixpatrol/FlixPatrol.ts:112-119`
**Status:** DONE (PR #397)
**Description:** HTTP requests can hang indefinitely if FlixPatrol doesn't respond.
```typescript
// FIX
const axiosConfig: AxiosRequestConfig = {
  headers: { 'User-Agent': this.options.agent },
  timeout: 30000  // 30 seconds
};
```

### 5. Wrong type for FlixPatrolPopular.platform
**File:** `src/Utils/GetAndValidateConfigs.ts:20`
**Status:** DONE (PR #397)
**Description:** Uses `FlixPatrolTop10Platform` instead of `FlixPatrolPopularPlatform`, allowing invalid values.
```typescript
// CURRENT
export interface FlixPatrolPopular {
  platform: FlixPatrolTop10Platform;  // WRONG
}

// FIX
export interface FlixPatrolPopular {
  platform: FlixPatrolPopularPlatform;
}
```

### 6. JSON.parse without try-catch
**File:** `src/Trakt/TraktAPI.ts:42`
**Status:** DONE (PR #397)
**Description:** Can throw if the token file is corrupted.
```typescript
// FIX
try {
  const data = fs.readFileSync(this.traktSaveFile, 'utf8');
  const token: TraktAccessExport = JSON.parse(data);
  // ...
} catch (err) {
  logger.error(`Error reading Trakt token file: ${err}`);
  // Delete corrupted file and reinitialize
  fs.unlinkSync(this.traktSaveFile);
  // Fall through to OAuth flow
}
```

### 7. No test coverage
**File:** `package.json:12`
**Status:** DONE (PR #399) - Added Vitest with tests for Errors and FlixPatrol
**Description:** No tests exist. Add Jest and write unit/integration tests.

---

## Medium Priority Issues

### 8. Massive code duplication in config validation
**File:** `src/Utils/GetAndValidateConfigs.ts`
**Status:** DONE (PR #398) - Replaced with Zod schemas
**Description:** The 3 validation methods repeat the same pattern ~20 times. Extract to helper functions.
```typescript
// CREATE HELPER
function validateRequiredString(
  config: Record<string, unknown>,
  key: string,
  context: string,
  validator?: (val: string) => boolean
): string {
  if (!Object.prototype.hasOwnProperty.call(config, key)) {
    logger.error(`Configuration Error: Property "${context}.${key}" -> not found`);
    process.exit(1);
  }
  const value = config[key];
  if (typeof value !== 'string') {
    logger.error(`Configuration Error: Property "${context}.${key}" -> not a valid string`);
    process.exit(1);
  }
  if (validator && !validator(value)) {
    logger.error(`Configuration Error: Property "${context}.${key}" -> invalid value "${value}"`);
    process.exit(1);
  }
  return value;
}
```

### 9. JSON built by string concatenation
**File:** `src/Utils/Utils.ts:15-98`
**Status:** TODO
**Description:** Default config is built with 80+ string concatenations instead of `JSON.stringify()`.
```typescript
// FIX
const defaultConfig = {
  FlixPatrolTop10: [
    { platform: 'netflix', location: 'world', /* ... */ }
  ],
  // ...
};
fs.writeFileSync('./config/default.json', JSON.stringify(defaultConfig, null, 2));
```

### 10. Duplicated name normalization logic
**File:** `src/app.ts:31-39, 67-75, 98-109`
**Status:** DONE
**Description:** Same pattern repeated 4 times. Extracted to `Utils.getListName()` utility function.
```typescript
// ADD TO Utils.ts
function getListName(
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
```

### 11. No retry logic on HTTP requests
**File:** `src/Flixpatrol/FlixPatrol.ts:118-129`
**Status:** DONE
**Description:** Added axios-retry with exponential backoff (3 retries, retry on network errors and 429).
```typescript
// FIX - use axios-retry or implement manually
import axiosRetry from 'axios-retry';

axiosRetry(axios, {
  retries: 3,
  retryDelay: axiosRetry.exponentialDelay,
  retryCondition: (error) => {
    return axiosRetry.isNetworkOrIdempotentRequestError(error)
      || error.response?.status === 429;
  }
});
```

### 12. TypeScript config not strict enough
**File:** `tsconfig.json`
**Status:** TODO
**Description:** Enable additional strict checks.
```json
{
  "compilerOptions": {
    "noImplicitReturns": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  }
}
```

---

## Low Priority Issues

### 13. Hardcoded and outdated User-Agent
**File:** `src/Flixpatrol/FlixPatrol.ts:76`
**Status:** TODO
**Description:** User-Agent string is hardcoded to Chrome 117. Consider making it configurable or updating periodically.

### 14. No deduplication of results
**File:** `src/Flixpatrol/FlixPatrol.ts:321-331`
**Status:** TODO
**Description:** Same movie/show can appear multiple times in results.
```typescript
// FIX
private async convertResultsToIds(results: FlixPatrolMatchResult[], type: FlixPatrolType, trakt: TraktAPI) {
  const traktTVIds: TraktTVIds = [];
  const seen = new Set<number>();

  for (const result of results) {
    const id = await this.getTraktTVId(result, type, trakt);
    if (id && !seen.has(id)) {
      seen.add(id);
      traktTVIds.push(id);
    }
  }
  return traktTVIds;
}
```

### 15. process.exit() calls throughout codebase
**Files:** Multiple
**Status:** DONE (PR #399) - Replaced with custom error classes
**Description:** Hard exits prevent proper testing and resource cleanup. Consider using custom Error classes and catching at top level.

### 16. Non-null assertions without checks
**File:** `src/Flixpatrol/FlixPatrol.ts:344, 374`
**Status:** TODO
**Description:** `html!` non-null assertion used after null check, but could be cleaner.
```typescript
// CURRENT
if (html === null) { process.exit(1); }
let results = FlixPatrol.parsePopularPage(html!);

// FIX - TypeScript should narrow after the check, but explicit is better
if (html === null) { process.exit(1); }
let results = FlixPatrol.parsePopularPage(html);  // Remove !
```

### 17. Cache null checks
**File:** `src/Flixpatrol/FlixPatrol.ts:240-241`
**Status:** TODO
**Description:** Cache is `FileSystemCache | null` but accessed without null check inside the if block.

---

## Feature Requests

### 18. Add dry-run mode
**Status:** TODO
**Description:** Allow running without actually updating Trakt lists, just logging what would be done.

### 19. Add progress indicators
**Status:** TODO
**Description:** Show progress when processing multiple lists (e.g., "Processing 3/10 lists...").

### 20. Add configuration schema validation
**Status:** DONE (PR #398)
**Description:** Use JSON Schema or Zod for declarative config validation instead of manual checks.

### 21. Add Docker Compose for development
**Status:** TODO
**Description:** Simplify local development setup.

### 22. Add GitHub Actions for CI
**Status:** TODO
**Description:** Run linting and tests on PRs.

---

## GitHub Issues (Closed)

### Issue #334 - [FEATURE] Add ARM support on Workflow ghcr images
**Labels:** enhancement
**Status:** DONE
**Description:** Add ARM architecture support for Docker images published to GitHub Container Registry.

### Issue #333 - [BUG] Some list have a warning about reduced list
**Labels:** bug, not-yet-viewed
**Status:** DONE
**Description:** Some lists display a warning about being reduced.

### Issue #275 - [FEATURE] Kids Movies and shows
**Labels:** enhancement
**Status:** DONE (PR #410)
**Description:** Add support for Kids Movies and Shows categories from FlixPatrol.
**Notes:**
- Kids lists only show when choosing a country (not worldwide)
- Only available on Netflix
- Added `kids` option to top10Config

### Issue #153 - [FEATURE] Support for most hours total
**Labels:** enhancement, not-yet-viewed
**Status:** DONE (PR #408)
**Description:** Add support for "most hours total" ranking from FlixPatrol.

### Issue #152 - [FEATURE] Support for most hours viewed first month
**Labels:** enhancement, not-yet-viewed
**Status:** DONE (PR #409)
**Description:** Add support for "most hours viewed in first month" ranking from FlixPatrol.

### Issue #151 - [FEATURE] Support for most hours viewed first week
**Labels:** enhancement, not-yet-viewed
**Status:** DONE (PR #409)
**Description:** Add support for "most hours viewed in first week" ranking from FlixPatrol.

---

## Summary

| Priority      | Count  | Done   | Remaining |
|---------------|--------|--------|-----------|
| Critical      | 3      | 3      | 0         |
| High          | 4      | 4      | 0         |
| Medium        | 5      | 3      | 2         |
| Low           | 5      | 1      | 4         |
| Features      | 5      | 1      | 4         |
| GitHub Issues | 6      | 6      | 0         |
| **Total**     | **28** | **18** | **10**    |

## Recommended Order of Implementation

1. ~~Fix critical bug #1 (if/else if in app.ts)~~ DONE
2. ~~Add .catch() to trakt.connect() (#2)~~ DONE
3. ~~Add XPath error handling (#3)~~ DONE
4. ~~Add Axios timeout (#4)~~ DONE
5. ~~Fix FlixPatrolPopular type (#5)~~ DONE
6. ~~Add try-catch around JSON.parse (#6)~~ DONE
7. ~~Refactor config validation (#8)~~ DONE (Zod)
8. ~~Add Zod schema validation (#20)~~ DONE
9. ~~Add test framework (#7)~~ DONE (Vitest)
10. ~~Replace process.exit() with errors (#15)~~ DONE
11. ~~Extract name normalization helper (#10)~~ DONE
12. ~~Add retry logic (#11)~~ DONE
