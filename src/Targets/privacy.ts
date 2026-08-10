import type { ListPrivacy } from './ListTarget';

/**
 * Reduces the four Trakt levels to the boolean Floppy and mdblist understand. `link`
 * and `friends` are rejected at startup on these backends, so collapsing them to
 * public here is only a safety net.
 */
export function isPrivate(privacy: ListPrivacy): boolean {
  return privacy === 'private';
}
