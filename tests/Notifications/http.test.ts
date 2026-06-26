import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { postJsonWithTimeout } from '../../src/Notifications/http';
import { logger } from '../../src/Utils/Logger';

describe('postJsonWithTimeout', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => logger);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    warnSpy.mockRestore();
  });

  it('sends a POST with JSON content type and stringified body', async () => {
    await postJsonWithTimeout('https://example.com/x', { hello: 'world' }, 'TestAdapter');
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://example.com/x');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json' });
    expect(JSON.parse(init.body as string)).toEqual({ hello: 'world' });
  });

  it('merges extra headers when provided', async () => {
    await postJsonWithTimeout('https://example.com/x', {}, 'TestAdapter', {
      headers: { 'X-Custom': 'yes' },
    });
    const init = fetchMock.mock.calls[0][1];
    expect(init.headers).toMatchObject({
      'Content-Type': 'application/json',
      'X-Custom': 'yes',
    });
  });

  it('resolves silently on non-2xx response', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 500 }));
    await expect(postJsonWithTimeout('https://example.com/x', {}, 'TestAdapter'))
      .resolves.toBeUndefined();
  });

  it('resolves silently when fetch throws (network error)', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await expect(postJsonWithTimeout('https://example.com/x', {}, 'TestAdapter'))
      .resolves.toBeUndefined();
  });

  it('logs the adapter label + host + status on non-2xx, but NEVER the secret path or query', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }));
    const secretUrl = 'https://discord.com/api/webhooks/12345/super-secret-token';
    await postJsonWithTimeout(secretUrl, {}, 'WebhookAdapter');
    expect(warnSpy).toHaveBeenCalledOnce();
    const message = warnSpy.mock.calls[0][0] as string;
    expect(message).toContain('WebhookAdapter');
    expect(message).toContain('401');
    expect(message).toContain('discord.com');
    expect(message).not.toContain('super-secret-token');
    expect(message).not.toContain('12345');
    expect(message).not.toContain('/api/webhooks/');
  });

  it('logs the adapter label + host + error on fetch throw, but NEVER the secret path', async () => {
    fetchMock.mockRejectedValueOnce(new Error('boom'));
    const secretUrl = 'http://apprise:8000/notify/private-routing-key';
    await postJsonWithTimeout(secretUrl, {}, 'AppriseAdapter');
    expect(warnSpy).toHaveBeenCalledOnce();
    const message = warnSpy.mock.calls[0][0] as string;
    expect(message).toContain('AppriseAdapter');
    expect(message).toContain('boom');
    expect(message).toContain('apprise:8000');
    expect(message).not.toContain('private-routing-key');
    expect(message).not.toContain('/notify/');
  });

  it('falls back to "?" when the URL is malformed', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 500 }));
    await postJsonWithTimeout('not-a-url', {}, 'TestAdapter');
    const message = warnSpy.mock.calls[0][0] as string;
    expect(message).toContain('TestAdapter[?]');
  });

  it('aborts the request after the default 5 second timeout', async () => {
    vi.useFakeTimers();
    let capturedSignal: AbortSignal | undefined;
    fetchMock.mockImplementation((_url: string, init: RequestInit) => {
      capturedSignal = init.signal as AbortSignal;
      return new Promise<Response>((_resolve, reject) => {
        capturedSignal?.addEventListener('abort', () => reject(new Error('AbortError')));
      });
    });
    const promise = postJsonWithTimeout('https://example.com/x', {}, 'TestAdapter');
    await vi.advanceTimersByTimeAsync(5001);
    await expect(promise).resolves.toBeUndefined();
    expect(capturedSignal?.aborted).toBe(true);
  });

  it('honours a custom timeoutMs', async () => {
    vi.useFakeTimers();
    let capturedSignal: AbortSignal | undefined;
    fetchMock.mockImplementation((_url: string, init: RequestInit) => {
      capturedSignal = init.signal as AbortSignal;
      return new Promise<Response>((_resolve, reject) => {
        capturedSignal?.addEventListener('abort', () => reject(new Error('AbortError')));
      });
    });
    const promise = postJsonWithTimeout('https://example.com/x', {}, 'TestAdapter', {
      timeoutMs: 1000,
    });
    await vi.advanceTimersByTimeAsync(1001);
    await expect(promise).resolves.toBeUndefined();
  });
});
