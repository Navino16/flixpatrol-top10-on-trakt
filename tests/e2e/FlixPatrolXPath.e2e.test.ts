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
  parseTop10Page,
  toCanonicalTitlePath,
  top10Expressions,
  top10KidsExpressions,
} from '../../src/Flixpatrol/parse';
import type {
  FlixPatrolMostHoursLanguage,
  FlixPatrolMostHoursPeriod,
  FlixPatrolTop10Location,
  FlixPatrolType,
} from '../../src/types';

/**
 * E2E suite: an early-warning canary for FlixPatrol markup drift.
 *
 * Every XPath in `src/Flixpatrol/parse.ts` runs against a third-party site nobody
 * here controls, as a chain whose later rungs are deliberately tolerant. Fallbacks
 * mask drift, so a suite asserting only "a title and a year came back" stays green
 * while production silently runs on a fallback and writes wrong films to real user
 * lists. This suite instead asserts that the PRIMARY rung of each chain still
 * matches, and treats a fallback taking over as a failure. The rung lists are
 * imported from the parser, so they cannot diverge from what production runs.
 *
 * It never asserts today's content — only shapes, counts and rung identity — and
 * pins nothing to a calendar. The one content-independent invariant: distinct
 * titles must NOT all report the same year, which is what a year read from page
 * furniture rather than from the media looks like. Each family spans several
 * deliberately DIFFERENT page layouts, since an expression can die on one and
 * still match on another, and every case is table-driven so a red CI line names
 * the page and the rung.
 *
 * Top 10 URLs carry a date because FlixPatrol publishes a day progressively: the
 * undated page is the CURRENT day and, at the hour the canary runs, is still
 * missing the Kids charts. An unpublished chart is not drift and an always-red
 * canary is one nobody reads, so that family asks for the last COMPLETED day —
 * see `TOP10_DATE` for why exactly one day back.
 *
 * FlixPatrol sits behind Cloudflare, so the suite needs FlareSolverr and is gated
 * on `E2E_FLARESOLVERR_URL`. Each page is fetched exactly ONCE during bootstrap,
 * and the request count is asserted against a hard budget: someone else's server.
 */
const flareSolverrUrl = process.env.E2E_FLARESOLVERR_URL ?? '';

const BASE_URL = 'https://flixpatrol.com';

/** Politeness delay between two FlixPatrol page loads. */
const REQUEST_DELAY_MS = 1500;

/**
 * Hard ceiling on live page loads, asserted at the end. It sits two slots above
 * what the tables below plan and no more, that margin being what lets the
 * assertion tell "someone added a page" from "something is re-fetching". Raising
 * it must stay a deliberate act visible in a diff.
 */
const REQUEST_BUDGET = 32;

/** Whole-suite budget: every page load, the first of which solves a challenge. */
const BOOTSTRAP_TIMEOUT_MS = 600_000;

const MEDIA_TYPES: readonly FlixPatrolType[] = ['Movies', 'TV Shows'];

const currentYear = new Date().getFullYear();

/**
 * The day every Top 10 URL asks for: the day before the run, in UTC.
 *
 * ONE day, and never more: FlixPatrol gives away only a short rolling window of
 * daily history and paywalls everything older, so the last completed day is the
 * freshest date guaranteed both published AND free. There is deliberately no retry
 * chain either — a date that does not answer is a signal, and walking backwards
 * until something does would suppress it while marching towards the paywall.
 *
 * UTC because the site's notion of today is the UTC date. Were that to change,
 * "yesterday in UTC" would still be TODAY for the site, i.e. incomplete; the
 * dated-page guard below turns that into a named failure rather than a dozen
 * empty-chart ones.
 */
const TOP10_DATE = ((): string => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
})();

/**
 * The dated form FlixPatrol serves a completed day under:
 * `/top10/<platform>/<country>/YYYY-MM-DD/`. The trailing slash is spelled out
 * because the form without it answers only via a redirect.
 */
const onPreviousDay = (path: string): string => `${path}/${TOP10_DATE}/`;

/**
 * The phrase FlixPatrol replaces a chart with once the day has aged past its free
 * window. Not the shorter "FlixPatrol Premium": the site's own upsell links carry
 * that on every page, so it would match everywhere and detect nothing.
 */
