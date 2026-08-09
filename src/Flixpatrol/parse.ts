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
 * Top10 section of a platform page. The world page and the regional pages do not
 * share the same markup, and the regional one has drifted enough over time to
 * warrant a chain of three expressions, from strictest to loosest.
 */
export function parseTop10Page(
  type: FlixPatrolType,
  location: FlixPatrolTop10Location,
  html: string,
): FlixPatrolMatchResult[] {
  const expressions: string[] = [];
  if (location === 'world') {
    expressions.push(`//div[h2[span[contains(., "TOP ${type}")]]]/parent::div//a[contains(@class,'hover:underline')]/@href`);
  } else {
    // Original strict
    expressions.push(`//div[h3[text() = "TOP 10 ${type}"]]/parent::div//a[contains(@class,'hover:underline')]/@href`);
    // More tolerant headline match
    expressions.push(`//h3[contains(., "TOP 10") and contains(., "${type === 'Movies' ? 'Movies' : 'TV Shows'}")]/ancestor::div[1]/following-sibling::div[1]//a[contains(@class,'hover:underline')]/@href`);
    // Generic first tables fallback
    expressions.push(`((//table)[1] | (//table)[2])//a[contains(@class,'hover:underline')]/@href`);
  }
  for (const expr of expressions) {
    const res = parsePage(expr, html);
    if (res.length > 0){
      logger.silly(`Found ${res.length} ${type} in ${expr}`);
      return res;
    }
  }
  return [];
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
  const expressions: string[] = [
    // Match h3 with "TOP 10 Kids Movies/TV Shows" followed by table
    `//h3[text() = "TOP 10 ${kidsType}"]/parent::div/following-sibling::table//a[@class="hover:underline"]/@href`,
    // Fallback with contains for more tolerance
    `//h3[contains(., "TOP 10") and contains(., "${kidsType}")]/parent::div/following-sibling::table//a[@class="hover:underline"]/@href`,
  ];

  for (const expr of expressions) {
    const res = parsePage(expr, html);
    if (res.length > 0) {
      logger.silly(`Found ${res.length} ${kidsType} in ${expr}`);
      return res;
    }
  }
  return [];
}

/** Popular page: a single card table, no fallback. */
export function parsePopularPage(
  html: string,
): FlixPatrolMatchResult[] {
  const expression = '//table[@class="card-table"]//a[@class="flex gap-2 group items-center"]/@href';

  return parsePage(expression, html);
}

/**
 * Most-watched page. `originalsOnly` narrows the selection to the rows carrying
 * the Netflix-original badge, which is an `svg` inside the link.
 */
export function parseMostWatchedPage(
  html: string,
  originalsOnly: boolean,
): FlixPatrolMatchResult[] {
  let expression = '//table[@class="card-table"]//a[@class="flex gap-2 group items-center"]/@href';
  if (originalsOnly) {
    expression = '//table[@class="card-table"]//a[@class="flex gap-2 group items-center"][.//svg]/@href'
  }

  return parsePage(expression, html);
}

/**
 * Most-hours page: one section per media type, and — outside the `total` period —
 * one table per language tab.
 */
export function parseMostHoursPage(
  type: FlixPatrolType,
  language: FlixPatrolMostHoursLanguage,
  html: string,
): FlixPatrolMatchResult[] {
  const sectionId = type === 'Movies' ? 'toc-movies' : 'toc-tv-shows';
  const langMap: Record<FlixPatrolMostHoursLanguage, string> = {
    'all': 'all-languages',
    'english': 'english',
    'non-english': 'non-english',
  };
  const langTab = langMap[language];

  // For language-specific tables, we need to find the correct table within the section
  // The tables use x-show="isCurrent('all-languages')" etc.
  const expression = `//div[@id="${sectionId}"]//table[contains(@x-show, "'${langTab}'")]//a[@class="flex gap-2 group items-center"]/@href`;
  let results = parsePage(expression, html);

  // Fallback for 'total' period which doesn't have language tabs
  if (results.length === 0) {
    const fallbackExpr = `//div[@id="${sectionId}"]//table[@class="card-table"]//a[@class="flex gap-2 group items-center"]/@href`;
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
export function parseDetailTitle(dom: JSDOM): string {
  // Title with fallback (kept)
  const title = dom.window.document.evaluate(
    '//div[contains(@class,"info-grid-header")]//h1/text()',
    dom.window.document,
    null,
    dom.window.XPathResult.STRING_TYPE,
    null,
  ).stringValue.trim();
  if (title) {
    return title;
  }
  return dom.window.document.evaluate(
    '//h1/text()',
    dom.window.document,
    null,
    dom.window.XPathResult.STRING_TYPE,
    null,
  ).stringValue.trim();
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
export function parseDetailYear(dom: JSDOM): number | null {
  const premiereBlock = dom.window.document.evaluate(
    '//div[contains(@class,"info-grid-header")]//div[@title="Premiere"]',
    dom.window.document,
    null,
    dom.window.XPathResult.STRING_TYPE,
    null,
  ).stringValue;
  const match = premiereBlock.match(/(19|20)\d{2}/);
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
