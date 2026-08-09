import type { MediaItem } from './ListTarget';

/** How a backend's search result exposes the two fields the cascade compares. */
export interface MatchableCandidate {
  title: string;
  year: number | null;
}

/**
 * Picks the candidate that best matches `wanted`, following a single cascade
 * every backend shares: exact title AND year, then title alone, then year
 * alone.
 *
 * There is deliberately no last-resort fallback on the first candidate: falling
 * through the whole cascade means neither the title nor the year matched, so any
 * candidate left is a mismatch by definition. Returning null lets the caller
 * warn and drop the item rather than write a confidently wrong entry.
 *
 * This lives here, parameterised by `read`, precisely so the cascade cannot
 * drift between backends: a copy per adapter is how one backend once produced
 * correct matches while another produced confidently wrong ones from the same
 * broken year.
 *
 * Candidate ELIGIBILITY stays with the caller — mdblist drops results without a
 * TMDB id before calling this, because such a result could not be written at
 * all, which is a different question from how well it matches.
 */
export function pickBestMatch<T>(
  candidates: T[],
  wanted: MediaItem,
  read: (candidate: T) => MatchableCandidate,
): T | null {
  const wantedTitle = wanted.title.trim().toLowerCase();
  const sameTitle = (candidate: T): boolean => read(candidate).title.trim().toLowerCase() === wantedTitle;
  const sameYear = (candidate: T): boolean => wanted.year !== null && read(candidate).year === wanted.year;

  return candidates.find((candidate) => sameTitle(candidate) && sameYear(candidate))
    ?? candidates.find(sameTitle)
    ?? candidates.find(sameYear)
    ?? null;
}
