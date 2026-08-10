import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import {
  parseDetailPage,
  parseDetailTitle,
  parseDetailYear,
  parseMostHoursPage,
  parseMostWatchedPage,
  parsePopularPage,
  parseTop10KidsPage,
  parseTop10Page,
  toCanonicalTitlePath,
} from '../../src/Flixpatrol/parse';

// These tests take HTML in and assert on plain data out: no HTTP mock, no cache,
// no config. That is the whole point of the parsing module living on its own —
// the XPath chains are the part of the scraper that silently rots when FlixPatrol
// changes its markup, so they must be cheap to pin down against small fixtures.

// The site-wide marketing blurb that lives in `div.mb-6` on every detail page. It ends
// in a hardcoded "2021", which a text-scanning year fallback would happily pick up and
// stamp onto every single title.
const MARKETING_BLURB_HTML = '<div class="mb-6">FlixPatrol tracks the most popular '
  + 'TV shows in 2021 across all streaming platforms.</div>';

const detailHeader = (inner: string) => `
  <html>
    <body>
      ${MARKETING_BLURB_HTML}
      <div class="info-grid">
        <div class="info-grid-header">${inner}</div>
      </div>
      ${MARKETING_BLURB_HTML}
    </body>
  </html>
`;

const premiereBlock = (date: string) => `
  <div class="flex flex-wrap">
    <div class="flex gap-x-1" title="3894"><div>Movie</div><div>|</div></div>
    <div class="flex gap-x-1" title="Premiere"><div><span>${date}</span></div>|</div>
  </div>
`;

