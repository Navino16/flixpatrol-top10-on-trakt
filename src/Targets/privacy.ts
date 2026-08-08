import type { ListPrivacy } from './ListTarget';

/**
 * Reduces the four Trakt levels to the boolean Floppy and mdblist understand.
 * Only `private` stays private; `link` and `friends` have no equivalent and are
 * treated as public, which the caller reports to the user.
 */
export function isPrivate(privacy: ListPrivacy): boolean {
  return privacy === 'private';
}
