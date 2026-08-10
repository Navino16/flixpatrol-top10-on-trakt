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
 * Nothing is pinned to a calendar either: the most-watched years and the Top 10
 * date are derived from `new Date()`, so no page path rots on a fixed date.
 *
 * WHY THE TOP 10 URLS CARRY A DATE. FlixPatrol publishes a day progressively:
 * `/top10/netflix/united-states` is the CURRENT day, and early in the morning it
 * holds the two main charts but not yet the Kids ones. Measured at 08:30 UTC, the
 * undated page was 81 KB with no "Kids" anywhere, while the previous day's URL was
 * 99 KB and carried both Kids sections. Against the undated URL this suite would
 * therefore have reported twelve Kids failures every week — the canary runs on a
 * weekly cron at 06:30 UTC, squarely inside the incomplete window — and a canary
 * that is always red is a canary nobody reads. An unpublished chart is not drift,
 * so the Top 10 family asks for the last COMPLETED day instead. See `TOP10_DATE`
 * for why it is exactly one day and never two.
 *
 * WHY SEVERAL PAGES PER FAMILY. One page per family only proves the expression
 * survives on that one layout. FlixPatrol renders a big catalogue, a small one,
 * a niche regional platform and a language-tabbed report differently enough that
 * an expression can die on one shape while still matching on another. Each
 * family below therefore spans three or four deliberately DIFFERENT pages, and
 * every case is table-driven so a red CI line names the page and the rung
 * without anyone opening this file.
 *
 * MECHANICS. FlixPatrol sits behind Cloudflare, so the suite needs FlareSolverr
 * and is gated on `E2E_FLARESOLVERR_URL`; without it, it skips cleanly. Each
 * page is fetched exactly ONCE during bootstrap and shared by every assertion —
 * `fetchPage` is memoised and the suite asserts its own request count against a
 * hard budget, because this is someone else's server and the polite ceiling is
 * the one thing that must not creep upwards unnoticed.
 */
const flareSolverrUrl = process.env.E2E_FLARESOLVERR_URL ?? '';

const BASE_URL = 'https://flixpatrol.com';

/** Politeness delay between two FlixPatrol page loads. */
const REQUEST_DELAY_MS = 1500;

/**
 * Hard ceiling on live page loads for the whole suite, asserted at the end.
 *
 * The suite currently plans 20 listing pages plus 8 detail pages derived from
 * them. The budget leaves a small margin and no more: it exists so that adding
 * "just one more page" is a deliberate act that shows up in a diff, rather than
 * something that quietly triples the load on a site that owes us nothing.
 */
const REQUEST_BUDGET = 30;

/** Whole-suite budget: ~28 page loads, the first of which solves a challenge. */
const BOOTSTRAP_TIMEOUT_MS = 600_000;

const MEDIA_TYPES: readonly FlixPatrolType[] = ['Movies', 'TV Shows'];

const currentYear = new Date().getFullYear();

/**
 * The day every Top 10 URL asks for: the day before the run, in UTC.
 *
 * ONE day, and never more. FlixPatrol gives away a short rolling window of daily
 * history and paywalls everything older: measured today, the six previous days
 * came back complete (99 KB, both Kids charts) while the seventh returned a 32 KB
 * stub reading "only available to paid subscribers". So the last completed day is
 * the freshest date that is guaranteed both published AND free, and reaching
 * further back trades a false positive for a slow march towards the paywall. There
 * is deliberately no retry chain: a date that does not answer is a signal, and
 * silently walking backwards until something does would suppress exactly the
 * signal this suite exists to raise.
 *
 * DERIVED IN UTC, which is the one assumption here that could quietly reintroduce
 * the failure it fixes. If FlixPatrol's own calendar ran behind UTC, "yesterday in
 * UTC" could still be TODAY for the site, i.e. incomplete again. Measured against
 * the live site: at 08:30 UTC the undated page served the UTC date, the UTC date's
 * own dated URL served the same partial page, and the NEXT date returned "Page Not
 * Found" — so the site's notion of today is the UTC date, not one behind it. The
 * dated-page guard below turns any future divergence into a named failure instead
 * of twelve mysterious empty-chart ones.
 */
