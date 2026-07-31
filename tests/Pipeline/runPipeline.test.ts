import { describe, it, expect, vi, beforeEach } from 'vitest';

const pushToList = vi.fn().mockResolvedValue(undefined);
const connect = vi.fn().mockResolvedValue(undefined);
const getTop10Sections = vi.fn();

vi.mock('../../src/Trakt', () => ({
  TraktAPI: vi.fn().mockImplementation(function TraktAPIMock() { return { connect, pushToList }; }),
}));
vi.mock('../../src/Flixpatrol', () => ({
  FlixPatrol: vi.fn().mockImplementation(function FlixPatrolMock() { return { getTop10Sections }; }),
}));
const createSession = vi.fn().mockResolvedValue(undefined);
const destroySession = vi.fn().mockResolvedValue(undefined);
vi.mock('../../src/FlareSolverr', () => ({
  FlareSolverrClient: vi.fn().mockImplementation(function FlareSolverrClientMock() {
    return { createSession, destroySession, get: vi.fn() };
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

function baseDeps(overrides: Partial<RunPipelineDeps> = {}): RunPipelineDeps {
  return {
    cacheOptions: { enabled: false, savePath: '/tmp', ttl: 1 },
    traktOptions: { saveFile: '/tmp/t', clientId: 'id', clientSecret: 'secret' },
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

describe('runPipeline abort checkpoint', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('stops before the next Trakt write when the signal is already aborted', async () => {
    getTop10Sections.mockResolvedValue({
      movies: [1, 2], shows: [3, 4], rawCounts: { movies: 2, shows: 2 },
    });
    const controller = new AbortController();
    controller.abort();
    const deps = baseDeps({
      flixPatrolTop10: [{
        platform: 'netflix', location: 'world', fallback: false,
        privacy: 'private', limit: 10, type: 'both',
      }] as never,
      signal: controller.signal,
    });
    await runPipeline(deps);
    expect(pushToList).not.toHaveBeenCalled();
    expect(deps.dispatch).toHaveBeenCalledWith('error', expect.objectContaining({
      title: expect.stringContaining('run interrupted'),
    }));
  });

  it('performs writes when the signal is not aborted', async () => {
    getTop10Sections.mockResolvedValue({
      movies: [1, 2], shows: [], rawCounts: { movies: 2, shows: 0 },
    });
    const deps = baseDeps({
      flixPatrolTop10: [{
        platform: 'netflix', location: 'world', fallback: false,
        privacy: 'private', limit: 10, type: 'both',
      }] as never,
    });
    await runPipeline(deps);
    expect(pushToList).toHaveBeenCalledTimes(1);
    expect(deps.dispatch).not.toHaveBeenCalledWith('error', expect.objectContaining({
      title: expect.stringContaining('run interrupted'),
    }));
  });
});

describe('runPipeline FlareSolverr lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

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
      flixPatrolTop10: [{
        platform: 'netflix', location: 'world', fallback: false,
        privacy: 'private', limit: 10, type: 'both',
      }],
    }))).rejects.toThrow('scrape exploded');

    expect(destroySession).toHaveBeenCalledOnce();
  });
});
