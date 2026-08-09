import {
  afterAll, beforeAll, describe, expect, it,
} from 'vitest';
import { JSDOM } from 'jsdom';
import { FlareSolverrClient } from '../../src/FlareSolverr';
import {
  DETAIL_PREMIERE_EXPRESSION,
  DETAIL_TITLE_EXPRESSIONS,
  DETAIL_YEAR_PATTERN,
  POPULAR_EXPRESSION,
  mostHoursExpressions,
  mostWatchedExpression,
  parseDetailPage,
  top10Expressions,
  top10KidsExpressions,
} from '../../src/Flixpatrol/parse';

/**
 * E2E suite: an early-warning canary for FlixPatrol markup drift.
 *
 * WHY IT EXISTS. Every XPath expression in `src/Flixpatrol/parse.ts` is matched
 * against a third-party site nobody here controls. The site once drifted so that
 * BOTH detail-page expressions died: the title survived only through its bare
 * `//h1` fallback, and the year fell through to a regex over `div.mb-6`, which
 * had become a marketing blurb ending in "the most popular TV shows in 2021".
 * Every single title came back dated 2021 and wrong films were written to real
 * user lists for months — with a fully green unit suite, because the fixtures
 * had been captured from the already-broken markup.
 *
 * WHAT IT ASSERTS, AND WHY IT IS NOT "does parsing work".
 * A test asserting "a title and a year came back" would have passed throughout
 * that whole incident: 2021 is a perfectly plausible year. Fallbacks mask drift
 * — that is their job, and that is precisely the problem. So this suite asserts
 * that the PRIMARY rung of each expression chain still matches, and treats a
 * fallback taking over as a failure in its own right. The rung lists are
 * imported from the parser rather than copied, so they cannot silently diverge
 * from what production actually runs.
 *
 * It also asserts one cross-page invariant that holds no matter what the site
 * lists today: several distinct titles must NOT all report the same year. That
 * is the exact signature of the 2021 bug.
 *
 * WHAT IT NEVER ASSERTS: today's content. FlixPatrol's charts change daily, so
 * only shapes, counts and rung identity are checked — never a specific title.
 *
 * MECHANICS. FlixPatrol sits behind Cloudflare, so the suite needs FlareSolverr
 * and is gated on `E2E_FLARESOLVERR_URL`; without it, it skips cleanly. Each
 * page is fetched exactly once and shared by every assertion, and the requests
 * are spaced out: this is someone else's server.
 */
const flareSolverrUrl = process.env.E2E_FLARESOLVERR_URL ?? '';

const BASE_URL = 'https://flixpatrol.com';

/** Politeness delay between two FlixPatrol page loads. */
const REQUEST_DELAY_MS = 1500;

/** Whole-suite budget: ~10 page loads, the first of which solves a challenge. */
const BOOTSTRAP_TIMEOUT_MS = 300_000;

/**
 * The pages, one per XPath family. Netflix/France is listed once and used twice:
 * the regional Top10 and the Kids Top10 share a single page, and there is no
 * reason to download it twice.
 */
const TOP10_WORLD_PATH = '/top10/netflix/world';
const TOP10_REGION_PATH = '/top10/netflix/france';
const POPULAR_PATH = '/popular/movies/wikipedia';
const MOST_HOURS_PATH = '/streaming-services/most-hours-first-week/netflix/';
// Derived rather than hardcoded: last completed year is always published, so
// this path stays valid forever instead of rotting on a fixed year.
const MOST_WATCHED_PATH = `/most-watched/${new Date().getFullYear() - 1}/movies`;

/** Shape of a listing href, e.g. `/title/inception/` or `/title/damsel-2024/hours/`. */
const TITLE_HREF = /^\/title\/[^/]+\//;

/** A media detail page pulled at runtime out of one of the listing pages. */
interface DerivedDetail {
  /** Which listing family the URL came from, so a failure names the family. */
  family: string;
  path: string;
  html: string;
  /** The label the listing itself printed for that href. */
  listingLabel: string;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms); });

/** Squashes the whitespace the site sprinkles inside its anchors. */
const collapse = (value: string): string => value.replace(/\s+/g, ' ').trim();

/**
 * Evaluates one XPath over an HTML string, exactly as the parser does. The
 * evaluation is re-implemented here on purpose: what is under test is the
 * EXPRESSIONS, so re-using the parser's own chain-walking would hide which rung
 * produced the result.
 */
