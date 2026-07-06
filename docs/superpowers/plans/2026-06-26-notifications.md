# Notifications System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in notification system that emits `run_start`, `run_end`, and `error` events to one or more configured destinations (generic webhook with smart Discord shaping, Gotify, ntfy, Apprise sidecar).

**Architecture:** New `src/Notifications/` module exposing a `Notifier` interface, four typed adapters, and a `NotificationManager` orchestrator. Config lives under a new optional `Notifications` key in `config/default.json`, validated via Zod alongside existing schemas. `app.ts` dispatches events at three lifecycle points using fire-and-forget semantics — adapter failures never block or crash the main run.

**Tech Stack:** TypeScript 6, Node.js 24, Vitest, Zod 4, Winston, native `fetch` + `AbortController`.

## Global Constraints

- All notification adapters MUST swallow their own errors (network failure, non-2xx response, timeout) and log a `warn` line — they MUST NOT throw. The main sync run is the source of truth for success/failure.
- Every adapter HTTP call uses a 5-second timeout via `AbortController`.
- `NotificationManager.dispatch()` caps total wait at 6 seconds (`Promise.race` against a timer) so a hung adapter never delays the run by more than that.
- The `Notifications` config block is **optional**. Absent or null → manager dispatch is a no-op.
- `DRY_RUN=true` does NOT suppress notifications. Title/body are prefixed with `[DRY-RUN]` when dry-run is active.
- TypeScript strict mode is on; lint rules include `max-len: 120` (template literals exempt), `noUnusedLocals`, `noImplicitReturns`.
- Tests run with `npm test`. Lint with `npm run lint`. Build with `npm run build`. All three must pass before each commit.
- All new files use the existing project formatting (2-space indent, single quotes, trailing commas in multiline).
- Commits in English, single line, no `Co-Authored-By`.

## File Structure

**New files:**
- `src/Notifications/index.ts` — re-exports of public surface
- `src/Notifications/types.ts` — `NotificationEvent`, `NotificationPayload`, `RunSummary`, `Destination` types
- `src/Notifications/Notifier.ts` — `Notifier` interface
- `src/Notifications/NotificationManager.ts` — orchestrator
- `src/Notifications/adapters/WebhookAdapter.ts` — generic webhook + Discord-shaped payload
- `src/Notifications/adapters/GotifyAdapter.ts` — Gotify HTTP API
- `src/Notifications/adapters/NtfyAdapter.ts` — ntfy HTTP API (JSON mode)
- `src/Notifications/adapters/AppriseAdapter.ts` — Apprise API sidecar

**Modified files:**
- `src/types/Config.types.ts` — add `NotificationsSchema`, `NotificationsConfig` type
- `src/Utils/GetAndValidateConfigs.ts` — add `getNotifications()` static method
- `src/app.ts` — add `RunSummary` accumulator and three `notifier.dispatch(...)` calls
- `README.md` — new "Notifications" subsection

**New tests:**
- `tests/Notifications/adapters/WebhookAdapter.test.ts`
- `tests/Notifications/adapters/GotifyAdapter.test.ts`
- `tests/Notifications/adapters/NtfyAdapter.test.ts`
- `tests/Notifications/adapters/AppriseAdapter.test.ts`
- `tests/Notifications/NotificationManager.test.ts`

**Modified tests:**
- `tests/Utils/GetAndValidateConfigs.test.ts` — add Notifications-schema cases

---

### Task 1: Types and Notifier interface

**Files:**
- Create: `src/Notifications/types.ts`
- Create: `src/Notifications/Notifier.ts`
- Create: `src/Notifications/index.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `NotificationEvent = 'run_start' | 'run_end' | 'error'`
  - `RunSummary { listsProcessed, moviesAdded, showsAdded, unmatchedMovies, unmatchedShows, durationMs }` (all `number`)
  - `NotificationPayload { title: string; body: string; timestamp: string; summary?: RunSummary }`
  - `Destination` discriminated union over `type`
  - `Notifier { notify(event, payload): Promise<void> }`

- [ ] **Step 1: Create the types file**

Create `src/Notifications/types.ts`:

```ts
export type NotificationEvent = 'run_start' | 'run_end' | 'error';

export interface RunSummary {
  listsProcessed: number;
  moviesAdded: number;
  showsAdded: number;
  unmatchedMovies: number;
  unmatchedShows: number;
  durationMs: number;
}

export interface NotificationPayload {
  title: string;
  body: string;
  timestamp: string;
  summary?: RunSummary;
}

export interface WebhookDestination {
  type: 'webhook';
  url: string;
}

export interface GotifyDestination {
  type: 'gotify';
  url: string;
  token: string;
}

export interface NtfyDestination {
  type: 'ntfy';
  url: string;
  topic: string;
}

export interface AppriseDestination {
  type: 'apprise';
  url: string;
  key: string;
}

export type Destination =
  | WebhookDestination
  | GotifyDestination
  | NtfyDestination
  | AppriseDestination;

export type NotificationsConfig = Partial<Record<NotificationEvent, Destination[]>>;
```

- [ ] **Step 2: Create the Notifier interface**

Create `src/Notifications/Notifier.ts`:

```ts
import type { NotificationEvent, NotificationPayload } from './types';

export interface Notifier {
  notify(event: NotificationEvent, payload: NotificationPayload): Promise<void>;
}
```

- [ ] **Step 3: Create the public index**

Create `src/Notifications/index.ts`:

```ts
export * from './types';
export * from './Notifier';
```

- [ ] **Step 4: Verify build passes**

Run: `npm run build`
Expected: no errors. The types are not yet consumed but should compile cleanly.

- [ ] **Step 5: Verify lint passes**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/Notifications/types.ts src/Notifications/Notifier.ts src/Notifications/index.ts
git commit -m "Add Notifications types and Notifier interface"
```

---

### Task 2: Zod schema and `getNotifications()` accessor

**Files:**
- Modify: `src/types/Config.types.ts` (append `NotificationsSchema` + type export)
- Modify: `src/Utils/GetAndValidateConfigs.ts` (add `getNotifications()` method)
- Modify: `tests/Utils/GetAndValidateConfigs.test.ts` (add `getNotifications` describe block)

**Interfaces:**
- Consumes: `NotificationsConfig` type from Task 1
- Produces: `GetAndValidateConfigs.getNotifications(): NotificationsConfig` — returns empty object `{}` when the config block is absent

- [ ] **Step 1: Write failing tests in `tests/Utils/GetAndValidateConfigs.test.ts`**

Locate the existing `describe('GetAndValidateConfigs', ...)` block and append a new nested `describe` for `getNotifications`. Add it at the same indentation as the other `describe` blocks inside the top-level one.

