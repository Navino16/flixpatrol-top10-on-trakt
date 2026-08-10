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
 * The XPath expressions below are matched against a live third-party site, so unit
 * tests can only ever exercise them through fixtures. Their order is load-bearing.
 */

/** One raw match: the href FlixPatrol prints for a media, e.g. `/title/inception`. */
export type FlixPatrolMatchResult = string;

/** Canonical head of a detail-page path, plus any sub-page, query or fragment. */
const TITLE_PATH_PATTERN = /^(\/title\/[^/?#]+)(?:[/?#].*)?$/;

/**
 * Reduces a listing href to the canonical detail page it belongs to, `/title/<slug>/`.
 *
 * Some listings link at a sub-page instead (`/title/<slug>/hours/`,
 * `/title/<slug>/trailers/`), whose `h1` appends the section name to the media name.
 * The repair has to happen on the URL rather than by trimming that suffix off the
 * parsed title, because a title may legitimately end in the same word — "72 Hours"
 * would come back as "72".
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
 * Evaluates one XPath expression over an HTML string and returns every matched text
 * content. Returns an empty array rather than throwing, so a caller walking a chain
 * of expressions can move on to the next one.
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
 * Exported so the drift suite can assert which rung matched, not merely that the
 * chain produced something: a fallback quietly taking over is the early warning.
 * Copying the strings into the test would defeat that, as the copy could not drift
 * with the original.
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
  // Both rungs name the media type in the heading they match, so neither can answer
  // the Movies question with the TV Shows chart. When both fail the chain returns
  // empty rather than guessing, which is what keeps a market that charts only one
  // type from filling the other type's list.
  return [
    `//div[h3[text() = "TOP 10 ${type}"]]/parent::div//a[contains(@class,'hover:underline')]/@href`,
    `//h3[contains(., "TOP 10") and contains(., "${type === 'Movies' ? 'Movies' : 'TV Shows'}")]/ancestor::div[1]/following-sibling::div[1]//a[contains(@class,'hover:underline')]/@href`,
  ];
}

/**
 * Top10 section of a platform page. The world page and the regional pages do not share
 * the same markup. An empty result means the page publishes no chart for this media
 * type — it is not an error.
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
    `//h3[text() = "TOP 10 ${kidsType}"]/parent::div/following-sibling::table//a[@class="hover:underline"]/@href`,
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

/** Popular page: a single card table. */
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
 * The two expressions a Most-hours page relies on, strictest first: the language-tab
 * table, then the whole section. Falling through is normal for the `total` period,
 * which publishes no language tabs; on any other period it means the tab markup
 * drifted and every language is now returning the same rows.
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
    // The language tabs are Alpine-driven: each table carries x-show="isCurrent('<tab>')".
    `//div[@id="${sectionId}"]//table[contains(@x-show, "'${langTab}'")]//a[@class="flex gap-2 group items-center"]/@href`,
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
 * The two title expressions, strictest first. Rung 1 is a bare `//h1`, which matches
 * on almost any page and so hides a drift of rung 0 entirely — hence the drift suite
 * needs to interrogate each rung on its own.
 */
export const DETAIL_TITLE_EXPRESSIONS = [
  '//div[contains(@class,"info-grid-header")]//h1/text()',
  '//h1/text()',
];

export function parseDetailTitle(dom: JSDOM): string {
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
 * Read only from the premiere block, whose date is formatted MM/DD/YYYY — only the
 * year is wanted, and a four-digit run starting with 19 or 20 cannot occur earlier in
 * that format, so the day/month ambiguity never has to be resolved.
 *
 * There is deliberately no fallback expression. A missing year is safe; a guessed one
 * silently selects the wrong film, because an exact title-and-year match is trusted
 * over a title-only one. Never guess.
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
 * Whole detail page in one pass. The extractors take a prepared DOM rather than raw
 * HTML so the page is only parsed once per scrape.
 */
export function parseDetailPage(html: string): FlixPatrolDetail {
  const dom = new JSDOM(html);
  return {
    title: parseDetailTitle(dom),
    year: parseDetailYear(dom),
  };
}
