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
