# Notifications system — design

**Status:** approved
**Date:** 2026-06-26
**Scope:** Add an opt-in notification system that emits `run_start`, `run_end`, and `error` events to one or more configured destinations (generic webhook with smart Discord shaping, Gotify, ntfy, Apprise sidecar).

## Motivation

A scheduled CLI sync (cron, systemd timer, container restart) runs unattended. Without notifications, the user only finds out about failures by checking logs after the fact, and has no visibility into successful runs. The goal is to surface run lifecycle and errors to the user's existing notification channels (Discord, mobile push, etc.) with zero coupling to a specific provider.

Kometa solves the same problem in Python via the `apprise` lib embedded as a pip dependency. We are Node, so embedding Apprise is impractical; we ship native adapters for the few common destinations and an Apprise adapter that talks to the user's own Apprise API sidecar for the long tail.

## Events

| Event       | When                                                                                     | Body / Summary                                                                                          |
|-------------|------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------------|
| `run_start` | After `trakt.connect()` resolves, before the first list is processed                     | `"Processing N lists"` where N is the total computed `totalLists`                                       |
| `run_end`   | After the last list loop completes successfully                                          | `"Processed X/N lists"` + `RunSummary` (listsProcessed, moviesAdded, showsAdded, unmatchedMovies, unmatchedShows, durationMs) |
| `error`     | When the top-level `.catch()` in `trakt.connect().then(...)` is reached (terminal error) | `"<err.name>: <err.message>"`                                                                           |

Items that FlixPatrol returned but Trakt could not match (already logged today as `Some movies/shows from FlixPatrol could not be matched on Trakt`) are aggregated into `summary.unmatchedMovies` / `summary.unmatchedShows` and surfaced via `run_end`. They are **not** treated as errors — they're a normal data-quality signal.

In `DRY_RUN=true` mode, notifications **are** still dispatched (so the user can validate their setup). Title/body are prefixed with `[DRY-RUN]` so they're never confused with real runs.

## Config shape

Lives in `config/default.json` under a new top-level `Notifications` key. Validated by a new `NotificationsSchema` Zod schema in `src/types/Config.types.ts`.

```json
{
  "Notifications": {
    "run_start": [
      { "type": "webhook", "url": "https://discord.com/api/webhooks/..." }
    ],
    "run_end": [
      { "type": "webhook", "url": "https://discord.com/api/webhooks/..." },
      { "type": "apprise", "url": "http://apprise:8000", "key": "flixpatrol" }
    ],
    "error": [
      { "type": "gotify", "url": "https://gotify.example.com", "token": "AbCdEf123" },
      { "type": "ntfy", "url": "https://ntfy.sh", "topic": "flixpatrol-alerts" }
    ]
  }
}
```

Semantics:
- `Notifications` block absent → no notifications, no validation errors, no logs.
- Event key absent or list empty → that event is silent.
- A destination object may appear in multiple events.
- `type` is a strict enum: `"webhook" | "gotify" | "ntfy" | "apprise"`. Unknown types fail Zod validation at boot with a clear message.
- Required fields per type:
  - `webhook` → `url`
  - `gotify` → `url`, `token`
  - `ntfy` → `url`, `topic`
  - `apprise` → `url`, `key`

## Architecture

```
src/Notifications/
├── index.ts                    # public exports
├── NotificationManager.ts      # orchestrator
├── Notifier.ts                 # Notifier interface
├── types.ts                    # NotificationEvent, NotificationPayload, RunSummary, Destination
└── adapters/
    ├── WebhookAdapter.ts       # generic JSON, Discord-shaped if URL matches discord.com/api/webhooks
    ├── GotifyAdapter.ts        # POST {url}/message?token={token}
    ├── NtfyAdapter.ts          # POST {url} with JSON body { topic, title, message, priority, tags }
    └── AppriseAdapter.ts       # POST {url}/notify/{key} with { title, body, type }
```

### `Notifier` interface

```ts
export interface Notifier {
  notify(event: NotificationEvent, payload: NotificationPayload): Promise<void>;
}
```

### Adapter contracts

Each adapter:
- Receives its config object in the constructor.
- Implements `notify()` as `async`.
- **Never throws**: any HTTP failure (4xx/5xx, network error, timeout) is caught internally, logged at `warn`, and resolved.
- Applies a 5 second HTTP timeout via `AbortController`.

### `NotificationManager`

- Built via `NotificationManager.fromConfig(notificationsConfig)`.
- Pre-instantiates one adapter instance per destination object at boot.
- `dispatch(event, payload)`:
  - Looks up the list of adapters for `event`. If empty/absent, returns immediately.
  - Calls all adapters in parallel via `Promise.allSettled`.
  - Failures from individual adapters are already swallowed inside the adapter, but `allSettled` provides a final safety net.
- The dispatch itself is `await`ed in `app.ts`, but a per-dispatch timeout caps the wait at 6 seconds (5s HTTP + 1s margin) so a hung notification can never delay the rest of the run by more than that.

### Payload shaping

| Adapter         | Payload shape                                                                                              |
|-----------------|------------------------------------------------------------------------------------------------------------|
| webhook (Discord URL detected) | `{ content: title, embeds: [{ title, description: body, timestamp, color }] }` with color per event |
| webhook (generic) | `{ event, title, body, timestamp, summary? }` raw                                                       |
| gotify          | `{ title, message: body, priority }`; priority = 5 default, 8 for `error`                                  |
| ntfy            | `{ topic, title, message: body, priority, tags }`; priority 3 default, 5 for `error`; tag = event name     |
| apprise         | `{ title, body, type }`; type ∈ `info` (run_start), `success` (run_end), `failure` (error)                 |