```ts
describe('getNotifications', () => {
  it('returns an empty object when the Notifications block is absent', () => {
    vi.mocked(config.has).mockReturnValueOnce(false);
    expect(GetAndValidateConfigs.getNotifications()).toEqual({});
  });

  it('returns the parsed config when valid', () => {
    vi.mocked(config.has).mockReturnValueOnce(true);
    vi.mocked(config.get).mockReturnValueOnce({
      run_start: [{ type: 'webhook', url: 'https://example.com/hook' }],
      error: [{ type: 'gotify', url: 'https://gotify.example.com', token: 'tok' }],
    });
    const result = GetAndValidateConfigs.getNotifications();
    expect(result.run_start).toHaveLength(1);
    expect(result.error?.[0]).toMatchObject({ type: 'gotify', token: 'tok' });
  });

  it('rejects an unknown destination type', () => {
    vi.mocked(config.has).mockReturnValueOnce(true);
    vi.mocked(config.get).mockReturnValueOnce({
      run_end: [{ type: 'pigeon', url: 'https://example.com' }],
    });
    expect(() => GetAndValidateConfigs.getNotifications()).toThrow(/Notifications/);
  });

  it('rejects a gotify destination missing the token', () => {
    vi.mocked(config.has).mockReturnValueOnce(true);
    vi.mocked(config.get).mockReturnValueOnce({
      error: [{ type: 'gotify', url: 'https://gotify.example.com' }],
    });
    expect(() => GetAndValidateConfigs.getNotifications()).toThrow(/token/);
  });

  it('rejects an ntfy destination missing the topic', () => {
    vi.mocked(config.has).mockReturnValueOnce(true);
    vi.mocked(config.get).mockReturnValueOnce({
      run_end: [{ type: 'ntfy', url: 'https://ntfy.sh' }],
    });
    expect(() => GetAndValidateConfigs.getNotifications()).toThrow(/topic/);
  });

  it('rejects an apprise destination missing the key', () => {
    vi.mocked(config.has).mockReturnValueOnce(true);
    vi.mocked(config.get).mockReturnValueOnce({
      run_end: [{ type: 'apprise', url: 'http://apprise:8000' }],
    });
    expect(() => GetAndValidateConfigs.getNotifications()).toThrow(/key/);
  });
});
```

If the existing test file does not already mock `config.has`, add `has: vi.fn()` to the `vi.mock('config', ...)` block at the top of the file.

- [ ] **Step 2: Run the new tests and verify they fail**

