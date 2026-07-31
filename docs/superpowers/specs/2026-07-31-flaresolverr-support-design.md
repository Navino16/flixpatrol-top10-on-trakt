# FlareSolverr support — design

Date: 2026-07-31
Status: approved, pending implementation

## Problem

FlixPatrol is behind a Cloudflare **managed challenge**. Every request to the domain
returns `403` with `cf-mitigated: challenge` and a "Just a moment..." interstitial,
so the scraper cannot fetch any page.

Evidence gathered on 2026-07-31:

| Client | Result |
| --- | --- |
| `impit` (`browser: 'chrome'`) | 403, `cf-mitigated: challenge` |
| `impit` (`browser: 'firefox'`) | 403, same |
| `curl` with a Chrome UA | 403 |
| Real Chromium via Playwright, 15s wait | 403, stuck on "Performing security verification" |

Paths verified: `/`, `/top10/`, `/top10/netflix/france`, `/top10/netflix/world`,
`/popular/movies/imdb` — all 403, including the homepage. This is not an XPath,
platform or configuration problem.

`impit` only impersonates the TLS/HTTP2 fingerprint (added in #479 to bypass an
earlier iteration of this protection). Cloudflare now additionally requires the
challenge JavaScript to execute, which `impit` cannot do.

## Feasibility: validated

FlareSolverr 3.5.0 (`ghcr.io/flaresolverr/flaresolverr`) solves the challenge.
Measurements against the real site:

| Request | Result |
| --- | --- |
| Sessionless (baseline) | `200`, no challenge, 15.4s |
| `sessions.create` | ok, 924ms |
| Session, 1st request (solves challenge) | `200`, 12.0s |
| Session, `hbo-max/france` | `200`, 1.8s |
| Session, a `/title/...` detail page | `200`, 2.5s |
| Session, repeat of the 1st URL | `200`, 1.3s |

**Session mode is structural, not an optimisation.** The challenge is solved once,
then the `cf_clearance` cookie is reused — roughly 10x faster (12s to 1.3s). This
matters because the scraper issues one request for the top10 page plus **one per
item** (`convertResultsToIds` -> `getTraktTVId`), about 21 requests per list.
Sessionless that is ~5 minutes per list; with a session, ~45s, and the 7-day disk
cache absorbs the detail pages on later runs.

The returned HTML is consumed by the **existing** XPath expressions with no change.
Replaying the exact expressions from `parseTop10Page` against a FlareSolverr
response yielded exactly 10 movies and 10 shows with coherent slugs (the strict
expression, `expressions[0]`).

Container footprint: 125 MiB RAM.

## Non-negotiable constraint: FlareSolverr is optional

Whether the configuration block is absent **or** present with `enabled: false`,
behaviour is **byte-for-byte** what it is today. Two independent mechanisms
guarantee this, and either one alone is sufficient:

1. `getFlareSolverrOptions()` returns `{ enabled: false }` when the block is
   absent, and never raises a validation error — the Zod schema is applied only to
   a block that is actually present. This mirrors `getFlixPatrolMostHours()`
   (`GetAndValidateConfigs.ts:84-86`).
2. `runPipeline` instantiates the client only when `enabled` is true. Otherwise
   `FlixPatrol` receives `undefined` and takes the current `impit` path, with no
   extra request and no flag to test.

The block ships with `enabled: false` in **both** places that define a default
configuration, so the two stay consistent:

- `config/default.json` (version-controlled reference file)
- the `defaultConfig` literal in `Utils.ensureConfigExist()` (`Utils.ts:29-151`),
  used only when `config/default.json` is missing — a fresh install

Shipping it in the tracked `config/default.json` is safe precisely because
`enabled` is `false`: an existing installation that pulls the change gains an inert
block, and mechanism 2 keeps the `impit` path intact. It also makes the setting
discoverable in the reference file rather than README-only.

The guarantee is enforced by tests, not by intent: the 60 existing tests in
`FlixPatrol.test.ts`, which know nothing about FlareSolverr, must keep passing
**unmodified**. Having to touch one of them means the optionality is broken.

## Architecture

### Routing: always through FlareSolverr when enabled

When `enabled` is true, every FlixPatrol request goes through FlareSolverr; `impit`
is not used. When it is false or absent, `impit` is the only path.

A sticky-fallback variant was considered (try `impit`, switch on
`403` + `cf-mitigated`, stay switched for the rest of the run) and **rejected**: it
makes the workaround depend on Cloudflare continuing to emit that exact header. If
the signal changes — a `503` carrying the same interstitial, say — the fallback
would silently not trigger. Routing unconditionally removes that dependency,
collapses two code paths plus a transition into one, and matches the intent of a
user who explicitly enabled FlareSolverr.