### Detection rule for Discord smart-shaping

A `webhook` URL is treated as Discord when:
- Host is `discord.com` or `discordapp.com`
- Path starts with `/api/webhooks/`

Anything else gets the generic payload.

## Integration in `app.ts`

```ts
const notifierConfig = GetAndValidateConfigs.getNotifications();
const notifier = NotificationManager.fromConfig(notifierConfig);
const runStart = Date.now();
const summary: RunSummary = { listsProcessed: 0, moviesAdded: 0, showsAdded: 0, unmatchedMovies: 0, unmatchedShows: 0, durationMs: 0 };

trakt.connect().then(async () => {
  await notifier.dispatch('run_start', { title: `${name} v${version} run started`, body: `Processing ${totalLists} lists`, timestamp: new Date().toISOString() });

  // existing loops, incrementing summary.* on each push success / failure

  summary.durationMs = Date.now() - runStart;
  await notifier.dispatch('run_end', { title: `${name} run finished`, body: `Processed ${summary.listsProcessed}/${totalLists} lists`, timestamp: new Date().toISOString(), summary });
}).catch(async (err) => {
  await notifier.dispatch('error', { title: `${name} run failed`, body: `${(err as Error).name}: ${(err as Error).message}`, timestamp: new Date().toISOString() });
  if (err instanceof AppError) { logger.error(`${err.name}: ${err.message}`); }
  else { logger.error(`Unexpected error: ${(err as Error).message}`); }
  process.exit(1);
});
```

`RunSummary` counters are incremented inline at each existing `await trakt.pushToList(...)` call site (4 sites).

## Error handling

- A notification dispatch **never** crashes the main run. The main loop's outcome (success or fatal error) is determined entirely by Trakt sync logic.
- A notification HTTP failure logs a `warn` line identifying the adapter and the underlying error message. No retries — best-effort delivery.
- The `error` event itself is best-effort: if its dispatch fails, we still proceed to `logger.error(...)` + `process.exit(1)` as today.

## Documentation impact

- New section in `README.md` after "List Name Prefix": "Notifications" subsection covering events, each destination type with one-line config example, and a short note on Apprise sidecar deployment (with a `docker-compose.yml` snippet).
- New entry in the env-var table is **not** needed (this is config-file based, not env).

## Testing

Per-adapter tests (`tests/Notifications/adapters/*.test.ts`) mock `globalThis.fetch`:
- Correct URL constructed from config.
- Correct payload shape for each adapter (including the webhook Discord vs generic branch).
- Success path resolves silently.
- Non-2xx response is caught and warned; the adapter call resolves.
- `fetch` throwing (network error) is caught and warned.
- 5 second timeout fires via mock fake timers (`AbortError` path).

NtfyAdapter additional: payload uses the JSON mode (not Title-header mode) for consistency. Priority and `tags` field assertions.

AppriseAdapter additional: the `type` field maps correctly per event (`info` / `success` / `failure`).

Manager tests (`tests/Notifications/NotificationManager.test.ts`):
- `fromConfig` with no `Notifications` block returns a manager whose `dispatch` is a no-op.
- `fromConfig` with an event list of 3 destinations → `dispatch` calls all 3 adapters in parallel.
- One adapter throwing (even though they shouldn't) doesn't prevent the others from being awaited.
- `dispatch` returns within the 6 second cap when an adapter is slow (verified with fake timers).

Zod schema tests (extension of `tests/Utils/GetAndValidateConfigs.test.ts`):
- `Notifications` block is optional.
- Missing required fields per type → clear validation error.
- Unknown `type` value → clear validation error.

`app.ts` is **not** unit-tested (consistent with current convention). The `notifier.dispatch(...)` call sites are trivial and inspected by diff review.

Estimated total: 40–50 tests.

## Out of scope (deferred)

- Per-destination event filtering beyond the event-keyed lists (e.g. "send to channel X only if listErrors > 0"). Trivially addable later via a `condition` field on the destination.
- Retry / queue for failed notifications. Best-effort delivery is enough for a personal cron tool.
- `changes` event (one notification per list updated). Too noisy for the current use case; can be added later if requested.
- Direct Slack adapter. Slack accepts Discord-compatible webhooks via the generic webhook adapter if shaped right; users wanting deep Slack support can route through Apprise.
- Notification of partial degradation (unmatched items, single-list errors) outside `run_end`'s summary.

## Risks

- **Apprise sidecar setup friction**: users have to deploy a second container and configure it via its web UI before our config matters. Mitigated by documenting the `docker-compose.yml` example in README.
- **Discord URL detection false-positive**: a non-Discord webhook hosted at a domain we accidentally match would receive a Discord-shaped payload. Hosts are pinned to `discord.com` / `discordapp.com` with the exact path prefix, so the surface is minimal.
- **Notification timeout adds 6s to run completion if a destination is hung**: acceptable for a CLI that already runs for minutes when syncing many lists. The cap prevents indefinite hangs.

## Decisions log

- **Adapter pattern over plugin system**: 4 adapters is too few to justify dynamic plugin loading.
- **Destination as inline `type`-discriminated object instead of a separate `destinations:` registry referenced by name from each event**: simpler config for the common case (one destination per event), at the cost of repetition if a destination is used in many events. Acceptable since most users will have ≤2 destinations total.
- **Apprise sidecar instead of embedding Python + Apprise CLI in the Docker image or bundling a Node port**: keeps the Node binary self-contained, avoids 150 MB+ of Python deps in the official Docker image, and lets users who want zero extra moving parts skip Apprise and use Discord/Gotify/ntfy adapters directly.