Run: `npx vitest run tests/Utils/GetAndValidateConfigs.test.ts -t "getNotifications"`
Expected: all 6 tests FAIL with `TypeError: GetAndValidateConfigs.getNotifications is not a function` (and the missing-import errors first compile pass — that's fine, it confirms the API is missing).

- [ ] **Step 3: Add the Zod schema in `src/types/Config.types.ts`**

Append at the end of the file, before the `// Infer types from schemas` comment:

```ts
export const WebhookDestinationSchema = z.object({
  type: z.literal('webhook'),
  url: z.string().min(1),
});

export const GotifyDestinationSchema = z.object({
  type: z.literal('gotify'),
  url: z.string().min(1),
  token: z.string().min(1),
});

export const NtfyDestinationSchema = z.object({
  type: z.literal('ntfy'),
  url: z.string().min(1),
  topic: z.string().min(1),
});

export const AppriseDestinationSchema = z.object({
  type: z.literal('apprise'),
  url: z.string().min(1),
  key: z.string().min(1),
});

export const DestinationSchema = z.discriminatedUnion('type', [
  WebhookDestinationSchema,
  GotifyDestinationSchema,
  NtfyDestinationSchema,
  AppriseDestinationSchema,
]);

export const NotificationsSchema = z.object({
  run_start: z.array(DestinationSchema).optional(),
  run_end: z.array(DestinationSchema).optional(),
  error: z.array(DestinationSchema).optional(),
});
```

Then append after the existing type exports:

```ts
export type NotificationsConfigFromSchema = z.infer<typeof NotificationsSchema>;
```

(We re-export the canonical type from `Notifications/types.ts` rather than this inferred one — this export exists only for unit-test convenience.)

- [ ] **Step 4: Add `getNotifications()` in `src/Utils/GetAndValidateConfigs.ts`**

Add the `NotificationsSchema` import at the top, in the existing import-block from `'../types'`:

```ts
import {
  FlixPatrolTop10Schema,
  FlixPatrolPopularSchema,
  FlixPatrolMostWatchedSchema,
  FlixPatrolMostHoursSchema,
  TraktOptionsSchema,
  CacheOptionsSchema,
  NotificationsSchema,
} from '../types';
```

Add this type-only import line below the existing type imports:

```ts
import type { NotificationsConfig } from '../Notifications/types';
```

Add this method inside the `GetAndValidateConfigs` class, after `getCacheOptions()`:

```ts
public static getNotifications(): NotificationsConfig {
  try {
    if (!config.has('Notifications')) {
      return {};
    }
    const data = config.get('Notifications');
    return validateConfig(NotificationsSchema, data, 'Notifications');
  } catch (err) {
    if (err instanceof ConfigurationError) throw err;
    throw new ConfigurationError(`${err}`);
  }
}
```

- [ ] **Step 5: Run the tests and verify they pass**

Run: `npx vitest run tests/Utils/GetAndValidateConfigs.test.ts -t "getNotifications"`
Expected: all 6 tests PASS.

- [ ] **Step 6: Run the full test suite**

Run: `npm test`
Expected: every previously-passing test still passes; total count increased by 6.

- [ ] **Step 7: Verify lint and build**

Run: `npm run lint && npm run build`
Expected: both succeed.

- [ ] **Step 8: Commit**

```bash
git add src/types/Config.types.ts src/Utils/GetAndValidateConfigs.ts tests/Utils/GetAndValidateConfigs.test.ts
git commit -m "Add Notifications Zod schema and getNotifications accessor"
```

---

### Task 3: WebhookAdapter (generic + Discord shaping)

**Files:**
- Create: `tests/Notifications/adapters/WebhookAdapter.test.ts`
- Create: `src/Notifications/adapters/WebhookAdapter.ts`

**Interfaces:**
- Consumes: `Notifier`, `NotificationEvent`, `NotificationPayload`, `WebhookDestination` from Task 1
- Produces: `WebhookAdapter` class implementing `Notifier`, constructor `(destination: WebhookDestination)`, plus a private helper `isDiscordUrl(url: string): boolean` (not exported)

- [ ] **Step 1: Write the failing tests**

Create `tests/Notifications/adapters/WebhookAdapter.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebhookAdapter } from '../../../src/Notifications/adapters/WebhookAdapter';

describe('WebhookAdapter', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('POSTs a generic JSON payload to a non-Discord URL', async () => {
    const adapter = new WebhookAdapter({ type: 'webhook', url: 'https://example.com/hook' });
    await adapter.notify('run_start', {
      title: 'started',
      body: 'processing',
      timestamp: '2026-06-26T10:00:00.000Z',
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://example.com/hook');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json' });
    const sentBody = JSON.parse(init.body as string);
    expect(sentBody).toMatchObject({
      event: 'run_start',
      title: 'started',
      body: 'processing',
      timestamp: '2026-06-26T10:00:00.000Z',
    });
  });

  it('includes summary in the generic payload when provided', async () => {
    const adapter = new WebhookAdapter({ type: 'webhook', url: 'https://example.com/hook' });
    await adapter.notify('run_end', {
      title: 'done',
      body: 'finished',
      timestamp: '2026-06-26T10:00:00.000Z',
      summary: {
        listsProcessed: 5, moviesAdded: 100, showsAdded: 50,
        unmatchedMovies: 2, unmatchedShows: 1, durationMs: 12000,
      },
    });
    const init = fetchMock.mock.calls[0][1];
    const sentBody = JSON.parse(init.body as string);
    expect(sentBody.summary).toEqual({
      listsProcessed: 5, moviesAdded: 100, showsAdded: 50,
      unmatchedMovies: 2, unmatchedShows: 1, durationMs: 12000,
    });
  });

  it('shapes the payload as Discord embed when URL matches discord.com/api/webhooks', async () => {
    const adapter = new WebhookAdapter({
      type: 'webhook',
      url: 'https://discord.com/api/webhooks/1234/abcd',
    });
    await adapter.notify('run_start', {
      title: 'started',
      body: 'processing 3 lists',
      timestamp: '2026-06-26T10:00:00.000Z',
    });
    const init = fetchMock.mock.calls[0][1];
    const sentBody = JSON.parse(init.body as string);
    expect(sentBody.content).toBe('started');
    expect(sentBody.embeds).toBeDefined();
    expect(sentBody.embeds[0]).toMatchObject({
      title: 'started',
      description: 'processing 3 lists',
      timestamp: '2026-06-26T10:00:00.000Z',
    });
    expect(typeof sentBody.embeds[0].color).toBe('number');
  });

  it('also shapes the Discord payload for discordapp.com URLs', async () => {
    const adapter = new WebhookAdapter({
      type: 'webhook',
      url: 'https://discordapp.com/api/webhooks/5678/efgh',
    });
    await adapter.notify('error', { title: 't', body: 'b', timestamp: '2026-06-26T10:00:00.000Z' });
    const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(sentBody.embeds).toBeDefined();
  });

  it('does NOT shape for Discord when host is right but path is different', async () => {
    const adapter = new WebhookAdapter({
      type: 'webhook',
      url: 'https://discord.com/some/other/path',
    });
    await adapter.notify('run_start', { title: 't', body: 'b', timestamp: '2026-06-26T10:00:00.000Z' });
    const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(sentBody.embeds).toBeUndefined();
    expect(sentBody.event).toBe('run_start');
  });

  it('resolves silently when the server returns 500', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 500 }));
    const adapter = new WebhookAdapter({ type: 'webhook', url: 'https://example.com/hook' });
    await expect(
      adapter.notify('run_start', { title: 't', body: 'b', timestamp: '2026-06-26T10:00:00.000Z' })
    ).resolves.toBeUndefined();
  });

  it('resolves silently when fetch throws (network error)', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const adapter = new WebhookAdapter({ type: 'webhook', url: 'https://example.com/hook' });
    await expect(
      adapter.notify('run_start', { title: 't', body: 'b', timestamp: '2026-06-26T10:00:00.000Z' })
    ).resolves.toBeUndefined();
  });

  it('aborts the request after 5 seconds', async () => {
    vi.useFakeTimers();
    let capturedSignal: AbortSignal | undefined;
    fetchMock.mockImplementation((_url: string, init: RequestInit) => {
      capturedSignal = init.signal as AbortSignal;
      return new Promise<Response>((_resolve, reject) => {
        capturedSignal?.addEventListener('abort', () => reject(new Error('AbortError')));
      });
    });
    const adapter = new WebhookAdapter({ type: 'webhook', url: 'https://example.com/hook' });
    const promise = adapter.notify('run_start', {
      title: 't', body: 'b', timestamp: '2026-06-26T10:00:00.000Z',
    });
    await vi.advanceTimersByTimeAsync(5000);
    await expect(promise).resolves.toBeUndefined();
    expect(capturedSignal?.aborted).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npx vitest run tests/Notifications/adapters/WebhookAdapter.test.ts`
Expected: all 8 tests FAIL with `Cannot find module '...WebhookAdapter'`.

- [ ] **Step 3: Implement the adapter**

Create `src/Notifications/adapters/WebhookAdapter.ts`:

```ts
import { logger } from '../../Utils/Logger';
import type { Notifier } from '../Notifier';
import type {
  NotificationEvent,
  NotificationPayload,
  WebhookDestination,
} from '../types';

const TIMEOUT_MS = 5000;

const DISCORD_COLORS: Record<NotificationEvent, number> = {
  run_start: 0x3498db,
  run_end: 0x2ecc71,
  error: 0xe74c3c,
};

function isDiscordUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const isDiscordHost = parsed.host === 'discord.com' || parsed.host === 'discordapp.com';
    return isDiscordHost && parsed.pathname.startsWith('/api/webhooks/');
  } catch {
    return false;
  }
}

function buildDiscordPayload(event: NotificationEvent, payload: NotificationPayload): unknown {
  return {
    content: payload.title,
    embeds: [{
      title: payload.title,
      description: payload.body,
      timestamp: payload.timestamp,
      color: DISCORD_COLORS[event],
    }],
  };
}

function buildGenericPayload(event: NotificationEvent, payload: NotificationPayload): unknown {
  return {
    event,
    title: payload.title,
    body: payload.body,
    timestamp: payload.timestamp,
    ...(payload.summary ? { summary: payload.summary } : {}),
  };
}

export class WebhookAdapter implements Notifier {
  constructor(private readonly destination: WebhookDestination) {}

  async notify(event: NotificationEvent, payload: NotificationPayload): Promise<void> {
    const body = isDiscordUrl(this.destination.url)
      ? buildDiscordPayload(event, payload)
      : buildGenericPayload(event, payload);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(this.destination.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) {
        logger.warn(`WebhookAdapter: HTTP ${response.status} from ${this.destination.url}`);
      }
    } catch (err) {
      logger.warn(`WebhookAdapter: ${(err as Error).message} for ${this.destination.url}`);
    } finally {
      clearTimeout(timer);
    }
  }
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npx vitest run tests/Notifications/adapters/WebhookAdapter.test.ts`
Expected: all 8 tests PASS.

- [ ] **Step 5: Run the full test suite + lint + build**

Run: `npm test && npm run lint && npm run build`
Expected: every test passes; lint clean; build clean.

- [ ] **Step 6: Commit**

```bash
git add tests/Notifications/adapters/WebhookAdapter.test.ts src/Notifications/adapters/WebhookAdapter.ts
git commit -m "Add WebhookAdapter with smart Discord payload shaping"
```

---

### Task 4: GotifyAdapter

**Files:**
- Create: `tests/Notifications/adapters/GotifyAdapter.test.ts`
- Create: `src/Notifications/adapters/GotifyAdapter.ts`

**Interfaces:**
- Consumes: `Notifier`, `GotifyDestination` from Task 1
- Produces: `GotifyAdapter` class implementing `Notifier`, constructor `(destination: GotifyDestination)`

- [ ] **Step 1: Write the failing tests**

Create `tests/Notifications/adapters/GotifyAdapter.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GotifyAdapter } from '../../../src/Notifications/adapters/GotifyAdapter';

describe('GotifyAdapter', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const dest = { type: 'gotify' as const, url: 'https://gotify.example.com', token: 'AbCd' };

  it('POSTs to {url}/message?token={token}', async () => {
    const adapter = new GotifyAdapter(dest);
    await adapter.notify('run_start', { title: 't', body: 'b', timestamp: '2026-06-26T10:00:00.000Z' });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://gotify.example.com/message?token=AbCd');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json' });
  });

  it('uses priority 5 for run_start and run_end', async () => {
    const adapter = new GotifyAdapter(dest);
    await adapter.notify('run_start', { title: 't', body: 'b', timestamp: '2026-06-26T10:00:00.000Z' });
    let sent = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(sent).toMatchObject({ title: 't', message: 'b', priority: 5 });

    fetchMock.mockClear();
    await adapter.notify('run_end', { title: 't', body: 'b', timestamp: '2026-06-26T10:00:00.000Z' });
    sent = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(sent.priority).toBe(5);
  });

  it('uses priority 8 for error', async () => {
    const adapter = new GotifyAdapter(dest);
    await adapter.notify('error', { title: 't', body: 'b', timestamp: '2026-06-26T10:00:00.000Z' });
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(sent.priority).toBe(8);
  });

  it('strips a trailing slash on the URL to avoid //message', async () => {
    const adapter = new GotifyAdapter({ ...dest, url: 'https://gotify.example.com/' });
    await adapter.notify('run_start', { title: 't', body: 'b', timestamp: '2026-06-26T10:00:00.000Z' });
    expect(fetchMock.mock.calls[0][0]).toBe('https://gotify.example.com/message?token=AbCd');
  });

  it('resolves silently on non-2xx response', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }));
    const adapter = new GotifyAdapter(dest);
    await expect(
      adapter.notify('run_start', { title: 't', body: 'b', timestamp: '2026-06-26T10:00:00.000Z' })
    ).resolves.toBeUndefined();
  });

  it('resolves silently when fetch throws', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const adapter = new GotifyAdapter(dest);
    await expect(
      adapter.notify('run_start', { title: 't', body: 'b', timestamp: '2026-06-26T10:00:00.000Z' })
    ).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npx vitest run tests/Notifications/adapters/GotifyAdapter.test.ts`
Expected: all 6 tests FAIL with `Cannot find module '...GotifyAdapter'`.

- [ ] **Step 3: Implement the adapter**

Create `src/Notifications/adapters/GotifyAdapter.ts`:

```ts
import { logger } from '../../Utils/Logger';
import type { Notifier } from '../Notifier';
import type {
  NotificationEvent,
  NotificationPayload,
  GotifyDestination,
} from '../types';

const TIMEOUT_MS = 5000;

function priorityFor(event: NotificationEvent): number {
  return event === 'error' ? 8 : 5;
}

export class GotifyAdapter implements Notifier {
  constructor(private readonly destination: GotifyDestination) {}

  async notify(event: NotificationEvent, payload: NotificationPayload): Promise<void> {
    const base = this.destination.url.replace(/\/+$/, '');
    const url = `${base}/message?token=${encodeURIComponent(this.destination.token)}`;
    const body = {
      title: payload.title,
      message: payload.body,
      priority: priorityFor(event),
    };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) {
        logger.warn(`GotifyAdapter: HTTP ${response.status} from ${base}`);
      }
    } catch (err) {
      logger.warn(`GotifyAdapter: ${(err as Error).message} for ${base}`);
    } finally {
      clearTimeout(timer);
    }
  }
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npx vitest run tests/Notifications/adapters/GotifyAdapter.test.ts`
Expected: all 6 tests PASS.

- [ ] **Step 5: Full test suite + lint + build**

Run: `npm test && npm run lint && npm run build`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add tests/Notifications/adapters/GotifyAdapter.test.ts src/Notifications/adapters/GotifyAdapter.ts
git commit -m "Add GotifyAdapter"
```

---

### Task 5: NtfyAdapter

**Files:**
- Create: `tests/Notifications/adapters/NtfyAdapter.test.ts`
- Create: `src/Notifications/adapters/NtfyAdapter.ts`

**Interfaces:**
- Consumes: `Notifier`, `NtfyDestination` from Task 1
- Produces: `NtfyAdapter` class implementing `Notifier`, constructor `(destination: NtfyDestination)`

- [ ] **Step 1: Write the failing tests**

Create `tests/Notifications/adapters/NtfyAdapter.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NtfyAdapter } from '../../../src/Notifications/adapters/NtfyAdapter';

