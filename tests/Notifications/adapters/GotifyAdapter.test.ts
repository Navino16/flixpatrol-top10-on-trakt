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

  it('POSTs to {url}/message with token in X-Gotify-Key header', async () => {
    const adapter = new GotifyAdapter(dest);
    await adapter.notify('run_start', { title: 't', body: 'b', timestamp: '2026-06-26T10:00:00.000Z' });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://gotify.example.com/message');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      'Content-Type': 'application/json',
      'X-Gotify-Key': 'AbCd',
    });
  });

  it('does not include the token in the URL or query string', async () => {
    const adapter = new GotifyAdapter(dest);
    await adapter.notify('run_start', { title: 't', body: 'b', timestamp: '2026-06-26T10:00:00.000Z' });
    const [url] = fetchMock.mock.calls[0];
    expect(url).not.toContain('AbCd');
    expect(url).not.toContain('token=');
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
    expect(fetchMock.mock.calls[0][0]).toBe('https://gotify.example.com/message');
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
