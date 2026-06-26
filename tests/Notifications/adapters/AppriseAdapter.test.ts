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