const TOP10_DATE = ((): string => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
})();

/**
 * The dated form FlixPatrol serves a completed day under, trailing slash included:
 * `/top10/<platform>/<country>/YYYY-MM-DD/`. Verified against the live site — the
 * form without the trailing slash answers too, but only via a redirect, so the
 * slash is spelled out rather than paid for on every request.
 */
const onPreviousDay = (path: string): string => `${path}/${TOP10_DATE}/`;

/**
 * The phrase FlixPatrol replaces a chart with once the day has aged past its free
 * window. Present exactly once on a paywalled day and on no page that is served in
 * full — the site's own upsell links say "FlixPatrol Premium" everywhere, so the
 * shorter string would match every page and detect nothing.
 */
const PAYWALL_NOTICE = 'only available to paid subscribers';

/**
 * Top 10 (world) — one page per platform, chosen for catalogue size rather than
 * popularity: Netflix and Disney+ render long, dense charts, Apple TV+ a sparse
 * one, and HBO Max sits in between. A world chart has a single expression with
 * no fallback, so all four have to hold it up on their own.
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
   * True when this market may legitimately publish a short chart, or none at
   * all, for a given media type. Only pages flagged here are allowed to report
   * "no chart"; anywhere else a missing chart is drift and fails.
   */
  mayBeShortOrAbsent: boolean;
}

/**
 * Top 10 (regional) — the three-rung chain, across four different platform and
 * country pairings.
 *
 * `go3/latvia` is the deliberate small-market case: a regional Baltic service
 * whose page publishes a Movies chart but, routinely, no TV Shows chart at all.
 * That is not a hypothetical — it is precisely the situation where a naive
 * "something matched" assertion is worst: with no TV Shows chart, the strict
 * rung correctly returns nothing and the chain falls through to its loosest
 * rung, which scoops up whatever tables the page does have. A page with no data
 * must therefore be recognised as such and reported distinctly, never as drift.
 *
 * Asking for a COMPLETED day is what keeps that distinction sharp. On the current
 * day a missing chart is ambiguous — the market may not chart it, or the site may
 * simply not have got round to publishing it yet. On a finished day only the first
 * reading survives, so the skip below means what it says. Verified on the live
 * site: `go3/latvia` publishes a full Movies chart and no TV Shows heading at all
 * on a completed day.
 */
const TOP10_REGION_PAGES: readonly RegionalPage[] = [
  { path: onPreviousDay('/top10/netflix/france'), location: 'france', mayBeShortOrAbsent: false },
  { path: onPreviousDay('/top10/disney/united-states'), location: 'united-states', mayBeShortOrAbsent: false },
  { path: onPreviousDay('/top10/amazon-prime/japan'), location: 'japan', mayBeShortOrAbsent: false },
  { path: onPreviousDay('/top10/go3/latvia'), location: 'latvia', mayBeShortOrAbsent: true },
];

/**
 * Top 10 Kids — Netflix only (the app refuses any other platform) and regional
 * only, so the variation available is the country. France is reused from the
 * regional table above rather than fetched twice, which only works because both
 * tables date their paths identically.
 *
 * This is the family the dated URL exists for: Kids is the LAST section of a day
 * to be published, so it is the one the undated URL is systematically missing at
 * cron time. All four countries were verified to carry both Kids charts on a
 * completed day.
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
   * YouTube links at `/title/<slug>/trailers/#toc-...` instead.
   *
   * This is documentation of the site's shape, NOT a correctness requirement:
   * the scraper canonicalises every href before fetching it, so a sub-page link
   * is harmless. What must hold for both sources alike is that the title parsed
   * from the canonical page matches what the listing printed — asserted in the
   * detail section below, where both Wikipedia and YouTube now have a spec.
   */
  directTitleLinks: boolean;
}

