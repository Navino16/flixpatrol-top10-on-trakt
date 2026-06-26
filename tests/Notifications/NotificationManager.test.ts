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
    // Drain pending microtasks reliably
    for (let i = 0; i < 10; i++) await Promise.resolve();
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
