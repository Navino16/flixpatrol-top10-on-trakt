import { JSDOM } from 'jsdom';
import { logger } from '../Utils';
import type {
  FlixPatrolMostHoursLanguage,
  FlixPatrolTop10Location,
  FlixPatrolType,
} from '../types';

/**
 * Pure parsing layer for FlixPatrol pages: HTML string in, plain data out.
 *
 * Nothing here fetches, caches or knows about the configuration — which is the
 * point. Every XPath expression below is matched against a live third-party site
 * that no test can validate, so they are only ever exercised through fixtures.
 * Keep them, and the order in which they are attempted, exactly as they are:
 * a "tidied" expression is an untestable production break.
 */

/** One raw match: the href FlixPatrol prints for a media, e.g. `/title/inception`. */
export type FlixPatrolMatchResult = string;

/**
 * A detail-page path: its canonical head, plus whatever the listing appended to it
 * (a sub-page segment, a query string, a fragment). Anything that does not look
 * like `/title/<slug>` simply does not match.
 */
const TITLE_PATH_PATTERN = /^(\/title\/[^/?#]+)(?:[/?#].*)?$/;

/**
 * Reduces a listing href to the canonical detail page it belongs to, `/title/<slug>/`.
 *
 * Not every listing links at the title page itself. Most-watched links at
 * `/title/<slug>/hours/`, and YouTube Popular at `/title/<slug>/trailers/#toc-...`.
 * Those sub-pages carry a DIFFERENT `h1`: the section name is appended to the media
 * name, so the very same expressions that read a title correctly on `/title/<slug>/`
 * read "KPop Demon Hunters Hours" and "Primetime Trailers" one level below. Fetching
 * the href verbatim therefore searches every backend under a name nobody uses.
 *
 * The repair belongs to the URL, and only to the URL. Trimming a " Hours" suffix off
 * the parsed title looks equivalent and is not: "72 Hours" is a real film that charts
 * on Netflix, and it would come back as "72". Once a section name has been
 * concatenated onto a title there is no way to tell the two apart, so the
 * concatenation must never be allowed to happen in the first place.
 *
 * Conservative by construction: a path that is not a title page is returned
 * untouched, and an already-canonical one is returned unchanged.
 */
export function toCanonicalTitlePath(path: string): string {
  const match = TITLE_PATH_PATTERN.exec(path);
  return match === null ? path : `${match[1]}/`;
}

/** What a detail page says about one media. */
export interface FlixPatrolDetail {
  title: string;
  year: number | null;
}

/**
 * Evaluates one XPath expression over an HTML string and returns every matched
 * text content. Returns an empty array rather than throwing, so a caller trying
 * a chain of expressions can simply move on to the next one.
 */
function parsePage(expression: string, html: string): FlixPatrolMatchResult[] {
  const dom = new JSDOM(html);
  const match = dom.window.document.evaluate(
    expression,
    dom.window.document,
    null,
    dom.window.XPathResult.UNORDERED_NODE_ITERATOR_TYPE,
    null,
  );
  const results: string[] = [];

  try {
    let p = match.iterateNext();
    while (p !== null) {
      if (p.textContent) {
        results.push(p.textContent);
      }
      p = match.iterateNext();
    }
  } catch (err) {
    logger.error(`Error parsing XPath: ${err}`);
    return [];
  }
  return results;
}

/**
 * Every expression tried for the Top10 section, strictest first.
 *
 * Exported so the drift suite can assert WHICH rung matched against the live
 * site, instead of only that the chain as a whole produced something. A fallback
 * quietly taking over is itself the early warning, and it can only be observed
 * from outside if the rungs are addressable one by one — duplicating the strings
 * in the test would defeat the purpose, since the copy could not drift with the
 * original.
 */
export function top10Expressions(
  type: FlixPatrolType,
  location: FlixPatrolTop10Location,
): string[] {
  if (location === 'world') {
    return [
      `//div[h2[span[contains(., "TOP ${type}")]]]/parent::div//a[contains(@class,'hover:underline')]/@href`,
    ];
  }
  return [
    // Original strict
    `//div[h3[text() = "TOP 10 ${type}"]]/parent::div//a[contains(@class,'hover:underline')]/@href`,
    // More tolerant headline match
    `//h3[contains(., "TOP 10") and contains(., "${type === 'Movies' ? 'Movies' : 'TV Shows'}")]/ancestor::div[1]/following-sibling::div[1]//a[contains(@class,'hover:underline')]/@href`,
    // Generic first tables fallback
    `((//table)[1] | (//table)[2])//a[contains(@class,'hover:underline')]/@href`,
  ];
}

/**
 * Top10 section of a platform page. The world page and the regional pages do not
 * share the same markup, and the regional one has drifted enough over time to
 * warrant a chain of three expressions, from strictest to loosest.
 */
export function parseTop10Page(
  type: FlixPatrolType,
  location: FlixPatrolTop10Location,
  html: string,
): FlixPatrolMatchResult[] {
  const expressions = top10Expressions(type, location);
  for (const expr of expressions) {
    const res = parsePage(expr, html);
    if (res.length > 0){
      logger.silly(`Found ${res.length} ${type} in ${expr}`);
      return res;
    }
  }
  return [];
}

/** Every expression tried for the Kids Top10 section, strictest first. */
export function top10KidsExpressions(type: FlixPatrolType): string[] {
  const kidsType = type === 'Movies' ? 'Kids Movies' : 'Kids TV Shows';
  return [
    // Match h3 with "TOP 10 Kids Movies/TV Shows" followed by table
    `//h3[text() = "TOP 10 ${kidsType}"]/parent::div/following-sibling::table//a[@class="hover:underline"]/@href`,
    // Fallback with contains for more tolerance
    `//h3[contains(., "TOP 10") and contains(., "${kidsType}")]/parent::div/following-sibling::table//a[@class="hover:underline"]/@href`,
  ];
}

/**
 * Kids variant of the Top10 section, which lives in its own table and is only
 * published for Netflix on regional pages.
 */
export function parseTop10KidsPage(
  type: FlixPatrolType,
  html: string,
): FlixPatrolMatchResult[] {
  const kidsType = type === 'Movies' ? 'Kids Movies' : 'Kids TV Shows';
  const expressions = top10KidsExpressions(type);

  for (const expr of expressions) {
    const res = parsePage(expr, html);
    if (res.length > 0) {
      logger.silly(`Found ${res.length} ${kidsType} in ${expr}`);
      return res;
    }
  }
  return [];
}

/** The single expression a Popular page relies on. There is no fallback rung. */
export const POPULAR_EXPRESSION = '//table[@class="card-table"]//a[@class="flex gap-2 group items-center"]/@href';

/** Popular page: a single card table, no fallback. */
export function parsePopularPage(
  html: string,
): FlixPatrolMatchResult[] {
  return parsePage(POPULAR_EXPRESSION, html);
}

/** The single expression a Most-watched page relies on, for each of its two modes. */
export function mostWatchedExpression(originalsOnly: boolean): string {
  if (originalsOnly) {
    return '//table[@class="card-table"]//a[@class="flex gap-2 group items-center"][.//svg]/@href';
  }
  return '//table[@class="card-table"]//a[@class="flex gap-2 group items-center"]/@href';
}

/**
 * Most-watched page. `originalsOnly` narrows the selection to the rows carrying
 * the Netflix-original badge, which is an `svg` inside the link.
 */
export function parseMostWatchedPage(
  html: string,
  originalsOnly: boolean,
): FlixPatrolMatchResult[] {
  return parsePage(mostWatchedExpression(originalsOnly), html);
}

/**
 * Most-hours page: one section per media type, and — outside the `total` period —
 * one table per language tab.
 */
/**
 * The two expressions a Most-hours page relies on, strictest first: the
 * language-tab table, then the whole section. The second rung exists for the
 * `total` period, which publishes no language tabs at all — so a fallback there
 * is normal, while a fallback on a period that DOES have tabs means the tab
 * markup drifted and every language now returns the same rows.
 */
export function mostHoursExpressions(
  type: FlixPatrolType,
  language: FlixPatrolMostHoursLanguage,
): string[] {
  const sectionId = type === 'Movies' ? 'toc-movies' : 'toc-tv-shows';
  const langMap: Record<FlixPatrolMostHoursLanguage, string> = {
    'all': 'all-languages',
    'english': 'english',
    'non-english': 'non-english',
  };
  const langTab = langMap[language];

  return [
    // For language-specific tables, we need to find the correct table within the section
    // The tables use x-show="isCurrent('all-languages')" etc.
    `//div[@id="${sectionId}"]//table[contains(@x-show, "'${langTab}'")]//a[@class="flex gap-2 group items-center"]/@href`,
    // Fallback for 'total' period which doesn't have language tabs
    `//div[@id="${sectionId}"]//table[@class="card-table"]//a[@class="flex gap-2 group items-center"]/@href`,
  ];
}

export function parseMostHoursPage(
  type: FlixPatrolType,
  language: FlixPatrolMostHoursLanguage,
  html: string,
): FlixPatrolMatchResult[] {
  const [expression, fallbackExpr] = mostHoursExpressions(type, language);
  let results = parsePage(expression, html);

  if (results.length === 0) {
    results = parsePage(fallbackExpr, html);
  }

  return results;
}

/**
 * Title as FlixPatrol prints it on a detail page.
 * The two expressions and their order are load-bearing against the live site:
 * do not touch them without re-checking a real detail page.
 * The title lives in `div.info-grid-header`, a direct child of `div.info-grid`.
 */
/**
 * The two title expressions, strictest first. The second one is a bare `//h1`,
 * which matches on essentially any page and therefore hides a drift of the first
 * completely: the suite has to be able to interrogate rung 1 on its own.
 */
export const DETAIL_TITLE_EXPRESSIONS = [
  '//div[contains(@class,"info-grid-header")]//h1/text()',
  '//h1/text()',
];

export function parseDetailTitle(dom: JSDOM): string {
  // Title with fallback (kept)
  for (const expression of DETAIL_TITLE_EXPRESSIONS) {
    const title = dom.window.document.evaluate(
      expression,
      dom.window.document,
      null,
      dom.window.XPathResult.STRING_TYPE,
      null,
    ).stringValue.trim();
    if (title) {
      return title;
    }
  }
  return '';
}

/**
 * Release year, or null when the detail page exposes nothing usable.
 *
 * The year is read only from the premiere block inside `div.info-grid-header`
 * (`<div title="Premiere">`), whose date is formatted MM/DD/YYYY. Only the year is
 * needed, so the day/month ambiguity never has to be resolved: a four-digit run
 * starting with 19 or 20 cannot appear before the year in that format.
 *
 * There is deliberately NO fallback. A previous version scanned the text of
 * `div.mb-6`, which the site now uses for a marketing blurb ending in
 * "the most popular TV shows in 2021" — that stamped 2021 onto every single title
 * and made the "exact title AND year" branch of the backend match cascade select
 * the wrong film with full confidence. A missing year degrades the cascade to
 * title-only and is not cached; a wrong year is silently destructive. Never guess.
 */
export const DETAIL_PREMIERE_EXPRESSION = '//div[contains(@class,"info-grid-header")]//div[@title="Premiere"]';

/** The four-digit run the premiere block is scanned for. */
export const DETAIL_YEAR_PATTERN = /(19|20)\d{2}/;

export function parseDetailYear(dom: JSDOM): number | null {
  const premiereBlock = dom.window.document.evaluate(
    DETAIL_PREMIERE_EXPRESSION,
    dom.window.document,
    null,
    dom.window.XPathResult.STRING_TYPE,
    null,
  ).stringValue;
  const match = premiereBlock.match(DETAIL_YEAR_PATTERN);
  if (match === null) {
    return null;
  }
  const year = parseInt(match[0], 10);
  return Number.isNaN(year) ? null : year;
}

/**
 * Whole detail page in one pass. The DOM is built once and handed to both
 * extractors, which is the only reason they take a prepared DOM rather than the
 * raw HTML: parsing a detail page twice would double the cost of every scrape.
 */
export function parseDetailPage(html: string): FlixPatrolDetail {
  const dom = new JSDOM(html);
  return {
    title: parseDetailTitle(dom),
    year: parseDetailYear(dom),
  };
}