/**
 * Popular — both sources the app accepts, plus both media types for Wikipedia.
 *
 * NOT dated, and not merely because it does not need to be: these are cumulative
 * all-time rankings, not a chart for a given day. Appending a date was tried
 * against the live site and is actively misleading — the extra segment is
 * swallowed and the CURRENT ranking comes back under a URL that claims to be a
 * historical one, so the suite would be asserting against a page it had
 * misunderstood.
 */
const POPULAR_PAGES: readonly PopularPage[] = [
  { path: '/popular/movies/wikipedia', directTitleLinks: true },
  { path: '/popular/tv-shows/wikipedia', directTitleLinks: true },
  // YouTube publishes one single trailer chart: `/popular/tv-shows/youtube`
  // currently returns byte-identical rows, so fetching it too would spend a
  // request on a page already covered.
  { path: '/popular/movies/youtube', directTitleLinks: false },
];

/**
 * Most watched — two different years and both media shapes. Years are derived,
 * never written down: the last completed year is always published, so these
 * paths stay valid forever instead of rotting. The `original: true` variant is
 * a second expression over the SAME page, so it costs no extra request.
 *
 * Already dated, by YEAR, and that is the only granularity the route has: a day
 * appended to it returns "Page Not Found" on the live site. Same for Most hours
 * below, which is a per-title lifetime total with no daily dimension at all.
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
   * Whether the period publishes per-language tabs. `total` does not, which is
   * the entire reason the second rung exists — so on `total` the fallback is the
   * CORRECT answer and rung 0 must legitimately match nothing.
   */
  hasLanguageTabs: boolean;
}

/** Most hours — all three periods the app can request. */
const MOST_HOURS_PAGES: readonly MostHoursPage[] = [
  { path: '/streaming-services/most-hours-total/netflix/', period: 'total', hasLanguageTabs: false },
  { path: '/streaming-services/most-hours-first-week/netflix/', period: 'first-week', hasLanguageTabs: true },
  { path: '/streaming-services/most-hours-first-month/netflix/', period: 'first-month', hasLanguageTabs: true },
];

const MOST_HOURS_LANGUAGES: readonly FlixPatrolMostHoursLanguage[] = ['all', 'english', 'non-english'];

/**
 * Detail pages are NEVER hardcoded: individual title pages disappear as the site
 * prunes them, and a fixed list would rot within months. Each spec names a
 * listing already fetched for another family and the expression to pull an href
 * out of it, so the set heals itself every run.
 *
 * The seven specs deliberately span movies and TV shows, world and regional
 * charts, a kids chart (animation, frequently older and non-English) and the two
 * evergreen Wikipedia charts (which reach much further back than any Top 10) —
 * so the release years have every reason to differ, which is what the
 * cross-page "not all the same year" invariant needs in order to mean anything.
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
    // The second listing family that links at a sub-page rather than at the title.
    // It went uncovered while the sub-page bug was live — and asserting it then
    // would have locked the defect in, so it is added now that the scraper
    // canonicalises hrefs, precisely so a regression cannot pass unnoticed here
    // just because it happens to be a different family than most-watched.
    family: 'popular-movie-youtube',
    listingPath: '/popular/movies/youtube',
    expression: POPULAR_EXPRESSION,
  },
];

/**
 * Every Top 10 page the suite loads, deduplicated — all of them dated, which is
 * what lets the guard below assert the day was served in full exactly once per URL
 * rather than once per media type.
 */
const DATED_TOP10_PATHS: readonly string[] = Array.from(new Set<string>([
  ...TOP10_WORLD_PATHS,
  ...TOP10_REGION_PAGES.map((entry) => entry.path),
  ...TOP10_KIDS_PATHS,
]));

/** Every listing page the suite loads, deduplicated. */
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
  /** Which listing family the URL came from, so a failure names the family. */
  family: string;
  /** The href exactly as the listing printed it, which may be a sub-page. */
  listingHref: string;
  /** The page actually fetched: the canonical `/title/<slug>/` form of the href. */
  path: string;
  html: string;
  /** The label the listing itself printed for that href. */
  listingLabel: string;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms); });