describe('NtfyAdapter', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const dest = { type: 'ntfy' as const, url: 'https://ntfy.sh', topic: 'flixpatrol-alerts' };

  it('POSTs JSON to the server root with topic in body', async () => {
    const adapter = new NtfyAdapter(dest);
    await adapter.notify('run_start', { title: 't', body: 'b', timestamp: '2026-06-26T10:00:00.000Z' });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://ntfy.sh');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json' });
    const sent = JSON.parse(init.body as string);
    expect(sent).toMatchObject({
      topic: 'flixpatrol-alerts',
      title: 't',
      message: 'b',
    });
  });

  it('uses priority 3 for run_start and run_end and tags the event', async () => {
    const adapter = new NtfyAdapter(dest);
    await adapter.notify('run_start', { title: 't', body: 'b', timestamp: '2026-06-26T10:00:00.000Z' });
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(sent.priority).toBe(3);
    expect(sent.tags).toContain('run_start');
  });

  it('uses priority 5 (max) for error', async () => {
    const adapter = new NtfyAdapter(dest);
    await adapter.notify('error', { title: 't', body: 'b', timestamp: '2026-06-26T10:00:00.000Z' });
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(sent.priority).toBe(5);
    expect(sent.tags).toContain('error');
  });

  it('strips a trailing slash on the server URL', async () => {
    const adapter = new NtfyAdapter({ ...dest, url: 'https://ntfy.sh/' });
    await adapter.notify('run_start', { title: 't', body: 'b', timestamp: '2026-06-26T10:00:00.000Z' });
    expect(fetchMock.mock.calls[0][0]).toBe('https://ntfy.sh');
  });

  it('resolves silently on non-2xx response', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 403 }));
    const adapter = new NtfyAdapter(dest);
    await expect(
      adapter.notify('run_start', { title: 't', body: 'b', timestamp: '2026-06-26T10:00:00.000Z' })
    ).resolves.toBeUndefined();
  });

  it('resolves silently when fetch throws', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ENOTFOUND'));
    const adapter = new NtfyAdapter(dest);
    await expect(
      adapter.notify('run_start', { title: 't', body: 'b', timestamp: '2026-06-26T10:00:00.000Z' })
    ).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npx vitest run tests/Notifications/adapters/NtfyAdapter.test.ts`
Expected: all 6 tests FAIL with `Cannot find module '...NtfyAdapter'`.

- [ ] **Step 3: Implement the adapter**

Create `src/Notifications/adapters/NtfyAdapter.ts`:

```ts
import { logger } from '../../Utils/Logger';
import type { Notifier } from '../Notifier';
import type {
  NotificationEvent,
  NotificationPayload,
  NtfyDestination,
} from '../types';

const TIMEOUT_MS = 5000;

function priorityFor(event: NotificationEvent): number {
  return event === 'error' ? 5 : 3;
}

export class NtfyAdapter implements Notifier {
  constructor(private readonly destination: NtfyDestination) {}

  async notify(event: NotificationEvent, payload: NotificationPayload): Promise<void> {
    const base = this.destination.url.replace(/\/+$/, '');
    const body = {
      topic: this.destination.topic,
      title: payload.title,
      message: payload.body,
      priority: priorityFor(event),
      tags: [event],
    };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(base, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) {
        logger.warn(`NtfyAdapter: HTTP ${response.status} from ${base}`);
      }
    } catch (err) {
      logger.warn(`NtfyAdapter: ${(err as Error).message} for ${base}`);
    } finally {
      clearTimeout(timer);
    }
  }
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npx vitest run tests/Notifications/adapters/NtfyAdapter.test.ts`
Expected: all 6 tests PASS.

- [ ] **Step 5: Full test suite + lint + build**

Run: `npm test && npm run lint && npm run build`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add tests/Notifications/adapters/NtfyAdapter.test.ts src/Notifications/adapters/NtfyAdapter.ts
git commit -m "Add NtfyAdapter"
```

---

### Task 6: AppriseAdapter

**Files:**
- Create: `tests/Notifications/adapters/AppriseAdapter.test.ts`
- Create: `src/Notifications/adapters/AppriseAdapter.ts`

**Interfaces:**
- Consumes: `Notifier`, `AppriseDestination` from Task 1
- Produces: `AppriseAdapter` class implementing `Notifier`, constructor `(destination: AppriseDestination)`

- [ ] **Step 1: Write the failing tests**

Create `tests/Notifications/adapters/AppriseAdapter.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AppriseAdapter } from '../../../src/Notifications/adapters/AppriseAdapter';

describe('AppriseAdapter', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const dest = { type: 'apprise' as const, url: 'http://apprise:8000', key: 'flixpatrol' };

  it('POSTs to {url}/notify/{key} with {title, body, type}', async () => {
    const adapter = new AppriseAdapter(dest);
    await adapter.notify('run_start', { title: 't', body: 'b', timestamp: '2026-06-26T10:00:00.000Z' });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://apprise:8000/notify/flixpatrol');
    expect(init.method).toBe('POST');
    const sent = JSON.parse(init.body as string);
    expect(sent.title).toBe('t');
    expect(sent.body).toBe('b');
  });

  it('maps run_start to type=info', async () => {
    const adapter = new AppriseAdapter(dest);
    await adapter.notify('run_start', { title: 't', body: 'b', timestamp: '2026-06-26T10:00:00.000Z' });
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(sent.type).toBe('info');
  });

  it('maps run_end to type=success', async () => {
    const adapter = new AppriseAdapter(dest);
    await adapter.notify('run_end', { title: 't', body: 'b', timestamp: '2026-06-26T10:00:00.000Z' });
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(sent.type).toBe('success');
  });

  it('maps error to type=failure', async () => {
    const adapter = new AppriseAdapter(dest);
    await adapter.notify('error', { title: 't', body: 'b', timestamp: '2026-06-26T10:00:00.000Z' });
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(sent.type).toBe('failure');
  });

  it('strips a trailing slash on the URL', async () => {
    const adapter = new AppriseAdapter({ ...dest, url: 'http://apprise:8000/' });
    await adapter.notify('run_start', { title: 't', body: 'b', timestamp: '2026-06-26T10:00:00.000Z' });
    expect(fetchMock.mock.calls[0][0]).toBe('http://apprise:8000/notify/flixpatrol');
  });

  it('resolves silently on non-2xx response', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));
    const adapter = new AppriseAdapter(dest);
    await expect(
      adapter.notify('run_start', { title: 't', body: 'b', timestamp: '2026-06-26T10:00:00.000Z' })
    ).resolves.toBeUndefined();
  });

  it('resolves silently when fetch throws', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const adapter = new AppriseAdapter(dest);
    await expect(
      adapter.notify('run_start', { title: 't', body: 'b', timestamp: '2026-06-26T10:00:00.000Z' })
    ).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npx vitest run tests/Notifications/adapters/AppriseAdapter.test.ts`
Expected: all 7 tests FAIL with `Cannot find module '...AppriseAdapter'`.

- [ ] **Step 3: Implement the adapter**

Create `src/Notifications/adapters/AppriseAdapter.ts`:

```ts
import { logger } from '../../Utils/Logger';
import type { Notifier } from '../Notifier';
import type {
  NotificationEvent,
  NotificationPayload,
  AppriseDestination,
} from '../types';

const TIMEOUT_MS = 5000;

const APPRISE_TYPE: Record<NotificationEvent, 'info' | 'success' | 'failure'> = {
  run_start: 'info',
  run_end: 'success',
  error: 'failure',
};

export class AppriseAdapter implements Notifier {
  constructor(private readonly destination: AppriseDestination) {}

  async notify(event: NotificationEvent, payload: NotificationPayload): Promise<void> {
    const base = this.destination.url.replace(/\/+$/, '');
    const url = `${base}/notify/${encodeURIComponent(this.destination.key)}`;
    const body = {
      title: payload.title,
      body: payload.body,
      type: APPRISE_TYPE[event],
    };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) {
        logger.warn(`AppriseAdapter: HTTP ${response.status} from ${base}`);
      }
    } catch (err) {
      logger.warn(`AppriseAdapter: ${(err as Error).message} for ${base}`);
    } finally {
      clearTimeout(timer);
    }
  }
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npx vitest run tests/Notifications/adapters/AppriseAdapter.test.ts`
Expected: all 7 tests PASS.

- [ ] **Step 5: Full test suite + lint + build**

Run: `npm test && npm run lint && npm run build`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add tests/Notifications/adapters/AppriseAdapter.test.ts src/Notifications/adapters/AppriseAdapter.ts
git commit -m "Add AppriseAdapter"
```

---

### Task 7: NotificationManager

**Files:**
- Create: `tests/Notifications/NotificationManager.test.ts`
- Create: `src/Notifications/NotificationManager.ts`
- Modify: `src/Notifications/index.ts` (add export)

**Interfaces:**
- Consumes: `Notifier`, all adapter classes from Tasks 3-6, `NotificationsConfig`, `NotificationEvent`, `NotificationPayload` from Task 1
- Produces:
  - `NotificationManager` class with `static fromConfig(config: NotificationsConfig): NotificationManager`
  - Instance method `dispatch(event: NotificationEvent, payload: NotificationPayload): Promise<void>`
  - Constant `DISPATCH_TIMEOUT_MS = 6000` (exported for tests)

- [ ] **Step 1: Write the failing tests**

Create `tests/Notifications/NotificationManager.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NotificationManager } from '../../src/Notifications/NotificationManager';