Accepted trade-off: with `enabled: true` and the container down, the run fails
entirely, where sticky fallback might have succeeded directly. The error message
names the URL and the cause.

### Module `src/FlareSolverr/`

A standalone client that knows only the FlareSolverr protocol, injected into
`FlixPatrol`. Rationale: `FlixPatrol.ts` is already 450 lines covering fetch, XPath
parsing and Trakt resolution; a third-party HTTP protocol does not belong there. A
separate module is testable without touching the scraper and follows the existing
convention (`Notifications/`, `Scheduler/`, `Pipeline/`).

```typescript
class FlareSolverrClient {
  async createSession(): Promise<void>            // sessions.create — must be called first
  async get(url: string): Promise<string | null>  // request.get, passing the session id
  async destroySession(): Promise<void>           // sessions.destroy — idempotent
}
```

**The three session calls are explicit protocol calls we issue ourselves.** This is
not a stylistic choice, and the upstream docs are explicit about it: for
`request.get`, *"If one is not sent [a session], it will create a temporary instance
that will be destroyed immediately after the request is completed."* No
`cf_clearance` cookie is reused, which is the measured 15.4s sessionless path versus
1.3-2.5s with a session. Skipping `sessions.create` silently forfeits the entire
performance rationale for this feature while still appearing to work — exactly the
kind of regression a test must catch (see Testing).

`sessions.create` takes `session` as an **optional** parameter (a random UUID is
assigned otherwise), so passing our own namespaced id is supported; the client
retains the id from the response either way. `sessions.destroy` requires it.

`createSession()` must be called before the first `get()`. It is **not** lazy:
routing is unconditional when enabled, so the session would be created on the first
request of every run anyway. An explicit call puts the lifecycle at the pipeline
level where it belongs, and surfaces a `sessions.create` failure at the start of the
run instead of midway through.

The session name is fixed and namespaced (`flixpatrol-top10`) so a container shared
with other tools (*arr, etc.) does not collide.

The client returns `string | null` — the contract `getFlixPatrolHTMLPage` already
returns — so callers gain no new case to handle. A `status !== 'ok'` response, or
`solution.status !== 200`, is logged with FlareSolverr's own `message` and returns
`null`.

Rejected alternative: an abstract `Fetcher` interface with two implementations.
Over-engineering for two cases.

### Wiring into `FlixPatrol`

`getFlixPatrolHTMLPage` (`FlixPatrol.ts:79`) is the single choke point for every
fetch — the only place to change. The client is an optional constructor argument.
When present, the method delegates to it; when absent, the existing `impit` loop
runs untouched.

Retry/backoff stays on the `impit` path. FlareSolverr performs its own retries
internally and a 12s challenge solve behind a 3x exponential backoff would produce
pathological run times.

### Lifecycle

`FlixPatrol` is instantiated once per run (`runPipeline.ts:55`), which gives the
session its natural lifetime. `runPipeline` owns both ends of it:

```
if (flareSolverr) await flareSolverr.createSession()
try {
  ... existing pipeline ...
} finally {
  if (flareSolverr) await flareSolverr.destroySession()
}
```

`destroySession()` in a `finally` so no browser is left behind when a run fails or
is interrupted — this matters in **daemon mode** (`Scheduler`, `app.ts:166`), where
runs repeat and a leaked session would keep a Chrome resident between runs. It must
not throw: a failure to destroy is logged as a warning, never converted into a run
failure, since by then the useful work is already done.

This matches the upstream guidance — *"When you no longer need to use a session you
should make sure to close it"* — and its memory warning: *"Web browsers consume a lot
of memory. If you are running FlareSolverr on a machine with few RAM, do not make
many requests at once."* Two consequences worth stating: we hold **exactly one**
session at a time, and the existing pipeline is already strictly sequential
(`for` loops awaiting each request), so this feature introduces no concurrent load
on the container. Measured footprint during the feasibility test: 125 MiB.

### Configuration

Optional block, modelled on `Schedule`:

```json
"FlareSolverr": {
  "enabled": false,
  "url": "http://localhost:8191/v1",
  "maxTimeout": 60000
}
```

Zod schema, mirroring `ScheduleOptionsSchema`:

