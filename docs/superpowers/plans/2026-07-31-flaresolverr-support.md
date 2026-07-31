# FlareSolverr Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the scraper reach FlixPatrol through an optional FlareSolverr instance, bypassing the Cloudflare managed challenge that currently returns `403` on every request.

**Architecture:** A standalone `FlareSolverrClient` speaks the FlareSolverr JSON protocol (`sessions.create` / `request.get` / `sessions.destroy`) and is injected into `FlixPatrol`. When configured and enabled, every FlixPatrol fetch routes through it; otherwise the existing `impit` path runs untouched. `runPipeline` owns the session lifecycle: created before the run, destroyed in a `finally`.

**Tech Stack:** TypeScript, Zod 4 (config validation), Vitest (tests), `node-config` (config loading), native `fetch` (FlareSolverr calls), `impit` (existing direct path).

## Global Constraints

- **Optionality is non-negotiable.** Block absent **or** `enabled: false` → behaviour is byte-for-byte what it is today.
- **The 60 existing tests in `tests/Flixpatrol/FlixPatrol.test.ts` must keep passing UNMODIFIED.** Needing to edit one means optionality is broken — stop and reconsider.
- **`sessions.create` and `sessions.destroy` are explicit calls.** `request.get` without a `session` silently works but creates a throwaway browser (15.4s vs 1.3-2.5s measured). Never rely on implicit sessions.
- Session name is the fixed constant `flixpatrol-top10` (avoids collisions in a container shared with *arr tools).
- `maxTimeout` default is `60000` ms — matches the documented FlareSolverr default.
- All code, comments and commit messages in English. Commit messages are a single line, no `Co-Authored-By`.
- Max line length 120 chars (ESLint, ignores strings/template literals).
- Do NOT commit anything under `docs/` — that includes this plan.
- Every task ends green: `npx vitest run`, `npx tsc --noEmit`, `npm run lint`.

## File Structure

| File | Responsibility |
|---|---|
| `src/types/Config.types.ts` (modify) | `FlareSolverrOptionsSchema` + inferred type |
| `src/Utils/Errors.ts` (modify) | `FlareSolverrError` |
| `src/Utils/GetAndValidateConfigs.ts` (modify) | `getFlareSolverrOptions()` |
| `src/FlareSolverr/FlareSolverrClient.ts` (create) | The protocol client — sessions + request.get |
| `src/FlareSolverr/index.ts` (create) | Barrel export |
| `src/Flixpatrol/FlixPatrol.ts` (modify) | Optional client injection + routing in `getFlixPatrolHTMLPage` |
| `src/Pipeline/runPipeline.ts` (modify) | Session lifecycle (create before, destroy in `finally`) |
| `src/app.ts` (modify) | Load the new config block into deps |
| `src/Utils/Utils.ts` (modify) | Block in the generated `defaultConfig` |
| `config/default.json` (modify) | Same block, `enabled: false` |
| `README.md`, `CLAUDE.md` (modify) | User + contributor docs |

---

### Task 1: Configuration schema and getter

**Files:**
- Modify: `src/types/Config.types.ts` (append after `ScheduleOptionsSchema`, around line 158)
- Modify: `src/Utils/GetAndValidateConfigs.ts` (import list + new static method)
- Test: `tests/Utils/GetAndValidateConfigs.test.ts`

**Interfaces:**
- Consumes: nothing (first task)
- Produces: `FlareSolverrOptionsSchema`, type `FlareSolverrOptions = { enabled: boolean; url?: string; maxTimeout: number }`, and `GetAndValidateConfigs.getFlareSolverrOptions(): FlareSolverrOptions`

- [ ] **Step 1: Write the failing tests**

Add to `tests/Utils/GetAndValidateConfigs.test.ts`, inside the outer `describe('GetAndValidateConfigs', ...)`, next to the existing `describe('getScheduleOptions', ...)` block (around line 436). `config` and `ConfigurationError` are already imported at the top of this file.

```typescript
    describe('getFlareSolverrOptions', () => {
      it('returns disabled defaults when the FlareSolverr block is absent', () => {
        vi.mocked(config.has).mockReturnValue(false);
        const result = GetAndValidateConfigs.getFlareSolverrOptions();
        expect(result).toEqual({ enabled: false, maxTimeout: 60000 });
      });

      it('returns disabled defaults without error when present but disabled', () => {
        vi.mocked(config.has).mockReturnValue(true);
        vi.mocked(config.get).mockReturnValue({ enabled: false });
        const result = GetAndValidateConfigs.getFlareSolverrOptions();
        expect(result).toEqual({ enabled: false, maxTimeout: 60000 });
      });

      it('returns a valid enabled configuration', () => {
        vi.mocked(config.has).mockReturnValue(true);
        vi.mocked(config.get).mockReturnValue({
          enabled: true, url: 'http://localhost:8191/v1', maxTimeout: 90000,
        });
        const result = GetAndValidateConfigs.getFlareSolverrOptions();
        expect(result).toEqual({
          enabled: true, url: 'http://localhost:8191/v1', maxTimeout: 90000,
        });
      });

      it('defaults maxTimeout to 60000 when omitted', () => {
        vi.mocked(config.has).mockReturnValue(true);
        vi.mocked(config.get).mockReturnValue({ enabled: true, url: 'http://localhost:8191/v1' });
        const result = GetAndValidateConfigs.getFlareSolverrOptions();
        expect(result.maxTimeout).toBe(60000);
      });

      it('throws when enabled with no url', () => {
        vi.mocked(config.has).mockReturnValue(true);
        vi.mocked(config.get).mockReturnValue({ enabled: true });
        expect(() => GetAndValidateConfigs.getFlareSolverrOptions()).toThrow(ConfigurationError);
      });

      it('throws when url is not a valid URL', () => {
        vi.mocked(config.has).mockReturnValue(true);
        vi.mocked(config.get).mockReturnValue({ enabled: true, url: 'not-a-url' });
        expect(() => GetAndValidateConfigs.getFlareSolverrOptions()).toThrow(ConfigurationError);
      });
    });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/Utils/GetAndValidateConfigs.test.ts -t "getFlareSolverrOptions"`
