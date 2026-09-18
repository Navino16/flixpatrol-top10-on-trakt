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
  parseWeeklySection,
  parseWeeklyWeekIndex,
  hasWeeklySection,
  isNotFoundPage,
  toCanonicalTitlePath,
} from '../../src/Flixpatrol/parse';

// HTML in, plain data out: the XPath chains rot silently when FlixPatrol changes
// its markup, so they are pinned here against small fixtures.

// The site-wide marketing blurb that lives in `div.mb-6` on every detail page. It ends
// in a hardcoded "2021", which a text-scanning year fallback would stamp onto every
// single title, so the detail fixtures below deliberately carry it.
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
      // the headline kills it and the tolerant expression has to catch the section.
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
      // Borrowing untyped tables would answer a TV Shows question with movie rows,
      // which nothing downstream can reject. No data is the safe answer.
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
    // Several listings do not link at the title page: most-watched links at
    // `/title/<slug>/hours/` and YouTube Popular at `/title/<slug>/trailers/#toc-...`,
    // and those sub-pages append the section name to their own `h1`. The href is the
    // only safe place to repair that, since a real title may itself end in "Hours".
    const canonical = '/title/kpop-demon-hunters/';

    it('drops a sub-page segment', () => {
      expect(toCanonicalTitlePath('/title/kpop-demon-hunters/hours/')).toBe(canonical);
      expect(toCanonicalTitlePath('/title/kpop-demon-hunters/hours')).toBe(canonical);
      expect(toCanonicalTitlePath('/title/kpop-demon-hunters/trailers/')).toBe(canonical);
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
      // A bare slug resolves to the same page, and is normalised onto one spelling
      // so both share a single cache entry.
      expect(toCanonicalTitlePath('/title/inception')).toBe('/title/inception/');
    });

    it('leaves a path that is not a title page alone', () => {
      // Nothing outside `/title/<slug>` may be rewritten, or a future listing family
      // would start fetching a page that does not exist.
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
      // A day above 12 rules out reading the day as a month.
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

// FlixPatrol answers a missing page with HTTP 200 and this body, never a 404, so the
// status code cannot be used to tell a dead URL from an empty chart.
describe('isNotFoundPage', () => {
  const page = (title: string, body = '') => `<html><head><title>${title}</title></head><body>${body}</body></html>`;

  it('recognises the page FlixPatrol serves for a path that does not exist', () => {
    expect(isNotFoundPage(page('Page Not Found \u2022 FlixPatrol', '<h1 class="text-h1">Page Not Found</h1>')))
      .toBe(true);
  });

  it('leaves a real listing page alone', () => {
    expect(isNotFoundPage(page('Netflix Most Watched Movies in 2025 \u2022 FlixPatrol'))).toBe(false);
    expect(isNotFoundPage(page('TOP 10 on Netflix in the World on September 16, 2026 \u2022 FlixPatrol')))
      .toBe(false);
  });

  it('keys off the title, not the body, so a page merely mentioning the phrase is not flagged', () => {
    expect(isNotFoundPage(page('Netflix Most Watched Movies in 2025 \u2022 FlixPatrol', '<p>Page Not Found</p>')))
      .toBe(false);
  });

  it('treats markup it cannot read as a normal page, so a detection failure never escalates', () => {
    expect(isNotFoundPage('<html><body>no title here</body></html>')).toBe(false);
    expect(isNotFoundPage('')).toBe(false);
  });
});

const weeklyHtml = `
<h2 class="text-h2">Netflix TOP 10 Movies (in English) Viewing Hours</h2>
<table class="card-table">
  <tr><td><a class="flex gap-2 items-center group" href="/title/first-movie/hours/">First</a></td></tr>
  <tr><td><a class="flex gap-2 items-center group" href="/title/second-movie/hours/">Second</a></td></tr>
</table>
<h2 class="text-h2">Netflix TOP 10 Movies (in Not English) Viewing Hours</h2>
<table class="card-table">
  <tr><td><a class="flex gap-2 items-center group" href="/title/tercero/hours/">Tercero</a></td></tr>
</table>
<div>
  <a href="/hours/netflix/2026-035/">35</a>
  <a href="/hours/netflix/2026-037/">37</a>
  <a href="/hours/netflix/2026-036/">36</a>
  <a href="/hours/amazon-prime/2026-035/">az</a>
</div>`;

describe('parseWeeklySection', () => {
  it('returns the hrefs of the table following the heading', () => {
    expect(parseWeeklySection('Netflix TOP 10 Movies (in English)', weeklyHtml))
      .toEqual(['/title/first-movie/hours/', '/title/second-movie/hours/']);
  });

  it('does not bleed into the next section', () => {
    expect(parseWeeklySection('Netflix TOP 10 Movies (in Not English)', weeklyHtml))
      .toEqual(['/title/tercero/hours/']);
  });

  it('returns [] for an unknown heading', () => {
    expect(parseWeeklySection('Netflix TOP 10 Documentaries', weeklyHtml)).toEqual([]);
  });
});

describe('hasWeeklySection', () => {
  it('is true for a heading that exists, even with an empty table', () => {
    expect(hasWeeklySection('Netflix TOP 10 Movies (in English)', weeklyHtml)).toBe(true);
    expect(hasWeeklySection('Netflix TOP 10 Movies (in English)',
      '<h2>Netflix TOP 10 Movies (in English) Viewing Hours</h2><table></table>')).toBe(true);
  });

  it('is false for an unknown heading', () => {
    expect(hasWeeklySection('Netflix TOP 10 Documentaries', weeklyHtml)).toBe(false);
  });
});

describe('parseWeeklyWeekIndex', () => {
  it('returns the highest week of that platform', () => {
    expect(parseWeeklyWeekIndex('netflix', weeklyHtml)).toBe('2026-037');
  });

  it('does not mix platforms', () => {
    expect(parseWeeklyWeekIndex('amazon-prime', weeklyHtml)).toBe('2026-035');
  });

  it('returns null when the platform has no week link', () => {
    expect(parseWeeklyWeekIndex('netflix', '<div></div>')).toBeNull();
  });
});