const PAYWALL_NOTICE = 'only available to paid subscribers';

/**
 * Top 10 (world) — one page per platform, chosen for catalogue size so the layouts
 * differ. A world chart has a single expression with no fallback behind it.
 */
const TOP10_WORLD_PATHS: readonly string[] = [
  onPreviousDay('/top10/netflix/world'),
  onPreviousDay('/top10/disney/world'),
  onPreviousDay('/top10/hbo-max/world'),
  onPreviousDay('/top10/apple-tv/world'),
];

interface RegionalPage {
  path: string;
  location: FlixPatrolTop10Location;
  /**
   * True when this market may legitimately publish a short chart, or none at all,
   * for a media type. Anywhere else a missing chart is drift and fails.
   */
  mayBeShortOrAbsent: boolean;
}

/**
 * Top 10 (regional) — the rung chain across six platform and country pairings.
 *
 * The three `go3` Baltic markets are the deliberate small-market case: they publish
 * a Movies chart but, routinely, no TV Shows chart at all. Both rungs name the media
 * type, so the missing one must come back EMPTY rather than with the rows the market
 * does publish, relabelled — asserted below. Asking for a COMPLETED day is what
 * keeps that unambiguous: on the current day the site may simply not have published
 * the chart yet.
 */
const TOP10_REGION_PAGES: readonly RegionalPage[] = [
  { path: onPreviousDay('/top10/netflix/france'), location: 'france', mayBeShortOrAbsent: false },
  { path: onPreviousDay('/top10/disney/united-states'), location: 'united-states', mayBeShortOrAbsent: false },
  { path: onPreviousDay('/top10/amazon-prime/japan'), location: 'japan', mayBeShortOrAbsent: false },
  { path: onPreviousDay('/top10/go3/latvia'), location: 'latvia', mayBeShortOrAbsent: true },
  { path: onPreviousDay('/top10/go3/lithuania'), location: 'lithuania', mayBeShortOrAbsent: true },
  { path: onPreviousDay('/top10/go3/estonia'), location: 'estonia', mayBeShortOrAbsent: true },
];

/**
 * Top 10 Kids — Netflix only (the app refuses any other platform) and regional only,
 * so the country is the only variation available. France is reused from the regional
 * table rather than fetched twice, which only works because both tables date their
 * paths identically.
 *
 * This is the family the dated URL exists for: Kids is the LAST section of a day to
 * be published, so it is the one the undated URL is missing at cron time.
 */
const TOP10_KIDS_PATHS: readonly string[] = [
  onPreviousDay('/top10/netflix/france'),
  onPreviousDay('/top10/netflix/united-states'),
  onPreviousDay('/top10/netflix/japan'),
  onPreviousDay('/top10/netflix/brazil'),
];

interface PopularPage {
  path: string;
  /**
   * Whether this source links straight at `/title/<slug>/`. Wikipedia does;
   * YouTube links at `/title/<slug>/trailers/#toc-...` instead. Documentation of
   * the site's shape, NOT a correctness requirement: the scraper canonicalises
   * every href before fetching it, so a sub-page link is harmless.
   */
  directTitleLinks: boolean;
}

/**
 * Popular — both sources the app accepts, plus both media types for Wikipedia. NOT
 * dated: these are cumulative all-time rankings, and appending a date is actively
 * misleading — the segment is swallowed and the CURRENT ranking comes back under a
 * URL claiming to be a historical one.
 */
const POPULAR_PAGES: readonly PopularPage[] = [
  { path: '/popular/movies/wikipedia', directTitleLinks: true },
  { path: '/popular/tv-shows/wikipedia', directTitleLinks: true },
  // YouTube publishes one single trailer chart, so `/popular/tv-shows/youtube`
  // returns the same rows and fetching it would spend a request for nothing.
  { path: '/popular/movies/youtube', directTitleLinks: false },
];

/**
 * Most watched — two derived years, so no path rots, and both media shapes. The
 * `original: true` variant is a second expression over the SAME page, so it costs no
 * extra request. YEAR is the only granularity this route has: a day appended to it
 * returns "Page Not Found". Same for Most hours below, a lifetime total.
 */
