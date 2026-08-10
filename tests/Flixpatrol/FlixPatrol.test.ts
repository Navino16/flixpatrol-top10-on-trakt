import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FlixPatrol } from '../../src/Flixpatrol/FlixPatrol';
import { logger } from '../../src/Utils/Logger';
import type { FlixPatrolTop10, FlixPatrolPopular, FlixPatrolMostWatched, FlixPatrolMostHours } from '../../src/types';

// Mock impit: single shared `mockFetch` is returned from every `new Impit(...)`,
// mirroring the previous `vi.mock('axios')` behavior where all instances shared one mock.
const mockFetch = vi.fn();
vi.mock('impit', () => ({
  // Use a regular `function` (not an arrow) so it can be invoked with `new`.
  Impit: vi.fn(function MockImpit(this: { fetch: typeof mockFetch }) {
    this.fetch = mockFetch;
  }),
}));

// Helper to build an impit-style response from the legacy { status, data } shape used by the tests.
const mockHtmlResponse = (input: { status: number; data: unknown; headers?: Record<string, string> }) => ({
  status: input.status,
  headers: new Headers(input.headers ?? {}),
  text: async () => (input.data as string) ?? '',
});

// Mock file-system-cache with a real in-memory store, one per Cache() call, so the
// detail-cache behaviour is observable instead of being stubbed to a permanent miss.
vi.mock('file-system-cache', () => ({
  default: () => {
    const store = new Map<string, unknown>();
    return {
      get: async (key: string, fallback: unknown = null) => (store.has(key) ? store.get(key) : fallback),
      set: async (key: string, value: unknown) => { store.set(key, value); },
    };
  },
  FileSystemCache: class MockFileSystemCache {},
}));

// Shared fixtures for the fallback-semantics tests. `detailPage` mirrors the real
// markup: div.info-grid > div.info-grid-header holding the h1 and, among the metadata
// blocks, a `title="Premiere"` block whose date is formatted MM/DD/YYYY.
const detailPage = (title: string, year: number) => `
  <html>
    <body>
      <div class="info-grid">
        <div class="info-grid-header">
          <div class="md:flex items-baseline justify-between">
            <h1 class="mb-4 text-h1">${title}</h1>
          </div>
          <div class="flex flex-wrap">
            <div class="flex gap-x-1" title="3894"><div>Movie</div><div>|</div></div>
            <div class="flex gap-x-1" title="Premiere"><div><span>06/18/${year}</span></div>|</div>
          </div>
        </div>
      </div>
    </body>
  </html>
`;

// A detail page whose header carries a title but no premiere block at all.
const NO_YEAR_DETAIL_HTML = '<div class="info-grid"><div class="info-grid-header">'
  + '<h1 class="mb-4 text-h1">Movie Without Year</h1></div></div>';

// The site-wide marketing blurb that lives in `div.mb-6` on every detail page. It ends
// in a hardcoded "2021", which a text-scanning year fallback would happily pick up and
// stamp onto every single title. Fixtures below embed it to keep that regression fenced.
const MARKETING_BLURB_HTML = '<div class="mb-6">FlixPatrol tracks the most popular '
  + 'TV shows in 2021 across all streaming platforms.</div>';

// Regional (h3) top10 markup listing two movies.
const TOP10_REGIONAL_HTML = `
  <html>
    <body>
      <div>
        <div><h3>TOP 10 Movies</h3></div>
        <div>
          <a class="hover:underline" href="/title/inception">Inception</a>
          <a class="hover:underline" href="/title/fight-club">Fight Club</a>
        </div>
      </div>
    </body>
  </html>
`;

// World (h2/span) top10 markup listing the same two movies.
const TOP10_WORLD_HTML = `
  <html>
    <body>
      <div>
        <div><h2><span>TOP Movies</span></h2></div>
        <div>
          <a class="hover:underline" href="/title/inception">Inception</a>
          <a class="hover:underline" href="/title/fight-club">Fight Club</a>
        </div>
      </div>
    </body>
  </html>
`;

// A valid regional top10 page whose movies section is empty.
const EMPTY_TOP10_HTML = `
  <html>
    <body>
      <div>
        <div><h3>TOP 10 Movies</h3></div>
        <div></div>
      </div>
    </body>
  </html>
`;

const POPULAR_LIST_HTML = `
  <html>
    <body>
      <table class="card-table">
        <tr><td><a class="flex gap-2 group items-center" href="/title/inception">Inception</a></td></tr>
        <tr><td><a class="flex gap-2 group items-center" href="/title/fight-club">Fight Club</a></td></tr>
      </table>
    </body>
  </html>
`;

const DETAIL_PAGES: Record<string, string> = {
  '/title/inception': detailPage('Inception', 2010),
  '/title/fight-club': detailPage('Fight Club', 1999),
};

/**
 * Route every fetch by URL instead of by call order: the tests below assert on how
 * many pages are downloaded, which a `mockResolvedValueOnce` chain cannot express.
 */
const routeFetch = (listHtml: string | ((path: string) => string), detailHtml?: string) => {
  mockFetch.mockImplementation(async (url: string) => {
    const path = url.replace('https://flixpatrol.com', '');
    if (path.startsWith('/title/')) {
      // Detail fixtures are keyed on the bare slug: the scraper canonicalises every
      // href to `/title/<slug>/` before fetching, so the trailing slash is stripped
      // here rather than duplicating every key.
      const key = path.replace(/\/$/, '');
      return mockHtmlResponse({ status: 200, data: detailHtml ?? DETAIL_PAGES[key] ?? '' });
    }
    return mockHtmlResponse({
      status: 200,
      data: typeof listHtml === 'function' ? listHtml(path) : listHtml,
    });
  });
};