Expected: FAIL — `GetAndValidateConfigs.getFlareSolverrOptions is not a function`

- [ ] **Step 3: Add the Zod schema**

In `src/types/Config.types.ts`, append immediately after the `ScheduleOptionsSchema` definition (which ends with its `.refine(...)` closing `);` around line 158):

```typescript
export const FlareSolverrOptionsSchema = z.object({
  enabled: z.boolean().default(false),
  url: z.url().optional(),
  maxTimeout: z.number().default(60000),
}).refine(
  (f) => !f.enabled || (f.url !== undefined && f.url.length > 0),
  { message: 'url must be set when enabled' },
);
```

Then add the inferred type alongside the other `z.infer` exports at the bottom of the file (next to `export type ScheduleOptions = ...`):

```typescript
export type FlareSolverrOptions = z.infer<typeof FlareSolverrOptionsSchema>;
```

Note: `z.url()` is Zod 4 syntax and is already used in this file by `WebhookDestinationSchema` — follow that precedent, not the deprecated `z.string().url()`.

- [ ] **Step 4: Add the getter**

In `src/Utils/GetAndValidateConfigs.ts`, add `FlareSolverrOptionsSchema` to the existing schema import block from `'../types'`, and `FlareSolverrOptions` to the `import type` block from `'../types'`. Then add this method to the `GetAndValidateConfigs` class, after `getScheduleOptions()`:

```typescript
  public static getFlareSolverrOptions(): FlareSolverrOptions {
    try {
      const data = config.has('FlareSolverr') ? config.get('FlareSolverr') : {};
      return validateConfig(FlareSolverrOptionsSchema, data, 'FlareSolverr');
    } catch (err) {
      if (err instanceof ConfigurationError) throw err;
      throw new ConfigurationError(`${err}`);
    }
  }
```

This mirrors `getScheduleOptions()`: an absent block parses `{}` through the schema, so the Zod defaults produce `{ enabled: false, maxTimeout: 60000 }` without raising.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/Utils/GetAndValidateConfigs.test.ts`
Expected: PASS, including all pre-existing tests in the file

- [ ] **Step 6: Verify types and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: both clean

- [ ] **Step 7: Commit**

```bash
git add src/types/Config.types.ts src/Utils/GetAndValidateConfigs.ts tests/Utils/GetAndValidateConfigs.test.ts
git commit -m "feat(config): add optional FlareSolverr configuration block"
```

---

### Task 2: FlareSolverrClient

**Files:**
- Modify: `src/Utils/Errors.ts` (add `FlareSolverrError`)
- Create: `src/FlareSolverr/FlareSolverrClient.ts`
- Create: `src/FlareSolverr/index.ts`
- Test: `tests/FlareSolverr/FlareSolverrClient.test.ts` (create, plus the directory)

**Interfaces:**
- Consumes: `FlareSolverrOptions` from Task 1
- Produces: `FlareSolverrClient` with `createSession(): Promise<void>`, `get(url: string): Promise<string | null>`, `destroySession(): Promise<void>`; and `FlareSolverrError extends AppError`

- [ ] **Step 1: Write the failing tests**

Create `tests/FlareSolverr/FlareSolverrClient.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FlareSolverrClient } from '../../src/FlareSolverr/FlareSolverrClient';
import { FlareSolverrError } from '../../src/Utils/Errors';
import { logger } from '../../src/Utils/Logger';

const ENDPOINT = 'http://localhost:8191/v1';

// Build a fetch mock whose Response bodies are the FlareSolverr JSON envelopes.
const jsonResponse = (body: unknown) => ({ json: async () => body });

const okSession = { status: 'ok', session: 'flixpatrol-top10' };
const okSolution = (html: string, status = 200) => ({
  status: 'ok',
  solution: { url: 'https://flixpatrol.com/x', status, response: html },
});

// Read the JSON payload the client POSTed on a given call index.
const payloadOf = (fetchMock: ReturnType<typeof vi.fn>, call: number): Record<string, unknown> =>
  JSON.parse(fetchMock.mock.calls[call][1].body as string);