- `enabled: z.boolean().default(false)`
- `url: z.url().optional()` — validated as a URL when supplied
- `maxTimeout: z.number().default(60000)` — forwarded as the `maxTimeout` field of
  every `request.get` payload, which is how FlareSolverr bounds its own solve time
- `.refine()` requiring `url` to be present when `enabled` is true, the same guard
  as `Schedule.crons`

The defaults mean a block containing only `{"enabled": true, "url": "..."}` is
valid, and that an absent block parses to `{ enabled: false, maxTimeout: 60000 }`
without error.

Scope limited to these three keys.

Deliberately **not** exposed, having checked them against the upstream API docs:

- `session_ttl_minutes` (a `request.get` parameter that auto-rotates expired
  sessions). Our session lives for the duration of one run and is destroyed in a
  `finally`, so rotation has nothing to do. An earlier draft of this spec wrongly
  called TTL a container-side setting; it is a client parameter, but an unnecessary
  one here.
- `proxy`, `cookies`, `returnOnlyCookies`, `returnScreenshot`, `waitInSeconds`,
  `tabs_till_verify` — not needed for plain HTML scraping.
- `sessions.list` — a debugging command; our session id is known by construction.

## Error handling

When `enabled` is false or the block is absent, FlareSolverr is never contacted at
all — no network call, no RAM, no latency.

When enabled, the first contact is `sessions.create` at the start of the run. If the
service does not answer, the error is explicit and the run fails as it does today:

```
[error] FlareSolverr sessions.create failed at http://localhost:8191/v1: ECONNREFUSED
-> run failed (exit 1) + 'error' notification
```

Because `createSession()` runs before the pipeline, a dead or misconfigured
container is reported immediately rather than after partially processing lists —
this gives us the practical benefit of a healthcheck without adding a separate
probe. A dedicated startup healthcheck was rejected for that reason: it would be a
redundant network call, and it would fail launches where FlareSolverr is disabled.

## Testing

Client unit tests, with `fetch` stubbed (the `tests/Notifications/http.test.ts`
pattern). The first three assert the explicit session protocol, which is the part
that silently degrades if got wrong:

- `createSession()` posts `{cmd: 'sessions.create'}` and retains the returned id
- **`get()` posts `{cmd: 'request.get'}` carrying that `session` id** — the
  regression guard against the throwaway-session path that works but is 10x slower
- `destroySession()` posts `{cmd: 'sessions.destroy'}` with the same id; idempotent,
  and a no-op when no session exists
- `maxTimeout` from config is forwarded in the `request.get` payload
- `createSession()` failure -> throws, so the run fails at the start
- `destroySession()` failure -> logs a warning, does not throw
- `get()` network error -> `null`
- `get()` `status !== 'ok'` -> `null` plus a log carrying FlareSolverr's `message`
- `get()` `solution.status !== 200` -> `null`

Routing tests in `FlixPatrol.test.ts`:

- **no client -> behaviour unchanged** (explicit regression test)
- with a client, `getFlixPatrolHTMLPage` returns the HTML and `impit` is never
  called (assert the mock call count)
- with a client, a client failure propagates as `null`, hence `FlixPatrolError`

Config tests:

- block absent -> `{ enabled: false }`, no error raised
- `enabled: true` with no `url` -> `ConfigurationError`
- block present and valid -> parsed values

End-to-end verification: real smoke test with the container running and
`LIST_NAME_PREFIX="[TEST]"`, checking the Trakt lists actually fill. That is the
only proof that counts.

## Documentation

- README: configuration block, plus a `docker-compose` service for FlareSolverr.
  Follow the upstream example and publish the port on loopback only
  (`127.0.0.1:8191:8191`) — FlareSolverr has no authentication, so it must not be
  exposed on the network.
- `Utils.ensureConfigExist()`: block added to `defaultConfig` with `enabled: false`
- `config/default.json`: same block, `enabled: false` (see the optionality
  constraint — inert by default, and kept consistent with the generator)
- CLAUDE.md states the scraper uses axios; it has used `impit` since #479. Fix in
  passing, as it touches the module being modified.

## Out of scope

- Removing `impit`. It stays the default path when FlareSolverr is absent.
- Any change to XPath expressions or parsing — verified unnecessary.
- Alternative data sources for FlixPatrol.
- `disableMedia` (a `request.get` parameter, and a `DISABLE_MEDIA` container env
  var, that skips images/CSS/fonts). Attractive on paper since we only consume HTML
  for XPath, but it could plausibly starve the Cloudflare challenge of resources it
  needs to solve. Worth measuring as a follow-up once the feature works — not worth
  risking on the initial implementation.