describe('FlixPatrol parsing', () => {
  describe('parseTop10Page', () => {
    it('extracts the world section from the h2/span markup', () => {
      const html = `
        <html><body>
          <div>
            <div><h2><span>TOP Movies</span></h2></div>
            <div>
              <a class="hover:underline" href="/title/inception">Inception</a>
              <a class="hover:underline" href="/title/fight-club">Fight Club</a>
            </div>
          </div>
        </body></html>
      `;

      expect(parseTop10Page('Movies', 'world', html)).toEqual(['/title/inception', '/title/fight-club']);
    });

    it('keeps the world and TV Shows sections apart', () => {
      const html = `
        <html><body>
          <div>
            <div><h2><span>TOP Movies</span></h2></div>
            <div><a class="hover:underline" href="/title/movie-1">Movie 1</a></div>
          </div>
          <div>
            <div><h2><span>TOP TV Shows</span></h2></div>
            <div><a class="hover:underline" href="/title/show-1">Show 1</a></div>
          </div>
        </body></html>
      `;

      expect(parseTop10Page('TV Shows', 'world', html)).toEqual(['/title/show-1']);
    });

    it('extracts a regional section through the strict h3 expression', () => {
      const html = `
        <html><body>
          <div>
            <div><h3>TOP 10 Movies</h3></div>
            <div><a class="hover:underline" href="/title/regional-1">Regional 1</a></div>
          </div>
        </body></html>
      `;

      expect(parseTop10Page('Movies', 'france', html)).toEqual(['/title/regional-1']);
    });

    it('falls back to the tolerant headline match when the h3 text is not exact', () => {
      // The strict expression compares the whole h3 text, so any decoration around
      // the headline kills it and the second expression has to catch the section.
      const html = `
        <html><body>
          <div>
            <div><h3>TOP 10 Movies on Netflix</h3></div>
            <div><a class="hover:underline" href="/title/tolerant-1">Tolerant 1</a></div>
          </div>
        </body></html>
      `;

      expect(parseTop10Page('Movies', 'france', html)).toEqual(['/title/tolerant-1']);
    });

    it('returns nothing rather than borrowing tables when no headline matches at all', () => {
      // There used to be a third, untyped rung taking "the first two tables on the
      // page" whatever they held. On a market publishing only a Movies chart it
      // answered the TV Shows question with the movie rows, and the shows list was
      // filled with films that no downstream check could reject. No data is the
      // correct answer here, so the caller can leave the existing list alone.
      const html = `
        <html><body>
          <table><tr><td><a class="hover:underline" href="/title/table-1">T1</a></td></tr></table>
          <table><tr><td><a class="hover:underline" href="/title/table-2">T2</a></td></tr></table>
          <table><tr><td><a class="hover:underline" href="/title/table-3">T3</a></td></tr></table>
        </body></html>
      `;

      expect(parseTop10Page('Movies', 'france', html)).toEqual([]);
    });

    it('never answers one media type with the other type chart', () => {
      // The `go3/latvia` shape, reduced to a fixture: a page publishing a Movies
      // chart and no TV Shows heading at all.
      const html = `
        <html><body>
          <div>
            <div><h3>TOP 10 Movies</h3></div>
            <div>
              <a class="hover:underline" href="/title/movie-1">Movie 1</a>
              <a class="hover:underline" href="/title/movie-2">Movie 2</a>
            </div>
          </div>
        </body></html>
      `;

      expect(parseTop10Page('Movies', 'latvia', html)).toEqual(['/title/movie-1', '/title/movie-2']);
      expect(parseTop10Page('TV Shows', 'latvia', html)).toEqual([]);
    });

    it('returns an empty array when the page holds nothing usable', () => {
      expect(parseTop10Page('Movies', 'france', '<html><body></body></html>')).toEqual([]);
      expect(parseTop10Page('Movies', 'world', '<html><body></body></html>')).toEqual([]);
    });
  });

  describe('parseTop10KidsPage', () => {
    it('extracts the kids movies table', () => {
      const html = `
        <html><body>
          <div><h3>TOP 10 Kids Movies</h3></div>
          <table class="card-table">
            <tr><td><a class="hover:underline" href="/title/kids-1">Kids 1</a></td></tr>
            <tr><td><a class="hover:underline" href="/title/kids-2">Kids 2</a></td></tr>
          </table>
        </body></html>
      `;

      expect(parseTop10KidsPage('Movies', html)).toEqual(['/title/kids-1', '/title/kids-2']);
    });

    it('extracts the kids TV shows table', () => {
      const html = `
        <html><body>
          <div><h3>TOP 10 Kids TV Shows</h3></div>
          <table class="card-table">
            <tr><td><a class="hover:underline" href="/title/kids-show-1">Kids Show 1</a></td></tr>
          </table>
        </body></html>
      `;

      expect(parseTop10KidsPage('TV Shows', html)).toEqual(['/title/kids-show-1']);
    });

    it('falls back to the tolerant headline match', () => {
      const html = `
        <html><body>
          <div><h3>TOP 10 Kids Movies in France</h3></div>
          <table class="card-table">
            <tr><td><a class="hover:underline" href="/title/kids-tolerant">Kids</a></td></tr>
          </table>
        </body></html>
      `;

      expect(parseTop10KidsPage('Movies', html)).toEqual(['/title/kids-tolerant']);
    });

    it('never picks up the ordinary top10 table', () => {
      const html = `
        <html><body>
          <div><h3>TOP 10 Movies</h3></div>
          <table class="card-table">
            <tr><td><a class="hover:underline" href="/title/adult-1">Adult 1</a></td></tr>
          </table>
        </body></html>
      `;

      expect(parseTop10KidsPage('Movies', html)).toEqual([]);
    });
  });

  describe('parsePopularPage', () => {
    it('extracts every card-table row', () => {
      const html = `
        <html><body>
          <table class="card-table">
            <tr><td><a class="flex gap-2 group items-center" href="/title/p1">P1</a></td></tr>
            <tr><td><a class="flex gap-2 group items-center" href="/title/p2">P2</a></td></tr>
          </table>
        </body></html>
      `;

      expect(parsePopularPage(html)).toEqual(['/title/p1', '/title/p2']);
    });

    it('returns an empty array on an empty page', () => {
      expect(parsePopularPage('<html><body></body></html>')).toEqual([]);
    });
  });

  describe('parseMostWatchedPage', () => {
    const html = `
      <html><body>
        <table class="card-table">
          <tr><td><a class="flex gap-2 group items-center" href="/title/original"><svg></svg>Original</a></td></tr>
          <tr><td><a class="flex gap-2 group items-center" href="/title/licensed">Licensed</a></td></tr>
        </table>
      </body></html>
    `;

    it('returns every row when originals are not filtered', () => {
      expect(parseMostWatchedPage(html, false)).toEqual(['/title/original', '/title/licensed']);
    });

    it('keeps only the rows carrying the originals badge', () => {
      expect(parseMostWatchedPage(html, true)).toEqual(['/title/original']);
    });
  });

  describe('parseMostHoursPage', () => {
    const tabbedHtml = `
      <html><body>
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
        <div id="toc-tv-shows">
          <table class="card-table" x-show="isCurrent('english')">
            <tr><td><a class="flex gap-2 group items-center" href="/title/eng-show-1">English Show 1</a></td></tr>
          </table>
        </div>
      </body></html>
    `;

    it('picks the table of the requested language tab', () => {
      expect(parseMostHoursPage('Movies', 'english', tabbedHtml)).toEqual(['/title/eng-1']);
      expect(parseMostHoursPage('Movies', 'non-english', tabbedHtml)).toEqual(['/title/non-1']);
      expect(parseMostHoursPage('Movies', 'all', tabbedHtml)).toEqual(['/title/all-1']);
    });

    it('stays inside the section of the requested media type', () => {
      expect(parseMostHoursPage('TV Shows', 'english', tabbedHtml)).toEqual(['/title/eng-show-1']);
    });

    it('falls back to the plain card-table when the period has no language tabs', () => {
      // The `total` period publishes a single table with no x-show attribute.
      const totalHtml = `
        <html><body>
          <div id="toc-movies">
            <table class="card-table">
              <tr><td><a class="flex gap-2 group items-center" href="/title/total-1">Total 1</a></td></tr>
            </table>
          </div>
        </body></html>
      `;

      expect(parseMostHoursPage('Movies', 'english', totalHtml)).toEqual(['/title/total-1']);
    });

    it('returns an empty array when the section is missing', () => {
      expect(parseMostHoursPage('Movies', 'all', '<html><body></body></html>')).toEqual([]);
    });
  });

  describe('toCanonicalTitlePath', () => {
    // The bug this exists for: several listings do NOT link at the title page.
    // Most-watched links at `/title/<slug>/hours/` and YouTube Popular at
    // `/title/<slug>/trailers/#toc-...`, and those sub-pages print the section name
    // inside their own `h1` — "KPop Demon Hunters Hours", "Primetime Trailers".
    // The href is the only safe place to repair that: see the note in parse.ts on
    // why trimming the suffix off the title would mutilate "72 Hours".
    const canonical = '/title/kpop-demon-hunters/';

    it('drops a sub-page segment', () => {
      expect(toCanonicalTitlePath('/title/kpop-demon-hunters/hours/')).toBe(canonical);
      expect(toCanonicalTitlePath('/title/kpop-demon-hunters/hours')).toBe(canonical);
      expect(toCanonicalTitlePath('/title/kpop-demon-hunters/trailers/')).toBe(canonical);
      // Deeper nesting collapses just the same: only the slug survives.
      expect(toCanonicalTitlePath('/title/kpop-demon-hunters/hours/by-country/')).toBe(canonical);
    });

    it('drops a fragment, with or without a sub-page in front of it', () => {
      const youtubeHref = '/title/primetime/trailers/#toc-trl_Ywax13ahfd2y6npIiMrwcvRj';
      expect(toCanonicalTitlePath(youtubeHref)).toBe('/title/primetime/');
      expect(toCanonicalTitlePath('/title/primetime/#toc-anything')).toBe('/title/primetime/');
      expect(toCanonicalTitlePath('/title/primetime#toc-anything')).toBe('/title/primetime/');
    });

    it('drops a query string', () => {
      expect(toCanonicalTitlePath('/title/inception?utm_source=chart')).toBe('/title/inception/');
      expect(toCanonicalTitlePath('/title/inception/hours/?tab=weekly')).toBe('/title/inception/');
    });

    it('leaves an already-canonical path untouched', () => {
      expect(toCanonicalTitlePath('/title/inception/')).toBe('/title/inception/');
      // The site links with a trailing slash; a bare slug resolves to the same page
      // and is normalised onto one single spelling so it shares one cache entry.
      expect(toCanonicalTitlePath('/title/inception')).toBe('/title/inception/');
    });

    it('leaves a path that is not a title page alone', () => {
      // Conservative by design: nothing outside `/title/<slug>` may be rewritten,
      // or a future listing family would start fetching a page that does not exist.
      const untouched = [
        '/top10/netflix/world',
        '/most-watched/2025/movies',
        '/streaming-services/most-hours-total/netflix/',
        '/popular/movies/youtube',
        '/title/',
        '/titles/inception/',
        '',
      ];
      for (const path of untouched) {
        expect(toCanonicalTitlePath(path)).toBe(path);
      }
    });
  });

  describe('parseDetailPage', () => {
    it('reads the title and the premiere year from the info grid header', () => {
      const html = detailHeader(`
        <div class="md:flex items-baseline justify-between"><h1 class="mb-4 text-h1">The Matrix</h1></div>
        ${premiereBlock('06/18/1999')}
      `);

      expect(parseDetailPage(html)).toEqual({ title: 'The Matrix', year: 1999 });
    });

    // Regression: FlixPatrol's markup drifted and the year XPath went dead. The old code
    // fell back to a regex over `div.mb-6`, which had become a site-wide marketing blurb
    // ending in "the most popular TV shows in 2021" — so every scraped title was dated
    // 2021, and the "exact title AND year" branch of the match cascade confidently
    // selected homonyms (Paulette 2012 resolved to an unrelated 2021 film).
    it('extracts the real premiere year even when the 2021 marketing blurb is present', () => {
      const html = detailHeader(`
        <div class="md:flex items-baseline justify-between"><h1 class="mb-4 text-h1">Paulette</h1></div>
        <div class="flex flex-wrap">
          <div class="flex gap-x-1" title="3894"><div>Movie</div><div>|</div></div>
          <div class="flex gap-x-1"><span>France</span></div>
          <div class="flex gap-x-1" title="Premiere"><div><span>10/03/2012</span></div>|</div>
        </div>
      `);

      expect(parseDetailPage(html)).toEqual({ title: 'Paulette', year: 2012 });
    });

    it('returns a null year rather than scavenging the blurb when there is no premiere block', () => {
      const html = detailHeader('<h1 class="mb-4 text-h1">Unknown Movie</h1>');

      expect(parseDetailPage(html)).toEqual({ title: 'Unknown Movie', year: null });
    });

    it('reads the year of an MM/DD/YYYY premiere date whose day exceeds 12', () => {
      // A day above 12 removes any doubt about which component is read: only the
      // trailing year may ever be picked up.
      const html = detailHeader(`
        <h1 class="mb-4 text-h1">Turbulence</h1>
        ${premiereBlock('05/18/2025')}
      `);

      expect(parseDetailPage(html)).toEqual({ title: 'Turbulence', year: 2025 });
    });

    it('falls back to any h1 when the info grid header is gone, and still refuses to guess a year', () => {
      const html = `<html><body><h1>Fallback Title</h1>${MARKETING_BLURB_HTML}</body></html>`;

      expect(parseDetailPage(html)).toEqual({ title: 'Fallback Title', year: null });
    });

    it('returns an empty title when the page carries no h1 at all', () => {
      const html = detailHeader(premiereBlock('06/18/2024'));

      expect(parseDetailPage(html)).toEqual({ title: '', year: 2024 });
    });

    it('survives an empty document', () => {
      expect(parseDetailPage('')).toEqual({ title: '', year: null });
    });
  });

  describe('parseDetailTitle / parseDetailYear on a prepared DOM', () => {
    it('trims the surrounding whitespace of the title', () => {
      const dom = new JSDOM(detailHeader('<h1 class="mb-4 text-h1">\n  Spaced Out\n</h1>'));

      expect(parseDetailTitle(dom)).toBe('Spaced Out');
    });

    it('prefers the info grid header title over any other h1', () => {
      const html = `
        <html><body>
          <h1>Site Wide Heading</h1>
          <div class="info-grid"><div class="info-grid-header"><h1>Real Title</h1></div></div>
        </body></html>
      `;

      expect(parseDetailTitle(new JSDOM(html))).toBe('Real Title');
    });

    it('ignores a premiere block sitting outside the info grid header', () => {
      const html = `
        <html><body>
          <div class="flex gap-x-1" title="Premiere"><div><span>01/01/1977</span></div></div>
          <div class="info-grid"><div class="info-grid-header"><h1>No Year Here</h1></div></div>
        </body></html>
      `;

      expect(parseDetailYear(new JSDOM(html))).toBeNull();
    });

    it('accepts a 19xx premiere year', () => {
      const dom = new JSDOM(detailHeader(premiereBlock('05/25/1977')));

      expect(parseDetailYear(dom)).toBe(1977);
    });
  });
});
