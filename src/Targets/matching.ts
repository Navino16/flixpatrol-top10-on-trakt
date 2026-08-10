import type { MediaItem } from './ListTarget';

/** How a backend's search result exposes the two fields the cascade compares. */
export interface MatchableCandidate {
  title: string;
  year: number | null;
}

/**
 * Picks the candidate best matching `wanted` through the one cascade every backend
 * shares: exact title and year, then title alone, then year alone. Parameterised by
 * `read` so the cascade cannot drift between adapters.
 *
 * There is deliberately no last-resort fallback on the first candidate: falling
 * through the cascade means neither field matched, so whatever is left is a mismatch.
 * Null lets the caller drop the item instead of writing a confidently wrong entry.
 *
 * Candidate eligibility stays with the caller — mdblist drops results without a TMDB
 * id beforehand, since those could not be written at all.
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
