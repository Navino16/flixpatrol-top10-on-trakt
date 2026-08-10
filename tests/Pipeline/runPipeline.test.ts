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
    getPopular: vi.fn(),
    getMostWatched: vi.fn(),
    getMostHours: vi.fn(),
    createSession: vi.fn(),
    destroySession: vi.fn(),
    target: targetMock,
  };
});

const {
  pushToList, connect, resolveMany, getTop10Sections, getPopular, getMostWatched, getMostHours,
  createSession, destroySession, target,
} = h;

vi.mock('../../src/Flixpatrol', () => ({
  FlixPatrol: vi.fn().mockImplementation(function FlixPatrolMock() {
    return {
      getTop10Sections: h.getTop10Sections,
      getPopular: h.getPopular,
      getMostWatched: h.getMostWatched,
      getMostHours: h.getMostHours,
    };
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

const infoSpy = logger.info as unknown as ReturnType<typeof vi.fn>;
const warnSpy = logger.warn as unknown as ReturnType<typeof vi.fn>;
const sillySpy = logger.silly as unknown as ReturnType<typeof vi.fn>;
const debugSpy = logger.debug as unknown as ReturnType<typeof vi.fn>;

/** List name passed to pushToList on the nth write (0-indexed). */
function listNameOfWrite(index: number): string {
  return String(pushToList.mock.calls[index][1]);
}

/** ListContent passed to pushToList on the nth write (0-indexed). */
function contentOfWrite(index: number): Record<string, string[]> {
  return pushToList.mock.calls[index][0] as Record<string, string[]>;
}

/** Media kinds actually written on the nth write; an absent key means "left untouched". */
function kindsOfWrite(index: number): string[] {
  return Object.keys(contentOfWrite(index));
}

/** Privacy passed to pushToList on the nth write (0-indexed). */
function privacyOfWrite(index: number): string {
  return String(pushToList.mock.calls[index][2]);
}

/** Info lines with the list name and the counter blanked, so shapes can be compared. */
function infoShapes(): string[] {
  return infoSpy.mock.calls
    .map((c) => String(c[0]))
    .map((m) => m.replace(/"[^"]*"/g, '"<list>"').replace(/^\[\d+\/\d+\]/, '[n/total]'));
}

/** Payload of the most recent `event` notification. */
function lastPayload(
  dispatch: RunPipelineDeps['dispatch'],
  event: string,
): { title: string; body: string } {
  const calls = (dispatch as unknown as ReturnType<typeof vi.fn>).mock.calls
    .filter((c) => c[0] === event);
  const payload = calls[calls.length - 1][1] as { title: string; body: string };
  return payload;
}

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

// Every scraped item resolves, keeping a 1:1 mapping between scraped items and
// pushed ids for the tests that do not care about resolution losses.
function resolveAll(): void {
  resolveMany.mockImplementation(
    (items: MediaItem[]) => Promise.resolve(items.map((_, i) => `id-${i}`)),
  );
}

const oneItem: MediaItem[] = [{ title: 'Inception', year: 2010 }];

function popularConfig(
  overrides: Record<string, unknown> = {},
): RunPipelineDeps['flixPatrolPopulars'] {
  return [{
    platform: 'wikipedia', privacy: 'private', limit: 10, type: 'both', ...overrides,
  }] as unknown as RunPipelineDeps['flixPatrolPopulars'];
}

function mostWatchedConfig(
  overrides: Record<string, unknown> = {},
): RunPipelineDeps['flixPatrolMostWatched'] {
  return [{
    enabled: true, privacy: 'private', limit: 10, type: 'both', year: 2024, ...overrides,
  }] as unknown as RunPipelineDeps['flixPatrolMostWatched'];
}

function mostHoursConfig(
  overrides: Record<string, unknown> = {},
): RunPipelineDeps['flixPatrolMostHours'] {
  return [{
    enabled: true, privacy: 'private', limit: 10, type: 'both', period: 'total', language: 'all', ...overrides,
  }] as unknown as RunPipelineDeps['flixPatrolMostHours'];
}

beforeEach(() => {
  vi.clearAllMocks();
  target.backend = 'trakt';
  resolveAll();
  pushToList.mockResolvedValue(undefined);
  connect.mockResolvedValue(undefined);
  getPopular.mockResolvedValue(oneItem);
  getMostWatched.mockResolvedValue(oneItem);
  getMostHours.mockResolvedValue(oneItem);
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
    expect(pushToList).toHaveBeenCalledWith({ movie: ['1', '2'] }, expect.any(String), expect.any(String));
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

  // pushToList REPLACES a list's content, so writing an empty array on a total
  // resolution failure would wipe a list the user has accumulated. The guard is on
  // the RESOLVED count, never the scraped one.
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
    // The movie key is ABSENT, not empty: `movie: []` would wipe the movies the
    // backend simply failed to match.
    expect(pushToList).toHaveBeenCalledOnce();
    expect(pushToList).toHaveBeenCalledWith({ show: ['id-0'] }, expect.any(String), expect.any(String));
    expect(kindsOfWrite(0)).toEqual(['show']);
    expect(summary.moviesAdded).toBe(0);
    expect(summary.showsAdded).toBe(1);
    expect(summary.listsProcessed).toBe(1);
  });

  // A genuinely empty scrape is NOT a resolution failure: the Top10 block skips it
  // entirely, so neither a write nor a warning happens.
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

describe('runPipeline Popular section', () => {
  it('scrapes and writes movies only when type is "movies"', async () => {
    const deps = baseDeps({ flixPatrolPopulars: popularConfig({ type: 'movies' }) });
    const summary = await runPipeline(deps);

    expect(getPopular).toHaveBeenCalledOnce();
    expect(getPopular).toHaveBeenCalledWith('Movies', expect.objectContaining({ platform: 'wikipedia' }));
    expect(pushToList).toHaveBeenCalledOnce();
    expect(kindsOfWrite(0)).toEqual(['movie']);
    expect(summary.moviesAdded).toBe(1);
    expect(summary.showsAdded).toBe(0);
  });

  it('scrapes and writes shows only when type is "shows"', async () => {
    const deps = baseDeps({ flixPatrolPopulars: popularConfig({ type: 'shows' }) });
    const summary = await runPipeline(deps);

    expect(getPopular).toHaveBeenCalledOnce();
    expect(getPopular).toHaveBeenCalledWith('TV Shows', expect.objectContaining({ platform: 'wikipedia' }));
    expect(kindsOfWrite(0)).toEqual(['show']);
    expect(summary.moviesAdded).toBe(0);
    expect(summary.showsAdded).toBe(1);
  });

  it('writes both media kinds of a list in a single push', async () => {
    const deps = baseDeps({ flixPatrolPopulars: popularConfig() });
    const summary = await runPipeline(deps);

    expect(pushToList).toHaveBeenCalledOnce();
    expect(contentOfWrite(0)).toEqual({ movie: ['id-0'], show: ['id-0'] });
    expect(summary.listsProcessed).toBe(1);
    expect(summary.moviesAdded).toBe(1);
    expect(summary.showsAdded).toBe(1);
  });

  it('still writes once per list, never merging two lists into one call', async () => {
    const deps = baseDeps({
      flixPatrolPopulars: [
        ...popularConfig({ name: 'first' }),
        ...popularConfig({ name: 'second' }),
      ],
    });
    await runPipeline(deps);

    expect(pushToList).toHaveBeenCalledTimes(2);
    expect(listNameOfWrite(0)).toBe('first');
    expect(listNameOfWrite(1)).toBe('second');
  });

  it('omits the failing kind from the fused write and still writes the other', async () => {
    resolveMany
      .mockResolvedValueOnce(['m-1']) // movies resolve
      .mockResolvedValueOnce([]); // shows resolve to nothing
    const summary = await runPipeline(baseDeps({ flixPatrolPopulars: popularConfig() }));

    expect(pushToList).toHaveBeenCalledOnce();
    expect(contentOfWrite(0)).toEqual({ movie: ['m-1'] });
    expect('show' in contentOfWrite(0)).toBe(false);
    expect(summary.showsAdded).toBe(0);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('left unchanged'));
  });

  // An empty scrape is not a failure: the key is present and empty, which asks the
  // backend to clear that kind.
  it('sends an empty array for a kind the scrape returned empty', async () => {
    getPopular.mockResolvedValueOnce([]).mockResolvedValueOnce(oneItem);
    await runPipeline(baseDeps({ flixPatrolPopulars: popularConfig() }));

    expect(pushToList).toHaveBeenCalledOnce();
    expect(contentOfWrite(0)).toEqual({ movie: [], show: ['id-0'] });
  });

  it('derives the default list name from the platform and applies the prefix', async () => {
    await runPipeline(baseDeps({
      flixPatrolPopulars: popularConfig({ type: 'movies' }),
      listNamePrefix: '[TEST]',
    }));

    expect(listNameOfWrite(0)).toBe('[TEST]wikipedia-popular');
  });

  it('honours a custom list name over the derived one', async () => {
    await runPipeline(baseDeps({
      flixPatrolPopulars: popularConfig({ type: 'movies', name: 'My Popular List' }),
    }));

    expect(listNameOfWrite(0)).toBe('my-popular-list');
  });

  it('forwards the configured privacy to the write', async () => {
    await runPipeline(baseDeps({
      flixPatrolPopulars: popularConfig({ type: 'movies', privacy: 'public' }),
    }));

    expect(privacyOfWrite(0)).toBe('public');
  });
});

describe('runPipeline MostWatched section', () => {
  it('skips a disabled entry entirely', async () => {
    const deps = baseDeps({ flixPatrolMostWatched: mostWatchedConfig({ enabled: false }) });
    const summary = await runPipeline(deps);

    expect(getMostWatched).not.toHaveBeenCalled();
    expect(pushToList).not.toHaveBeenCalled();
    expect(summary.listsProcessed).toBe(0);
    expect(lastPayload(deps.dispatch, 'run_start').body).toContain('0 lists');
  });

  it('scrapes movies only when type is "movies"', async () => {
    const summary = await runPipeline(baseDeps({
      flixPatrolMostWatched: mostWatchedConfig({ type: 'movies' }),
    }));

    expect(getMostWatched).toHaveBeenCalledOnce();
    expect(getMostWatched).toHaveBeenCalledWith('Movies', expect.objectContaining({ year: 2024 }));
    expect(summary.moviesAdded).toBe(1);
    expect(summary.showsAdded).toBe(0);
  });

  it('scrapes shows only when type is "shows"', async () => {
    const summary = await runPipeline(baseDeps({
      flixPatrolMostWatched: mostWatchedConfig({ type: 'shows' }),
    }));

    expect(getMostWatched).toHaveBeenCalledOnce();
    expect(getMostWatched).toHaveBeenCalledWith('TV Shows', expect.anything());
    expect(summary.showsAdded).toBe(1);
  });

  it('names the list from the year alone when no optional filter is set', async () => {
    await runPipeline(baseDeps({
      flixPatrolMostWatched: mostWatchedConfig({ type: 'movies' }),
    }));

    expect(listNameOfWrite(0)).toBe('most-watched-2024-netflix');
  });

  it('appends original, premiere and country to the default name, in that order', async () => {
    await runPipeline(baseDeps({
      flixPatrolMostWatched: mostWatchedConfig({
        type: 'movies', original: true, premiere: 2020, country: 'france',
      }),
    }));

    expect(listNameOfWrite(0)).toBe('most-watched-2024-netflix-original-2020-premiere-from-france');
  });

  // `original: false` is still a *set* filter: the scraper receives it, so the
  // list name must stay distinct from the unfiltered one.
  it('marks the name as original even when the flag is explicitly false', async () => {
    await runPipeline(baseDeps({
      flixPatrolMostWatched: mostWatchedConfig({ type: 'movies', original: false }),
    }));

    expect(listNameOfWrite(0)).toBe('most-watched-2024-netflix-original');
  });
});

describe('runPipeline MostHours section', () => {
  it('skips a disabled entry entirely', async () => {
    const summary = await runPipeline(baseDeps({
      flixPatrolMostHours: mostHoursConfig({ enabled: false }),
    }));

    expect(getMostHours).not.toHaveBeenCalled();
    expect(summary.listsProcessed).toBe(0);
  });

  it('scrapes movies only when type is "movies"', async () => {
    const summary = await runPipeline(baseDeps({
      flixPatrolMostHours: mostHoursConfig({ type: 'movies' }),
    }));

    expect(getMostHours).toHaveBeenCalledOnce();
    expect(getMostHours).toHaveBeenCalledWith('Movies', expect.objectContaining({ period: 'total' }));
    expect(summary.moviesAdded).toBe(1);
  });

  it('scrapes shows only when type is "shows"', async () => {
    const summary = await runPipeline(baseDeps({
      flixPatrolMostHours: mostHoursConfig({ type: 'shows' }),
    }));

    expect(getMostHours).toHaveBeenCalledOnce();
    expect(getMostHours).toHaveBeenCalledWith('TV Shows', expect.anything());
    expect(summary.showsAdded).toBe(1);
  });

  it('omits the language suffix when the language is "all"', async () => {
    await runPipeline(baseDeps({
      flixPatrolMostHours: mostHoursConfig({ type: 'movies', period: 'first-month' }),
    }));

    expect(listNameOfWrite(0)).toBe('netflix-most-hours-first-month');
  });

  it('appends the language suffix when it narrows the list', async () => {
    await runPipeline(baseDeps({
      flixPatrolMostHours: mostHoursConfig({ type: 'movies', period: 'first-week', language: 'non-english' }),
    }));

    expect(listNameOfWrite(0)).toBe('netflix-most-hours-first-week-non-english');
  });
});

describe('runPipeline run accounting', () => {
  it('announces only the enabled lists in the run_start total', async () => {
    const deps = baseDeps({
      flixPatrolTop10: top10Config,
      flixPatrolPopulars: popularConfig({ type: 'movies' }),
      flixPatrolMostWatched: [
        ...mostWatchedConfig({ type: 'movies' }),
        ...mostWatchedConfig({ type: 'movies', enabled: false }),
      ],
      flixPatrolMostHours: mostHoursConfig({ type: 'movies', enabled: false }),
    });
    getTop10Sections.mockResolvedValue({
      movies: oneItem, shows: [], rawCounts: { movies: 1, shows: 0 },
    });

    const summary = await runPipeline(deps);

    // 1 Top10 + 1 Popular + 1 enabled MostWatched; the two disabled entries do not count.
    expect(lastPayload(deps.dispatch, 'run_start').body).toContain('3 lists');
    expect(summary.listsProcessed).toBe(3);
  });

  it('runs every section in order and totals their writes', async () => {
    getTop10Sections.mockResolvedValue({
      movies: oneItem, shows: [], rawCounts: { movies: 1, shows: 0 },
    });
    const deps = baseDeps({
      flixPatrolTop10: top10Config,
      flixPatrolPopulars: popularConfig({ type: 'shows' }),
      flixPatrolMostWatched: mostWatchedConfig({ type: 'movies' }),
      flixPatrolMostHours: mostHoursConfig({ type: 'shows' }),
    });

    const summary = await runPipeline(deps);

    expect(summary.listsProcessed).toBe(4);
    expect(summary.moviesAdded).toBe(2);
    expect(summary.showsAdded).toBe(2);
    expect(lastPayload(deps.dispatch, 'run_end').body).toContain('4/4 lists');
  });

  it('reports items without a known year by title alone', async () => {
    getPopular.mockResolvedValue([{ title: 'Untitled', year: null }, { title: 'Dark', year: 2017 }]);
    await runPipeline(baseDeps({ flixPatrolPopulars: popularConfig({ type: 'movies' }) }));

    const messages = debugSpy.mock.calls.map((c) => String(c[0]));
    const itemLine = messages.find((m) => m.includes('Untitled'));
    expect(itemLine).toBeDefined();
    expect(itemLine).toContain('Untitled, Dark (2017)');
  });
});

describe('runPipeline log narrative', () => {
  beforeEach(() => {
    getTop10Sections.mockResolvedValue({
      movies: oneItem, shows: oneItem, rawCounts: { movies: 1, shows: 1 },
    });
  });

  it('separates the resolution phase from the single write of a list', async () => {
    await runPipeline(baseDeps({ flixPatrolTop10: top10Config }));

    expect(infoShapes()).toEqual([
      '[n/total] Processing "<list>"',
      'Scraping FlixPatrol movies and shows for "<list>"',
      'Resolved 1/1 movie for "<list>" on trakt',
      'Resolved 1/1 show for "<list>" on trakt',
      'Updated "<list>" with 1 movie and 1 show',
    ]);
  });

  it('logs the same shape whichever section a list comes from', async () => {
    await runPipeline(baseDeps({
      flixPatrolTop10: top10Config,
      flixPatrolPopulars: popularConfig(),
      flixPatrolMostWatched: mostWatchedConfig(),
      flixPatrolMostHours: mostHoursConfig(),
    }));

    const shapes = infoShapes();
    expect(shapes).toHaveLength(20);
    const firstList = shapes.slice(0, 5);
    expect(shapes.slice(5, 10)).toEqual(firstList);
    expect(shapes.slice(10, 15)).toEqual(firstList);
    expect(shapes.slice(15, 20)).toEqual(firstList);
  });

  it('does not claim a list was updated on a dry run', async () => {
    await runPipeline(baseDeps({ flixPatrolTop10: top10Config, dryRun: true }));

    const messages = infoSpy.mock.calls.map((c) => String(c[0]));
    expect(messages.some((m) => m.startsWith('Would update "'))).toBe(true);
    expect(messages.some((m) => m.startsWith('Updated "'))).toBe(false);
  });
});

describe('runPipeline dry-run reporting', () => {
  it('tags both notifications and reports additions as hypothetical', async () => {
    const deps = baseDeps({
      flixPatrolPopulars: popularConfig({ type: 'movies' }),
      dryRun: true,
    });

    await runPipeline(deps);

    expect(lastPayload(deps.dispatch, 'run_start').title).toContain('[DRY-RUN]');
    const end = lastPayload(deps.dispatch, 'run_end');
    expect(end.title).toContain('[DRY-RUN]');
    expect(end.body).toContain('would be added');
    expect(end.body).not.toContain('1 movies / 0 shows added');
  });

  it('reports additions as effective when the run is not a dry run', async () => {
    const deps = baseDeps({ flixPatrolPopulars: popularConfig({ type: 'movies' }) });

    await runPipeline(deps);

    expect(lastPayload(deps.dispatch, 'run_start').title).not.toContain('[DRY-RUN]');
    const end = lastPayload(deps.dispatch, 'run_end');
    expect(end.body).toContain('1 movies / 0 shows added');
    expect(end.body).not.toContain('would be added');
  });

  it('tags the interruption notification too', async () => {
    const controller = new AbortController();
    controller.abort();
    const deps = baseDeps({
      flixPatrolPopulars: popularConfig({ type: 'movies' }),
      dryRun: true,
      signal: controller.signal,
    });

    await runPipeline(deps);

    expect(lastPayload(deps.dispatch, 'error').title).toContain('[DRY-RUN]');
  });
});

describe('runPipeline abort between lists', () => {
  it('completes the in-flight list write, then stops before the next list', async () => {
    const controller = new AbortController();
    // Abort as soon as the first LIST write lands: the checkpoint sits between two
    // lists, so the first list is written whole and the second not at all.
    pushToList.mockImplementationOnce(() => {
      controller.abort();
      return Promise.resolve();
    });
    const deps = baseDeps({
      flixPatrolPopulars: [
        ...popularConfig({ type: 'both', name: 'first' }),
        ...popularConfig({ type: 'both', name: 'second' }),
      ],
      signal: controller.signal,
    });

    const summary = await runPipeline(deps);

    expect(pushToList).toHaveBeenCalledOnce();
    expect(listNameOfWrite(0)).toBe('first');
    expect(contentOfWrite(0)).toEqual({ movie: ['id-0'], show: ['id-0'] });
    expect(summary.moviesAdded).toBe(1);
    expect(summary.showsAdded).toBe(1);
    expect(summary.listsProcessed).toBe(1);
  });

  it('does not dispatch run_end when the run was interrupted', async () => {
    const controller = new AbortController();
    controller.abort();
    const deps = baseDeps({
      flixPatrolMostWatched: mostWatchedConfig({ type: 'movies' }),
      signal: controller.signal,
    });

    await runPipeline(deps);

    const events = (deps.dispatch as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(events).toContain('error');
    expect(events).not.toContain('run_end');
  });

  it('stops the MostHours section on an aborted signal', async () => {
    const controller = new AbortController();
    controller.abort();
    const deps = baseDeps({
      flixPatrolMostHours: mostHoursConfig({ type: 'shows' }),
      signal: controller.signal,
    });

    const summary = await runPipeline(deps);

    expect(getMostHours).toHaveBeenCalledOnce();
    expect(pushToList).not.toHaveBeenCalled();
    expect(summary.showsAdded).toBe(0);
  });
});
