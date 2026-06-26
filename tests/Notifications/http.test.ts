import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { redactUrl, postJsonWithTimeout } from '../../src/Notifications/http';

describe('redactUrl', () => {
  it('redacts the Discord webhook token segment', () => {
    expect(redactUrl('https://discord.com/api/webhooks/1234567890/secrettoken123'))
      .toBe('https://discord.com/api/webhooks/1234567890/<redacted>');
  });

  it('redacts the Discord webhook token on discordapp.com too', () => {
    expect(redactUrl('https://discordapp.com/api/webhooks/abc/xyz'))
      .toBe('https://discordapp.com/api/webhooks/abc/<redacted>');
  });

  it('redacts the Apprise routing key', () => {
    expect(redactUrl('http://apprise:8000/notify/flixpatrol-key'))
      .toBe('http://apprise:8000/notify/<redacted>');
  });

  it('does not modify a generic webhook URL', () => {
    expect(redactUrl('https://example.com/hook')).toBe('https://example.com/hook');
  });

  it('does not modify a Gotify-style URL without sensitive path', () => {
    expect(redactUrl('https://gotify.example.com/message')).toBe('https://gotify.example.com/message');
  });

  it('returns the input unchanged when the URL is malformed', () => {
    expect(redactUrl('not a url')).toBe('not a url');
  });
});

describe('postJsonWithTimeout', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
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