describe('FlareSolverrClient', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let client: FlareSolverrClient;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    client = new FlareSolverrClient({ enabled: true, url: ENDPOINT, maxTimeout: 60000 });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('createSession', () => {
    it('posts sessions.create with the namespaced session id', async () => {
      fetchMock.mockResolvedValue(jsonResponse(okSession));

      await client.createSession();

      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe(ENDPOINT);
      expect(init.method).toBe('POST');
      expect(payloadOf(fetchMock, 0)).toEqual({
        cmd: 'sessions.create',
        session: 'flixpatrol-top10',
      });
    });

    it('throws FlareSolverrError when the service is unreachable', async () => {
      fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(client.createSession()).rejects.toThrow(FlareSolverrError);
    });

    it('throws FlareSolverrError when FlareSolverr answers with an error status', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ status: 'error', message: 'boom' }));

      await expect(client.createSession()).rejects.toThrow(/boom/);
    });
  });

  describe('get', () => {
    it('posts request.get carrying the session id and maxTimeout', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(okSession));
      fetchMock.mockResolvedValueOnce(jsonResponse(okSolution('<html>hi</html>')));
      await client.createSession();

      const html = await client.get('https://flixpatrol.com/top10/netflix/france');

      expect(html).toBe('<html>hi</html>');
      expect(payloadOf(fetchMock, 1)).toEqual({
        cmd: 'request.get',
        url: 'https://flixpatrol.com/top10/netflix/france',
        session: 'flixpatrol-top10',
        maxTimeout: 60000,
      });
    });

    it('reuses the same session across successive calls', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(okSession));
      fetchMock.mockResolvedValue(jsonResponse(okSolution('<html></html>')));
      await client.createSession();

      await client.get('https://flixpatrol.com/a');
      await client.get('https://flixpatrol.com/b');

      const createCalls = fetchMock.mock.calls.filter(
        (c) => JSON.parse(c[1].body as string).cmd === 'sessions.create',
      );
      expect(createCalls).toHaveLength(1);
      expect(payloadOf(fetchMock, 2).session).toBe('flixpatrol-top10');
    });

    it('forwards a custom maxTimeout from config', async () => {
      const custom = new FlareSolverrClient({ enabled: true, url: ENDPOINT, maxTimeout: 90000 });
      fetchMock.mockResolvedValueOnce(jsonResponse(okSession));
      fetchMock.mockResolvedValueOnce(jsonResponse(okSolution('<html></html>')));
      await custom.createSession();

      await custom.get('https://flixpatrol.com/a');

      expect(payloadOf(fetchMock, 1).maxTimeout).toBe(90000);
    });

    it('returns null and logs when the envelope status is not ok', async () => {
      const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => logger);
      fetchMock.mockResolvedValueOnce(jsonResponse(okSession));
      fetchMock.mockResolvedValueOnce(jsonResponse({ status: 'error', message: 'challenge failed' }));
      await client.createSession();

      const html = await client.get('https://flixpatrol.com/a');

      expect(html).toBeNull();
      expect(errorSpy.mock.calls.map((c) => String(c[0])).join('\n')).toContain('challenge failed');
    });

    it('returns null when the solution HTTP status is not 200', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(okSession));
      fetchMock.mockResolvedValueOnce(jsonResponse(okSolution('<html></html>', 403)));
      await client.createSession();

      await expect(client.get('https://flixpatrol.com/a')).resolves.toBeNull();
    });

    it('returns null on a network error', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(okSession));
      fetchMock.mockRejectedValueOnce(new Error('socket hang up'));
      await client.createSession();

      await expect(client.get('https://flixpatrol.com/a')).resolves.toBeNull();
    });
  });

  describe('destroySession', () => {
    it('posts sessions.destroy with the session id', async () => {
      fetchMock.mockResolvedValue(jsonResponse(okSession));
      await client.createSession();

      await client.destroySession();

      expect(payloadOf(fetchMock, 1)).toEqual({
        cmd: 'sessions.destroy',
        session: 'flixpatrol-top10',
      });
    });

    it('is a no-op when no session was created', async () => {
      await client.destroySession();

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('is idempotent — a second call issues no further request', async () => {
      fetchMock.mockResolvedValue(jsonResponse(okSession));
      await client.createSession();

      await client.destroySession();
      await client.destroySession();

      const destroyCalls = fetchMock.mock.calls.filter(
        (c) => JSON.parse(c[1].body as string).cmd === 'sessions.destroy',
      );
      expect(destroyCalls).toHaveLength(1);
    });

    it('warns but does not throw when destruction fails', async () => {
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => logger);
      fetchMock.mockResolvedValueOnce(jsonResponse(okSession));
      fetchMock.mockRejectedValueOnce(new Error('gone'));
      await client.createSession();

      await expect(client.destroySession()).resolves.toBeUndefined();
      expect(warnSpy).toHaveBeenCalled();
    });
  });

  it('rejects construction without a url', () => {
    expect(() => new FlareSolverrClient({ enabled: true, maxTimeout: 60000 }))
      .toThrow(FlareSolverrError);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/FlareSolverr/FlareSolverrClient.test.ts`
Expected: FAIL — cannot resolve `../../src/FlareSolverr/FlareSolverrClient`

- [ ] **Step 3: Add the error type**

Append to `src/Utils/Errors.ts`:

```typescript
/**
 * Error thrown when FlareSolverr session management fails
 */
export class FlareSolverrError extends AppError {
  constructor(message: string) {
    super(message);
    this.name = 'FlareSolverrError';
  }
}
```

- [ ] **Step 4: Implement the client**

Create `src/FlareSolverr/FlareSolverrClient.ts`:

```typescript
import { logger } from '../Utils/Logger';
import { FlareSolverrError } from '../Utils/Errors';
import type { FlareSolverrOptions } from '../types';

/**
 * Fixed, namespaced session id. FlareSolverr instances are commonly shared with
 * other tools (*arr stack), so an unqualified name like "default" could collide.
 */
const SESSION_NAME = 'flixpatrol-top10';

interface FlareSolverrSolution {
  url: string;
  status: number;
  response: string;
}

interface FlareSolverrEnvelope {
  status: string;
  message?: string;
  session?: string;
  solution?: FlareSolverrSolution;
}

/**
 * Minimal FlareSolverr v1 client.
 *
 * The three session commands are issued explicitly and in order:
 * `sessions.create` -> N x `request.get` -> `sessions.destroy`.
 *
 * This is deliberate. Per the FlareSolverr docs, a `request.get` sent WITHOUT a
 * session field "will create a temporary instance that will be destroyed
 * immediately after the request is completed" — so no cf_clearance cookie is
 * reused and every request re-solves the challenge (measured: 15.4s per request
 * versus 1.3-2.5s on a warm session). Dropping the session would still "work",
 * just ~10x slower, which is why the tests assert the session id is present in
 * every request.get payload.
 */
export class FlareSolverrClient {
  private readonly endpoint: string;

  private readonly maxTimeout: number;

  private sessionId: string | null = null;

  constructor(options: FlareSolverrOptions) {
    if (!options.url) {
      throw new FlareSolverrError('FlareSolverr url must be set when FlareSolverr is enabled');
    }
    this.endpoint = options.url;
    this.maxTimeout = options.maxTimeout;
  }

  private async command(payload: Record<string, unknown>): Promise<FlareSolverrEnvelope> {
    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return await res.json() as FlareSolverrEnvelope;
  }

  /**
   * Opens the browser session. Throws on failure: without a session there is no
   * point starting the run, and failing here surfaces a dead container before any
   * list is processed rather than midway through.
   */
  public async createSession(): Promise<void> {
    logger.debug(`Creating FlareSolverr session "${SESSION_NAME}" at ${this.endpoint}`);
    let envelope: FlareSolverrEnvelope;
    try {
      envelope = await this.command({ cmd: 'sessions.create', session: SESSION_NAME });
    } catch (err) {
      throw new FlareSolverrError(
        `sessions.create failed at ${this.endpoint}: ${(err as Error).message}`,
      );
    }
    if (envelope.status !== 'ok') {
      throw new FlareSolverrError(
        `sessions.create failed at ${this.endpoint}: ${envelope.message ?? envelope.status}`,
      );
    }
    this.sessionId = envelope.session ?? SESSION_NAME;
    logger.info(`FlareSolverr session ready (${this.sessionId})`);
  }

  /**
   * Fetches a URL through FlareSolverr. Returns null on any failure, matching the
   * contract of FlixPatrol.getFlixPatrolHTMLPage so callers gain no new case.
   */
  public async get(url: string): Promise<string | null> {
    try {
      const envelope = await this.command({
        cmd: 'request.get',
        url,
        session: this.sessionId ?? SESSION_NAME,
        maxTimeout: this.maxTimeout,
      });
      if (envelope.status !== 'ok') {
        logger.error(`FlareSolverr failed for ${url}: ${envelope.message ?? envelope.status}`);
        return null;
      }
      if (!envelope.solution || envelope.solution.status !== 200) {
        logger.error(`FlareSolverr returned HTTP ${envelope.solution?.status} for ${url}`);
        return null;
      }
      logger.debug(`FlareSolverr fetched ${url} (HTTP ${envelope.solution.status})`);
      return envelope.solution.response;
    } catch (err) {
      logger.error(`FlareSolverr request failed for ${url}: ${(err as Error).message}`);
      return null;
    }
  }

  /**
   * Closes the browser session. Never throws: it runs in a finally block after the
   * useful work is done, so a failure here must not turn a successful run into a
   * failed one. Leaking a session would keep a Chrome resident in the container,
   * which matters in daemon mode where runs repeat.
   */
  public async destroySession(): Promise<void> {
    if (this.sessionId === null) {
      return;
    }
    const id = this.sessionId;
    this.sessionId = null;
    try {
      const envelope = await this.command({ cmd: 'sessions.destroy', session: id });
      if (envelope.status !== 'ok') {
        logger.warn(`FlareSolverr sessions.destroy failed for ${id}: ${envelope.message ?? envelope.status}`);
        return;
      }
      logger.debug(`FlareSolverr session ${id} destroyed`);
    } catch (err) {
      logger.warn(`FlareSolverr sessions.destroy failed for ${id}: ${(err as Error).message}`);
    }
  }
}
```

Create `src/FlareSolverr/index.ts`:

```typescript
export * from './FlareSolverrClient';
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/FlareSolverr/FlareSolverrClient.test.ts`
Expected: PASS (16 tests)

- [ ] **Step 6: Verify types and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: both clean

- [ ] **Step 7: Commit**

```bash
git add src/Utils/Errors.ts src/FlareSolverr tests/FlareSolverr
git commit -m "feat(flaresolverr): add protocol client with explicit session lifecycle"
```

---

### Task 3: Route FlixPatrol fetches through the client

**Files:**
- Modify: `src/Flixpatrol/FlixPatrol.ts` (imports, class field, constructor around line 42, `getFlixPatrolHTMLPage` around line 79)
- Test: `tests/Flixpatrol/FlixPatrol.test.ts` (ADD tests only — do not touch the 60 existing ones)

**Interfaces:**
- Consumes: `FlareSolverrClient` from Task 2
- Produces: `new FlixPatrol(cacheOptions, options?, flareSolverr?)` — a third optional constructor parameter. Task 4 passes the client here.

- [ ] **Step 1: Write the failing tests**

Add a new `describe` block to `tests/Flixpatrol/FlixPatrol.test.ts`, after the existing `describe('getFlixPatrolHTMLPage', ...)` block. `mockFetch` and `mockHtmlResponse` already exist at the top of the file.

```typescript
  describe('getFlixPatrolHTMLPage with FlareSolverr', () => {
    // A minimal stand-in for FlareSolverrClient: only get() is reachable from
    // getFlixPatrolHTMLPage, and the session lifecycle is runPipeline's concern.
    const makeClient = (html: string | null) => ({
      createSession: vi.fn().mockResolvedValue(undefined),
      get: vi.fn().mockResolvedValue(html),
      destroySession: vi.fn().mockResolvedValue(undefined),
    });

    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('fetches through FlareSolverr and never touches impit', async () => {
      const client = makeClient('<html>via flaresolverr</html>');
      const flixpatrol = new FlixPatrol(
        { enabled: false, savePath: '', ttl: 0 },
        {},
        client as unknown as ConstructorParameters<typeof FlixPatrol>[2],
      );

      const result = await flixpatrol.getFlixPatrolHTMLPage('/top10/netflix/france');

      expect(result).toBe('<html>via flaresolverr</html>');
      expect(client.get).toHaveBeenCalledWith('https://flixpatrol.com/top10/netflix/france');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('propagates a null from FlareSolverr', async () => {
      const client = makeClient(null);
      const flixpatrol = new FlixPatrol(
        { enabled: false, savePath: '', ttl: 0 },
        {},
        client as unknown as ConstructorParameters<typeof FlixPatrol>[2],
      );

      await expect(flixpatrol.getFlixPatrolHTMLPage('/blocked')).resolves.toBeNull();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('honours a custom base url when routing through FlareSolverr', async () => {
      const client = makeClient('<html></html>');
      const flixpatrol = new FlixPatrol(
        { enabled: false, savePath: '', ttl: 0 },
        { url: 'https://custom.flixpatrol.com' },
        client as unknown as ConstructorParameters<typeof FlixPatrol>[2],
      );

      await flixpatrol.getFlixPatrolHTMLPage('/test');

      expect(client.get).toHaveBeenCalledWith('https://custom.flixpatrol.com/test');
    });

    it('uses impit when no client is supplied (optionality regression guard)', async () => {
      const flixpatrol = new FlixPatrol({ enabled: false, savePath: '', ttl: 0 });
      mockFetch.mockResolvedValue(mockHtmlResponse({ status: 200, data: '<html>via impit</html>' }));

      const result = await flixpatrol.getFlixPatrolHTMLPage('/test-path');

      expect(result).toBe('<html>via impit</html>');
      expect(mockFetch).toHaveBeenCalledWith('https://flixpatrol.com/test-path');
    });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/Flixpatrol/FlixPatrol.test.ts -t "with FlareSolverr"`
Expected: FAIL — the third constructor argument is ignored, so `impit` is called instead of `client.get`

- [ ] **Step 3: Wire the client into FlixPatrol**

In `src/Flixpatrol/FlixPatrol.ts`:

Add the import next to the existing `import { TraktAPI } from '../Trakt';`:

```typescript
import type { FlareSolverrClient } from '../FlareSolverr';
```

Add the private field after the existing `private readonly impit: Impit;` declaration:

```typescript
  private readonly flareSolverr?: FlareSolverrClient;
```

Change the constructor signature (currently `constructor(cacheOptions: CacheOptions, options: FlixPatrolOptions = {})`) to:

```typescript
  constructor(
    cacheOptions: CacheOptions,
    options: FlixPatrolOptions = {},
    flareSolverr?: FlareSolverrClient,
  ) {
```

and assign the field immediately after the existing `this.impit = new Impit({ browser: 'chrome', timeout: 30000 });` line:

```typescript
    this.flareSolverr = flareSolverr;
```

- [ ] **Step 4: Add the routing branch**

In `getFlixPatrolHTMLPage`, insert the branch between the `logger.silly(...)` line and the `for` retry loop:

```typescript
    // When FlareSolverr is configured, every request goes through it. We do not try
    // impit first: FlixPatrol currently answers 403 (cf-mitigated: challenge) to
    // any non-browser client, and making the bypass conditional on that exact
    // header would silently stop working if Cloudflare changed the signal.
    // No retry loop here — FlareSolverr retries internally, and wrapping a 12s
    // challenge solve in a 3x exponential backoff produces pathological runtimes.
    if (this.flareSolverr) {
      return this.flareSolverr.get(url);
    }
```

- [ ] **Step 5: Run the full FlixPatrol suite**

Run: `npx vitest run tests/Flixpatrol/FlixPatrol.test.ts`
Expected: PASS — 64 tests (60 pre-existing, unmodified, plus the 4 new ones). If any pre-existing test needed editing, STOP: optionality is broken.

- [ ] **Step 6: Verify types and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: both clean

- [ ] **Step 7: Commit**

```bash
git add src/Flixpatrol/FlixPatrol.ts tests/Flixpatrol/FlixPatrol.test.ts
git commit -m "feat(flixpatrol): route page fetches through FlareSolverr when configured"
```

---

### Task 4: Session lifecycle in the pipeline

**Files:**
- Modify: `src/Pipeline/runPipeline.ts` (imports, `RunPipelineDeps`, split `runPipeline` into a wrapper + `executeRun`, line 55)
- Modify: `src/app.ts` (`bootstrapConfigs`, around line 101)
- Test: `tests/Pipeline/runPipeline.test.ts`

**Interfaces:**
- Consumes: `FlareSolverrClient` (Task 2), `FlareSolverrOptions` and `getFlareSolverrOptions()` (Task 1), the third `FlixPatrol` constructor parameter (Task 3)
- Produces: `RunPipelineDeps.flareSolverrOptions?: FlareSolverrOptions` (optional, so existing callers and tests are unaffected)

- [ ] **Step 1: Write the failing tests**

Add to `tests/Pipeline/runPipeline.test.ts`. First extend the module mocks at the top of the file — add this alongside the existing `vi.mock('../../src/Flixpatrol', ...)` calls:

```typescript
const createSession = vi.fn().mockResolvedValue(undefined);
const destroySession = vi.fn().mockResolvedValue(undefined);
vi.mock('../../src/FlareSolverr', () => ({
  FlareSolverrClient: vi.fn().mockImplementation(function FlareSolverrClientMock() {
    return { createSession, destroySession, get: vi.fn() };
  }),
}));
```

Then append this `describe` block at the end of the file:

```typescript
describe('runPipeline FlareSolverr lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not create a session when the config is absent', async () => {
    await runPipeline(baseDeps());

    expect(createSession).not.toHaveBeenCalled();
    expect(destroySession).not.toHaveBeenCalled();
  });

  it('does not create a session when disabled', async () => {
    await runPipeline(baseDeps({
      flareSolverrOptions: { enabled: false, maxTimeout: 60000 },
    }));

    expect(createSession).not.toHaveBeenCalled();
  });

  it('creates and destroys the session when enabled', async () => {
    await runPipeline(baseDeps({
      flareSolverrOptions: { enabled: true, url: 'http://localhost:8191/v1', maxTimeout: 60000 },
    }));

    expect(createSession).toHaveBeenCalledOnce();
    expect(destroySession).toHaveBeenCalledOnce();
  });

  it('destroys the session even when the run throws', async () => {
    getTop10Sections.mockRejectedValueOnce(new Error('scrape exploded'));

    await expect(runPipeline(baseDeps({
      flareSolverrOptions: { enabled: true, url: 'http://localhost:8191/v1', maxTimeout: 60000 },
      flixPatrolTop10: [{
        platform: 'netflix', location: 'world', fallback: false,
        privacy: 'private', limit: 10, type: 'both',
      }],
    }))).rejects.toThrow('scrape exploded');

    expect(destroySession).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/Pipeline/runPipeline.test.ts -t "FlareSolverr lifecycle"`
Expected: FAIL — `createSession` is never called (the option is not read yet)

- [ ] **Step 3: Add the dependency field and imports**

In `src/Pipeline/runPipeline.ts`, add the client import after the existing `import { TraktAPI } from '../Trakt';`:

```typescript
import { FlareSolverrClient } from '../FlareSolverr';
```

Add `FlareSolverrOptions` to the existing `import type { ... } from '../types';` list, then add this optional field to the `RunPipelineDeps` interface (after `flixPatrolMostHours`):

```typescript
  flareSolverrOptions?: FlareSolverrOptions;
```

Keeping it optional is what allows `baseDeps()` in the existing tests, and any other caller, to compile untouched.

- [ ] **Step 4: Split runPipeline into a lifecycle wrapper**

Rename the existing exported function `runPipeline` to `executeRun`, remove its `export`, and give it a second parameter. Its signature line becomes:

```typescript
async function executeRun(deps: RunPipelineDeps, flareSolverr?: FlareSolverrClient): Promise<RunSummary> {
```

Its body is unchanged except for one line — the `FlixPatrol` construction at what is currently line 55:

```typescript
  const flixpatrol = new FlixPatrol(deps.cacheOptions, {}, flareSolverr);
```

Then add the new exported wrapper immediately above `executeRun`:

```typescript
/**
 * Owns the FlareSolverr session lifetime, which is exactly one run.
 *
 * createSession() runs before any list is processed so an unreachable container
 * fails the run immediately instead of midway through. destroySession() runs in a
 * finally — including on the early `return summary` abort paths — because a leaked
 * session keeps a Chrome resident in the container between runs in daemon mode.
 */
export async function runPipeline(deps: RunPipelineDeps): Promise<RunSummary> {
  const flareSolverr = deps.flareSolverrOptions?.enabled
    ? new FlareSolverrClient(deps.flareSolverrOptions)
    : undefined;

  if (flareSolverr) {
    await flareSolverr.createSession();
  }
  try {
    return await executeRun(deps, flareSolverr);
  } finally {
    if (flareSolverr) {
      await flareSolverr.destroySession();
    }
  }
}
```

This keeps the public API (`runPipeline`) and the whole existing body identical — no re-indentation of the ~150-line pipeline.

- [ ] **Step 5: Load the config in app.ts**

In `src/app.ts`, add one line to the `deps` object literal inside `bootstrapConfigs()`, after `flixPatrolMostHours`:

```typescript
      flareSolverrOptions: GetAndValidateConfigs.getFlareSolverrOptions(),
```

A `ConfigurationError` thrown here is already handled by the surrounding `try`/`catch` that calls `dispatchErrorAndExit(err)`.

- [ ] **Step 6: Run the full suite**

Run: `npx vitest run`
Expected: PASS — every test file, including the untouched `FlixPatrol.test.ts`

- [ ] **Step 7: Verify types and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: both clean

- [ ] **Step 8: Commit**

```bash
git add src/Pipeline/runPipeline.ts src/app.ts tests/Pipeline/runPipeline.test.ts
git commit -m "feat(pipeline): manage FlareSolverr session lifetime per run"
```

---

### Task 5: Default configuration

**Files:**
- Modify: `src/Utils/Utils.ts` (the `defaultConfig` literal, after the `Schedule` block around line 150)
- Modify: `config/default.json` (after the `Schedule` block)
- Test: `tests/Utils/Utils.test.ts`

**Interfaces:**
- Consumes: the config shape from Task 1
- Produces: nothing consumed by later tasks

- [ ] **Step 1: Write the failing test**

Add to `tests/Utils/Utils.test.ts`, inside the existing `describe('ensureConfigExist', ...)` block (line 141). The `fs` mock, the `mockExit` spy and the `'process.exit called'` throw message are already set up at the top of that file — this test reuses them exactly as the neighbouring test at line 152 does.

```typescript
    it('should include a disabled FlareSolverr block in the generated config', () => {
      vi.mocked(fs.existsSync)
        .mockReturnValueOnce(false) // config/default.json does not exist
        .mockReturnValueOnce(true); // config directory already exists

      expect(() => Utils.ensureConfigExist()).toThrow('process.exit called');

      const written = vi.mocked(fs.writeFileSync).mock.calls[0][1] as string;
      const parsed = JSON.parse(written) as { FlareSolverr: Record<string, unknown> };
      expect(parsed.FlareSolverr).toEqual({
        enabled: false,
        url: 'http://localhost:8191/v1',
        maxTimeout: 60000,
      });
      expect(mockExit).toHaveBeenCalledWith(0);
    });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/Utils/Utils.test.ts -t "FlareSolverr"`
Expected: FAIL — `parsed.FlareSolverr` is `undefined`

- [ ] **Step 3: Add the block to the generator**

In `src/Utils/Utils.ts`, add to the `defaultConfig` object literal, after the `Schedule` entry:

```typescript
        FlareSolverr: {
          enabled: false,
          url: 'http://localhost:8191/v1',
          maxTimeout: 60000,
        },
```

- [ ] **Step 4: Add the same block to the tracked reference config**

In `config/default.json`, add after the `"Schedule"` block (mind the trailing comma on the preceding block):

```json
  "FlareSolverr": {
    "enabled": false,
    "url": "http://localhost:8191/v1",
    "maxTimeout": 60000
  }
```

This is safe for existing installations precisely because `enabled` is `false`: pulling the change yields an inert block, and `runPipeline` never constructs the client.

- [ ] **Step 5: Verify the JSON is valid and the app still starts clean**

Run: `node -e "JSON.parse(require('fs').readFileSync('config/default.json','utf8')); console.log('valid json')"`
Expected: `valid json`

Run: `npx vitest run tests/Utils/Utils.test.ts`
Expected: PASS

- [ ] **Step 6: Verify types and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: both clean

- [ ] **Step 7: Commit**

```bash
git add src/Utils/Utils.ts config/default.json tests/Utils/Utils.test.ts
git commit -m "feat(config): ship a disabled FlareSolverr block in default configuration"
```

---

### Task 6: Documentation

**Files:**
- Modify: `README.md` (new `<details>` block after the `Schedule` one at line 283, before `Example configuration` at line 296; plus a Troubleshooting row around line 529)
- Modify: `CLAUDE.md` (the `src/Flixpatrol/FlixPatrol.ts` bullet under Core Components, and the module structure tree)

**Interfaces:**
- Consumes: the final config shape from Tasks 1 and 5
- Produces: nothing

- [ ] **Step 1: Add the README configuration block**

Insert after the closing `</details>` of the `Schedule` block, following the exact table style of its neighbours:

````markdown
<details>
<summary><strong>FlareSolverr</strong> — Cloudflare challenge bypass (optional)</summary>

FlixPatrol is behind a Cloudflare managed challenge that returns HTTP 403 to
non-browser clients. [FlareSolverr](https://github.com/FlareSolverr/FlareSolverr)
solves that challenge and proxies the request.

This block is **entirely optional**. If it is absent, or `enabled` is `false`, the
tool behaves exactly as before and never contacts FlareSolverr.

| Name       | Description                                    | Mandatory        | Values                    | Default |
|------------|------------------------------------------------|------------------|---------------------------|---------|
| enabled    | Route FlixPatrol requests through FlareSolverr  | No               | true, false               | false   |
| url        | FlareSolverr v1 API endpoint                    | If enabled       | Any valid URL             |         |
| maxTimeout | Challenge solving timeout in milliseconds       | No               | Number                    | 60000   |

When enabled, a browser session is created once at the start of each run and
destroyed at the end. The first request solves the challenge (around 12s); later
requests reuse the session and take 1-3s each.

Run FlareSolverr alongside the tool:

```yaml
# docker-compose.yml
services:
  flaresolverr:
    image: ghcr.io/flaresolverr/flaresolverr:latest
    container_name: flaresolverr
    # Published on loopback only: FlareSolverr has no authentication and must not
    # be reachable from the network.
    ports:
      - "127.0.0.1:8191:8191"
    environment:
      - LOG_LEVEL=info
    restart: unless-stopped
```

If the tool itself runs in Docker on the same Compose network, use the service name
instead of localhost: `"url": "http://flaresolverr:8191/v1"`.

</details>
````

- [ ] **Step 2: Update the README example configuration**

Open the `Example configuration` `<details>` block (line 296 before your insertion) and add the same `FlareSolverr` JSON object from Task 5, Step 4, so the example stays consistent with the shipped `config/default.json`.

- [ ] **Step 3: Add a Troubleshooting row**

Add to the Troubleshooting table (around line 529):

```markdown
| "Unable to get FlixPatrol ... page" with `HTTP 403 (cf-mitigated: challenge)` | Cloudflare is challenging the request. Enable the optional `FlareSolverr` block (see Configuration File). |
```

- [ ] **Step 4: Correct CLAUDE.md**

Under **Core Components**, the `src/Flixpatrol/FlixPatrol.ts` bullet currently reads "Uses axios for HTTP requests with custom User-Agent". That has been wrong since PR #479. Replace that line with:

```markdown
- Uses `impit` (Chrome impersonation) for direct HTTP requests, or an optional FlareSolverr client when configured
```

Then add the new module to the Module Structure tree, after the `Flixpatrol/` entry:

```
├── FlareSolverr/
│   ├── index.ts                # Exports FlareSolverrClient
│   └── FlareSolverrClient.ts   # FlareSolverr v1 protocol client (sessions + request.get)
```

Add a `FlareSolverr` entry to the Configuration Structure block mirroring the config shape, and note in the app.ts flow description that `runPipeline` creates/destroys the FlareSolverr session around the run.

- [ ] **Step 5: Verify the docs render and nothing else broke**

Run: `npx vitest run && npx tsc --noEmit && npm run lint`
Expected: all clean

- [ ] **Step 6: Commit**

```bash
git add README.md CLAUDE.md
git commit -m "docs: document optional FlareSolverr support"
```

---

### Task 7: Real end-to-end verification

This is the only step that proves the feature actually works. Unit tests all mock the network.

**Files:**
- Modify: `config/local.json` (local only — it is gitignored, never commit it)

**Interfaces:**
- Consumes: everything above

- [ ] **Step 1: Ensure FlareSolverr is running**

Run: `curl -s http://localhost:8191/`
Expected: `{"msg": "FlareSolverr is ready!", ...}`

If not running: `docker run -d --name flaresolverr-test -p 127.0.0.1:8191:8191 -e LOG_LEVEL=info ghcr.io/flaresolverr/flaresolverr:latest`

- [ ] **Step 2: Confirm the failure still reproduces without FlareSolverr**

With no `FlareSolverr` block in `config/local.json`:

Run: `npm run build && LOG_LEVEL=debug LIST_NAME_PREFIX="[TEST]" node build/app.js 2>&1 | head -20`
Expected: `HTTP 403 (cf-mitigated: challenge)` then `FlixPatrolError: Unable to get FlixPatrol top10 page`

This confirms the baseline and that the block being absent changes nothing.

- [ ] **Step 3: Enable FlareSolverr in the local config**

Add to `config/local.json`:

```json
  "FlareSolverr": {
    "enabled": true,
    "url": "http://localhost:8191/v1",
    "maxTimeout": 60000
  }
```

- [ ] **Step 4: Run for real and verify the lists fill**

Run: `LOG_LEVEL=debug LIST_NAME_PREFIX="[TEST]" node build/app.js 2>&1 | tail -40`

Expected, in order:
- `FlareSolverr session ready (flixpatrol-top10)`
- `FlareSolverr fetched https://flixpatrol.com/top10/netflix/france (HTTP 200)`
- no `403` and no `cf-mitigated`
- `List [TEST]netflix-france-top10-with-world-fallback updated with N new movies`, N > 0
- a `FlareSolverr session flixpatrol-top10 destroyed` line at the end

- [ ] **Step 5: Verify no session leaked**

Run: `curl -s -X POST http://localhost:8191/v1 -H "Content-Type: application/json" -d '{"cmd":"sessions.list"}'`
Expected: `{"sessions": [], ...}` — an empty list proves the `finally` ran.

- [ ] **Step 6: Verify the failure mode**

Run: `docker stop flaresolverr-test && LOG_LEVEL=debug node build/app.js 2>&1 | tail -5`
Expected: a `sessions.create failed at http://localhost:8191/v1: ...` message and a non-zero exit — the run fails fast, before processing any list.

Then restart it: `docker start flaresolverr-test`

- [ ] **Step 7: Report the results**

Report actual observed output — session creation timing, per-request timings, the item counts pushed to Trakt, and the sessions.list result. Do not claim success without this output. If any expectation above did not hold, stop and report rather than adjusting the test to pass.

---

## Post-implementation

- Remove the throwaway container when done: `docker rm -f flaresolverr-test`
- Revert `config/local.json` if you do not want FlareSolverr enabled in your day-to-day local runs
- Open the PR against `develop` using `.github/PULL_REQUEST_TEMPLATE.md`, labelled `enhancement`
- Do NOT commit `docs/`
