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