/**
 * One DOM per page, built once. Several pages are multi-megabyte and every
 * assertion evaluates a fresh expression over them; re-parsing each time turns a
 * fast suite into a slow one for no benefit.
 */
const doms = new Map<string, JSDOM>();

const domOf = (html: string): JSDOM => {
  const cached = doms.get(html);
  if (cached !== undefined) {
    return cached;
  }
  const dom = new JSDOM(html);
  doms.set(html, dom);
  return dom;
};

const matches = (expression: string, html: string): string[] => {
  const dom = domOf(html);
  const iterator = dom.window.document.evaluate(
    expression,
    dom.window.document,
    null,
    dom.window.XPathResult.UNORDERED_NODE_ITERATOR_TYPE,
    null,
  );
  const results: string[] = [];
  let node = iterator.iterateNext();
  while (node !== null) {
    if (node.textContent) {
      results.push(node.textContent.trim());
    }
    node = iterator.iterateNext();
  }
  return results;
};

const stringValue = (expression: string, html: string): string => {
  const dom = domOf(html);
  return dom.window.document.evaluate(
    expression,
    dom.window.document,
    null,
    dom.window.XPathResult.STRING_TYPE,
    null,
  ).stringValue.trim();
};

/**
 * Index of the first rung that matches, or -1 when the whole chain is dead.
 * Anything other than 0 means production is currently running on a fallback,
 * which is the early warning this suite exists to raise.
 */
const firstMatchingRung = (expressions: string[], html: string): number => expressions
  .findIndex((expression) => matches(expression, html).length > 0);

