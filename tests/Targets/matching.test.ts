import { describe, it, expect } from 'vitest';
import { pickBestMatch } from '../../src/Targets/matching';
import type { MediaItem } from '../../src/Targets/ListTarget';

interface Candidate {
  id: string;
  title: string;
  year: number | null;
}

const read = (candidate: Candidate) => ({ title: candidate.title, year: candidate.year });

const wanted: MediaItem = { title: 'Inception', year: 2010 };

describe('pickBestMatch', () => {
  it('prefers the candidate matching both title and year', () => {
    const candidates: Candidate[] = [
      { id: 'title-only', title: 'Inception', year: 1999 },
      { id: 'year-only', title: 'Other', year: 2010 },
      { id: 'both', title: 'Inception', year: 2010 },
    ];
    expect(pickBestMatch(candidates, wanted, read)?.id).toBe('both');
  });

  it('falls back to a title match when no candidate has the right year', () => {
    const candidates: Candidate[] = [
      { id: 'year-only', title: 'Other', year: 2010 },
      { id: 'title-only', title: 'Inception', year: 1999 },
    ];
    expect(pickBestMatch(candidates, wanted, read)?.id).toBe('title-only');
  });

  it('falls back to a year match when no candidate has the right title', () => {
    const candidates: Candidate[] = [
      { id: 'neither', title: 'Other', year: 1999 },
      { id: 'year-only', title: 'Another', year: 2010 },
    ];
    expect(pickBestMatch(candidates, wanted, read)?.id).toBe('year-only');
  });

  it('returns null rather than the first result when nothing matches', () => {
    const candidates: Candidate[] = [
      { id: 'a', title: 'Interstellar', year: 2014 },
      { id: 'b', title: 'Tenet', year: 2020 },
    ];
    expect(pickBestMatch(candidates, wanted, read)).toBeNull();
  });

  it('returns null on an empty candidate list', () => {
    expect(pickBestMatch([], wanted, read)).toBeNull();
  });

  it('compares titles case-insensitively and ignores surrounding whitespace', () => {
    const candidates: Candidate[] = [{ id: 'loose', title: '  iNcEpTiOn ', year: 2010 }];
    expect(pickBestMatch(candidates, { title: 'Inception  ', year: 2010 }, read)?.id).toBe('loose');
  });

  it('never matches on year when the wanted year is unknown', () => {
    const candidates: Candidate[] = [{ id: 'null-year', title: 'Other', year: null }];
    expect(pickBestMatch(candidates, { title: 'Inception', year: null }, read)).toBeNull();
  });

  it('still matches on title alone when the wanted year is unknown', () => {
    const candidates: Candidate[] = [{ id: 'title-only', title: 'Inception', year: 2010 }];
    expect(pickBestMatch(candidates, { title: 'Inception', year: null }, read)?.id).toBe('title-only');
  });

  it('keeps the first candidate when several are equally good', () => {
    const candidates: Candidate[] = [
      { id: 'first', title: 'Inception', year: 2010 },
      { id: 'second', title: 'Inception', year: 2010 },
    ];
    expect(pickBestMatch(candidates, wanted, read)?.id).toBe('first');
  });
});
