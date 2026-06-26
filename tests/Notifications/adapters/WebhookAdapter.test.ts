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