describe.skipIf(!process.env.E2E_FLARESOLVERR_URL)('FlixPatrol XPath drift (E2E)', () => {
  let client: FlareSolverrClient;
  const pages = new Map<string, string>();
  const details: DerivedDetail[] = [];

  const page = (path: string): string => {
    const html = pages.get(path);
    if (html === undefined) {
      throw new Error(`Page ${path} was not fetched during bootstrap`);
    }
    return html;
  };

  const fetchPage = async (path: string): Promise<string> => {
    const cached = pages.get(path);
    if (cached !== undefined) {
      return cached;
    }
    await sleep(REQUEST_DELAY_MS);
    const html = await client.get(`${BASE_URL}${path}`);
    if (html === null) {
      throw new Error(`FlixPatrol returned nothing for ${path} — the site may be down or blocking`);
    }
    pages.set(path, html);
    return html;
  };

  /**
   * Detail-page URLs are NEVER hardcoded: individual title pages disappear as
   * the site prunes them, and a fixed list would rot within months. They are
   * derived from the listings that were just fetched, so the suite heals itself.
   */
  const deriveDetail = async (
    family: string,
    listingPath: string,
    hrefExpression: string,
  ): Promise<void> => {
    const html = page(listingPath);
    const hrefs = matches(hrefExpression, html);
    // The label expression is the href one minus its final `/@href` step, so the
    // two can never point at different anchors.
    const labels = matches(hrefExpression.replace(/\/@href$/, ''), html);
    if (hrefs.length === 0) {
      // The listing assertions report this properly; nothing to derive from here.
      return;
    }
    details.push({
      family,
      path: hrefs[0],
      html: await fetchPage(hrefs[0]),
      listingLabel: labels[0] ?? '',
    });
  };

  beforeAll(async () => {
    client = new FlareSolverrClient({ enabled: true, url: flareSolverrUrl, maxTimeout: 60000 });
    await client.createSession();

    for (const path of [
      TOP10_WORLD_PATH,
      TOP10_REGION_PATH,
      POPULAR_PATH,
      MOST_WATCHED_PATH,
      MOST_HOURS_PATH,
    ]) {
      await fetchPage(path);
    }

    // Four detail pages, taken from four different families so their release
    // years have every reason to differ — which is what the cross-page
    // invariant below needs in order to mean anything.
    await deriveDetail('top10-world-movie', TOP10_WORLD_PATH, top10Expressions('Movies', 'world')[0]);
    await deriveDetail('top10-world-show', TOP10_WORLD_PATH, top10Expressions('TV Shows', 'world')[0]);
    await deriveDetail('popular-movie', POPULAR_PATH, POPULAR_EXPRESSION);
    await deriveDetail('most-watched-movie', MOST_WATCHED_PATH, mostWatchedExpression(false));
  }, BOOTSTRAP_TIMEOUT_MS);

  afterAll(async () => {
    if (client !== undefined) {
      await client.destroySession();
    }
  });

  describe('Top 10 (world)', () => {
    it.each(['Movies', 'TV Shows'] as const)(
      'primary expression still selects the %s chart',
      (type) => {
        const expressions = top10Expressions(type, 'world');
        // World has a single rung by design: if it dies, nothing catches it.
        expect(expressions).toHaveLength(1);
        const hrefs = matches(expressions[0], page(TOP10_WORLD_PATH));
        // A "TOP 10" section holds ten entries. A different count means the
        // expression is now reaching into neighbouring markup.
        expect(hrefs).toHaveLength(10);
        expect(hrefs.every((href) => TITLE_HREF.test(href))).toBe(true);
        expect(new Set(hrefs).size).toBe(10);
      },
    );
  });

  describe('Top 10 (regional)', () => {
    it.each(['Movies', 'TV Shows'] as const)(
      'the STRICT rung matches for %s, not one of its two fallbacks',
      (type) => {
        const expressions = top10Expressions(type, 'france');
        expect(expressions).toHaveLength(3);
        const rung = firstMatchingRung(expressions, page(TOP10_REGION_PATH));
        // rung 0 is the only acceptable answer. rung 1 or 2 means the site
        // drifted and production is silently running on a looser expression;
        // rung 2 in particular scoops up whole tables and would return far more
        // than ten titles. -1 means the whole chain is dead.
        expect(rung).toBe(0);
        expect(matches(expressions[0], page(TOP10_REGION_PATH))).toHaveLength(10);
      },
    );

    it('the loosest rung over-matches, proving it is a degraded substitute', () => {
      const expressions = top10Expressions('Movies', 'france');
      const strict = matches(expressions[0], page(TOP10_REGION_PATH));
      const loosest = matches(expressions[2], page(TOP10_REGION_PATH));
      // Documents WHY falling back matters: the last rung mixes several charts
      // together, so a silent fallback does not merely change the selector, it
      // changes the list that users receive.
      expect(loosest.length).toBeGreaterThan(strict.length);
    });
  });

  describe('Top 10 Kids', () => {
    it.each(['Movies', 'TV Shows'] as const)(
      'the STRICT rung matches for Kids %s, not its fallback',
      (type) => {
        const expressions = top10KidsExpressions(type);
        expect(expressions).toHaveLength(2);
        expect(firstMatchingRung(expressions, page(TOP10_REGION_PATH))).toBe(0);
        expect(matches(expressions[0], page(TOP10_REGION_PATH))).toHaveLength(10);
      },
    );
  });

  describe('Popular', () => {
    it('the single expression still selects the card table', () => {
      const hrefs = matches(POPULAR_EXPRESSION, page(POPULAR_PATH));
      // No fallback exists here, so this expression dying is an outright outage
      // rather than a silent degradation — but it is still worth catching early.
      expect(hrefs.length).toBeGreaterThanOrEqual(10);
      expect(hrefs.every((href) => TITLE_HREF.test(href))).toBe(true);
    });
  });

  describe('Most watched', () => {
    it('the base expression still selects the card table', () => {
      const hrefs = matches(mostWatchedExpression(false), page(MOST_WATCHED_PATH));
      expect(hrefs.length).toBeGreaterThanOrEqual(10);
      expect(hrefs.every((href) => TITLE_HREF.test(href))).toBe(true);
    });

    it('the originals variant is still a strict, non-empty subset', () => {
      const all = matches(mostWatchedExpression(false), page(MOST_WATCHED_PATH));
      const originals = matches(mostWatchedExpression(true), page(MOST_WATCHED_PATH));
      // The `[.//svg]` predicate is the whole point of `original: true`. Empty
      // means the originals badge moved out of the anchor; equal to `all` means
      // the predicate has become a no-op and the option silently does nothing.
      expect(originals.length).toBeGreaterThan(0);
      expect(originals.length).toBeLessThan(all.length);
      expect(originals.every((href) => all.includes(href))).toBe(true);
    });
  });

  describe('Most hours', () => {
    it.each(['all', 'english', 'non-english'] as const)(
      'the language-tab rung matches for %s, not the section-wide fallback',
      (language) => {
        const expressions = mostHoursExpressions('Movies', language);
        expect(expressions).toHaveLength(2);
        // The second rung exists only for the `total` period, which publishes no
        // language tabs. On a period that HAS tabs, falling back means every
        // language now returns the same undifferentiated rows.
        expect(firstMatchingRung(expressions, page(MOST_HOURS_PATH))).toBe(0);
      },
    );

    it('the TV shows section is still addressed by its own id', () => {
      const expressions = mostHoursExpressions('TV Shows', 'all');
      expect(firstMatchingRung(expressions, page(MOST_HOURS_PATH))).toBe(0);
    });

    it('the language tabs are distinct tables, not the same one matched three times', () => {
      const html = page(MOST_HOURS_PATH);
      const english = matches(mostHoursExpressions('Movies', 'english')[0], html);
      const nonEnglish = matches(mostHoursExpressions('Movies', 'non-english')[0], html);
      const sectionWide = matches(mostHoursExpressions('Movies', 'all')[1], html);
      expect(english.length).toBeGreaterThan(0);
      expect(nonEnglish.length).toBeGreaterThan(0);
      // If the tab attribute drifted, the language expressions would collapse
      // onto one another and `language` would become a decorative setting.
      expect(english).not.toEqual(nonEnglish);
      // And the tab narrowing must still narrow: the section holds every tab.
      expect(sectionWide.length).toBeGreaterThan(english.length);
    });
  });

  describe('Detail pages', () => {
    it('derived four detail pages, spanning movies and TV shows', () => {
      // Guards the derivation itself: without it, every assertion below would
      // vacuously pass over an empty list.
      expect(details).toHaveLength(4);
      expect(details.map((detail) => detail.family)).toContain('top10-world-show');
    });

    it('the PRIMARY title expression matches on every detail page', () => {
      // This is the exact assertion the 2021 incident needed. The second rung is
      // a bare `//h1`, which matches on virtually any page and would keep the
      // parse "working" while the real container had vanished.
      const drifted = details
        .filter((detail) => stringValue(DETAIL_TITLE_EXPRESSIONS[0], detail.html) === '')
        .map((detail) => `${detail.family} (${detail.path})`);
      expect(drifted).toEqual([]);
    });

    it('the premiere block is present and yields a parseable year on every detail page', () => {
      const missing = details
        .filter((detail) => !DETAIL_YEAR_PATTERN.test(stringValue(DETAIL_PREMIERE_EXPRESSION, detail.html)))
        .map((detail) => `${detail.family} (${detail.path})`);
      // No fallback exists for the year on purpose: a wrong year is silently
      // destructive, so the premiere block is the only source. If it moves, the
      // year goes null everywhere and the backend match degrades to title-only.
      expect(missing).toEqual([]);
    });

    it('years parsed across distinct titles are NOT all identical', () => {
      const parsed = details.map((detail) => parseDetailPage(detail.html));
      const years = parsed.map((detail) => detail.year);
      expect(years.every((year) => year !== null)).toBe(true);
      // THE signature of the 2021 bug: four unrelated titles from four different
      // charts sharing one year means the year is coming from page furniture,
      // not from the media. Holds regardless of what the site lists today.
      expect(new Set(years).size).toBeGreaterThan(1);
      expect(new Set(parsed.map((detail) => detail.title)).size).toBe(parsed.length);
    });

    it('years are plausible release years', () => {
      const upperBound = new Date().getFullYear() + 5;
      for (const detail of details) {
        const { year } = parseDetailPage(detail.html);
        expect(year).not.toBeNull();
        expect(year).toBeGreaterThanOrEqual(1900);
        expect(year).toBeLessThanOrEqual(upperBound);
      }
    });

    it('the parsed title is what the listing printed for the same href', () => {
      // Cross-check between two independent parts of the site, and the only way
      // to catch an href that points at a SUB-page of the title rather than the
      // title itself (Most watched links to `/title/<slug>/hours/`, whose `h1`
      // is not the media title). The item is then searched for in the backend
      // under a name nobody uses, and no assertion on shape alone would notice.
      //
      // The listing label is a prefix test, not an equality one: some listings
      // append metadata (type, country, premiere date) inside the same anchor,
      // while the detail page prints the bare title. A title that is NOT the
      // leading text of its own listing label is a genuine mismatch.
      const mismatched = details
        .filter((detail) => detail.listingLabel !== '')
        .map((detail) => ({ detail, parsed: collapse(parseDetailPage(detail.html).title) }))
        .filter(({ detail, parsed }) => !collapse(detail.listingLabel).startsWith(parsed))
        .map(({ detail, parsed }) => `${detail.family}: listing "${collapse(detail.listingLabel)}" vs detail "${parsed}"`);
      expect(mismatched).toEqual([]);
    });
  });
});
