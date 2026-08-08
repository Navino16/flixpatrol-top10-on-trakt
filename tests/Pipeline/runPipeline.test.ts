import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MediaItem } from '../../src/Targets';

// vi.hoisted is required here: vi.mock factories are hoisted above the module
// imports, so plain top-level consts would still be in their TDZ when a factory runs.
const h = vi.hoisted(() => {
  const pushToListFn = vi.fn();
  const connectFn = vi.fn();
  const resolveManyFn = vi.fn();
  const targetMock = {
    backend: 'trakt' as string,
    requiresInteractiveAuth: true,
    isAuthenticated: vi.fn().mockReturnValue(true),
    connect: connectFn,
    resolveMany: resolveManyFn,
    pushToList: pushToListFn,
  };
  return {
    pushToList: pushToListFn,
    connect: connectFn,
    resolveMany: resolveManyFn,
    getTop10Sections: vi.fn(),
    createSession: vi.fn(),
    destroySession: vi.fn(),
    target: targetMock,
  };
});

const {
  pushToList, connect, resolveMany, getTop10Sections, createSession, destroySession, target,
} = h;

vi.mock('../../src/Flixpatrol', () => ({
  FlixPatrol: vi.fn().mockImplementation(function FlixPatrolMock() {
    return { getTop10Sections: h.getTop10Sections };
  }),
}));
vi.mock('../../src/FlareSolverr', () => ({
  FlareSolverrClient: vi.fn().mockImplementation(function FlareSolverrClientMock() {
    return { createSession: h.createSession, destroySession: h.destroySession, get: vi.fn() };
  }),
}));
vi.mock('../../src/Utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/Utils')>();
  return {
    ...actual,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), silly: vi.fn(), level: 'info' },
  };
});

import { runPipeline } from '../../src/Pipeline/runPipeline';
import type { RunPipelineDeps } from '../../src/Pipeline/runPipeline';
import { logger } from '../../src/Utils';

const warnSpy = logger.warn as unknown as ReturnType<typeof vi.fn>;
const sillySpy = logger.silly as unknown as ReturnType<typeof vi.fn>;

const top10Config = [{
  platform: 'netflix', location: 'world', fallback: false,
  privacy: 'private', limit: 10, type: 'both',
}] as unknown as RunPipelineDeps['flixPatrolTop10'];

function baseDeps(overrides: Partial<RunPipelineDeps> = {}): RunPipelineDeps {
  return {
    cacheOptions: { enabled: false, savePath: '/tmp', ttl: 1 },
    target: target as unknown as RunPipelineDeps['target'],
    flixPatrolTop10: [],
    flixPatrolPopulars: [],
    flixPatrolMostWatched: [],
    flixPatrolMostHours: [],
    dispatch: vi.fn().mockResolvedValue(undefined),
    dryRun: false,
    listNamePrefix: '',
    appName: 'flixpatrol-top10',
    appVersion: 'test',
    ...overrides,
  };
}

// Default: every scraped item resolves, so tests that do not care about
// resolution losses keep a 1:1 mapping between scraped items and pushed ids.
function resolveAll(): void {
  resolveMany.mockImplementation(
    (items: MediaItem[]) => Promise.resolve(items.map((_, i) => `id-${i}`)),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  target.backend = 'trakt';
  resolveAll();
  pushToList.mockResolvedValue(undefined);
  connect.mockResolvedValue(undefined);
});

describe('runPipeline abort checkpoint', () => {
  it('stops before the next list write when the signal is already aborted', async () => {
    getTop10Sections.mockResolvedValue({
      movies: [{ title: 'A', year: 2000 }, { title: 'B', year: 2001 }],
      shows: [{ title: 'C', year: 2002 }, { title: 'D', year: 2003 }],
      rawCounts: { movies: 2, shows: 2 },
    });
    const controller = new AbortController();
    controller.abort();
    const deps = baseDeps({ flixPatrolTop10: top10Config, signal: controller.signal });
    await runPipeline(deps);
    expect(pushToList).not.toHaveBeenCalled();
    expect(deps.dispatch).toHaveBeenCalledWith('error', expect.objectContaining({
      title: expect.stringContaining('run interrupted'),
    }));
  });

  it('performs writes when the signal is not aborted', async () => {
    getTop10Sections.mockResolvedValue({
      movies: [{ title: 'A', year: 2000 }, { title: 'B', year: 2001 }],
      shows: [],
      rawCounts: { movies: 2, shows: 0 },
    });
    const deps = baseDeps({ flixPatrolTop10: top10Config });
    await runPipeline(deps);
    expect(pushToList).toHaveBeenCalledTimes(1);
    expect(deps.dispatch).not.toHaveBeenCalledWith('error', expect.objectContaining({
      title: expect.stringContaining('run interrupted'),
    }));
  });
});