describe('NotificationManager', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  const payload = { title: 't', body: 'b', timestamp: '2026-06-26T10:00:00.000Z' };

  it('dispatch is a no-op when the config is empty', async () => {
    const manager = NotificationManager.fromConfig({});
    await manager.dispatch('run_start', payload);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('dispatch is a no-op when the event has no destinations', async () => {
    const manager = NotificationManager.fromConfig({
      run_end: [{ type: 'webhook', url: 'https://example.com/hook' }],
    });
    await manager.dispatch('run_start', payload);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('dispatches to all destinations configured for the event', async () => {
    const manager = NotificationManager.fromConfig({
      run_end: [
        { type: 'webhook', url: 'https://a.example.com/hook' },
        { type: 'gotify', url: 'https://gotify.example.com', token: 't' },
        { type: 'ntfy', url: 'https://ntfy.sh', topic: 'flix' },
      ],
    });
    await manager.dispatch('run_end', payload);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const urls = fetchMock.mock.calls.map((c) => c[0]);
    expect(urls).toEqual(expect.arrayContaining([
      'https://a.example.com/hook',
      'https://gotify.example.com/message?token=t',
      'https://ntfy.sh',
    ]));
  });

  it('does not call destinations attached to other events', async () => {
    const manager = NotificationManager.fromConfig({
      run_start: [{ type: 'webhook', url: 'https://start.example.com' }],
      error: [{ type: 'webhook', url: 'https://error.example.com' }],
    });
    await manager.dispatch('run_start', payload);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe('https://start.example.com');
  });

  it('continues dispatching to others if one adapter throws', async () => {
    // First call rejects, second succeeds
    fetchMock
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    const manager = NotificationManager.fromConfig({
      error: [
        { type: 'webhook', url: 'https://will-fail.example.com' },
        { type: 'webhook', url: 'https://will-succeed.example.com' },
      ],
    });
    await expect(manager.dispatch('error', payload)).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('dispatch resolves within the 6-second cap even if an adapter never returns', async () => {
    vi.useFakeTimers();
    // Adapter that never resolves
    fetchMock.mockImplementation(() => new Promise(() => { /* hang */ }));
    const manager = NotificationManager.fromConfig({
      run_start: [{ type: 'webhook', url: 'https://hang.example.com' }],
    });
    const promise = manager.dispatch('run_start', payload);
    let resolved = false;
    promise.then(() => { resolved = true; });
    await vi.advanceTimersByTimeAsync(5999);
    expect(resolved).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    await Promise.resolve(); // flush microtasks
    expect(resolved).toBe(true);
  });

  it('instantiates each adapter type correctly from config', async () => {
    const manager = NotificationManager.fromConfig({
      run_end: [
        { type: 'apprise', url: 'http://apprise:8000', key: 'flix' },
      ],
    });
    await manager.dispatch('run_end', payload);
    expect(fetchMock.mock.calls[0][0]).toBe('http://apprise:8000/notify/flix');
  });
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npx vitest run tests/Notifications/NotificationManager.test.ts`
Expected: all 7 tests FAIL with `Cannot find module '...NotificationManager'`.

- [ ] **Step 3: Implement the manager**

Create `src/Notifications/NotificationManager.ts`:

```ts
import { logger } from '../Utils/Logger';
import type { Notifier } from './Notifier';
import type {
  Destination,
  NotificationEvent,
  NotificationPayload,
  NotificationsConfig,
} from './types';
import { WebhookAdapter } from './adapters/WebhookAdapter';
import { GotifyAdapter } from './adapters/GotifyAdapter';
import { NtfyAdapter } from './adapters/NtfyAdapter';
import { AppriseAdapter } from './adapters/AppriseAdapter';

export const DISPATCH_TIMEOUT_MS = 6000;

function buildAdapter(destination: Destination): Notifier {
  switch (destination.type) {
    case 'webhook': return new WebhookAdapter(destination);
    case 'gotify': return new GotifyAdapter(destination);
    case 'ntfy': return new NtfyAdapter(destination);
    case 'apprise': return new AppriseAdapter(destination);
  }
}

export class NotificationManager {
  private constructor(
    private readonly adapters: Partial<Record<NotificationEvent, Notifier[]>>,
  ) {}

  static fromConfig(config: NotificationsConfig): NotificationManager {
    const adapters: Partial<Record<NotificationEvent, Notifier[]>> = {};
    for (const event of ['run_start', 'run_end', 'error'] as const) {
      const destinations = config[event];
      if (destinations && destinations.length > 0) {
        adapters[event] = destinations.map(buildAdapter);
      }
    }
    return new NotificationManager(adapters);
  }

  async dispatch(event: NotificationEvent, payload: NotificationPayload): Promise<void> {
    const targets = this.adapters[event];
    if (!targets || targets.length === 0) return;

    const sends = targets.map((adapter) =>
      adapter.notify(event, payload).catch((err) => {
        logger.warn(`NotificationManager: adapter for "${event}" threw: ${(err as Error).message}`);
      })
    );
    const cap = new Promise<void>((resolve) => {
      setTimeout(() => {
        logger.warn(`NotificationManager: dispatch for "${event}" hit the ${DISPATCH_TIMEOUT_MS}ms cap`);
        resolve();
      }, DISPATCH_TIMEOUT_MS);
    });
    await Promise.race([Promise.allSettled(sends).then(() => undefined), cap]);
  }
}
```

- [ ] **Step 4: Update the public `index.ts`**

Modify `src/Notifications/index.ts` to add the manager export:

```ts
export * from './types';
export * from './Notifier';
export * from './NotificationManager';
```

- [ ] **Step 5: Run the tests and verify they pass**

Run: `npx vitest run tests/Notifications/NotificationManager.test.ts`
Expected: all 7 tests PASS.

- [ ] **Step 6: Full test suite + lint + build**

Run: `npm test && npm run lint && npm run build`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add tests/Notifications/NotificationManager.test.ts src/Notifications/NotificationManager.ts src/Notifications/index.ts
git commit -m "Add NotificationManager to orchestrate adapter dispatch"
```

---

### Task 8: Integrate into `app.ts` (RunSummary + dispatch calls)

**Files:**
- Modify: `src/app.ts`

**Interfaces:**
- Consumes: `NotificationManager`, `RunSummary` from Task 7; `getNotifications()` from Task 2

This task wires the notifier into the existing run lifecycle and accumulates the `RunSummary` counters at the existing `pushToList` call sites. There are no new unit tests because `app.ts` is the entry point (consistent with current project convention). A smoke test verifies the integration end-to-end.

- [ ] **Step 1: Add imports**

In `src/app.ts`, modify the existing import line:

```ts
import { logger, Utils, AppError, getPackageInfo } from './Utils';
```

into:

```ts
import { logger, Utils, AppError, getPackageInfo } from './Utils';
import { NotificationManager } from './Notifications';
import type { RunSummary } from './Notifications';
```

- [ ] **Step 2: Construct the manager and summary accumulator**

In `src/app.ts`, locate the line `const flixpatrol = new FlixPatrol(cacheOptions);` and insert this block immediately above it:

```ts
let notificationsConfig;
try {
  notificationsConfig = GetAndValidateConfigs.getNotifications();
} catch (err) {
  logger.error(`${(err as Error).name}: ${(err as Error).message}`);
  process.exit(1);
}
const notifier = NotificationManager.fromConfig(notificationsConfig);
const dryRunTag = dryRun ? '[DRY-RUN] ' : '';
const runStartAt = Date.now();
const summary: RunSummary = {
  listsProcessed: 0,
  moviesAdded: 0,
  showsAdded: 0,
  unmatchedMovies: 0,
  unmatchedShows: 0,
  durationMs: 0,
};
```

(The `let notificationsConfig` declaration without initializer is the existing pattern for the other `GetAndValidateConfigs.*` calls; the surrounding try/catch mirrors how other config reads are guarded in the file.)

- [ ] **Step 3: Emit `run_start` after `trakt.connect()` resolves**

In `src/app.ts`, locate `trakt.connect().then(async () => {`. Add a `dispatch` call as the first statement inside the `then` callback:

```ts
trakt.connect().then(async () => {
  await notifier.dispatch('run_start', {
    title: `${dryRunTag}${name} v${version} run started`,
    body: `Processing ${totalLists} lists`,
    timestamp: new Date().toISOString(),
  });

  // ... existing for-loops follow ...
```

- [ ] **Step 4: Accumulate counters in each list-type loop**

In `src/app.ts`, locate each of the FOUR loops (`for (const top10 ...)`, `for (const popular ...)`, `for (const mostWatched ...)`, `for (const mostHours ...)`) and update them as follows.

**In the Top10 loop**, the existing structure logs match-rate via `rawCounts.movies > movies.length`. Update both the movies and shows branches so they accumulate `summary.*` after the `pushToList` call.

Replace this existing block:

```ts
    if (movies.length > 0) {
      logger.info('==============================');
      if (rawCounts.movies > movies.length) {
        logger.warn(`Some movies from FlixPatrol could not be matched on Trakt (${rawCounts.movies} found, ${movies.length} matched)`);
      }
      logger.info(`Saving movies for "${baseListName}"`);
      logger.debug(`${top10.platform} movies: ${movies}`);
      await trakt.pushToList(movies, baseListName, 'movie', top10.privacy);
      logger.info(`List ${baseListName} updated with ${movies.length} new movies`);
    }
    if (shows.length > 0) {
      logger.info('==============================');
      if (rawCounts.shows > shows.length) {
        logger.warn(`Some shows from FlixPatrol could not be matched on Trakt (${rawCounts.shows} found, ${shows.length} matched)`);
      }
      logger.info(`Saving shows for "${baseListName}"`);
      logger.debug(`${top10.platform} shows: ${shows}`);
      await trakt.pushToList(shows, baseListName, 'show', top10.privacy);
      logger.info(`List ${baseListName} updated with ${shows.length} new shows`);
    }
```

with:

```ts
    if (movies.length > 0) {
      logger.info('==============================');
      if (rawCounts.movies > movies.length) {
        logger.warn(`Some movies from FlixPatrol could not be matched on Trakt (${rawCounts.movies} found, ${movies.length} matched)`);
        summary.unmatchedMovies += rawCounts.movies - movies.length;
      }
      logger.info(`Saving movies for "${baseListName}"`);
      logger.debug(`${top10.platform} movies: ${movies}`);
      await trakt.pushToList(movies, baseListName, 'movie', top10.privacy);
      logger.info(`List ${baseListName} updated with ${movies.length} new movies`);
      summary.moviesAdded += movies.length;
    }
    if (shows.length > 0) {
      logger.info('==============================');
      if (rawCounts.shows > shows.length) {
        logger.warn(`Some shows from FlixPatrol could not be matched on Trakt (${rawCounts.shows} found, ${shows.length} matched)`);
        summary.unmatchedShows += rawCounts.shows - shows.length;
      }
      logger.info(`Saving shows for "${baseListName}"`);
      logger.debug(`${top10.platform} shows: ${shows}`);
      await trakt.pushToList(shows, baseListName, 'show', top10.privacy);
      logger.info(`List ${baseListName} updated with ${shows.length} new shows`);
      summary.showsAdded += shows.length;
    }
  }
```

Then add `summary.listsProcessed++;` as the last statement of the Top10 for-loop body, just before its closing `}`.

**In the Popular loop**, similarly add accumulation:
- After `await trakt.pushToList(popularMovies, listName, 'movie', popular.privacy);` line, add `summary.moviesAdded += popularMovies.length;`
- After `await trakt.pushToList(popularShows, listName, 'show', popular.privacy);` line, add `summary.showsAdded += popularShows.length;`
- At the end of the for-loop body, add `summary.listsProcessed++;`

(Popular currently does not capture rawCounts in the visible diff. If a future change exposes rawCounts.movies/rawCounts.shows the unmatched accumulators can be added then.)

**In the MostWatched loop**, mirror Popular:
- After each `await trakt.pushToList(...)` line for movies → `summary.moviesAdded += mostWatchedMovies.length;`
- After each `await trakt.pushToList(...)` line for shows → `summary.showsAdded += mostWatchedShows.length;`
- At the end of the `if (mostWatched.enabled) { ... }` block (just inside its closing `}`), add `summary.listsProcessed++;`

**In the MostHours loop**, mirror MostWatched:
- After each `await trakt.pushToList(mostHoursMovies, ...)` line → `summary.moviesAdded += mostHoursMovies.length;`
- After each `await trakt.pushToList(mostHoursShows, ...)` line → `summary.showsAdded += mostHoursShows.length;`
- At the end of the `if (mostHours.enabled) { ... }` block, add `summary.listsProcessed++;`

- [ ] **Step 5: Emit `run_end` after the last loop**

In `src/app.ts`, locate the closing `}` of the MostHours for-loop (just before the `}).catch((err: unknown) => {`). Add this block immediately after the last for-loop's closing brace and before `}).catch(...`:

```ts
  summary.durationMs = Date.now() - runStartAt;
  await notifier.dispatch('run_end', {
    title: `${dryRunTag}${name} run finished`,
    body: `Processed ${summary.listsProcessed}/${totalLists} lists in ${Math.round(summary.durationMs / 1000)}s — ${summary.moviesAdded} movies / ${summary.showsAdded} shows added`,
    timestamp: new Date().toISOString(),
    summary,
  });
}).catch((err: unknown) => {
```

- [ ] **Step 6: Emit `error` in the `.catch`**

In `src/app.ts`, modify the `.catch(...)` block:

```ts
}).catch(async (err: unknown) => {
  await notifier.dispatch('error', {
    title: `${dryRunTag}${name} run failed`,
    body: `${(err as Error).name}: ${(err as Error).message}`,
    timestamp: new Date().toISOString(),
  });
  if (err instanceof AppError) {
    logger.error(`${err.name}: ${err.message}`);
  } else {
    logger.error(`Unexpected error: ${(err as Error).message}`);
  }
  process.exit(1);
});
```

(The callback becomes `async`; the existing error log + `process.exit(1)` flow is unchanged.)

- [ ] **Step 7: Verify build and lint**

Run: `npm run build && npm run lint`
Expected: both pass.

- [ ] **Step 8: Run the full test suite**

Run: `npm test`
Expected: all previously-passing tests still pass (no new tests added for `app.ts` itself).

- [ ] **Step 9: Smoke test — no notifications configured**

Run: `LIST_NAME_PREFIX="[TEST]" timeout 3 node build/app.js 2>&1 | head -12`
Expected: the startup banner appears, no notification-related warnings, the run proceeds normally (or fails on Trakt auth — that's fine, we only care about boot).

- [ ] **Step 10: Smoke test — notifications block declared but no destinations matching the event**

Temporarily append to `config/default.json` (under the existing top-level object) the key `"Notifications": { "run_start": [] }`. Then:

Run: `LIST_NAME_PREFIX="[TEST]" timeout 3 node build/app.js 2>&1 | head -12`
Expected: no notification HTTP calls attempted, no errors during boot, run proceeds.

Then revert `config/default.json` to its prior state (`git checkout -- config/default.json`).

- [ ] **Step 11: Commit**

```bash
git add src/app.ts
git commit -m "Wire NotificationManager into app lifecycle with RunSummary"
```

---

### Task 9: Documentation

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add the Notifications section**

In `README.md`, locate the `### Configuration File` header (which currently follows the "List Name Prefix" subsection). Insert a new subsection **above** the `### Configuration File` line and **below** the "List Name Prefix" code block / description:

````markdown
#### Notifications

Send a notification at the start of a run, at the end (with a summary), and on terminal errors. The block is optional — omit it entirely to disable notifications.

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

Each event takes a list of destinations. A destination has a `type` and the fields required by that type:

| Type      | Fields                | Notes                                                                                |
|-----------|-----------------------|--------------------------------------------------------------------------------------|
| `webhook` | `url`                 | Sends generic JSON. If `url` matches `discord.com/api/webhooks/...` a Discord-shaped payload is sent automatically. |
| `gotify`  | `url`, `token`        | POSTs to `{url}/message?token={token}`.                                              |
| `ntfy`    | `url`, `topic`        | POSTs JSON to `{url}` with the topic in the body. Use `https://ntfy.sh` for the public service. |
| `apprise` | `url`, `key`          | POSTs to `{url}/notify/{key}` against an Apprise API sidecar (see below).            |

Notifications are best-effort: a failing destination is logged at `warn` level but never blocks the main sync. Each adapter has a 5-second HTTP timeout and the manager caps total wait at 6 seconds.

`DRY_RUN=true` does **not** suppress notifications (useful for testing the setup). Title/body are prefixed with `[DRY-RUN]` so they are easy to distinguish.

##### Apprise sidecar (optional)

The `apprise` destination talks to an [Apprise API](https://github.com/caronc/apprise-api) instance you host yourself. Once it is running, you configure your downstream services (Discord, Telegram, Email, etc.) inside Apprise — flixpatrol-top10 only needs to know the Apprise URL and a config key.

```yaml
# docker-compose.yml excerpt
services:
  flixpatrol:
    image: ghcr.io/navino16/flixpatrol-top10-on-trakt:latest
    volumes:
      - ./config:/app/config
    depends_on:
      - apprise

  apprise:
    image: caronc/apprise:latest
    ports:
      - "8000:8000"
    volumes:
      - ./apprise-config:/config
```

In the Apprise web UI (default `http://localhost:8000`), create a configuration key (for example `flixpatrol`) and add your downstream Apprise URLs (`discord://...`, `tgram://...`, `mailto://...`, etc.) under that key. Then reference it from `config/default.json`:

```json
{ "type": "apprise", "url": "http://apprise:8000", "key": "flixpatrol" }
```

````

- [ ] **Step 2: Verify the README renders correctly**

Run: `grep -n "#### Notifications" README.md`
Expected: one match — the section was added once, in the right place.

Run: `grep -c "type.*apprise" README.md`
Expected: at least 2 matches (one in the JSON example, one in the table).

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "Document Notifications config in README"
```

---

## Final Verification

After all tasks are complete:

- [ ] Run: `npm test` → all tests pass (baseline 148 + ~40 new = ~190)
- [ ] Run: `npm run lint` → no errors
- [ ] Run: `npm run build` → no errors
- [ ] Run: `LIST_NAME_PREFIX="[TEST]" timeout 3 node build/app.js 2>&1 | head -12` → boot succeeds, banner shows

When ready to push and open the PR (a single PR for the whole feature on branch `feat/notifications`):

```bash
git push -u origin feat/notifications
gh pr create --base develop --title "Add notifications system (run_start, run_end, error)" \
  --body "$(cat <<'EOF'
## Description

New notification system that emits run_start, run_end, and error events to one or more configured destinations: generic webhook (with smart Discord payload shaping), Gotify, ntfy, and Apprise (via a user-hosted Apprise API sidecar). Spec: `docs/superpowers/specs/2026-06-26-notifications-design.md`.

Best-effort delivery: adapters swallow their own errors, 5s HTTP timeout per call, 6s dispatch cap. Notifications never block or crash the main sync.

## Type of change
- [x] New feature

## Checklist
- [x] I have tested my changes locally
- [x] I have added/updated tests if needed
- [x] Code coverage is maintained or improved
- [x] Lint passes (`npm run lint`)
- [x] Tests pass (`npm test`)
- [x] Documentation updated
EOF
)" --label enhancement
```
