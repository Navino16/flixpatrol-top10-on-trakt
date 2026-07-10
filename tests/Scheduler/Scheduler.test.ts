import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node-cron', () => ({
  default: {
    schedule: vi.fn(() => ({ stop: vi.fn() })),
    validate: vi.fn(() => true),
  },
}));

vi.mock('../../src/Utils', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import cron from 'node-cron';
import { logger } from '../../src/Utils';
import { Scheduler } from '../../src/Scheduler/Scheduler';

// A promise we can resolve/reject on demand to control run timing.
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe('Scheduler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('schedules one cron task per expression', () => {
    const scheduler = new Scheduler({
      crons: ['0 6 * * *', '0 18 * * *'],
      runOnStart: false,
      runner: vi.fn().mockResolvedValue(undefined),
      onError: vi.fn().mockResolvedValue(undefined),
    });
    scheduler.start();
    expect(vi.mocked(cron.schedule)).toHaveBeenCalledTimes(2);
  });

  it('does not run on start when runOnStart is false', () => {
    const runner = vi.fn().mockResolvedValue(undefined);
    new Scheduler({ crons: ['* * * * *'], runOnStart: false, runner, onError: vi.fn() }).start();
    expect(runner).not.toHaveBeenCalled();
  });

  it('runs immediately on start when runOnStart is true', async () => {
    const runner = vi.fn().mockResolvedValue(undefined);
    new Scheduler({ crons: ['* * * * *'], runOnStart: true, runner, onError: vi.fn() }).start();
    await Promise.resolve();
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it('skips a trigger while a run is already in progress', async () => {
    const d = deferred<void>();
    const runner = vi.fn().mockReturnValue(d.promise);
    const scheduler = new Scheduler({
      crons: ['* * * * *'], runOnStart: false, runner, onError: vi.fn(),
    });
    scheduler.start();
    const tick = vi.mocked(cron.schedule).mock.calls[0][1] as () => void;
    tick(); // first run starts, isRunning = true
    tick(); // should be skipped
    await Promise.resolve();
    expect(runner).toHaveBeenCalledTimes(1);
    expect(vi.mocked(logger.warn)).toHaveBeenCalled();
    d.resolve();
  });

  it('survives a runner rejection and routes it to onError', async () => {
    const onError = vi.fn().mockResolvedValue(undefined);
    const runner = vi.fn().mockRejectedValue(new Error('boom'));
    const scheduler = new Scheduler({
      crons: ['* * * * *'], runOnStart: true, runner, onError,
    });
    scheduler.start();
    await new Promise((r) => setTimeout(r, 0));
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    // A later trigger runs again (daemon stayed alive).
    const tick = vi.mocked(cron.schedule).mock.calls[0][1] as () => void;
    tick();
    await new Promise((r) => setTimeout(r, 0));
    expect(runner).toHaveBeenCalledTimes(2);
  });

  it('stop() aborts the signal, stops tasks and awaits the in-flight run', async () => {
    const d = deferred<void>();
    let received: AbortSignal | undefined;
    let runSettled = false;
    const runner = vi.fn((signal: AbortSignal) => {
      received = signal;
      return d.promise.then(() => { runSettled = true; });
    });
    const task = { stop: vi.fn() };
    vi.mocked(cron.schedule).mockReturnValue(task as never);
    const scheduler = new Scheduler({
      crons: ['* * * * *'], runOnStart: true, runner, onError: vi.fn(),
    });
    scheduler.start();
    await Promise.resolve();
    const stopPromise = scheduler.stop();
    expect(received?.aborted).toBe(true);
    expect(task.stop).toHaveBeenCalled();

    // stop() must stay pending until the in-flight run settles.
    let stopSettled = false;
    void stopPromise.then(() => { stopSettled = true; });
    await new Promise((r) => setTimeout(r, 0));
    expect(stopSettled).toBe(false);
    expect(runSettled).toBe(false);

    d.resolve();
    await stopPromise;
    expect(runSettled).toBe(true);
    expect(stopSettled).toBe(true);
  });
});