const MOST_WATCHED_PAGES: readonly { path: string }[] = [
  { path: `/most-watched/${currentYear - 1}/movies` },
  { path: `/most-watched/${currentYear - 2}/movies` },
  { path: `/most-watched/${currentYear - 1}/tv-shows-grouped` },
];

interface MostHoursPage {
  path: string;
  period: FlixPatrolMostHoursPeriod;
  /**
   * Whether the period publishes per-language tabs. `total` does not, which is the
   * entire reason the second rung exists — so there the fallback is the CORRECT
   * answer and rung 0 must legitimately match nothing.
   */
  hasLanguageTabs: boolean;
}

const MOST_HOURS_PAGES: readonly MostHoursPage[] = [
  { path: '/streaming-services/most-hours-total/netflix/', period: 'total', hasLanguageTabs: false },
  { path: '/streaming-services/most-hours-first-week/netflix/', period: 'first-week', hasLanguageTabs: true },
  { path: '/streaming-services/most-hours-first-month/netflix/', period: 'first-month', hasLanguageTabs: true },
];

const MOST_HOURS_LANGUAGES: readonly FlixPatrolMostHoursLanguage[] = ['all', 'english', 'non-english'];

/**
 * Detail pages are NEVER hardcoded: individual title pages disappear as the site
 * prunes them. Each spec names a listing already fetched for another family and
 * the expression to pull an href out of it, so the set heals itself every run.
 *
 * They deliberately span movies and TV shows, world and regional charts, a kids
 * chart and the evergreen Wikipedia charts, so the release years have every reason
 * to differ — which is what the "not all the same year" invariant needs to mean
 * anything.
 */
interface DetailSpec {
  /** Names the family in the test title, so a red line points at a listing. */
  family: string;
  listingPath: string;
  expression: string;
}

const DETAIL_SPECS: readonly DetailSpec[] = [
  {
    family: 'top10-world-movie',
    listingPath: onPreviousDay('/top10/netflix/world'),
    expression: top10Expressions('Movies', 'world')[0],
  },
  {
    family: 'top10-world-show',
    listingPath: onPreviousDay('/top10/hbo-max/world'),
    expression: top10Expressions('TV Shows', 'world')[0],
  },
  {
    family: 'top10-region-movie',
    listingPath: onPreviousDay('/top10/disney/united-states'),
    expression: top10Expressions('Movies', 'united-states')[0],
  },
  {
    family: 'top10-kids-movie',
    listingPath: onPreviousDay('/top10/netflix/japan'),
    expression: top10KidsExpressions('Movies')[0],
  },
  {
    family: 'popular-movie',
    listingPath: '/popular/movies/wikipedia',
    expression: POPULAR_EXPRESSION,
  },
  {
    family: 'popular-show',
    listingPath: '/popular/tv-shows/wikipedia',
    expression: POPULAR_EXPRESSION,
  },
  {
    family: 'most-watched-movie',
    listingPath: `/most-watched/${currentYear - 1}/movies`,
    expression: mostWatchedExpression(false),
  },
  {
    // The second listing family that links at a sub-page rather than at the title,
    // so the canonicalisation is covered on more than one page shape.
    family: 'popular-movie-youtube',
    listingPath: '/popular/movies/youtube',
    expression: POPULAR_EXPRESSION,
  },
];

/**
 * Every Top 10 page the suite loads, deduplicated, so the guard below asserts the
 * day was served in full once per URL rather than once per media type.
 */
const DATED_TOP10_PATHS: readonly string[] = Array.from(new Set<string>([
  ...TOP10_WORLD_PATHS,
  ...TOP10_REGION_PAGES.map((entry) => entry.path),
  ...TOP10_KIDS_PATHS,
]));

const LISTING_PATHS: readonly string[] = Array.from(new Set<string>([
  ...DATED_TOP10_PATHS,
  ...POPULAR_PAGES.map((entry) => entry.path),
  ...MOST_WATCHED_PAGES.map((entry) => entry.path),
  ...MOST_HOURS_PAGES.map((entry) => entry.path),
]));

/** Shape of a listing href, e.g. `/title/inception/` or `/title/damsel-2024/hours/`. */
const TITLE_HREF = /^\/title\/[^/]+\//;

