import type { ListPrivacy } from './ListTarget';

/**
 * Reduces the configuration's privacy vocabulary to the boolean Floppy and mdblist
 * understand. Kept as the single place the mapping lives, for the next backend to hook into.
 */
export function isPrivate(privacy: ListPrivacy): boolean {
  return privacy === 'private';
}
