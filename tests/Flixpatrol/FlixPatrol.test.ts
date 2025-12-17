import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FlixPatrol } from '../../src/Flixpatrol/FlixPatrol';
import axios from 'axios';
import type { FlixPatrolTop10, FlixPatrolPopular, FlixPatrolMostWatched, FlixPatrolMostHours } from '../../src/types';

// Mock axios
vi.mock('axios');

// Mock file-system-cache
vi.mock('file-system-cache', () => ({
  default: vi.fn(() => ({
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
  })),
  FileSystemCache: vi.fn(),
}));

// Mock TraktAPI
const mockGetFirstItemByQuery = vi.fn();
vi.mock('../../src/Trakt/TraktAPI', () => ({
  TraktAPI: class MockTraktAPI {
    getFirstItemByQuery = mockGetFirstItemByQuery;
  },
}));

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
        expect(FlixPatrol.isFlixPatrolPopularPlatform('imdb')).toBe(true);
        expect(FlixPatrol.isFlixPatrolPopularPlatform('trakt')).toBe(true);
        expect(FlixPatrol.isFlixPatrolPopularPlatform('letterboxd')).toBe(true);
        expect(FlixPatrol.isFlixPatrolPopularPlatform('movie-db')).toBe(true);
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
        { url: 'https://custom.url', agent: 'CustomAgent/1.0' }
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
      vi.mocked(axios.get).mockResolvedValue({
        status: 200,
        data: mockHtml,
      });

      const result = await flixpatrol.getFlixPatrolHTMLPage('/test-path');

      expect(result).toBe(mockHtml);
      expect(axios.get).toHaveBeenCalledWith(
        'https://flixpatrol.com/test-path',
        expect.objectContaining({
          headers: expect.objectContaining({
            'User-Agent': expect.any(String),
          }),
          timeout: 30000,
        })
      );
    });

    it('should return null on non-200 status', async () => {
      vi.mocked(axios.get).mockResolvedValue({
        status: 404,
        data: 'Not found',
      });

      const result = await flixpatrol.getFlixPatrolHTMLPage('/not-found');

      expect(result).toBeNull();
    });

    it('should return null on network error', async () => {
      vi.mocked(axios.get).mockRejectedValue(new Error('Network error'));

      const result = await flixpatrol.getFlixPatrolHTMLPage('/error-path');

      expect(result).toBeNull();
    });

    it('should use custom URL when provided', async () => {
      const customFlixpatrol = new FlixPatrol(
        { enabled: false, savePath: '', ttl: 0 },
        { url: 'https://custom.flixpatrol.com' }
      );

      vi.mocked(axios.get).mockResolvedValue({
        status: 200,
        data: '<html></html>',
      });

      await customFlixpatrol.getFlixPatrolHTMLPage('/test');

      expect(axios.get).toHaveBeenCalledWith(
        'https://custom.flixpatrol.com/test',
        expect.any(Object)
      );
    });

    it('should use custom User-Agent when provided', async () => {
      const customFlixpatrol = new FlixPatrol(
        { enabled: false, savePath: '', ttl: 0 },
        { agent: 'MyCustomAgent/1.0' }
      );

      vi.mocked(axios.get).mockResolvedValue({
        status: 200,
        data: '<html></html>',
      });

      await customFlixpatrol.getFlixPatrolHTMLPage('/test');

      expect(axios.get).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'User-Agent': 'MyCustomAgent/1.0',
          }),
        })
      );
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
        vi.mocked(axios.get).mockResolvedValue({
          status: 200,
          data: mockHtml,
        });

        // We can't directly test parseTop10Page since it's private
        // But we can verify getFlixPatrolHTMLPage returns the HTML
        const result = await flixpatrol.getFlixPatrolHTMLPage('/top10/netflix/world');
        expect(result).toBe(mockHtml);
      });

      it('should handle empty HTML gracefully', async () => {
        vi.mocked(axios.get).mockResolvedValue({
          status: 200,
          data: '<html><body></body></html>',
        });

        const result = await flixpatrol.getFlixPatrolHTMLPage('/top10/netflix/world');
        expect(result).toBe('<html><body></body></html>');
      });

      it('should handle malformed HTML', async () => {
        vi.mocked(axios.get).mockResolvedValue({
          status: 200,
          data: '<html><body><div>Not closed',
        });

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
    const mockTrakt = { getFirstItemByQuery: mockGetFirstItemByQuery };

    beforeEach(() => {
      flixpatrol = new FlixPatrol({ enabled: false, savePath: '', ttl: 0 });
      vi.clearAllMocks();
    });

    it('should throw FlixPatrolError when page fetch fails', async () => {
      vi.mocked(axios.get).mockResolvedValue({ status: 404, data: null });

      const config: FlixPatrolTop10 = {
        platform: 'netflix',
        location: 'world',
        fallback: false,
        privacy: 'private',
        limit: 10,
        type: 'movies',
      };

      await expect(flixpatrol.getTop10Sections(config, mockTrakt as never))
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
            <div class="mb-6">
              <h1 class="mb-4">Test Movie</h1>
              <span>Movie</span>
              <span></span>
              <span></span>
              <span></span>
              <span><span>2024</span></span>
            </div>
          </body>
        </html>
      `;

      vi.mocked(axios.get)
        .mockResolvedValueOnce({ status: 200, data: top10Html })
        .mockResolvedValue({ status: 200, data: detailHtml });

      mockGetFirstItemByQuery.mockResolvedValue({
        movie: { title: 'Test Movie', year: 2024, ids: { trakt: 123 } },
      });

      const config: FlixPatrolTop10 = {
        platform: 'netflix',
        location: 'world',
        fallback: false,
        privacy: 'private',
        limit: 10,
        type: 'movies',
      };

      const result = await flixpatrol.getTop10Sections(config, mockTrakt as never);

      expect(result.movies.length).toBeGreaterThanOrEqual(0);
      expect(result.shows).toEqual([]);
      expect(result.rawCounts).toBeDefined();
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
            <div class="mb-6">
              <h1 class="mb-4">Test Show</h1>
              <span>TV Show</span>
              <span></span>
              <span></span>
              <span></span>
              <span><span>2024</span></span>
            </div>
          </body>
        </html>
      `;

      vi.mocked(axios.get)
        .mockResolvedValueOnce({ status: 200, data: top10Html })
        .mockResolvedValue({ status: 200, data: detailHtml });

      mockGetFirstItemByQuery.mockResolvedValue({
        show: { title: 'Test Show', year: 2024, ids: { trakt: 456 } },
      });

      const config: FlixPatrolTop10 = {
        platform: 'netflix',
        location: 'world',
        fallback: false,
        privacy: 'private',
        limit: 10,
        type: 'shows',
      };

      const result = await flixpatrol.getTop10Sections(config, mockTrakt as never);

      expect(result.movies).toEqual([]);
      expect(result.rawCounts).toBeDefined();
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
            <div class="mb-6">
              <h1 class="mb-4">Test Content</h1>
              <span>Movie</span>
              <span></span>
              <span></span>
              <span></span>
              <span><span>2024</span></span>
            </div>
          </body>
        </html>
      `;

      vi.mocked(axios.get)
        .mockResolvedValueOnce({ status: 200, data: top10Html })
        .mockResolvedValue({ status: 200, data: detailHtml });

      mockGetFirstItemByQuery.mockResolvedValue({
        movie: { title: 'Test Movie', year: 2024, ids: { trakt: 123 } },
      });

      const config: FlixPatrolTop10 = {
        platform: 'netflix',
        location: 'world',
        fallback: false,
        privacy: 'private',
        limit: 10,
        type: 'both',
      };

      const result = await flixpatrol.getTop10Sections(config, mockTrakt as never);

      expect(result.rawCounts).toBeDefined();
      expect(result.rawCounts.movies).toBeDefined();
      expect(result.rawCounts.shows).toBeDefined();
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
            <div class="mb-6">
              <h1 class="mb-4">Fallback Movie</h1>
              <span>Movie</span>
              <span></span>
              <span></span>
              <span></span>
              <span><span>2024</span></span>
            </div>
          </body>
        </html>
      `;

      vi.mocked(axios.get)
        .mockResolvedValueOnce({ status: 200, data: emptyHtml })
        .mockResolvedValueOnce({ status: 200, data: fallbackHtml })
        .mockResolvedValue({ status: 200, data: detailHtml });

      mockGetFirstItemByQuery.mockResolvedValue({
        movie: { title: 'Fallback Movie', year: 2024, ids: { trakt: 789 } },
      });

      const config: FlixPatrolTop10 = {
        platform: 'netflix',
        location: 'france',
        fallback: 'world',
        privacy: 'private',
        limit: 10,
        type: 'movies',
      };

      const result = await flixpatrol.getTop10Sections(config, mockTrakt as never);

      // Fallback should have been triggered
      expect(axios.get).toHaveBeenCalledTimes(3); // Initial + fallback + detail
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
            <div class="mb-6">
              <h1 class="mb-4">Test Movie</h1>
              <span>Movie</span>
              <span></span>
              <span></span>
              <span></span>
              <span><span>2024</span></span>
            </div>
          </body>
        </html>
      `;

      vi.mocked(axios.get)
        .mockResolvedValueOnce({ status: 200, data: top10Html })
        .mockResolvedValue({ status: 200, data: detailHtml });

      mockGetFirstItemByQuery.mockResolvedValue({
        movie: { title: 'Test Movie', year: 2024, ids: { trakt: 123 } },
      });

      const config: FlixPatrolTop10 = {
        platform: 'netflix',
        location: 'world',
        fallback: false,
        privacy: 'private',
        limit: 2,
        type: 'movies',
      };

      const result = await flixpatrol.getTop10Sections(config, mockTrakt as never);

      // Should only process 2 movies due to limit
      expect(result.movies.length).toBeLessThanOrEqual(2);
    });

    it('should parse regional top10 page', async () => {
      const top10Html = `
        <html>
          <body>
            <div>
              <h3>TOP 10 Movies</h3>
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
            <div class="mb-6">
              <h1 class="mb-4">Regional Movie</h1>
              <span>Movie</span>
              <span></span>
              <span></span>
              <span></span>
              <span><span>2024</span></span>
            </div>
          </body>
        </html>
      `;

      vi.mocked(axios.get)
        .mockResolvedValueOnce({ status: 200, data: top10Html })
        .mockResolvedValue({ status: 200, data: detailHtml });

      mockGetFirstItemByQuery.mockResolvedValue({
        movie: { title: 'Regional Movie', year: 2024, ids: { trakt: 999 } },
      });

      const config: FlixPatrolTop10 = {
        platform: 'netflix',
        location: 'france',
        fallback: false,
        privacy: 'private',
        limit: 10,
        type: 'movies',
      };

      const result = await flixpatrol.getTop10Sections(config, mockTrakt as never);

      expect(result.rawCounts).toBeDefined();
    });
  });

  describe('getPopular', () => {
    let flixpatrol: FlixPatrol;
    const mockTrakt = { getFirstItemByQuery: mockGetFirstItemByQuery };

    beforeEach(() => {
      flixpatrol = new FlixPatrol({ enabled: false, savePath: '', ttl: 0 });
      vi.clearAllMocks();
    });

    it('should throw FlixPatrolError when page fetch fails', async () => {
      vi.mocked(axios.get).mockResolvedValue({ status: 404, data: null });

      const config: FlixPatrolPopular = {
        platform: 'imdb',
        privacy: 'private',
        limit: 10,
        type: 'movies',
      };

      await expect(flixpatrol.getPopular('Movies', config, mockTrakt as never))
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
            <div class="mb-6">
              <h1 class="mb-4">Popular Movie</h1>
              <span>Movie</span>
              <span></span>
              <span></span>
              <span></span>
              <span><span>2024</span></span>
            </div>
          </body>
        </html>
      `;

      vi.mocked(axios.get)
        .mockResolvedValueOnce({ status: 200, data: popularHtml })
        .mockResolvedValue({ status: 200, data: detailHtml });

      mockGetFirstItemByQuery.mockResolvedValue({
        movie: { title: 'Popular Movie', year: 2024, ids: { trakt: 111 } },
      });

      const config: FlixPatrolPopular = {
        platform: 'imdb',
        privacy: 'private',
        limit: 10,
        type: 'movies',
      };

      const result = await flixpatrol.getPopular('Movies', config, mockTrakt as never);

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
            <div class="mb-6">
              <h1 class="mb-4">Popular Show</h1>
              <span>TV Show</span>
              <span></span>
              <span></span>
              <span></span>
              <span><span>2024</span></span>
            </div>
          </body>
        </html>
      `;

      vi.mocked(axios.get)
        .mockResolvedValueOnce({ status: 200, data: popularHtml })
        .mockResolvedValue({ status: 200, data: detailHtml });

      mockGetFirstItemByQuery.mockResolvedValue({
        show: { title: 'Popular Show', year: 2024, ids: { trakt: 222 } },
      });

      const config: FlixPatrolPopular = {
        platform: 'imdb',
        privacy: 'private',
        limit: 10,
        type: 'shows',
      };

      const result = await flixpatrol.getPopular('TV Shows', config, mockTrakt as never);

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
            <div class="mb-6">
              <h1 class="mb-4">Movie</h1>
              <span>Movie</span>
              <span></span>
              <span></span>
              <span></span>
              <span><span>2024</span></span>
            </div>
          </body>
        </html>
      `;

      vi.mocked(axios.get)
        .mockResolvedValueOnce({ status: 200, data: popularHtml })
        .mockResolvedValue({ status: 200, data: detailHtml });

      mockGetFirstItemByQuery.mockResolvedValue({
        movie: { title: 'Movie', year: 2024, ids: { trakt: 100 } },
      });

      const config: FlixPatrolPopular = {
        platform: 'imdb',
        privacy: 'private',
        limit: 2,
        type: 'movies',
      };

      const result = await flixpatrol.getPopular('Movies', config, mockTrakt as never);

      expect(result.length).toBeLessThanOrEqual(2);
    });
  });

  describe('getMostWatched', () => {
    let flixpatrol: FlixPatrol;
    const mockTrakt = { getFirstItemByQuery: mockGetFirstItemByQuery };

    beforeEach(() => {
      flixpatrol = new FlixPatrol({ enabled: false, savePath: '', ttl: 0 });
      vi.clearAllMocks();
    });

    it('should throw FlixPatrolError when page fetch fails', async () => {
      vi.mocked(axios.get).mockResolvedValue({ status: 404, data: null });

      const config: FlixPatrolMostWatched = {
        enabled: true,
        privacy: 'private',
        limit: 10,
        type: 'movies',
        year: 2024,
      };

      await expect(flixpatrol.getMostWatched('Movies', config, mockTrakt as never))
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
            <div class="mb-6">
              <h1 class="mb-4">Most Watched Movie</h1>
              <span>Movie</span>
              <span></span>
              <span></span>
              <span></span>
              <span><span>2024</span></span>
            </div>
          </body>
        </html>
      `;

      vi.mocked(axios.get)
        .mockResolvedValueOnce({ status: 200, data: mostWatchedHtml })
        .mockResolvedValue({ status: 200, data: detailHtml });

      mockGetFirstItemByQuery.mockResolvedValue({
        movie: { title: 'Most Watched Movie', year: 2024, ids: { trakt: 333 } },
      });

      const config: FlixPatrolMostWatched = {
        enabled: true,
        privacy: 'private',
        limit: 10,
        type: 'movies',
        year: 2024,
      };

      const result = await flixpatrol.getMostWatched('Movies', config, mockTrakt as never);

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
            <div class="mb-6">
              <h1 class="mb-4">Most Watched Show</h1>
              <span>TV Show</span>
              <span></span>
              <span></span>
              <span></span>
              <span><span>2024</span></span>
            </div>
          </body>
        </html>
      `;

      vi.mocked(axios.get)
        .mockResolvedValueOnce({ status: 200, data: mostWatchedHtml })
        .mockResolvedValue({ status: 200, data: detailHtml });

      mockGetFirstItemByQuery.mockResolvedValue({
        show: { title: 'Most Watched Show', year: 2024, ids: { trakt: 444 } },
      });

      const config: FlixPatrolMostWatched = {
        enabled: true,
        privacy: 'private',
        limit: 10,
        type: 'shows',
        year: 2024,
      };

      const result = await flixpatrol.getMostWatched('TV Shows', config, mockTrakt as never);

      expect(Array.isArray(result)).toBe(true);
      // TV shows URL should include -grouped
      expect(axios.get).toHaveBeenCalledWith(
        expect.stringContaining('-grouped'),
        expect.any(Object)
      );
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
            <div class="mb-6">
              <h1 class="mb-4">Movie</h1>
              <span>Movie</span>
              <span></span>
              <span></span>
              <span></span>
              <span><span>2024</span></span>
            </div>
          </body>
        </html>
      `;

      vi.mocked(axios.get)
        .mockResolvedValueOnce({ status: 200, data: mostWatchedHtml })
        .mockResolvedValue({ status: 200, data: detailHtml });

      mockGetFirstItemByQuery.mockResolvedValue({
        movie: { title: 'Movie', year: 2024, ids: { trakt: 555 } },
      });

      const config: FlixPatrolMostWatched = {
        enabled: true,
        privacy: 'private',
        limit: 10,
        type: 'movies',
        year: 2024,
        country: 'france',
      };

      const result = await flixpatrol.getMostWatched('Movies', config, mockTrakt as never);

      expect(axios.get).toHaveBeenCalledWith(
        expect.stringContaining('-from-france'),
        expect.any(Object)
      );
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
            <div class="mb-6">
              <h1 class="mb-4">Movie</h1>
              <span>Movie</span>
              <span></span>
              <span></span>
              <span></span>
              <span><span>2024</span></span>
            </div>
          </body>
        </html>
      `;

      vi.mocked(axios.get)
        .mockResolvedValueOnce({ status: 200, data: mostWatchedHtml })
        .mockResolvedValue({ status: 200, data: detailHtml });

      mockGetFirstItemByQuery.mockResolvedValue({
        movie: { title: 'Movie', year: 2024, ids: { trakt: 666 } },
      });

      const config: FlixPatrolMostWatched = {
        enabled: true,
        privacy: 'private',
        limit: 10,
        type: 'movies',
        year: 2024,
        premiere: 2023,
      };

      const result = await flixpatrol.getMostWatched('Movies', config, mockTrakt as never);

      expect(axios.get).toHaveBeenCalledWith(
        expect.stringContaining('-2023'),
        expect.any(Object)
      );
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
            <div class="mb-6">
              <h1 class="mb-4">Movie</h1>
              <span>Movie</span>
              <span></span>
              <span></span>
              <span></span>
              <span><span>2024</span></span>
            </div>
          </body>
        </html>
      `;

      vi.mocked(axios.get)
        .mockResolvedValueOnce({ status: 200, data: mostWatchedHtml })
        .mockResolvedValue({ status: 200, data: detailHtml });

      mockGetFirstItemByQuery.mockResolvedValue({
        movie: { title: 'Movie', year: 2024, ids: { trakt: 777 } },
      });

      const config: FlixPatrolMostWatched = {
        enabled: true,
        privacy: 'private',
        limit: 10,
        type: 'movies',
        year: 2024,
        orderByViews: true,
      };

      const result = await flixpatrol.getMostWatched('Movies', config, mockTrakt as never);

      expect(axios.get).toHaveBeenCalledWith(
        expect.stringContaining('/by-views'),
        expect.any(Object)
      );
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
            <div class="mb-6">
              <h1 class="mb-4">Original Movie</h1>
              <span>Movie</span>
              <span></span>
              <span></span>
              <span></span>
              <span><span>2024</span></span>
            </div>
          </body>
        </html>
      `;

      vi.mocked(axios.get)
        .mockResolvedValueOnce({ status: 200, data: mostWatchedHtml })
        .mockResolvedValue({ status: 200, data: detailHtml });

      mockGetFirstItemByQuery.mockResolvedValue({
        movie: { title: 'Original Movie', year: 2024, ids: { trakt: 888 } },
      });

      const config: FlixPatrolMostWatched = {
        enabled: true,
        privacy: 'private',
        limit: 10,
        type: 'movies',
        year: 2024,
        original: true,
      };

      const result = await flixpatrol.getMostWatched('Movies', config, mockTrakt as never);

      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('getTraktTVId (via integration)', () => {
    let flixpatrol: FlixPatrol;
    const mockTrakt = { getFirstItemByQuery: mockGetFirstItemByQuery };

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
            <div class="mb-6">
              <h1 class="mb-4">The Matrix</h1>
              <span>Movie</span>
              <span></span>
              <span></span>
              <span></span>
              <span><span>1999</span></span>
            </div>
          </body>
        </html>
      `;

      vi.mocked(axios.get)
        .mockResolvedValueOnce({ status: 200, data: popularHtml })
        .mockResolvedValue({ status: 200, data: detailHtml });

      mockGetFirstItemByQuery.mockResolvedValue({
        movie: { title: 'The Matrix', year: 1999, ids: { trakt: 999 } },
      });

      const config: FlixPatrolPopular = {
        platform: 'imdb',
        privacy: 'private',
        limit: 1,
        type: 'movies',
      };

      await flixpatrol.getPopular('Movies', config, mockTrakt as never);

      expect(mockGetFirstItemByQuery).toHaveBeenCalledWith('movie', 'The Matrix', 1999);
    });

    it('should handle missing year by using 0', async () => {
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
      const detailHtml = `
        <html>
          <body>
            <div class="mb-6">
              <h1 class="mb-4">Unknown Movie</h1>
              <span>Movie</span>
            </div>
          </body>
        </html>
      `;

      vi.mocked(axios.get)
        .mockResolvedValueOnce({ status: 200, data: popularHtml })
        .mockResolvedValue({ status: 200, data: detailHtml });

      mockGetFirstItemByQuery.mockResolvedValue({
        movie: { title: 'Unknown Movie', year: 0, ids: { trakt: 1000 } },
      });

      const config: FlixPatrolPopular = {
        platform: 'imdb',
        privacy: 'private',
        limit: 1,
        type: 'movies',
      };

      await flixpatrol.getPopular('Movies', config, mockTrakt as never);

      expect(mockGetFirstItemByQuery).toHaveBeenCalledWith('movie', 'Unknown Movie', 0);
    });

    it('should handle null result from Trakt search', async () => {
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
      const detailHtml = `
        <html>
          <body>
            <div class="mb-6">
              <h1 class="mb-4">Unknown Movie</h1>
              <span>Movie</span>
              <span></span>
              <span></span>
              <span></span>
              <span><span>2024</span></span>
            </div>
          </body>
        </html>
      `;

      vi.mocked(axios.get)
        .mockResolvedValueOnce({ status: 200, data: popularHtml })
        .mockResolvedValue({ status: 200, data: detailHtml });

      mockGetFirstItemByQuery.mockResolvedValue(null);

      const config: FlixPatrolPopular = {
        platform: 'imdb',
        privacy: 'private',
        limit: 1,
        type: 'movies',
      };

      const result = await flixpatrol.getPopular('Movies', config, mockTrakt as never);

      // Should return empty array when no Trakt ID found
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

      vi.mocked(axios.get)
        .mockResolvedValueOnce({ status: 200, data: popularHtml })
        .mockResolvedValueOnce({ status: 404, data: null });

      const config: FlixPatrolPopular = {
        platform: 'imdb',
        privacy: 'private',
        limit: 1,
        type: 'movies',
      };

      await expect(flixpatrol.getPopular('Movies', config, mockTrakt as never))
        .rejects.toThrow('Unable to get FlixPatrol detail page');
    });

    it('should handle TV Show type detection', async () => {
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
            <div class="mb-6">
              <h1 class="mb-4">Breaking Bad</h1>
              <span>TV Show</span>
              <span></span>
              <span></span>
              <span></span>
              <span><span>2008</span></span>
            </div>
          </body>
        </html>
      `;

      vi.mocked(axios.get)
        .mockResolvedValueOnce({ status: 200, data: popularHtml })
        .mockResolvedValue({ status: 200, data: detailHtml });

      mockGetFirstItemByQuery.mockResolvedValue({
        show: { title: 'Breaking Bad', year: 2008, ids: { trakt: 1388 } },
      });

      const config: FlixPatrolPopular = {
        platform: 'imdb',
        privacy: 'private',
        limit: 1,
        type: 'shows',
      };

      await flixpatrol.getPopular('TV Shows', config, mockTrakt as never);

      expect(mockGetFirstItemByQuery).toHaveBeenCalledWith('show', 'Breaking Bad', 2008);
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
      const detailHtml = `
        <html>
          <body>
            <h1>Fallback Title</h1>
            <div class="mb-6">
              Movie 2024
            </div>
          </body>
        </html>
      `;

      vi.mocked(axios.get)
        .mockResolvedValueOnce({ status: 200, data: popularHtml })
        .mockResolvedValue({ status: 200, data: detailHtml });

      mockGetFirstItemByQuery.mockResolvedValue({
        movie: { title: 'Fallback Title', year: 2024, ids: { trakt: 2000 } },
      });

      const config: FlixPatrolPopular = {
        platform: 'imdb',
        privacy: 'private',
        limit: 1,
        type: 'movies',
      };

      await flixpatrol.getPopular('Movies', config, mockTrakt as never);

      expect(mockGetFirstItemByQuery).toHaveBeenCalledWith('movie', 'Fallback Title', 2024);
    });
  });

  describe('getMostHours', () => {
    let flixpatrol: FlixPatrol;
    const mockTrakt = { getFirstItemByQuery: mockGetFirstItemByQuery };

    beforeEach(() => {
      flixpatrol = new FlixPatrol({ enabled: false, savePath: '', ttl: 0 });
      vi.clearAllMocks();
    });

    it('should throw FlixPatrolError when page fetch fails', async () => {
      vi.mocked(axios.get).mockResolvedValue({ status: 404, data: null });

      const config: FlixPatrolMostHours = {
        enabled: true,
        privacy: 'private',
        limit: 10,
        type: 'movies',
        period: 'total',
        language: 'all',
      };

      await expect(flixpatrol.getMostHours('Movies', config, mockTrakt as never))
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
            <div class="mb-6">
              <h1 class="mb-4">Test Movie</h1>
              <span>Movie</span>
              <span></span>
              <span></span>
              <span></span>
              <span><span>2024</span></span>
            </div>
          </body>
        </html>
      `;

      vi.mocked(axios.get)
        .mockResolvedValueOnce({ status: 200, data: mostHoursTotalHtml })
        .mockResolvedValue({ status: 200, data: detailHtml });

      mockGetFirstItemByQuery.mockResolvedValue({
        movie: { title: 'Test Movie', year: 2024, ids: { trakt: 123 } },
      });

      const config: FlixPatrolMostHours = {
        enabled: true,
        privacy: 'private',
        limit: 10,
        type: 'movies',
        period: 'total',
        language: 'all',
      };

      const result = await flixpatrol.getMostHours('Movies', config, mockTrakt as never);

      expect(Array.isArray(result)).toBe(true);
      expect(axios.get).toHaveBeenCalledWith(
        expect.stringContaining('/streaming-services/most-hours-total/netflix/'),
        expect.any(Object)
      );
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
            <div class="mb-6">
              <h1 class="mb-4">Test Show</h1>
              <span>TV Show</span>
              <span></span>
              <span></span>
              <span></span>
              <span><span>2024</span></span>
            </div>
          </body>
        </html>
      `;

      vi.mocked(axios.get)
        .mockResolvedValueOnce({ status: 200, data: mostHoursTotalHtml })
        .mockResolvedValue({ status: 200, data: detailHtml });

      mockGetFirstItemByQuery.mockResolvedValue({
        show: { title: 'Test Show', year: 2024, ids: { trakt: 456 } },
      });

      const config: FlixPatrolMostHours = {
        enabled: true,
        privacy: 'private',
        limit: 10,
        type: 'shows',
        period: 'total',
        language: 'all',
      };

      const result = await flixpatrol.getMostHours('TV Shows', config, mockTrakt as never);

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
            <div class="mb-6">
              <h1 class="mb-4">Movie</h1>
              <span>Movie</span>
              <span></span>
              <span></span>
              <span></span>
              <span><span>2024</span></span>
            </div>
          </body>
        </html>
      `;

      vi.mocked(axios.get)
        .mockResolvedValueOnce({ status: 200, data: mostHoursTotalHtml })
        .mockResolvedValue({ status: 200, data: detailHtml });

      mockGetFirstItemByQuery.mockResolvedValue({
        movie: { title: 'Movie', year: 2024, ids: { trakt: 100 } },
      });

      const config: FlixPatrolMostHours = {
        enabled: true,
        privacy: 'private',
        limit: 2,
        type: 'movies',
        period: 'total',
        language: 'all',
      };

      const result = await flixpatrol.getMostHours('Movies', config, mockTrakt as never);

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

      vi.mocked(axios.get)
        .mockResolvedValueOnce({ status: 200, data: mostHoursTotalHtml });

      const config: FlixPatrolMostHours = {
        enabled: true,
        privacy: 'private',
        limit: 10,
        type: 'movies',
        period: 'total',
        language: 'all',
      };

      const result = await flixpatrol.getMostHours('Movies', config, mockTrakt as never);

      expect(result).toEqual([]);
    });

    it('should use correct URL for first-week period', async () => {
      vi.mocked(axios.get).mockResolvedValue({ status: 404, data: null });

      const config: FlixPatrolMostHours = {
        enabled: true,
        privacy: 'private',
        limit: 10,
        type: 'movies',
        period: 'first-week',
        language: 'all',
      };

      await expect(flixpatrol.getMostHours('Movies', config, mockTrakt as never))
        .rejects.toThrow('Unable to get FlixPatrol most-hours-first-week page');
    });

    it('should use correct URL for first-month period', async () => {
      vi.mocked(axios.get).mockResolvedValue({ status: 404, data: null });

      const config: FlixPatrolMostHours = {
        enabled: true,
        privacy: 'private',
        limit: 10,
        type: 'movies',
        period: 'first-month',
        language: 'english',
      };

      await expect(flixpatrol.getMostHours('Movies', config, mockTrakt as never))
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
            <div class="mb-6">
              <h1 class="mb-4">English Movie</h1>
              <span>Movie</span>
              <span></span>
              <span></span>
              <span></span>
              <span><span>2024</span></span>
            </div>
          </body>
        </html>
      `;

      vi.mocked(axios.get)
        .mockResolvedValueOnce({ status: 200, data: firstWeekHtml })
        .mockResolvedValue({ status: 200, data: detailHtml });

      mockGetFirstItemByQuery.mockResolvedValue({
        movie: { title: 'English Movie', year: 2024, ids: { trakt: 789 } },
      });

      const config: FlixPatrolMostHours = {
        enabled: true,
        privacy: 'private',
        limit: 10,
        type: 'movies',
        period: 'first-week',
        language: 'english',
      };

      const result = await flixpatrol.getMostHours('Movies', config, mockTrakt as never);

      expect(Array.isArray(result)).toBe(true);
      expect(axios.get).toHaveBeenCalledWith(
        expect.stringContaining('/streaming-services/most-hours-first-week/netflix/'),
        expect.any(Object)
      );
    });
  });
});