/** A listing href pointing at the title page itself, with no sub-page below it. */
const DIRECT_TITLE_HREF = /^\/title\/[^/]+\/$/;

/** A media detail page pulled at runtime out of one of the listing pages. */
interface DerivedDetail {
  family: string;
  /** The href exactly as the listing printed it, which may be a sub-page. */
  listingHref: string;
  /** The page actually fetched: the canonical `/title/<slug>/` form of the href. */
  path: string;
  html: string;
  listingLabel: string;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms); });

/** Squashes the whitespace the site sprinkles inside its anchors. */
const collapse = (value: string): string => value.replace(/\s+/g, ' ').trim();

/**
 * One DOM per page, built once: several pages are multi-megabyte and every
 * assertion evaluates a fresh expression over them.
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

/**
 * Evaluates one XPath over an HTML string, as the parser does. Re-implemented on
 * purpose: what is under test is the EXPRESSIONS, so re-using the parser's own
 * chain-walking would hide which rung produced the result.
 */
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
 * Index of the first rung that matches, or -1 when the chain is dead. Any rung
 * other than the expected one means production is running on a fallback.
 */
const firstMatchingRung = (expressions: string[], html: string): number => expressions
  .findIndex((expression) => matches(expression, html).length > 0);

/**
 * Does the page publish a chart for this media type AT ALL? Deliberately
 * independent of the expressions under test — it looks for the section heading, not
 * the anchors the parser selects — which is what makes "this market publishes no TV
 * Shows chart" distinguishable from "the TV Shows expression has drifted". Exact
 * rather than `contains`, so "TOP 10 Kids Movies" is not read as the main chart.
 */
const publishesChart = (type: FlixPatrolType, html: string): boolean => matches(
  `//h3[normalize-space(.) = "TOP 10 ${type}"]`,
  html,
).length > 0;

interface Top10Case {
  path: string;
  type: FlixPatrolType;
}

interface RegionalCase extends Top10Case {
  location: FlixPatrolTop10Location;
  mayBeShortOrAbsent: boolean;
}

interface MostHoursCase {
  path: string;
  period: FlixPatrolMostHoursPeriod;
  type: FlixPatrolType;
  language: FlixPatrolMostHoursLanguage;
  hasLanguageTabs: boolean;
}

const datedTop10Cases: { path: string }[] = DATED_TOP10_PATHS.map((path) => ({ path }));

const top10WorldCases: Top10Case[] = TOP10_WORLD_PATHS
  .flatMap((path) => MEDIA_TYPES.map((type) => ({ path, type })));

const top10RegionCases: RegionalCase[] = TOP10_REGION_PAGES
  .flatMap((entry) => MEDIA_TYPES.map((type) => ({ ...entry, type })));

/**
 * The subset allowed to publish no chart at all: the only cases where "the chain
 * returns nothing" is a legitimate outcome, hence assertable as such.
 */
const top10AbsentChartCases: RegionalCase[] = top10RegionCases
  .filter((entry) => entry.mayBeShortOrAbsent);

const top10KidsCases: Top10Case[] = TOP10_KIDS_PATHS
  .flatMap((path) => MEDIA_TYPES.map((type) => ({ path, type })));

const mostHoursCases: MostHoursCase[] = MOST_HOURS_PAGES
  .flatMap((entry) => MEDIA_TYPES
    .flatMap((type) => MOST_HOURS_LANGUAGES.map((language) => ({ ...entry, type, language }))));

const mostHoursTabbedPages = MOST_HOURS_PAGES.filter((entry) => entry.hasLanguageTabs);

const mostHoursTabCases = mostHoursTabbedPages
  .flatMap((entry) => MEDIA_TYPES.map((type) => ({ ...entry, type })));

const mostHoursTotalCases = MOST_HOURS_PAGES
  .filter((entry) => !entry.hasLanguageTabs)
  .flatMap((entry) => MEDIA_TYPES.map((type) => ({ ...entry, type })));

