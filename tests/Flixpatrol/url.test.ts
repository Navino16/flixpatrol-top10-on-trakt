import { describe, it, expect } from 'vitest';
import { buildMostWatchedPath } from '../../src/Flixpatrol/url';
import type { FlixPatrolMostWatched } from '../../src/types';

const base: FlixPatrolMostWatched = {
  enabled: true,
  privacy: 'private',
  limit: 50,
  type: 'both',
  year: 2025,
};

describe('buildMostWatchedPath', () => {
  // Each expectation below was verified as a non-empty HTTP 200 against the live site.
  // See spec §2.
  it.for([
    { name: 'movies, nothing else', cfg: {}, type: 'Movies' as const, expected: '/hours/netflix/2025/world/movies/' },
    {
      name: 'shows always grouped',
      cfg: {},
      type: 'TV Shows' as const,
      expected: '/hours/netflix/2025/world/tv-shows-grouped/',
    },
    {
      name: 'premiere suffixes the type',
      cfg: { premiere: 2025 },
      type: 'Movies' as const,
      expected: '/hours/netflix/2025/world/movies-2025/',
    },
    {
      name: 'country suffixes the type',
      cfg: { country: 'france' as const },
      type: 'Movies' as const,
      expected: '/hours/netflix/2025/world/movies-from-france/',
    },
    {
      name: 'genre prefixes the type',
      cfg: { genre: 'comedy' as const },
      type: 'Movies' as const,
      expected: '/hours/netflix/2025/world/comedy-movies/',
    },
    {
      name: 'genre then country',
      cfg: { genre: 'comedy' as const, country: 'france' as const },
      type: 'Movies' as const,
      expected: '/hours/netflix/2025/world/comedy-movies-from-france/',
    },
    {
      name: 'genre then country then premiere',
      cfg: { genre: 'comedy' as const, country: 'france' as const, premiere: 2025 },
      type: 'Movies' as const,
      expected: '/hours/netflix/2025/world/comedy-movies-from-france-2025/',
    },
    {
      name: 'every dimension at once, shows',
      cfg: { genre: 'crime' as const, country: 'south-korea' as const, premiere: 2025 },
      type: 'TV Shows' as const,
      expected: '/hours/netflix/2025/world/crime-tv-shows-from-south-korea-2025-grouped/',
    },
    {
      name: 'shows-only genre',
      cfg: { genre: 'game-show' as const, type: 'shows' as const },
      type: 'TV Shows' as const,
      expected: '/hours/netflix/2025/world/game-show-tv-shows-grouped/',
    },
    {
      name: 'another year',
      cfg: { year: 2024 },
      type: 'Movies' as const,
      expected: '/hours/netflix/2024/world/movies/',
    },
  ])('$name', ({ cfg, type, expected }) => {
    expect(buildMostWatchedPath({ ...base, ...cfg }, type)).toBe(expected);
  });

  it('ignores `original`, which is a parsing predicate and not a URL segment', () => {
    expect(buildMostWatchedPath({ ...base, original: true }, 'Movies'))
      .toBe('/hours/netflix/2025/world/movies/');
  });

  it('never appends -grouped to a movies path', () => {
    expect(buildMostWatchedPath({ ...base, genre: 'superhero' }, 'Movies'))
      .toBe('/hours/netflix/2025/world/superhero-movies/');
  });

  it('always opens and closes with a slash', () => {
    const path = buildMostWatchedPath(base, 'TV Shows');
    expect(path.startsWith('/')).toBe(true);
    expect(path.endsWith('/')).toBe(true);
  });
});
