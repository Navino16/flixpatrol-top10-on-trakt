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