describe.skipIf(!process.env.E2E_FLARESOLVERR_URL)('FlixPatrol XPath drift (E2E)', () => {
  let client: FlareSolverrClient;
  const pages = new Map<string, string>();
  const details = new Map<string, DerivedDetail>();
  let requestCount = 0;

  const page = (path: string): string => {
    const html = pages.get(path);
    if (html === undefined) {
      throw new Error(`Page ${path} was not fetched during bootstrap`);
    }
    return html;
  };

  const detail = (family: string): DerivedDetail => {
    const derived = details.get(family);
    if (derived === undefined) {
      throw new Error(`No detail page could be derived for "${family}" — its listing yielded no href`);
    }
    return derived;
  };

  /** Memoised, so no URL is requested twice however many assertions read it. */
  const fetchPage = async (path: string): Promise<string> => {
    const cached = pages.get(path);
    if (cached !== undefined) {
      return cached;
    }
    await sleep(REQUEST_DELAY_MS);
    requestCount += 1;
    const html = await client.get(`${BASE_URL}${path}`);
    if (html === null) {
      throw new Error(`FlixPatrol returned nothing for ${path} — the site may be down or blocking`);
    }
    pages.set(path, html);
    return html;
  };

  const deriveDetail = async (spec: DetailSpec): Promise<void> => {
    const html = page(spec.listingPath);
    const hrefs = matches(spec.expression, html);
    // The label expression is the href one minus its final `/@href` step, so the
    // two can never point at different anchors.
    const labels = matches(spec.expression.replace(/\/@href$/, ''), html);
    if (hrefs.length === 0) {
      // The listing assertions report this properly; nothing to derive from here.
      return;
    }
    // Fetch what production fetches. Several listings link at a sub-page of the
    // title (`/hours/`, `/trailers/#toc-...`) whose `h1` welds the section name
    // onto the media name, and the scraper canonicalises every href before
    // fetching, so the suite must do the same or it exercises a dead code path.
    const canonicalPath = toCanonicalTitlePath(hrefs[0]);
    details.set(spec.family, {
      family: spec.family,
      listingHref: hrefs[0],
      path: canonicalPath,
      html: await fetchPage(canonicalPath),
      listingLabel: labels[0] ?? '',
    });
  };

  beforeAll(async () => {
    client = new FlareSolverrClient({
      enabled: true, url: flareSolverrUrl, maxTimeout: 60000, disableMedia: false,
    });
    await client.createSession();

    for (const path of LISTING_PATHS) {
      await fetchPage(path);
    }

    for (const spec of DETAIL_SPECS) {
      await deriveDetail(spec);
    }
  }, BOOTSTRAP_TIMEOUT_MS);

  afterAll(async () => {
    if (client !== undefined) {
      await client.destroySession();
    }
  });

  /**
   * Declared FIRST on purpose: every Top 10 assertion below is meaningless if the
   * site did not serve the day it reads. Without this block, a paywalled or
   * unpublished date surfaces as a dozen "the strict rung matched nothing" failures
   * — drift's signature — and sends the reader hunting markup that never changed.
   */
  describe('Dated Top 10 pages', () => {
    it('asks for exactly one day back, never further into the paywalled archive', () => {
      // Guards the derivation, not the site: two days back is not a safer
      // fallback but a step towards the paywall, so a refactor widening the offset
      // has to fail here rather than work until the free window shifts under it.
      const target = Date.parse(`${TOP10_DATE}T00:00:00Z`);
      const today = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
      expect((today - target) / 86_400_000).toBe(1);
    });

    it.for(datedTop10Cases)(
      '$path — FlixPatrol served that day in full, neither paywalled nor unpublished',
      ({ path }) => {
        const html = page(path);
        // Three outcomes, told apart by two checks: a day served in full echoes its
        // date in the canonical link, a day past the free window drops it and swaps
        // the charts for an upsell, and a day that does not exist yet returns "Page
        // Not Found" with no date anywhere. The paywall is checked first so the more
        // specific diagnosis wins.
        expect(
          html.includes(PAYWALL_NOTICE),
          `${path} is behind the FlixPatrol Premium paywall: the free history window has narrowed`,
        ).toBe(false);
        expect(
          html.includes(TOP10_DATE),
          `${path} was not served as ${TOP10_DATE}: the site's calendar no longer agrees with UTC`,
        ).toBe(true);
      },
    );
  });

  describe('Top 10 (world)', () => {
    it.for(top10WorldCases)(
      '$path — the single $type expression still selects exactly the chart',
      ({ path, type }) => {
        const expressions = top10Expressions(type, 'world');
        expect(expressions).toHaveLength(1);
        const hrefs = matches(expressions[0], page(path));
        // A "TOP 10" section holds ten entries; any other count means the
        // expression is reaching into neighbouring markup.
        expect(hrefs).toHaveLength(10);
        expect(hrefs.every((href) => DIRECT_TITLE_HREF.test(href))).toBe(true);
        expect(new Set(hrefs).size).toBe(10);
      },
    );
  });

  describe('Top 10 (regional)', () => {
    it.for(top10RegionCases)(
      '$path — the STRICT rung matches for $type, not its tolerant fallback',
      ({
        path, location, type, mayBeShortOrAbsent,
      }, ctx) => {
        const html = page(path);
        const expressions = top10Expressions(type, location);
        // Two rungs, both naming the media type: nothing selects by table position.
        expect(expressions).toHaveLength(2);

        if (!publishesChart(type, html)) {
          if (!mayBeShortOrAbsent) {
            throw new Error(
              `${path} no longer publishes a "TOP 10 ${type}" heading — either the market stopped `
              + 'charting this media type, or the section markup drifted. The day itself was served '
              + 'in full, so an unpublished chart is not one of the possibilities',
            );
          }
          // A market with no chart is not drift. Prove the two agree — the page says
          // there is nothing and NO rung finds anything — then bow out with a message
          // that cannot be mistaken for a passing assertion.
          expect(firstMatchingRung(expressions, html)).toBe(-1);
          ctx.skip(`${path} publishes no "TOP 10 ${type}" chart today: no drift signal available for this case`);
          return;
        }

        const rung = firstMatchingRung(expressions, html);
        // rung 1 means production is silently running on the looser heading match;
        // -1 means the chain is dead on a page that visibly publishes the chart.
        expect(rung).toBe(0);

        const hrefs = matches(expressions[0], html);
        if (mayBeShortOrAbsent) {
          // A small market may chart fewer than ten titles; more than ten would mean
          // the expression escaped its own section.
          expect(hrefs.length).toBeGreaterThan(0);
          expect(hrefs.length).toBeLessThanOrEqual(10);
        } else {
          expect(hrefs).toHaveLength(10);
        }
        expect(new Set(hrefs).size).toBe(hrefs.length);
        expect(hrefs.every((href) => DIRECT_TITLE_HREF.test(href))).toBe(true);
      },
    );

    /**
     * The redundancy between the subjects is SHALLOW: each self-skips as soon as its
     * market starts charting the missing type, and all of them are the same platform,
     * so one platform-wide feed change skips them all at once. A mono-type market on
     * another platform would be worth more here than a fourth Baltic one.
     *
     * Only the live verification is at stake: `tests/Flixpatrol/parse.test.ts`
     * asserts the empty-chain behaviour unconditionally against a fixture.
     */
    it.for(top10AbsentChartCases)(
      '$path — an unpublished $type chart yields EMPTY, never the other type rows',
      ({ path, location, type }, ctx) => {
        const html = page(path);
        if (publishesChart(type, html)) {
          ctx.skip(`${path} publishes a "TOP 10 ${type}" chart today: no absent-chart case to exercise`);
          return;
        }
        // The page is not blank — it charts the OTHER media type — so anything
        // positional would have plenty to grab here.
        const other: FlixPatrolType = type === 'Movies' ? 'TV Shows' : 'Movies';
        expect(publishesChart(other, html)).toBe(true);
        expect(matches(top10Expressions(other, location)[0], html).length).toBeGreaterThan(0);
        // Through the parser's own chain walk, which is what production runs.
        expect(parseTop10Page(type, location, html)).toEqual([]);
      },
    );
  });

  describe('Top 10 Kids', () => {
    it.for(top10KidsCases)(
      '$path — the STRICT rung matches for Kids $type, not its fallback',
      ({ path, type }) => {
        const expressions = top10KidsExpressions(type);
        expect(expressions).toHaveLength(2);
        const html = page(path);
        expect(firstMatchingRung(expressions, html)).toBe(0);
        const hrefs = matches(expressions[0], html);
        expect(hrefs).toHaveLength(10);
        expect(new Set(hrefs).size).toBe(10);
        expect(hrefs.every((href) => DIRECT_TITLE_HREF.test(href))).toBe(true);
      },
    );
  });

  describe('Popular', () => {
    it.for(POPULAR_PAGES)(
      '$path — the single expression still selects the card table',
      ({ path, directTitleLinks }) => {
        const hrefs = matches(POPULAR_EXPRESSION, page(path));
        expect(hrefs.length).toBeGreaterThanOrEqual(10);
        expect(hrefs.every((href) => TITLE_HREF.test(href))).toBe(true);
        expect(new Set(hrefs).size).toBe(hrefs.length);
        if (directTitleLinks) {
          // Pinned so a source that starts linking at a sub-page is noticed here
          // rather than through titles that quietly acquire a section name.
          expect(hrefs.every((href) => DIRECT_TITLE_HREF.test(href))).toBe(true);
        }
      },
    );
  });

  describe('Most watched', () => {
    it.for(MOST_WATCHED_PAGES)(
      '$path — the base expression still selects the card table',
      ({ path }) => {
        const hrefs = matches(mostWatchedExpression(false), page(path));
        expect(hrefs.length).toBeGreaterThanOrEqual(10);
        expect(hrefs.every((href) => TITLE_HREF.test(href))).toBe(true);
      },
    );

    it.for(MOST_WATCHED_PAGES)(
      '$path — the originals variant is still a strict, non-empty subset',
      ({ path }) => {
        const html = page(path);
        const all = matches(mostWatchedExpression(false), html);
        const originals = matches(mostWatchedExpression(true), html);
        // The `[.//svg]` predicate is the whole point of `original: true`: empty means
        // the badge moved out of the anchor, equal to `all` means it is a no-op.
        expect(originals.length).toBeGreaterThan(0);
        expect(originals.length).toBeLessThan(all.length);
        expect(originals.every((href) => all.includes(href))).toBe(true);
      },
    );
  });

  describe('Most hours', () => {
    it.for(mostHoursCases)(
      '$period / $type / $language — the expected rung matches',
      ({
        path, type, language, hasLanguageTabs,
      }) => {
        const expressions = mostHoursExpressions(type, language);
        expect(expressions).toHaveLength(2);
        const rung = firstMatchingRung(expressions, page(path));
        if (hasLanguageTabs) {
          // Falling back to rung 1 here would mean every language returns the same
          // undifferentiated rows and `language` has silently become decorative.
          expect(rung).toBe(0);
        } else {
          // Rung 0 matching here would mean the report gained tabs and the app is now
          // reading one arbitrary language instead of the whole period.
          expect(rung).toBe(1);
          expect(matches(expressions[0], page(path))).toHaveLength(0);
          expect(matches(expressions[1], page(path)).length).toBeGreaterThan(0);
        }
      },
    );

    it.for(mostHoursTabCases)(
      '$period / $type — the language tabs are distinct tables, not the same one three times',
      ({ path, type }) => {
        const html = page(path);
        const english = matches(mostHoursExpressions(type, 'english')[0], html);
        const nonEnglish = matches(mostHoursExpressions(type, 'non-english')[0], html);
        const sectionWide = matches(mostHoursExpressions(type, 'all')[1], html);
        expect(english.length).toBeGreaterThan(0);
        expect(nonEnglish.length).toBeGreaterThan(0);
        // A drifted tab attribute would collapse the language expressions onto one
        // another. Disjointness is the strongest form of that check and, unlike
        // comparing counts, does not depend on how many rows the site publishes.
        const englishSet = new Set(english);
        expect(nonEnglish.filter((href) => englishSet.has(href))).toEqual([]);
        // And the tab narrowing must still narrow: the section holds every tab.
        expect(sectionWide.length).toBeGreaterThan(english.length);
      },
    );

    it.for(mostHoursTotalCases)(
      '$period / $type — every language collapses onto the same rows, as the period has no tabs',
      ({ path, type }) => {
        const html = page(path);
        const rows = MOST_HOURS_LANGUAGES
          .map((language) => matches(mostHoursExpressions(type, language)[1], html));
        expect(rows[0].length).toBeGreaterThan(0);
        // Documents the shape of `total` rather than asserting it is desirable: the
        // day it stops holding, the period has gained a per-language split the
        // parser is not reading.
        for (const row of rows) {
          expect(row).toEqual(rows[0]);
        }
      },
    );
  });

  describe('Detail pages', () => {
    it('derived one detail page per spec, spanning movies and TV shows', () => {
      // Without this, every assertion below would vacuously pass over an empty set.
      expect([...details.keys()].sort()).toEqual(DETAIL_SPECS.map((spec) => spec.family).sort());
    });

    it('reduces every listing href to a canonical title page before fetching it', () => {
      const derived = [...details.values()];
      // Nothing below `/title/<slug>/` is ever requested, so no `h1` carrying a
      // section name can reach the backends.
      for (const entry of derived) {
        expect(DIRECT_TITLE_HREF.test(entry.path), `fetched ${entry.path} for ${entry.family}`).toBe(true);
      }
      // And the normalisation must still be exercised: with no sub-page href among
      // the specs, a regression in it would go unnoticed here.
      const viaSubPage = derived.filter((entry) => !DIRECT_TITLE_HREF.test(entry.listingHref));
      expect(viaSubPage.length, 'no listing published a sub-page href to normalise').toBeGreaterThan(0);
    });

    it.for(DETAIL_SPECS)(
      '$family — the PRIMARY title expression matches, not the bare //h1 fallback',
      ({ family }) => {
        // The second rung is a bare `//h1`, which matches on virtually any page and
        // would keep the parse "working" after the real container had vanished.
        const derived = detail(family);
        expect(stringValue(DETAIL_TITLE_EXPRESSIONS[0], derived.html), `on ${derived.path}`).not.toBe('');
      },
    );

    it.for(DETAIL_SPECS)(
      '$family — the premiere block is present and yields a plausible year',
      ({ family }) => {
        const derived = detail(family);
        const premiere = stringValue(DETAIL_PREMIERE_EXPRESSION, derived.html);
        // The year has no fallback on purpose: a guessed year silently selects the
        // wrong film, so the premiere block is the only source. If it moves, the year
        // goes null everywhere and the backend match degrades to title-only.
        expect(DETAIL_YEAR_PATTERN.test(premiere), `premiere block on ${derived.path}: "${premiere}"`).toBe(true);
        const { year } = parseDetailPage(derived.html);
        expect(year).not.toBeNull();
        expect(year).toBeGreaterThanOrEqual(1900);
        expect(year).toBeLessThanOrEqual(currentYear + 5);
      },
    );

    it('years parsed across distinct titles are NOT all identical', () => {
      const parsed = [...details.values()].map((derived) => parseDetailPage(derived.html));
      const years = parsed.map((derived) => derived.year);
      expect(years.every((year) => year !== null)).toBe(true);
      // Unrelated titles from unrelated charts sharing one year means the year is
      // coming from page furniture rather than from the media.
      expect(new Set(years).size).toBeGreaterThan(1);
      expect(new Set(parsed.map((derived) => derived.title)).size).toBe(parsed.length);
    });

    it.for(DETAIL_SPECS)(
      '$family — the parsed title is what the listing printed for the same href',
      ({ family }) => {
        // The only way to catch a title read off the wrong page: a sub-page of a title
        // prints the section name inside its own `h1` ("KPop Demon Hunters Hours"),
        // and the item would then be searched for in every backend under a name nobody
        // uses, which no assertion on shape alone would notice.
        //
        // A prefix test rather than equality: some listings append metadata inside the
        // same anchor while the detail page prints the bare title, so only a title
        // that is not the LEADING text of its label is a genuine mismatch.
        const derived = detail(family);
        if (derived.listingLabel === '') {
          return;
        }
        const parsed = collapse(parseDetailPage(derived.html).title);
        const label = collapse(derived.listingLabel);
        expect(label.startsWith(parsed), `${derived.path}: listing "${label}" vs detail "${parsed}"`).toBe(true);
      },
    );
  });

  describe('Politeness', () => {
    it('fetched every page exactly once and stayed within the request budget', () => {
      // Every assertion above reads from the bootstrap cache, so live requests must
      // equal the number of distinct URLs; more means something is re-fetching.
      expect(requestCount).toBe(pages.size);
      expect(requestCount).toBeLessThanOrEqual(REQUEST_BUDGET);
    });
  });
});