describe('runPipeline target wiring', () => {
  beforeEach(() => {
    getTop10Sections.mockResolvedValue({
      movies: [{ title: 'Inception', year: 2010 }, { title: 'Fight Club', year: 1999 }],
      shows: [],
      rawCounts: { movies: 2, shows: 0 },
    });
  });

  it('connects the injected target instead of building its own', async () => {
    await runPipeline(baseDeps({ flixPatrolTop10: top10Config }));
    expect(connect).toHaveBeenCalledOnce();
    expect(pushToList).toHaveBeenCalledOnce();
  });

  it('resolves scraped items through the target before pushing them', async () => {
    resolveMany.mockResolvedValueOnce(['1', '2']);
    await runPipeline(baseDeps({ flixPatrolTop10: top10Config }));
    expect(resolveMany).toHaveBeenCalledWith(
      [{ title: 'Inception', year: 2010 }, { title: 'Fight Club', year: 1999 }],
      'movie',
    );
    expect(pushToList).toHaveBeenCalledWith(['1', '2'], expect.any(String), 'movie', expect.any(String));
  });

  it('warns with the backend name when some items could not be matched', async () => {
    target.backend = 'floppy';
    resolveMany.mockResolvedValueOnce(['1']); // 2 scraped, 1 resolved
    await runPipeline(baseDeps({ flixPatrolTop10: top10Config }));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('floppy'));
  });

  it('counts resolved items, not scraped ones, in the summary', async () => {
    resolveMany.mockResolvedValueOnce(['1']);
    const summary = await runPipeline(baseDeps({ flixPatrolTop10: top10Config }));
    expect(summary.moviesAdded).toBe(1);
  });

  it('does not warn about resolution when every scraped item resolves', async () => {
    await runPipeline(baseDeps({ flixPatrolTop10: top10Config }));
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('reports scraping losses separately from resolution losses', async () => {
    getTop10Sections.mockResolvedValue({
      movies: [{ title: 'Inception', year: 2010 }, { title: 'Fight Club', year: 1999 }],
      shows: [],
      rawCounts: { movies: 4, shows: 0 },
    });
    resolveMany.mockResolvedValueOnce(['1']);
    await runPipeline(baseDeps({ flixPatrolTop10: top10Config }));
    const messages = warnSpy.mock.calls.map((c) => String(c[0]));
    expect(messages).toHaveLength(2);
    expect(messages.some((m) => m.includes('4 found') && m.includes('2 kept'))).toBe(true);
    expect(messages.some((m) => m.includes('trakt') && m.includes('1 matched'))).toBe(true);
  });

  // Regression guard: pushToList REPLACES a list's content, so writing an empty
  // array on a total resolution failure (backend outage, expired key) would wipe
  // a list the user has accumulated. Guard on the RESOLVED count, never the
  // scraped one — restoring an `items.length > 0` guard here must fail this test.
  it('leaves the list untouched when the scrape yielded items but none resolved', async () => {
    target.backend = 'mdblist';
    resolveMany.mockResolvedValueOnce([]);
    const summary = await runPipeline(baseDeps({ flixPatrolTop10: top10Config }));
    expect(pushToList).not.toHaveBeenCalled();
    expect(summary.moviesAdded).toBe(0);
    const messages = warnSpy.mock.calls.map((c) => String(c[0]));
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('mdblist');
    expect(messages[0]).toContain('left unchanged');
  });

  it('still processes the rest of the run after a total resolution failure', async () => {
    getTop10Sections.mockResolvedValue({
      movies: [{ title: 'Inception', year: 2010 }],
      shows: [{ title: 'Dark', year: 2017 }],
      rawCounts: { movies: 1, shows: 1 },
    });
    resolveMany.mockResolvedValueOnce([]); // movies fail
    const summary = await runPipeline(baseDeps({ flixPatrolTop10: top10Config }));
    expect(pushToList).toHaveBeenCalledOnce();
    expect(pushToList).toHaveBeenCalledWith(['id-0'], expect.any(String), 'show', expect.any(String));
    expect(summary.moviesAdded).toBe(0);
    expect(summary.showsAdded).toBe(1);
    expect(summary.listsProcessed).toBe(1);
  });

  // A genuinely empty scrape is NOT a resolution failure: the Top10 block skips it
  // entirely, so neither a write nor the "left unchanged" warning happens.
  it('does not warn about resolution when the scrape itself returned nothing', async () => {
    getTop10Sections.mockResolvedValue({
      movies: [], shows: [], rawCounts: { movies: 0, shows: 0 },
    });
    await runPipeline(baseDeps({ flixPatrolTop10: top10Config }));
    expect(resolveMany).not.toHaveBeenCalled();
    expect(pushToList).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('never logs target credentials, only the backend type', async () => {
    await runPipeline(baseDeps({ flixPatrolTop10: top10Config }));
    const sillyOutput = sillySpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(sillyOutput).toContain('trakt');
    for (const secretish of ['secret', 'clientSecret', 'apiKey', 'token', 'saveFile', 'http']) {
      expect(sillyOutput).not.toContain(secretish);
    }
  });
});

describe('runPipeline FlareSolverr lifecycle', () => {
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
      flixPatrolTop10: top10Config,
    }))).rejects.toThrow('scrape exploded');

    expect(destroySession).toHaveBeenCalledOnce();
  });
});