/** Squashes the whitespace the site sprinkles inside its anchors. */
const collapse = (value: string): string => value.replace(/\s+/g, ' ').trim();

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

/**
 * Evaluates one XPath over an HTML string, exactly as the parser does. The
 * evaluation is re-implemented here on purpose: what is under test is the
 * EXPRESSIONS, so re-using the parser's own chain-walking would hide which rung
 * produced the result.
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
 * Index of the first rung that matches, or -1 when the whole chain is dead.
 * Anything other than the rung a page is supposed to be served by means
 * production is currently running on a fallback, which is the early warning this
 * suite exists to raise.
 */
const firstMatchingRung = (expressions: string[], html: string): number => expressions
  .findIndex((expression) => matches(expression, html).length > 0);

/**
 * Does the page publish a chart for this media type AT ALL?
 *
 * Deliberately independent of the expressions under test: it looks for the
 * section heading, not for the anchors the parser selects. That separation is
 * what makes "this small market has no TV Shows chart today" distinguishable
 * from "the expression that selects TV Shows anchors has drifted". The match is
 * exact rather than `contains`, so "TOP 10 Kids Movies" is not mistaken for the
 * main Movies chart.
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

  /**
   * Memoised: a path already loaded is served from memory, so no URL is ever
   * requested twice however many assertions read it.
   */
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
    // title (`/hours/`, `/trailers/#toc-...`) whose `h1` is the media name with
    // the section name welded onto it; the scraper reduces every href to its
    // canonical `/title/<slug>/` form first, so the suite must do the same or it
    // would be exercising a code path the app no longer takes.
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
    client = new FlareSolverrClient({ enabled: true, url: flareSolverrUrl, maxTimeout: 60000 });
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
   * Declared FIRST on purpose. Every Top 10 assertion below reads a page for one
   * specific day, and all of them are meaningless if the site did not serve that
   * day. Without this block a paywalled or unpublished date would surface as a
   * dozen "the strict rung matched nothing" failures pointing at the expressions —
   * which is drift's signature, and would send whoever reads the CI line hunting
   * markup that never changed.
   */
  describe('Dated Top 10 pages', () => {
    it('asks for exactly one day back, never further into the paywalled archive', () => {
      // Guards the derivation itself rather than the site. Two days back is not a
      // safer fallback, it is a step towards the paywall — so a refactor that
      // widens the offset has to fail here instead of quietly working until the
      // free window shifts under it.
      const target = Date.parse(`${TOP10_DATE}T00:00:00Z`);
      const today = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
      expect((today - target) / 86_400_000).toBe(1);
    });

    it.for(datedTop10Cases)(
      '$path — FlixPatrol served that day in full, neither paywalled nor unpublished',
      ({ path }) => {
        const html = page(path);
        // Three outcomes, told apart by two checks. A day served in full echoes
        // its own date in the canonical link and the og:url. A day past the free
        // window keeps the date in its <title> but drops it from the canonical
        // link and swaps the charts for an upsell. A day that does not exist yet
        // returns "Page Not Found" and mentions no date anywhere. The paywall is
        // checked first, so the more specific diagnosis wins.
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
        // World has a single rung by design: if it dies, nothing catches it.
        expect(expressions).toHaveLength(1);
        const hrefs = matches(expressions[0], page(path));
        // A "TOP 10" section holds ten entries. A different count means the
        // expression is now reaching into neighbouring markup.
        expect(hrefs).toHaveLength(10);
        expect(hrefs.every((href) => DIRECT_TITLE_HREF.test(href))).toBe(true);
        expect(new Set(hrefs).size).toBe(10);
      },
    );
  });

  describe('Top 10 (regional)', () => {
    it.for(top10RegionCases)(
      '$path — the STRICT rung matches for $type, not one of its two fallbacks',
      ({
        path, location, type, mayBeShortOrAbsent,
      }, ctx) => {
        const html = page(path);
        const expressions = top10Expressions(type, location);
        expect(expressions).toHaveLength(3);

        if (!publishesChart(type, html)) {
          if (!mayBeShortOrAbsent) {
            throw new Error(
              `${path} no longer publishes a "TOP 10 ${type}" heading — either the market stopped `
              + 'charting this media type, or the section markup drifted. The day itself was served '
              + 'in full, so an unpublished chart is not one of the possibilities',
            );
          }
          // A market with no chart is not drift. Prove the two agree — the page
          // says there is nothing, and the strict rung finds nothing — then bow
          // out with a message that cannot be mistaken for a passing assertion.
          //
          // This branch means "this market does not chart this media type" and
          // nothing else. The third reading it could once have had, "the day is
          // not fully published yet", is ruled out upstream: the page is a
          // completed day and the guard above already asserted the site served it.
          expect(matches(expressions[0], html)).toHaveLength(0);
          ctx.skip(`${path} publishes no "TOP 10 ${type}" chart today: no drift signal available for this case`);
          return;
        }

        const rung = firstMatchingRung(expressions, html);
        // rung 0 is the only acceptable answer. rung 1 or 2 means the site
        // drifted and production is silently running on a looser expression;
        // rung 2 in particular scoops up whole tables and would return far more
        // than ten titles. -1 means the whole chain is dead.
        expect(rung).toBe(0);

        const hrefs = matches(expressions[0], html);
        if (mayBeShortOrAbsent) {
          // A small market may chart fewer than ten titles; what must never
          // happen is more than ten, which would mean the expression escaped
          // its own section.
          expect(hrefs.length).toBeGreaterThan(0);
          expect(hrefs.length).toBeLessThanOrEqual(10);
        } else {
          expect(hrefs).toHaveLength(10);
        }
        expect(new Set(hrefs).size).toBe(hrefs.length);
        expect(hrefs.every((href) => DIRECT_TITLE_HREF.test(href))).toBe(true);
      },
    );

    it.for(TOP10_REGION_PAGES)(
      '$path — the loosest rung over-matches, proving it is a degraded substitute',
      ({ path, location }) => {
        const html = page(path);
        const expressions = top10Expressions('Movies', location);
        const strict = matches(expressions[0], html);
        const loosest = matches(expressions[2], html);
        // Documents WHY falling back matters: the last rung mixes several charts
        // together, so a silent fallback does not merely change the selector, it
        // changes the list that users receive.
        expect(loosest.length).toBeGreaterThan(strict.length);
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
        // No fallback exists here, so this expression dying is an outright outage
        // rather than a silent degradation — but it is still worth catching early.
        expect(hrefs.length).toBeGreaterThanOrEqual(10);
        expect(hrefs.every((href) => TITLE_HREF.test(href))).toBe(true);
        expect(new Set(hrefs).size).toBe(hrefs.length);
        if (directTitleLinks) {
          // Wikipedia rows must keep pointing at the title itself. The day they
          // point at a sub-page instead, every title the app reads from this
          // chart acquires the sub-page's heading — the exact failure mode the
          // most-watched chart already exhibits.
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
        // The `[.//svg]` predicate is the whole point of `original: true`. Empty
        // means the originals badge moved out of the anchor; equal to `all` means
        // the predicate has become a no-op and the option silently does nothing.
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
          // On a period that HAS tabs, falling back to rung 1 means every
          // language now returns the same undifferentiated rows and the
          // `language` setting has silently become decorative.
          expect(rung).toBe(0);
        } else {
          // `total` publishes no language tabs, so rung 1 is the CORRECT answer
          // and rung 0 must match nothing. Rung 0 suddenly matching here would
          // mean the report gained tabs and the app is now reading one arbitrary
          // language instead of the whole period.
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
        // If the tab attribute drifted, the language expressions would collapse
        // onto one another and `language` would become a decorative setting.
        // Disjointness is the strongest form of that check and, unlike a
        // comparison of counts, it does not depend on how many rows the site
        // decides to publish today.
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
        // Documents the shape of the `total` period rather than asserting it is
        // desirable: with no tabs to narrow, all three languages are one list.
        // The day this stops holding, `total` has gained a per-language split
        // that the parser is not reading.
        for (const row of rows) {
          expect(row).toEqual(rows[0]);
        }
      },
    );
  });

  describe('Detail pages', () => {
    it('derived one detail page per spec, spanning movies and TV shows', () => {
      // Guards the derivation itself: without it, every assertion below would
      // vacuously pass over an empty set.
      expect([...details.keys()].sort()).toEqual(DETAIL_SPECS.map((spec) => spec.family).sort());
    });

    it('reduces every listing href to a canonical title page before fetching it', () => {
      const derived = [...details.values()];
      // The hard invariant: nothing below `/title/<slug>/` is ever requested, so
      // no `h1` carrying a section name can reach the backends.
      for (const entry of derived) {
        expect(DIRECT_TITLE_HREF.test(entry.path), `fetched ${entry.path} for ${entry.family}`).toBe(true);
      }
      // And the guard must still be exercised: if no listing published a sub-page
      // href today, the assertions below would pass without ever touching the
      // normalisation, and a regression in it would go unnoticed here.
      const viaSubPage = derived.filter((entry) => !DIRECT_TITLE_HREF.test(entry.listingHref));
      expect(viaSubPage.length, 'no listing published a sub-page href to normalise').toBeGreaterThan(0);
    });

    it.for(DETAIL_SPECS)(
      '$family — the PRIMARY title expression matches, not the bare //h1 fallback',
      ({ family }) => {
        // This is the exact assertion the 2021 incident needed. The second rung is
        // a bare `//h1`, which matches on virtually any page and would keep the
        // parse "working" while the real container had vanished.
        const derived = detail(family);
        expect(stringValue(DETAIL_TITLE_EXPRESSIONS[0], derived.html), `on ${derived.path}`).not.toBe('');
      },
    );

    it.for(DETAIL_SPECS)(
      '$family — the premiere block is present and yields a plausible year',
      ({ family }) => {
        const derived = detail(family);
        const premiere = stringValue(DETAIL_PREMIERE_EXPRESSION, derived.html);
        // No fallback exists for the year on purpose: a wrong year is silently
        // destructive, so the premiere block is the only source. If it moves, the
        // year goes null everywhere and the backend match degrades to title-only.
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
      // THE signature of the 2021 bug: unrelated titles pulled from unrelated
      // charts sharing one year means the year is coming from page furniture,
      // not from the media. Holds regardless of what the site lists today.
      expect(new Set(years).size).toBeGreaterThan(1);
      expect(new Set(parsed.map((derived) => derived.title)).size).toBe(parsed.length);
    });

    it.for(DETAIL_SPECS)(
      '$family — the parsed title is what the listing printed for the same href',
      ({ family }) => {
        // Cross-check between two independent parts of the site, and the only way
        // to catch a title read off the wrong page. Most watched links at
        // `/title/<slug>/hours/` and YouTube Popular at `/title/<slug>/trailers/`,
        // and both sub-pages print the section name inside their own `h1`
        // ("KPop Demon Hunters Hours"). The item would then be searched for in
        // every backend under a name nobody uses, and no assertion on shape alone
        // would notice. Both families have a spec above, so the canonicalisation
        // that prevents it is covered wherever the site publishes a sub-page link.
        //
        // The listing label is a prefix test, not an equality one: some listings
        // append metadata (type, country, premiere date) inside the same anchor,
        // while the detail page prints the bare title. A title that is NOT the
        // leading text of its own listing label is a genuine mismatch.
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
      // Every assertion above reads from the bootstrap cache, so the number of
      // live requests is exactly the number of distinct URLs. If this ever
      // exceeds the number of pages the tables declare, something is re-fetching.
      expect(requestCount).toBe(pages.size);
      expect(requestCount).toBeLessThanOrEqual(REQUEST_BUDGET);
    });
  });
});