describe('FlixPatrol', () => {
  describe('Type guards', () => {
    describe('isFlixPatrolTop10Location', () => {
      it('should return true for valid locations', () => {
        expect(FlixPatrol.isFlixPatrolTop10Location('world')).toBe(true);
        expect(FlixPatrol.isFlixPatrolTop10Location('france')).toBe(true);
        expect(FlixPatrol.isFlixPatrolTop10Location('united-states')).toBe(true);
        expect(FlixPatrol.isFlixPatrolTop10Location('japan')).toBe(true);
      });

      it('should return false for invalid locations', () => {
        expect(FlixPatrol.isFlixPatrolTop10Location('invalid')).toBe(false);
        expect(FlixPatrol.isFlixPatrolTop10Location('')).toBe(false);
        expect(FlixPatrol.isFlixPatrolTop10Location('WORLD')).toBe(false);
        expect(FlixPatrol.isFlixPatrolTop10Location('usa')).toBe(false);
      });
    });

    describe('isFlixPatrolTop10Platform', () => {
      it('should return true for valid platforms', () => {
        expect(FlixPatrol.isFlixPatrolTop10Platform('netflix')).toBe(true);
        expect(FlixPatrol.isFlixPatrolTop10Platform('disney')).toBe(true);
        expect(FlixPatrol.isFlixPatrolTop10Platform('amazon-prime')).toBe(true);
        expect(FlixPatrol.isFlixPatrolTop10Platform('hbo-max')).toBe(true);
      });

      it('should return false for invalid platforms', () => {
        expect(FlixPatrol.isFlixPatrolTop10Platform('invalid')).toBe(false);
        expect(FlixPatrol.isFlixPatrolTop10Platform('')).toBe(false);
        expect(FlixPatrol.isFlixPatrolTop10Platform('NETFLIX')).toBe(false);
        expect(FlixPatrol.isFlixPatrolTop10Platform('prime')).toBe(false);
      });
    });

    describe('isFlixPatrolPopularPlatform', () => {
      it('should return true for valid popular platforms', () => {
        expect(FlixPatrol.isFlixPatrolPopularPlatform('wikipedia')).toBe(true);
        expect(FlixPatrol.isFlixPatrolPopularPlatform('youtube')).toBe(true);
      });

      it('should return false for invalid popular platforms', () => {
        expect(FlixPatrol.isFlixPatrolPopularPlatform('netflix')).toBe(false);
        expect(FlixPatrol.isFlixPatrolPopularPlatform('')).toBe(false);
        expect(FlixPatrol.isFlixPatrolPopularPlatform('IMDB')).toBe(false);
      });
    });

    describe('isFlixPatrolType', () => {
      it('should return true for valid types', () => {
        expect(FlixPatrol.isFlixPatrolType('movies')).toBe(true);
        expect(FlixPatrol.isFlixPatrolType('shows')).toBe(true);
        expect(FlixPatrol.isFlixPatrolType('both')).toBe(true);
      });

      it('should return false for invalid types', () => {
        expect(FlixPatrol.isFlixPatrolType('movie')).toBe(false);
        expect(FlixPatrol.isFlixPatrolType('show')).toBe(false);
        expect(FlixPatrol.isFlixPatrolType('')).toBe(false);
        expect(FlixPatrol.isFlixPatrolType('MOVIES')).toBe(false);
      });
    });
  });

  describe('Constructor', () => {
    it('should create FlixPatrol instance with cache disabled', () => {
      const flixpatrol = new FlixPatrol({ enabled: false, savePath: '', ttl: 0 });
      expect(flixpatrol).toBeInstanceOf(FlixPatrol);
    });

    it('should create FlixPatrol instance with custom options', () => {
      const flixpatrol = new FlixPatrol(
        { enabled: false, savePath: '', ttl: 0 },
        { url: 'https://custom.url' }
      );
      expect(flixpatrol).toBeInstanceOf(FlixPatrol);
    });
  });

  describe('getFlixPatrolHTMLPage', () => {
    let flixpatrol: FlixPatrol;

    beforeEach(() => {
      flixpatrol = new FlixPatrol({ enabled: false, savePath: '', ttl: 0 });
      vi.clearAllMocks();
    });

    afterEach(() => {
      vi.resetAllMocks();
    });

    it('should return HTML content on successful request', async () => {
      const mockHtml = '<html><body>Test content</body></html>';
      mockFetch.mockResolvedValue(mockHtmlResponse({
        status: 200,
        data: mockHtml,
      }));

      const result = await flixpatrol.getFlixPatrolHTMLPage('/test-path');

      expect(result).toBe(mockHtml);
      expect(mockFetch).toHaveBeenCalledWith('https://flixpatrol.com/test-path');
    });

    it('should return null on non-200 status', async () => {
      mockFetch.mockResolvedValue(mockHtmlResponse({
        status: 404,
        data: 'Not found',
      }));

      const result = await flixpatrol.getFlixPatrolHTMLPage('/not-found');

      expect(result).toBeNull();
    });

    it('should return null on network error', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      const result = await flixpatrol.getFlixPatrolHTMLPage('/error-path');

      expect(result).toBeNull();
    });

    it('should log the HTTP status at debug level', async () => {
      const debugSpy = vi.spyOn(logger, 'debug').mockImplementation(() => logger);
      mockFetch.mockResolvedValue(mockHtmlResponse({ status: 200, data: '<html></html>' }));

      await flixpatrol.getFlixPatrolHTMLPage('/test-path');

      expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining('200'));
      debugSpy.mockRestore();
    });

    it('should log status and cf-mitigated when giving up on a non-retryable status', async () => {
      const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => logger);
      mockFetch.mockResolvedValue(mockHtmlResponse({
        status: 403,
        data: 'Just a moment...',
        headers: { 'cf-mitigated': 'challenge' },
      }));

      const result = await flixpatrol.getFlixPatrolHTMLPage('/blocked');

      expect(result).toBeNull();
      const logged = errorSpy.mock.calls.map((call) => String(call[0])).join('\n');
      expect(logged).toContain('403');
      expect(logged).toContain('cf-mitigated');
      expect(logged).toContain('challenge');
      errorSpy.mockRestore();
    });

    it('should log the status when giving up on a non-retryable status without cf-mitigated', async () => {
      const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => logger);
      mockFetch.mockResolvedValue(mockHtmlResponse({ status: 404, data: 'Not found' }));

      const result = await flixpatrol.getFlixPatrolHTMLPage('/not-found');

      expect(result).toBeNull();
      expect(errorSpy.mock.calls.map((call) => String(call[0])).join('\n')).toContain('404');
      errorSpy.mockRestore();
    });

    it('should not throw when the response has no headers', async () => {
      mockFetch.mockResolvedValue({ status: 403, text: async () => 'blocked' });

      await expect(flixpatrol.getFlixPatrolHTMLPage('/no-headers')).resolves.toBeNull();
    });

    it('should use custom URL when provided', async () => {
      const customFlixpatrol = new FlixPatrol(
        { enabled: false, savePath: '', ttl: 0 },
        { url: 'https://custom.flixpatrol.com' }
      );

      mockFetch.mockResolvedValue(mockHtmlResponse({
        status: 200,
        data: '<html></html>',
      }));

      await customFlixpatrol.getFlixPatrolHTMLPage('/test');

      expect(mockFetch).toHaveBeenCalledWith('https://custom.flixpatrol.com/test');
    });
  });

  describe('getFlixPatrolHTMLPage with FlareSolverr', () => {
    // A minimal stand-in for FlareSolverrClient: only get() is reachable from
    // getFlixPatrolHTMLPage, and the session lifecycle is runPipeline's concern.
    const makeClient = (html: string | null) => ({
      createSession: vi.fn().mockResolvedValue(undefined),
      get: vi.fn().mockResolvedValue(html),
      destroySession: vi.fn().mockResolvedValue(undefined),
    });

    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('fetches through FlareSolverr and never touches impit', async () => {
      const client = makeClient('<html>via flaresolverr</html>');
      const flixpatrol = new FlixPatrol(
        { enabled: false, savePath: '', ttl: 0 },
        {},
        client as unknown as ConstructorParameters<typeof FlixPatrol>[2],
      );

      const result = await flixpatrol.getFlixPatrolHTMLPage('/top10/netflix/france');

      expect(result).toBe('<html>via flaresolverr</html>');
      expect(client.get).toHaveBeenCalledWith('https://flixpatrol.com/top10/netflix/france');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('propagates a null from FlareSolverr', async () => {
      const client = makeClient(null);
      const flixpatrol = new FlixPatrol(
        { enabled: false, savePath: '', ttl: 0 },
        {},
        client as unknown as ConstructorParameters<typeof FlixPatrol>[2],
      );

      await expect(flixpatrol.getFlixPatrolHTMLPage('/blocked')).resolves.toBeNull();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('honours a custom base url when routing through FlareSolverr', async () => {
      const client = makeClient('<html></html>');
      const flixpatrol = new FlixPatrol(
        { enabled: false, savePath: '', ttl: 0 },
        { url: 'https://custom.flixpatrol.com' },
        client as unknown as ConstructorParameters<typeof FlixPatrol>[2],
      );

      await flixpatrol.getFlixPatrolHTMLPage('/test');

      expect(client.get).toHaveBeenCalledWith('https://custom.flixpatrol.com/test');
    });

    it('uses impit when no client is supplied (optionality regression guard)', async () => {
      const flixpatrol = new FlixPatrol({ enabled: false, savePath: '', ttl: 0 });
      mockFetch.mockResolvedValue(mockHtmlResponse({ status: 200, data: '<html>via impit</html>' }));

      const result = await flixpatrol.getFlixPatrolHTMLPage('/test-path');

      expect(result).toBe('<html>via impit</html>');
      expect(mockFetch).toHaveBeenCalledWith('https://flixpatrol.com/test-path');
    });
  });

  describe('HTML parsing (via static methods)', () => {
    // Test parsePage indirectly through the public static parseTop10Page pattern
    // We need to make the parsing methods accessible for testing
    // Since they're private, we test the behavior through integration

    describe('parseTop10Page behavior', () => {
      let flixpatrol: FlixPatrol;

      beforeEach(() => {
        flixpatrol = new FlixPatrol({ enabled: false, savePath: '', ttl: 0 });
        vi.clearAllMocks();
      });

      it('should parse top10 world page with movies', async () => {
        const mockHtml = `
          <html>
            <body>
              <div>
                <h2><span>TOP Movies</span></h2>
                <div>
                  <a class="hover:underline" href="/title/movie-1">Movie 1</a>
                  <a class="hover:underline" href="/title/movie-2">Movie 2</a>
                </div>
              </div>
            </body>
          </html>
        `;
        mockFetch.mockResolvedValue(mockHtmlResponse({
          status: 200,
          data: mockHtml,
        }));

        // We can't directly test parseTop10Page since it's private
        // But we can verify getFlixPatrolHTMLPage returns the HTML
        const result = await flixpatrol.getFlixPatrolHTMLPage('/top10/netflix/world');
        expect(result).toBe(mockHtml);
      });

      it('should handle empty HTML gracefully', async () => {
        mockFetch.mockResolvedValue(mockHtmlResponse({
          status: 200,
          data: '<html><body></body></html>',
        }));

        const result = await flixpatrol.getFlixPatrolHTMLPage('/top10/netflix/world');
        expect(result).toBe('<html><body></body></html>');
      });

      it('should handle malformed HTML', async () => {
        mockFetch.mockResolvedValue(mockHtmlResponse({
          status: 200,
          data: '<html><body><div>Not closed',
        }));

        const result = await flixpatrol.getFlixPatrolHTMLPage('/top10/netflix/world');
        expect(result).toBe('<html><body><div>Not closed');
      });
    });
  });

  describe('Cache initialization', () => {
    it('should initialize without cache when disabled', () => {
      const flixpatrol = new FlixPatrol({ enabled: false, savePath: '', ttl: 0 });
      expect(flixpatrol).toBeInstanceOf(FlixPatrol);
    });

    it('should initialize with cache when enabled', () => {
      const flixpatrol = new FlixPatrol({
        enabled: true,
        savePath: '/tmp/test-cache',
        ttl: 3600,
      });
      expect(flixpatrol).toBeInstanceOf(FlixPatrol);
    });
  });

  describe('getTop10Sections', () => {
    let flixpatrol: FlixPatrol;

    beforeEach(() => {
      flixpatrol = new FlixPatrol({ enabled: false, savePath: '', ttl: 0 });
      vi.clearAllMocks();
    });

    it('should throw FlixPatrolError when page fetch fails', async () => {
      mockFetch.mockResolvedValue(mockHtmlResponse({ status: 404, data: null }));

      const config: FlixPatrolTop10 = {
        platform: 'netflix',
        location: 'world',
        fallback: false,
        privacy: 'private',
        limit: 10,
        type: 'movies',
      };

      await expect(flixpatrol.getTop10Sections(config))
        .rejects.toThrow('Unable to get FlixPatrol top10 page');
    });

    it('should parse movies from world page', async () => {
      const top10Html = `
        <html>
          <body>
            <div>
              <div>
                <h2><span>TOP Movies</span></h2>
              </div>
              <div>
                <a class="hover:underline" href="/title/movie-1">Movie 1</a>
                <a class="hover:underline" href="/title/movie-2">Movie 2</a>
              </div>
            </div>
          </body>
        </html>
      `;
      const detailHtml = `
        <html>
          <body>
            <div class="info-grid">
              <div class="info-grid-header">
                <div class="md:flex items-baseline justify-between">
                  <h1 class="mb-4 text-h1">Test Movie</h1>
                </div>
                <div class="flex flex-wrap">
                  <div class="flex gap-x-1" title="3894"><div>Movie</div><div>|</div></div>
                  <div class="flex gap-x-1" title="Premiere"><div><span>06/18/2024</span></div>|</div>
                </div>
              </div>
            </div>
          </body>
        </html>
      `;

      mockFetch
        .mockResolvedValueOnce(mockHtmlResponse({ status: 200, data: top10Html }))
        .mockResolvedValue(mockHtmlResponse({ status: 200, data: detailHtml }));

      const config: FlixPatrolTop10 = {
        platform: 'netflix',
        location: 'world',
        fallback: false,
        privacy: 'private',
        limit: 10,
        type: 'movies',
      };

      const result = await flixpatrol.getTop10Sections(config);

      // Both detail pages describe the same media, so the two entries collapse into one.
      expect(result.movies).toEqual([{ title: 'Test Movie', year: 2024 }]);
      expect(result.shows).toEqual([]);
      expect(result.rawCounts).toEqual({ movies: 2, shows: 0 });
    });

    it('should parse shows from world page', async () => {
      const top10Html = `
        <html>
          <body>
            <div>
              <div>
                <h2><span>TOP TV Shows</span></h2>
              </div>
              <div>
                <a class="hover:underline" href="/title/show-1">Show 1</a>
              </div>
            </div>
          </body>
        </html>
      `;
      const detailHtml = `
        <html>
          <body>
            <div class="info-grid">
              <div class="info-grid-header">
                <div class="md:flex items-baseline justify-between">
                  <h1 class="mb-4 text-h1">Test Show</h1>
                </div>
                <div class="flex flex-wrap">
                  <div class="flex gap-x-1" title="3894"><div>TV Show</div><div>|</div></div>
                  <div class="flex gap-x-1" title="Premiere"><div><span>06/18/2024</span></div>|</div>
                </div>
              </div>
            </div>
          </body>
        </html>
      `;

      mockFetch
        .mockResolvedValueOnce(mockHtmlResponse({ status: 200, data: top10Html }))
        .mockResolvedValue(mockHtmlResponse({ status: 200, data: detailHtml }));

      const config: FlixPatrolTop10 = {
        platform: 'netflix',
        location: 'world',
        fallback: false,
        privacy: 'private',
        limit: 10,
        type: 'shows',
      };

      const result = await flixpatrol.getTop10Sections(config);

      expect(result.movies).toEqual([]);
      expect(result.shows).toEqual([{ title: 'Test Show', year: 2024 }]);
      expect(result.rawCounts).toEqual({ movies: 0, shows: 1 });
    });

    it('should parse both movies and shows', async () => {
      const top10Html = `
        <html>
          <body>
            <div>
              <div>
                <h2><span>TOP Movies</span></h2>
              </div>
              <div>
                <a class="hover:underline" href="/title/movie-1">Movie 1</a>
              </div>
            </div>
            <div>
              <div>
                <h2><span>TOP TV Shows</span></h2>
              </div>
              <div>
                <a class="hover:underline" href="/title/show-1">Show 1</a>
              </div>
            </div>
          </body>
        </html>
      `;
      const detailHtml = `
        <html>
          <body>
            <div class="info-grid">
              <div class="info-grid-header">
                <div class="md:flex items-baseline justify-between">
                  <h1 class="mb-4 text-h1">Test Content</h1>
                </div>
                <div class="flex flex-wrap">
                  <div class="flex gap-x-1" title="3894"><div>Movie</div><div>|</div></div>
                  <div class="flex gap-x-1" title="Premiere"><div><span>06/18/2024</span></div>|</div>
                </div>
              </div>
            </div>
          </body>
        </html>
      `;

      mockFetch
        .mockResolvedValueOnce(mockHtmlResponse({ status: 200, data: top10Html }))
        .mockResolvedValue(mockHtmlResponse({ status: 200, data: detailHtml }));

      const config: FlixPatrolTop10 = {
        platform: 'netflix',
        location: 'world',
        fallback: false,
        privacy: 'private',
        limit: 10,
        type: 'both',
      };

      const result = await flixpatrol.getTop10Sections(config);

      expect(result.movies).toEqual([{ title: 'Test Content', year: 2024 }]);
      expect(result.shows).toEqual([{ title: 'Test Content', year: 2024 }]);
      expect(result.rawCounts).toEqual({ movies: 1, shows: 1 });
    });

    it('should fallback to another location when no results found', async () => {
      const emptyHtml = '<html><body></body></html>';
      const fallbackHtml = `
        <html>
          <body>
            <div>
              <div>
                <h2><span>TOP Movies</span></h2>
              </div>
              <div>
                <a class="hover:underline" href="/title/movie-1">Movie 1</a>
              </div>
            </div>
          </body>
        </html>
      `;
      const detailHtml = `
        <html>
          <body>
            <div class="info-grid">
              <div class="info-grid-header">
                <div class="md:flex items-baseline justify-between">
                  <h1 class="mb-4 text-h1">Fallback Movie</h1>
                </div>
                <div class="flex flex-wrap">
                  <div class="flex gap-x-1" title="3894"><div>Movie</div><div>|</div></div>
                  <div class="flex gap-x-1" title="Premiere"><div><span>06/18/2024</span></div>|</div>
                </div>
              </div>
            </div>
          </body>
        </html>
      `;

      mockFetch
        .mockResolvedValueOnce(mockHtmlResponse({ status: 200, data: emptyHtml }))
        .mockResolvedValueOnce(mockHtmlResponse({ status: 200, data: fallbackHtml }))
        .mockResolvedValue(mockHtmlResponse({ status: 200, data: detailHtml }));

      const config: FlixPatrolTop10 = {
        platform: 'netflix',
        location: 'france',
        fallback: 'world',
        privacy: 'private',
        limit: 10,
        type: 'movies',
      };

      const result = await flixpatrol.getTop10Sections(config);

      // Fallback should have been triggered
      expect(mockFetch).toHaveBeenCalledTimes(3); // Initial + fallback + detail
      expect(result.movies).toEqual([{ title: 'Fallback Movie', year: 2024 }]);
    });

    it('should respect the limit configuration', async () => {
      const top10Html = `
        <html>
          <body>
            <div>
              <div>
                <h2><span>TOP Movies</span></h2>
              </div>
              <div>
                <a class="hover:underline" href="/title/movie-1">Movie 1</a>
                <a class="hover:underline" href="/title/movie-2">Movie 2</a>
                <a class="hover:underline" href="/title/movie-3">Movie 3</a>
                <a class="hover:underline" href="/title/movie-4">Movie 4</a>
                <a class="hover:underline" href="/title/movie-5">Movie 5</a>
              </div>
            </div>
          </body>
        </html>
      `;
      const detailHtml = `
        <html>
          <body>
            <div class="info-grid">
              <div class="info-grid-header">
                <div class="md:flex items-baseline justify-between">
                  <h1 class="mb-4 text-h1">Test Movie</h1>
                </div>
                <div class="flex flex-wrap">
                  <div class="flex gap-x-1" title="3894"><div>Movie</div><div>|</div></div>
                  <div class="flex gap-x-1" title="Premiere"><div><span>06/18/2024</span></div>|</div>
                </div>
              </div>
            </div>
          </body>
        </html>
      `;

      mockFetch
        .mockResolvedValueOnce(mockHtmlResponse({ status: 200, data: top10Html }))
        .mockResolvedValue(mockHtmlResponse({ status: 200, data: detailHtml }));

      const config: FlixPatrolTop10 = {
        platform: 'netflix',
        location: 'world',
        fallback: false,
        privacy: 'private',
        limit: 2,
        type: 'movies',
      };

      const result = await flixpatrol.getTop10Sections(config);

      // Should only process 2 movies due to limit: 1 list page + 2 detail pages.
      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(result.rawCounts.movies).toBe(2);
      // Both detail pages describe the same media, so they collapse into one item.
      expect(result.movies).toEqual([{ title: 'Test Movie', year: 2024 }]);
    });

    it('should parse regional top10 page', async () => {
      const top10Html = `
        <html>
          <body>
            <div>
              <div><h3>TOP 10 Movies</h3></div>
              <div>
                <a class="hover:underline" href="/title/movie-1">Movie 1</a>
              </div>
            </div>
          </body>
        </html>
      `;
      const detailHtml = `
        <html>
          <body>
            <div class="info-grid">
              <div class="info-grid-header">
                <div class="md:flex items-baseline justify-between">
                  <h1 class="mb-4 text-h1">Regional Movie</h1>
                </div>
                <div class="flex flex-wrap">
                  <div class="flex gap-x-1" title="3894"><div>Movie</div><div>|</div></div>
                  <div class="flex gap-x-1" title="Premiere"><div><span>06/18/2024</span></div>|</div>
                </div>
              </div>
            </div>
          </body>
        </html>
      `;

      mockFetch
        .mockResolvedValueOnce(mockHtmlResponse({ status: 200, data: top10Html }))
        .mockResolvedValue(mockHtmlResponse({ status: 200, data: detailHtml }));

      const config: FlixPatrolTop10 = {
        platform: 'netflix',
        location: 'france',
        fallback: false,
        privacy: 'private',
        limit: 10,
        type: 'movies',
      };

      const result = await flixpatrol.getTop10Sections(config);

      expect(result.movies).toEqual([{ title: 'Regional Movie', year: 2024 }]);
      expect(result.rawCounts).toEqual({ movies: 1, shows: 0 });
    });

    it('should parse kids movies from regional page', async () => {
      const top10Html = `
        <html>
          <body>
            <div>
              <h3>TOP 10 Kids Movies</h3>
            </div>
            <table class="card-table">
              <tr>
                <td><a class="hover:underline" href="/title/kids-movie-1">Kids Movie 1</a></td>
              </tr>
              <tr>
                <td><a class="hover:underline" href="/title/kids-movie-2">Kids Movie 2</a></td>
              </tr>
            </table>
          </body>
        </html>
      `;
      const detailHtml = `
        <html>
          <body>
            <div class="info-grid">
              <div class="info-grid-header">
                <div class="md:flex items-baseline justify-between">
                  <h1 class="mb-4 text-h1">Kids Movie</h1>
                </div>
                <div class="flex flex-wrap">
                  <div class="flex gap-x-1" title="3894"><div>Movie</div><div>|</div></div>
                  <div class="flex gap-x-1" title="Premiere"><div><span>06/18/2024</span></div>|</div>
                </div>
              </div>
            </div>
          </body>
        </html>
      `;

      mockFetch
        .mockResolvedValueOnce(mockHtmlResponse({ status: 200, data: top10Html }))
        .mockResolvedValue(mockHtmlResponse({ status: 200, data: detailHtml }));

      const config: FlixPatrolTop10 = {
        platform: 'netflix',
        location: 'italy',
        fallback: false,
        privacy: 'private',
        limit: 10,
        type: 'movies',
        kids: true,
      };

      const result = await flixpatrol.getTop10Sections(config);

      expect(result.movies).toEqual([{ title: 'Kids Movie', year: 2024 }]);
      expect(result.rawCounts).toEqual({ movies: 2, shows: 0 });
      expect(result.shows).toEqual([]);
    });

    it('should parse kids TV shows from regional page', async () => {
      const top10Html = `
        <html>
          <body>
            <div>
              <h3>TOP 10 Kids TV Shows</h3>
            </div>
            <table class="card-table">
              <tr>
                <td><a class="hover:underline" href="/title/kids-show-1">Kids Show 1</a></td>
              </tr>
            </table>
          </body>
        </html>
      `;
      const detailHtml = `
        <html>
          <body>
            <div class="info-grid">
              <div class="info-grid-header">
                <div class="md:flex items-baseline justify-between">
                  <h1 class="mb-4 text-h1">Kids Show</h1>
                </div>
                <div class="flex flex-wrap">
                  <div class="flex gap-x-1" title="3894"><div>TV Show</div><div>|</div></div>
                  <div class="flex gap-x-1" title="Premiere"><div><span>06/18/2024</span></div>|</div>
                </div>
              </div>
            </div>
          </body>
        </html>
      `;

      mockFetch
        .mockResolvedValueOnce(mockHtmlResponse({ status: 200, data: top10Html }))
        .mockResolvedValue(mockHtmlResponse({ status: 200, data: detailHtml }));

      const config: FlixPatrolTop10 = {
        platform: 'netflix',
        location: 'italy',
        fallback: false,
        privacy: 'private',
        limit: 10,
        type: 'shows',
        kids: true,
      };

      const result = await flixpatrol.getTop10Sections(config);

      expect(result.shows).toEqual([{ title: 'Kids Show', year: 2024 }]);
      expect(result.rawCounts).toEqual({ movies: 0, shows: 1 });
      expect(result.movies).toEqual([]);
    });

    it('should return empty results for kids with non-netflix platform', async () => {
      const config: FlixPatrolTop10 = {
        platform: 'disney',
        location: 'italy',
        fallback: false,
        privacy: 'private',
        limit: 10,
        type: 'both',
        kids: true,
      };

      const result = await flixpatrol.getTop10Sections(config);

      expect(result.movies).toEqual([]);
      expect(result.shows).toEqual([]);
      expect(result.rawCounts.movies).toBe(0);
      expect(result.rawCounts.shows).toBe(0);
      // Should not make any HTTP requests
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should return empty results for kids with world location', async () => {
      const config: FlixPatrolTop10 = {
        platform: 'netflix',
        location: 'world',
        fallback: false,
        privacy: 'private',
        limit: 10,
        type: 'both',
        kids: true,
      };

      const result = await flixpatrol.getTop10Sections(config);

      expect(result.movies).toEqual([]);
      expect(result.shows).toEqual([]);
      expect(result.rawCounts.movies).toBe(0);
      expect(result.rawCounts.shows).toBe(0);
      // Should not make any HTTP requests
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should not trigger fallback for kids when no results found', async () => {
      const emptyHtml = '<html><body></body></html>';

      mockFetch
        .mockResolvedValueOnce(mockHtmlResponse({ status: 200, data: emptyHtml }));

      const config: FlixPatrolTop10 = {
        platform: 'netflix',
        location: 'france',
        fallback: 'world',
        privacy: 'private',
        limit: 10,
        type: 'movies',
        kids: true,
      };

      const result = await flixpatrol.getTop10Sections(config);

      // Fallback should NOT be triggered for kids
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(result.movies).toEqual([]);
      expect(result.shows).toEqual([]);
    });

    it('falls back to another location only when the page yields no result at all', async () => {
      routeFetch((path) => (path.endsWith('/france') ? EMPTY_TOP10_HTML : TOP10_WORLD_HTML));

      const result = await flixpatrol.getTop10Sections({
        platform: 'netflix',
        location: 'france',
        fallback: 'world',
        privacy: 'private',
        limit: 10,
        type: 'movies',
      });

      expect(result.movies).toEqual([
        { title: 'Inception', year: 2010 },
        { title: 'Fight Club', year: 1999 },
      ]);
    });

    it('does not fall back when the page yields results that simply have no year', async () => {
      // Guard rail for the semantics change: present-but-poor results must no longer
      // trigger a silent fallback to another location.
      routeFetch(TOP10_REGIONAL_HTML, NO_YEAR_DETAIL_HTML);

      const result = await flixpatrol.getTop10Sections({
        platform: 'netflix',
        location: 'france',
        fallback: 'world',
        privacy: 'private',
        limit: 10,
        type: 'movies',
      });

      expect(result.movies[0].year).toBeNull();
      // a single list page downloaded: no fallback
      const listPages = mockFetch.mock.calls.filter((c) => `${c[0]}`.includes('/top10/'));
      expect(listPages).toHaveLength(1);
    });
  });

  describe('getPopular', () => {
    let flixpatrol: FlixPatrol;

    beforeEach(() => {
      flixpatrol = new FlixPatrol({ enabled: false, savePath: '', ttl: 0 });
      vi.clearAllMocks();
    });

    it('should throw FlixPatrolError when page fetch fails', async () => {
      mockFetch.mockResolvedValue(mockHtmlResponse({ status: 404, data: null }));

      const config: FlixPatrolPopular = {
        platform: 'wikipedia',
        privacy: 'private',
        limit: 10,
        type: 'movies',
      };

      await expect(flixpatrol.getPopular('Movies', config))
        .rejects.toThrow('Unable to get FlixPatrol popular page');
    });

    it('should parse popular movies', async () => {
      const popularHtml = `
        <html>
          <body>
            <table class="card-table">
              <tr>
                <td>
                  <a class="flex gap-2 group items-center" href="/title/popular-movie-1">Popular Movie 1</a>
                </td>
              </tr>
              <tr>
                <td>
                  <a class="flex gap-2 group items-center" href="/title/popular-movie-2">Popular Movie 2</a>
                </td>
              </tr>
            </table>
          </body>
        </html>
      `;
      const detailHtml = `
        <html>
          <body>
            <div class="info-grid">
              <div class="info-grid-header">
                <div class="md:flex items-baseline justify-between">
                  <h1 class="mb-4 text-h1">Popular Movie</h1>
                </div>
                <div class="flex flex-wrap">
                  <div class="flex gap-x-1" title="3894"><div>Movie</div><div>|</div></div>
                  <div class="flex gap-x-1" title="Premiere"><div><span>06/18/2024</span></div>|</div>
                </div>
              </div>
            </div>
          </body>
        </html>
      `;

      mockFetch
        .mockResolvedValueOnce(mockHtmlResponse({ status: 200, data: popularHtml }))
        .mockResolvedValue(mockHtmlResponse({ status: 200, data: detailHtml }));

      const config: FlixPatrolPopular = {
        platform: 'wikipedia',
        privacy: 'private',
        limit: 10,
        type: 'movies',
      };

      const result = await flixpatrol.getPopular('Movies', config);

      expect(Array.isArray(result)).toBe(true);
    });

    it('should parse popular TV shows', async () => {
      const popularHtml = `
        <html>
          <body>
            <table class="card-table">
              <tr>
                <td>
                  <a class="flex gap-2 group items-center" href="/title/popular-show-1">Popular Show 1</a>
                </td>
              </tr>
            </table>
          </body>
        </html>
      `;
      const detailHtml = `
        <html>
          <body>
            <div class="info-grid">
              <div class="info-grid-header">
                <div class="md:flex items-baseline justify-between">
                  <h1 class="mb-4 text-h1">Popular Show</h1>
                </div>
                <div class="flex flex-wrap">
                  <div class="flex gap-x-1" title="3894"><div>TV Show</div><div>|</div></div>
                  <div class="flex gap-x-1" title="Premiere"><div><span>06/18/2024</span></div>|</div>
                </div>
              </div>
            </div>
          </body>
        </html>
      `;

      mockFetch
        .mockResolvedValueOnce(mockHtmlResponse({ status: 200, data: popularHtml }))
        .mockResolvedValue(mockHtmlResponse({ status: 200, data: detailHtml }));

      const config: FlixPatrolPopular = {
        platform: 'wikipedia',
        privacy: 'private',
        limit: 10,
        type: 'shows',
      };

      const result = await flixpatrol.getPopular('TV Shows', config);

      expect(Array.isArray(result)).toBe(true);
    });

    it('should respect limit for popular', async () => {
      const popularHtml = `
        <html>
          <body>
            <table class="card-table">
              <tr><td><a class="flex gap-2 group items-center" href="/title/m1">M1</a></td></tr>
              <tr><td><a class="flex gap-2 group items-center" href="/title/m2">M2</a></td></tr>
              <tr><td><a class="flex gap-2 group items-center" href="/title/m3">M3</a></td></tr>
              <tr><td><a class="flex gap-2 group items-center" href="/title/m4">M4</a></td></tr>
              <tr><td><a class="flex gap-2 group items-center" href="/title/m5">M5</a></td></tr>
            </table>
          </body>
        </html>
      `;
      const detailHtml = `
        <html>
          <body>
            <div class="info-grid">
              <div class="info-grid-header">
                <div class="md:flex items-baseline justify-between">
                  <h1 class="mb-4 text-h1">Movie</h1>
                </div>
                <div class="flex flex-wrap">
                  <div class="flex gap-x-1" title="3894"><div>Movie</div><div>|</div></div>
                  <div class="flex gap-x-1" title="Premiere"><div><span>06/18/2024</span></div>|</div>
                </div>
              </div>
            </div>
          </body>
        </html>
      `;

      mockFetch
        .mockResolvedValueOnce(mockHtmlResponse({ status: 200, data: popularHtml }))
        .mockResolvedValue(mockHtmlResponse({ status: 200, data: detailHtml }));

      const config: FlixPatrolPopular = {
        platform: 'wikipedia',
        privacy: 'private',
        limit: 2,
        type: 'movies',
      };

      const result = await flixpatrol.getPopular('Movies', config);

      expect(result.length).toBeLessThanOrEqual(2);
    });
  });

  describe('getMostWatched', () => {
    let flixpatrol: FlixPatrol;

    beforeEach(() => {
      flixpatrol = new FlixPatrol({ enabled: false, savePath: '', ttl: 0 });
      vi.clearAllMocks();
    });

    it('should throw FlixPatrolError when page fetch fails', async () => {
      mockFetch.mockResolvedValue(mockHtmlResponse({ status: 404, data: null }));

      const config: FlixPatrolMostWatched = {
        enabled: true,
        privacy: 'private',
        limit: 10,
        type: 'movies',
        year: 2024,
      };

      await expect(flixpatrol.getMostWatched('Movies', config))
        .rejects.toThrow('Unable to get FlixPatrol most-watched page');
    });

    it('should parse most watched movies', async () => {
      const mostWatchedHtml = `
        <html>
          <body>
            <table class="card-table">
              <tr>
                <td>
                  <a class="flex gap-2 group items-center" href="/title/most-watched-1">Most Watched 1</a>
                </td>
              </tr>
            </table>
          </body>
        </html>
      `;
      const detailHtml = `
        <html>
          <body>
            <div class="info-grid">
              <div class="info-grid-header">
                <div class="md:flex items-baseline justify-between">
                  <h1 class="mb-4 text-h1">Most Watched Movie</h1>
                </div>
                <div class="flex flex-wrap">
                  <div class="flex gap-x-1" title="3894"><div>Movie</div><div>|</div></div>
                  <div class="flex gap-x-1" title="Premiere"><div><span>06/18/2024</span></div>|</div>
                </div>
              </div>
            </div>
          </body>
        </html>
      `;

      mockFetch
        .mockResolvedValueOnce(mockHtmlResponse({ status: 200, data: mostWatchedHtml }))
        .mockResolvedValue(mockHtmlResponse({ status: 200, data: detailHtml }));

      const config: FlixPatrolMostWatched = {
        enabled: true,
        privacy: 'private',
        limit: 10,
        type: 'movies',
        year: 2024,
      };

      const result = await flixpatrol.getMostWatched('Movies', config);

      expect(Array.isArray(result)).toBe(true);
    });

    it('should parse most watched TV shows with grouped URL', async () => {
      const mostWatchedHtml = `
        <html>
          <body>
            <table class="card-table">
              <tr>
                <td>
                  <a class="flex gap-2 group items-center" href="/title/most-watched-show-1">Most Watched Show 1</a>
                </td>
              </tr>
            </table>
          </body>
        </html>
      `;
      const detailHtml = `
        <html>
          <body>
            <div class="info-grid">
              <div class="info-grid-header">
                <div class="md:flex items-baseline justify-between">
                  <h1 class="mb-4 text-h1">Most Watched Show</h1>
                </div>
                <div class="flex flex-wrap">
                  <div class="flex gap-x-1" title="3894"><div>TV Show</div><div>|</div></div>
                  <div class="flex gap-x-1" title="Premiere"><div><span>06/18/2024</span></div>|</div>
                </div>
              </div>
            </div>
          </body>
        </html>
      `;

      mockFetch
        .mockResolvedValueOnce(mockHtmlResponse({ status: 200, data: mostWatchedHtml }))
        .mockResolvedValue(mockHtmlResponse({ status: 200, data: detailHtml }));

      const config: FlixPatrolMostWatched = {
        enabled: true,
        privacy: 'private',
        limit: 10,
        type: 'shows',
        year: 2024,
      };

      const result = await flixpatrol.getMostWatched('TV Shows', config);

      expect(Array.isArray(result)).toBe(true);
      // TV shows URL should include -grouped
      expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('-grouped'));
    });

    it('should include country in URL when specified', async () => {
      const mostWatchedHtml = `
        <html>
          <body>
            <table class="card-table">
              <tr>
                <td>
                  <a class="flex gap-2 group items-center" href="/title/movie-1">Movie 1</a>
                </td>
              </tr>
            </table>
          </body>
        </html>
      `;
      const detailHtml = `
        <html>
          <body>
            <div class="info-grid">
              <div class="info-grid-header">
                <div class="md:flex items-baseline justify-between">
                  <h1 class="mb-4 text-h1">Movie</h1>
                </div>
                <div class="flex flex-wrap">
                  <div class="flex gap-x-1" title="3894"><div>Movie</div><div>|</div></div>
                  <div class="flex gap-x-1" title="Premiere"><div><span>06/18/2024</span></div>|</div>
                </div>
              </div>
            </div>
          </body>
        </html>
      `;

      mockFetch
        .mockResolvedValueOnce(mockHtmlResponse({ status: 200, data: mostWatchedHtml }))
        .mockResolvedValue(mockHtmlResponse({ status: 200, data: detailHtml }));

      const config: FlixPatrolMostWatched = {
        enabled: true,
        privacy: 'private',
        limit: 10,
        type: 'movies',
        year: 2024,
        country: 'france',
      };

      const result = await flixpatrol.getMostWatched('Movies', config);

      expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('-from-france'));
    });

    it('should include premiere in URL when specified', async () => {
      const mostWatchedHtml = `
        <html>
          <body>
            <table class="card-table">
              <tr>
                <td>
                  <a class="flex gap-2 group items-center" href="/title/movie-1">Movie 1</a>
                </td>
              </tr>
            </table>
          </body>
        </html>
      `;
      const detailHtml = `
        <html>
          <body>
            <div class="info-grid">
              <div class="info-grid-header">
                <div class="md:flex items-baseline justify-between">
                  <h1 class="mb-4 text-h1">Movie</h1>
                </div>
                <div class="flex flex-wrap">
                  <div class="flex gap-x-1" title="3894"><div>Movie</div><div>|</div></div>
                  <div class="flex gap-x-1" title="Premiere"><div><span>06/18/2024</span></div>|</div>
                </div>
              </div>
            </div>
          </body>
        </html>
      `;

      mockFetch
        .mockResolvedValueOnce(mockHtmlResponse({ status: 200, data: mostWatchedHtml }))
        .mockResolvedValue(mockHtmlResponse({ status: 200, data: detailHtml }));

      const config: FlixPatrolMostWatched = {
        enabled: true,
        privacy: 'private',
        limit: 10,
        type: 'movies',
        year: 2024,
        premiere: 2023,
      };

      const result = await flixpatrol.getMostWatched('Movies', config);

      expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('-2023'));
    });

    it('should include orderByViews in URL when specified', async () => {
      const mostWatchedHtml = `
        <html>
          <body>
            <table class="card-table">
              <tr>
                <td>
                  <a class="flex gap-2 group items-center" href="/title/movie-1">Movie 1</a>
                </td>
              </tr>
            </table>
          </body>
        </html>
      `;
      const detailHtml = `
        <html>
          <body>
            <div class="info-grid">
              <div class="info-grid-header">
                <div class="md:flex items-baseline justify-between">
                  <h1 class="mb-4 text-h1">Movie</h1>
                </div>
                <div class="flex flex-wrap">
                  <div class="flex gap-x-1" title="3894"><div>Movie</div><div>|</div></div>
                  <div class="flex gap-x-1" title="Premiere"><div><span>06/18/2024</span></div>|</div>
                </div>
              </div>
            </div>
          </body>
        </html>
      `;

      mockFetch
        .mockResolvedValueOnce(mockHtmlResponse({ status: 200, data: mostWatchedHtml }))
        .mockResolvedValue(mockHtmlResponse({ status: 200, data: detailHtml }));

      const config: FlixPatrolMostWatched = {
        enabled: true,
        privacy: 'private',
        limit: 10,
        type: 'movies',
        year: 2024,
        orderByViews: true,
      };

      const result = await flixpatrol.getMostWatched('Movies', config);

      expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('/by-views'));
    });

    it('should filter Netflix originals when original is true', async () => {
      const mostWatchedHtml = `
        <html>
          <body>
            <table class="card-table">
              <tr>
                <td>
                  <a class="flex gap-2 group items-center" href="/title/original-movie">
                    <svg></svg>
                    Original Movie
                  </a>
                </td>
              </tr>
              <tr>
                <td>
                  <a class="flex gap-2 group items-center" href="/title/non-original">Non Original</a>
                </td>
              </tr>
            </table>
          </body>
        </html>
      `;
      const detailHtml = `
        <html>
          <body>
            <div class="info-grid">
              <div class="info-grid-header">
                <div class="md:flex items-baseline justify-between">
                  <h1 class="mb-4 text-h1">Original Movie</h1>
                </div>
                <div class="flex flex-wrap">
                  <div class="flex gap-x-1" title="3894"><div>Movie</div><div>|</div></div>
                  <div class="flex gap-x-1" title="Premiere"><div><span>06/18/2024</span></div>|</div>
                </div>
              </div>
            </div>
          </body>
        </html>
      `;

      mockFetch
        .mockResolvedValueOnce(mockHtmlResponse({ status: 200, data: mostWatchedHtml }))
        .mockResolvedValue(mockHtmlResponse({ status: 200, data: detailHtml }));

      const config: FlixPatrolMostWatched = {
        enabled: true,
        privacy: 'private',
        limit: 10,
        type: 'movies',
        year: 2024,
        original: true,
      };

      const result = await flixpatrol.getMostWatched('Movies', config);

      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('detail page extraction (via integration)', () => {
    let flixpatrol: FlixPatrol;

    beforeEach(() => {
      flixpatrol = new FlixPatrol({ enabled: false, savePath: '', ttl: 0 });
      vi.clearAllMocks();
    });

    it('should extract title and year from detail page', async () => {
      const popularHtml = `
        <html>
          <body>
            <table class="card-table">
              <tr>
                <td>
                  <a class="flex gap-2 group items-center" href="/title/test-movie">Test Movie</a>
                </td>
              </tr>
            </table>
          </body>
        </html>
      `;
      const detailHtml = `
        <html>
          <body>
            <div class="info-grid">
              <div class="info-grid-header">
                <div class="md:flex items-baseline justify-between">
                  <h1 class="mb-4 text-h1">The Matrix</h1>
                </div>
                <div class="flex flex-wrap">
                  <div class="flex gap-x-1" title="3894"><div>Movie</div><div>|</div></div>
                  <div class="flex gap-x-1" title="Premiere"><div><span>06/18/1999</span></div>|</div>
                </div>
              </div>
            </div>
          </body>
        </html>
      `;

      mockFetch
        .mockResolvedValueOnce(mockHtmlResponse({ status: 200, data: popularHtml }))
        .mockResolvedValue(mockHtmlResponse({ status: 200, data: detailHtml }));

      const config: FlixPatrolPopular = {
        platform: 'wikipedia',
        privacy: 'private',
        limit: 1,
        type: 'movies',
      };

      const result = await flixpatrol.getPopular('Movies', config);

      expect(result).toEqual([{ title: 'The Matrix', year: 1999 }]);
    });

    it('should return a null year when the detail page exposes no usable year', async () => {
      const popularHtml = `
        <html>
          <body>
            <table class="card-table">
              <tr>
                <td>
                  <a class="flex gap-2 group items-center" href="/title/test">Test</a>
                </td>
              </tr>
            </table>
          </body>
        </html>
      `;
      // Header present, but no premiere block: the year must come back null rather than
      // being guessed from the surrounding marketing copy.
      const detailHtml = `
        <html>
          <body>
            ${MARKETING_BLURB_HTML}
            <div class="info-grid">
              <div class="info-grid-header">
                <div class="md:flex items-baseline justify-between">
                  <h1 class="mb-4 text-h1">Unknown Movie</h1>
                </div>
                <div class="flex flex-wrap">
                  <div class="flex gap-x-1" title="3894"><div>Movie</div><div>|</div></div>
                </div>
              </div>
            </div>
          </body>
        </html>
      `;

      mockFetch
        .mockResolvedValueOnce(mockHtmlResponse({ status: 200, data: popularHtml }))
        .mockResolvedValue(mockHtmlResponse({ status: 200, data: detailHtml }));

      const config: FlixPatrolPopular = {
        platform: 'wikipedia',
        privacy: 'private',
        limit: 1,
        type: 'movies',
      };

      const result = await flixpatrol.getPopular('Movies', config);

      expect(result).toEqual([{ title: 'Unknown Movie', year: null }]);
    });

    it('should drop an item whose detail page yields no title at all', async () => {
      const popularHtml = `
        <html>
          <body>
            <table class="card-table">
              <tr>
                <td>
                  <a class="flex gap-2 group items-center" href="/title/unknown">Unknown</a>
                </td>
              </tr>
            </table>
          </body>
        </html>
      `;
      // No h1 anywhere: neither the primary nor the fallback title XPath matches.
      const detailHtml = `
        <html>
          <body>
            <div class="info-grid">
              <div class="info-grid-header">
                <div class="flex flex-wrap">
                  <div class="flex gap-x-1" title="3894"><div>Movie</div><div>|</div></div>
                  <div class="flex gap-x-1" title="Premiere"><div><span>06/18/2024</span></div>|</div>
                </div>
              </div>
            </div>
          </body>
        </html>
      `;

      mockFetch
        .mockResolvedValueOnce(mockHtmlResponse({ status: 200, data: popularHtml }))
        .mockResolvedValue(mockHtmlResponse({ status: 200, data: detailHtml }));

      const config: FlixPatrolPopular = {
        platform: 'wikipedia',
        privacy: 'private',
        limit: 1,
        type: 'movies',
      };

      const result = await flixpatrol.getPopular('Movies', config);

      expect(result).toEqual([]);
    });

    it('should throw error when detail page fetch fails', async () => {
      const popularHtml = `
        <html>
          <body>
            <table class="card-table">
              <tr>
                <td>
                  <a class="flex gap-2 group items-center" href="/title/test">Test</a>
                </td>
              </tr>
            </table>
          </body>
        </html>
      `;

      mockFetch
        .mockResolvedValueOnce(mockHtmlResponse({ status: 200, data: popularHtml }))
        .mockResolvedValueOnce(mockHtmlResponse({ status: 404, data: null }));

      const config: FlixPatrolPopular = {
        platform: 'wikipedia',
        privacy: 'private',
        limit: 1,
        type: 'movies',
      };

      await expect(flixpatrol.getPopular('Movies', config))
        .rejects.toThrow('Unable to get FlixPatrol detail page');
    });

    it('should extract a TV show detail page the same way as a movie', async () => {
      const popularHtml = `
        <html>
          <body>
            <table class="card-table">
              <tr>
                <td>
                  <a class="flex gap-2 group items-center" href="/title/test-show">Test Show</a>
                </td>
              </tr>
            </table>
          </body>
        </html>
      `;
      const detailHtml = `
        <html>
          <body>
            <div class="info-grid">
              <div class="info-grid-header">
                <div class="md:flex items-baseline justify-between">
                  <h1 class="mb-4 text-h1">Breaking Bad</h1>
                </div>
                <div class="flex flex-wrap">
                  <div class="flex gap-x-1" title="3894"><div>TV Show</div><div>|</div></div>
                  <div class="flex gap-x-1" title="Premiere"><div><span>06/18/2008</span></div>|</div>
                </div>
              </div>
            </div>
          </body>
        </html>
      `;

      mockFetch
        .mockResolvedValueOnce(mockHtmlResponse({ status: 200, data: popularHtml }))
        .mockResolvedValue(mockHtmlResponse({ status: 200, data: detailHtml }));

      const config: FlixPatrolPopular = {
        platform: 'wikipedia',
        privacy: 'private',
        limit: 1,
        type: 'shows',
      };

      const result = await flixpatrol.getPopular('TV Shows', config);

      expect(result).toEqual([{ title: 'Breaking Bad', year: 2008 }]);
    });

    it('should use fallback title extraction from h1', async () => {
      const popularHtml = `
        <html>
          <body>
            <table class="card-table">
              <tr>
                <td>
                  <a class="flex gap-2 group items-center" href="/title/test">Test</a>
                </td>
              </tr>
            </table>
          </body>
        </html>
      `;
      // No info-grid-header at all: the title still resolves through the //h1 fallback,
      // but the year has no source and must stay null instead of being scavenged from
      // the marketing blurb's "2021".
      const detailHtml = `
        <html>
          <body>
            <h1>Fallback Title</h1>
            ${MARKETING_BLURB_HTML}
          </body>
        </html>
      `;

      mockFetch
        .mockResolvedValueOnce(mockHtmlResponse({ status: 200, data: popularHtml }))
        .mockResolvedValue(mockHtmlResponse({ status: 200, data: detailHtml }));

      const config: FlixPatrolPopular = {
        platform: 'wikipedia',
        privacy: 'private',
        limit: 1,
        type: 'movies',
      };

      const result = await flixpatrol.getPopular('Movies', config);

      expect(result).toEqual([{ title: 'Fallback Title', year: null }]);
    });

    // Regression: FlixPatrol's markup drifted and the year XPath went dead. The old code
    // fell back to a regex over `div.mb-6`, which had become a site-wide marketing blurb
    // ending in "the most popular TV shows in 2021" — so every scraped title was dated
    // 2021, and the "exact title AND year" branch of the match cascade confidently
    // selected homonyms (Paulette 2012 resolved to an unrelated 2021 film).
    it('extracts the real premiere year even when the 2021 marketing blurb is present', async () => {
      const popularHtml = `
        <html>
          <body>
            <table class="card-table">
              <tr>
                <td>
                  <a class="flex gap-2 group items-center" href="/title/paulette">Paulette</a>
                </td>
              </tr>
            </table>
          </body>
        </html>
      `;
      const detailHtml = `
        <html>
          <body>
            ${MARKETING_BLURB_HTML}
            <div class="info-grid">
              <div class="info-grid-header">
                <div class="md:flex items-baseline justify-between">
                  <h1 class="mb-4 text-h1">Paulette</h1>
                </div>
                <div class="flex flex-wrap">
                  <div class="flex gap-x-1" title="3894"><div>Movie</div><div>|</div></div>
                  <div class="flex gap-x-1"><span>France</span></div>
                  <div class="flex gap-x-1" title="Premiere"><div><span>10/03/2012</span></div>|</div>
                </div>
              </div>
            </div>
            ${MARKETING_BLURB_HTML}
          </body>
        </html>
      `;

      mockFetch
        .mockResolvedValueOnce(mockHtmlResponse({ status: 200, data: popularHtml }))
        .mockResolvedValue(mockHtmlResponse({ status: 200, data: detailHtml }));

      const config: FlixPatrolPopular = {
        platform: 'wikipedia',
        privacy: 'private',
        limit: 1,
        type: 'movies',
      };

      const result = await flixpatrol.getPopular('Movies', config);

      expect(result).toEqual([{ title: 'Paulette', year: 2012 }]);
    });

    // The premiere date is MM/DD/YYYY. A day above 12 removes any doubt about which
    // component the parser reads: only the trailing year may ever be picked up.
    it('reads the year from an MM/DD/YYYY premiere date whose day exceeds 12', async () => {
      const popularHtml = `
        <html>
          <body>
            <table class="card-table">
              <tr>
                <td>
                  <a class="flex gap-2 group items-center" href="/title/turbulence">Turbulence</a>
                </td>
              </tr>
            </table>
          </body>
        </html>
      `;
      const detailHtml = `
        <html>
          <body>
            <div class="info-grid">
              <div class="info-grid-header">
                <div class="md:flex items-baseline justify-between">
                  <h1 class="mb-4 text-h1">Turbulence</h1>
                </div>
                <div class="flex flex-wrap">
                  <div class="flex gap-x-1" title="Premiere"><div><span>05/18/2025</span></div>|</div>
                </div>
              </div>
            </div>
          </body>
        </html>
      `;

      mockFetch
        .mockResolvedValueOnce(mockHtmlResponse({ status: 200, data: popularHtml }))
        .mockResolvedValue(mockHtmlResponse({ status: 200, data: detailHtml }));

      const config: FlixPatrolPopular = {
        platform: 'wikipedia',
        privacy: 'private',
        limit: 1,
        type: 'movies',
      };

      const result = await flixpatrol.getPopular('Movies', config);

      expect(result).toEqual([{ title: 'Turbulence', year: 2025 }]);
    });

    it('serves the second lookup of the same detail page from the cache', async () => {
      // `cacheOptions.enabled` is true here, unlike the rest of the file: the cache
      // behaviour itself is what this test measures.
      const cached = new FlixPatrol({ enabled: true, savePath: './config/.cache', ttl: 604800 });
      routeFetch(POPULAR_LIST_HTML);

      const config: FlixPatrolPopular = {
        platform: 'wikipedia',
        privacy: 'private',
        limit: 10,
        type: 'movies',
      };

      const before = mockFetch.mock.calls.length;
      await cached.getPopular('Movies', config);
      const afterFirst = mockFetch.mock.calls.length;
      await cached.getPopular('Movies', config);
      const afterSecond = mockFetch.mock.calls.length;

      // First pass downloads the list page plus one detail page per item.
      expect(afterFirst - before).toBe(3);
      // Second pass only re-downloads the list page: details come from the cache.
      expect(afterSecond - afterFirst).toBe(1);
    });

    it('does not cache a detail page whose year could not be parsed', async () => {
      // A null year is what degrades the later backend search, so a partial parse must
      // never be persisted: the second lookup has to re-fetch the detail page.
      const cached = new FlixPatrol({ enabled: true, savePath: './config/.cache', ttl: 604800 });
      routeFetch(POPULAR_LIST_HTML, NO_YEAR_DETAIL_HTML);

      const config: FlixPatrolPopular = {
        platform: 'wikipedia',
        privacy: 'private',
        limit: 10,
        type: 'movies',
      };

      const before = mockFetch.mock.calls.length;
      const first = await cached.getPopular('Movies', config);
      const afterFirst = mockFetch.mock.calls.length;
      await cached.getPopular('Movies', config);
      const afterSecond = mockFetch.mock.calls.length;

      expect(first).toEqual([{ title: 'Movie Without Year', year: null }]);
      expect(afterFirst - before).toBe(3);
      // Same cost again: nothing was cached, so both detail pages are re-fetched.
      expect(afterSecond - afterFirst).toBe(3);
    });

    // A listing that links at a SUB-page of the title instead of the title itself.
    // YouTube Popular does exactly this in production, and `/title/<slug>/trailers/`
    // prints "Primetime Trailers" in its `h1` — the section name welded onto the
    // media name. Fetching the href verbatim searches every backend under a name
    // nobody uses, so the href is canonicalised before anything else happens to it.
    const SUBPAGE_LIST_HTML = `
      <html>
        <body>
          <table class="card-table">
            <tr><td>
              <a class="flex gap-2 group items-center" href="/title/inception/trailers/#toc-trl_Ywax13">Inception</a>
            </td></tr>
          </table>
        </body>
      </html>
    `;

    const subPageConfig: FlixPatrolPopular = {
      platform: 'youtube',
      privacy: 'private',
      limit: 10,
      type: 'movies',
    };

    it('fetches the canonical title page when the listing links at a sub-page', async () => {
      routeFetch(SUBPAGE_LIST_HTML);

      const result = await flixpatrol.getPopular('Movies', subPageConfig);

      const fetched: string[] = mockFetch.mock.calls.map((call: unknown[]) => call[0] as string);
      expect(fetched).toContain('https://flixpatrol.com/title/inception/');
      // The sub-page must never be requested: it is the source of the bad title.
      expect(fetched.some((url) => url.includes('/trailers'))).toBe(false);
      expect(result).toEqual([{ title: 'Inception', year: 2010 }]);
    });

    it('shares one detail-cache entry between the sub-page and canonical spellings', async () => {
      // Normalising BEFORE the cache lookup is what makes this hold: the two
      // listings link at the same media through different hrefs, so the second one
      // must be a cache hit rather than a second entry and a second download.
      const cached = new FlixPatrol({ enabled: true, savePath: './config/.cache', ttl: 604800 });
      routeFetch((path: string) => (path.includes('youtube') ? SUBPAGE_LIST_HTML : POPULAR_LIST_HTML));

      const before = mockFetch.mock.calls.length;
      await cached.getPopular('Movies', subPageConfig);
      const afterSubPage = mockFetch.mock.calls.length;
      await cached.getPopular('Movies', {
        platform: 'wikipedia', privacy: 'private', limit: 1, type: 'movies',
      });
      const afterCanonical = mockFetch.mock.calls.length;

      // List page + the one detail page behind the sub-page href.
      expect(afterSubPage - before).toBe(2);
      // The canonical listing links at the same media: list page only, no detail.
      expect(afterCanonical - afterSubPage).toBe(1);
    });
  });

  describe('getMostHours', () => {
    let flixpatrol: FlixPatrol;

    beforeEach(() => {
      flixpatrol = new FlixPatrol({ enabled: false, savePath: '', ttl: 0 });
      vi.clearAllMocks();
    });

    it('should throw FlixPatrolError when page fetch fails', async () => {
      mockFetch.mockResolvedValue(mockHtmlResponse({ status: 404, data: null }));

      const config: FlixPatrolMostHours = {
        enabled: true,
        privacy: 'private',
        limit: 10,
        type: 'movies',
        period: 'total',
        language: 'all',
      };

      await expect(flixpatrol.getMostHours('Movies', config))
        .rejects.toThrow('Unable to get FlixPatrol most-hours-total page');
    });

    it('should parse most hours total movies from toc-movies section', async () => {
      const mostHoursTotalHtml = `
        <html>
          <body>
            <div id="toc-movies">
              <table class="card-table">
                <tr>
                  <td>
                    <a class="flex gap-2 group items-center" href="/title/movie-1">Movie 1</a>
                  </td>
                </tr>
                <tr>
                  <td>
                    <a class="flex gap-2 group items-center" href="/title/movie-2">Movie 2</a>
                  </td>
                </tr>
              </table>
            </div>
            <div id="toc-tv-shows">
              <table class="card-table">
                <tr>
                  <td>
                    <a class="flex gap-2 group items-center" href="/title/show-1">Show 1</a>
                  </td>
                </tr>
              </table>
            </div>
          </body>
        </html>
      `;
      const detailHtml = `
        <html>
          <body>
            <div class="info-grid">
              <div class="info-grid-header">
                <div class="md:flex items-baseline justify-between">
                  <h1 class="mb-4 text-h1">Test Movie</h1>
                </div>
                <div class="flex flex-wrap">
                  <div class="flex gap-x-1" title="3894"><div>Movie</div><div>|</div></div>
                  <div class="flex gap-x-1" title="Premiere"><div><span>06/18/2024</span></div>|</div>
                </div>
              </div>
            </div>
          </body>
        </html>
      `;

      mockFetch
        .mockResolvedValueOnce(mockHtmlResponse({ status: 200, data: mostHoursTotalHtml }))
        .mockResolvedValue(mockHtmlResponse({ status: 200, data: detailHtml }));

      const config: FlixPatrolMostHours = {
        enabled: true,
        privacy: 'private',
        limit: 10,
        type: 'movies',
        period: 'total',
        language: 'all',
      };

      const result = await flixpatrol.getMostHours('Movies', config);

      expect(Array.isArray(result)).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('/streaming-services/most-hours-total/netflix/'));
    });

    it('should parse most hours total TV shows from toc-tv-shows section', async () => {
      const mostHoursTotalHtml = `
        <html>
          <body>
            <div id="toc-movies">
              <table class="card-table">
                <tr>
                  <td>
                    <a class="flex gap-2 group items-center" href="/title/movie-1">Movie 1</a>
                  </td>
                </tr>
              </table>
            </div>
            <div id="toc-tv-shows">
              <table class="card-table">
                <tr>
                  <td>
                    <a class="flex gap-2 group items-center" href="/title/show-1">Show 1</a>
                  </td>
                </tr>
                <tr>
                  <td>
                    <a class="flex gap-2 group items-center" href="/title/show-2">Show 2</a>
                  </td>
                </tr>
              </table>
            </div>
          </body>
        </html>
      `;
      const detailHtml = `
        <html>
          <body>
            <div class="info-grid">
              <div class="info-grid-header">
                <div class="md:flex items-baseline justify-between">
                  <h1 class="mb-4 text-h1">Test Show</h1>
                </div>
                <div class="flex flex-wrap">
                  <div class="flex gap-x-1" title="3894"><div>TV Show</div><div>|</div></div>
                  <div class="flex gap-x-1" title="Premiere"><div><span>06/18/2024</span></div>|</div>
                </div>
              </div>
            </div>
          </body>
        </html>
      `;

      mockFetch
        .mockResolvedValueOnce(mockHtmlResponse({ status: 200, data: mostHoursTotalHtml }))
        .mockResolvedValue(mockHtmlResponse({ status: 200, data: detailHtml }));

      const config: FlixPatrolMostHours = {
        enabled: true,
        privacy: 'private',
        limit: 10,
        type: 'shows',
        period: 'total',
        language: 'all',
      };

      const result = await flixpatrol.getMostHours('TV Shows', config);

      expect(Array.isArray(result)).toBe(true);
    });

    it('should respect the limit configuration', async () => {
      const mostHoursTotalHtml = `
        <html>
          <body>
            <div id="toc-movies">
              <table class="card-table">
                <tr><td><a class="flex gap-2 group items-center" href="/title/m1">M1</a></td></tr>
                <tr><td><a class="flex gap-2 group items-center" href="/title/m2">M2</a></td></tr>
                <tr><td><a class="flex gap-2 group items-center" href="/title/m3">M3</a></td></tr>
                <tr><td><a class="flex gap-2 group items-center" href="/title/m4">M4</a></td></tr>
                <tr><td><a class="flex gap-2 group items-center" href="/title/m5">M5</a></td></tr>
              </table>
            </div>
          </body>
        </html>
      `;
      const detailHtml = `
        <html>
          <body>
            <div class="info-grid">
              <div class="info-grid-header">
                <div class="md:flex items-baseline justify-between">
                  <h1 class="mb-4 text-h1">Movie</h1>
                </div>
                <div class="flex flex-wrap">
                  <div class="flex gap-x-1" title="3894"><div>Movie</div><div>|</div></div>
                  <div class="flex gap-x-1" title="Premiere"><div><span>06/18/2024</span></div>|</div>
                </div>
              </div>
            </div>
          </body>
        </html>
      `;

      mockFetch
        .mockResolvedValueOnce(mockHtmlResponse({ status: 200, data: mostHoursTotalHtml }))
        .mockResolvedValue(mockHtmlResponse({ status: 200, data: detailHtml }));

      const config: FlixPatrolMostHours = {
        enabled: true,
        privacy: 'private',
        limit: 2,
        type: 'movies',
        period: 'total',
        language: 'all',
      };

      const result = await flixpatrol.getMostHours('Movies', config);

      expect(result.length).toBeLessThanOrEqual(2);
    });

    it('should return empty array when section is empty', async () => {
      const mostHoursTotalHtml = `
        <html>
          <body>
            <div id="toc-movies">
              <table class="card-table">
              </table>
            </div>
            <div id="toc-tv-shows">
              <table class="card-table">
                <tr>
                  <td>
                    <a class="flex gap-2 group items-center" href="/title/show-1">Show 1</a>
                  </td>
                </tr>
              </table>
            </div>
          </body>
        </html>
      `;

      mockFetch
        .mockResolvedValueOnce(mockHtmlResponse({ status: 200, data: mostHoursTotalHtml }));

      const config: FlixPatrolMostHours = {
        enabled: true,
        privacy: 'private',
        limit: 10,
        type: 'movies',
        period: 'total',
        language: 'all',
      };

      const result = await flixpatrol.getMostHours('Movies', config);

      expect(result).toEqual([]);
    });

    it('should use correct URL for first-week period', async () => {
      mockFetch.mockResolvedValue(mockHtmlResponse({ status: 404, data: null }));

      const config: FlixPatrolMostHours = {
        enabled: true,
        privacy: 'private',
        limit: 10,
        type: 'movies',
        period: 'first-week',
        language: 'all',
      };

      await expect(flixpatrol.getMostHours('Movies', config))
        .rejects.toThrow('Unable to get FlixPatrol most-hours-first-week page');
    });

    it('should use correct URL for first-month period', async () => {
      mockFetch.mockResolvedValue(mockHtmlResponse({ status: 404, data: null }));

      const config: FlixPatrolMostHours = {
        enabled: true,
        privacy: 'private',
        limit: 10,
        type: 'movies',
        period: 'first-month',
        language: 'english',
      };

      await expect(flixpatrol.getMostHours('Movies', config))
        .rejects.toThrow('Unable to get FlixPatrol most-hours-first-month page');
    });

    it('should parse language-specific table for first-week with english language', async () => {
      const firstWeekHtml = `
        <html>
          <body>
            <div id="toc-movies">
              <table class="card-table" x-show="isCurrent('all-languages')">
                <tr><td><a class="flex gap-2 group items-center" href="/title/all-1">All 1</a></td></tr>
              </table>
              <table class="card-table" x-show="isCurrent('english')">
                <tr><td><a class="flex gap-2 group items-center" href="/title/eng-1">English 1</a></td></tr>
              </table>
              <table class="card-table" x-show="isCurrent('non-english')">
                <tr><td><a class="flex gap-2 group items-center" href="/title/non-1">Non-English 1</a></td></tr>
              </table>
            </div>
          </body>
        </html>
      `;
      const detailHtml = `
        <html>
          <body>
            <div class="info-grid">
              <div class="info-grid-header">
                <div class="md:flex items-baseline justify-between">
                  <h1 class="mb-4 text-h1">English Movie</h1>
                </div>
                <div class="flex flex-wrap">
                  <div class="flex gap-x-1" title="3894"><div>Movie</div><div>|</div></div>
                  <div class="flex gap-x-1" title="Premiere"><div><span>06/18/2024</span></div>|</div>
                </div>
              </div>
            </div>
          </body>
        </html>
      `;

      mockFetch
        .mockResolvedValueOnce(mockHtmlResponse({ status: 200, data: firstWeekHtml }))
        .mockResolvedValue(mockHtmlResponse({ status: 200, data: detailHtml }));

      const config: FlixPatrolMostHours = {
        enabled: true,
        privacy: 'private',
        limit: 10,
        type: 'movies',
        period: 'first-week',
        language: 'english',
      };

      const result = await flixpatrol.getMostHours('Movies', config);

      expect(Array.isArray(result)).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('/streaming-services/most-hours-first-week/netflix/'));
    });
  });
});
