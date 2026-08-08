import type { ListPrivacy } from './ListTarget';

/**
 * Reduces the four Trakt levels to the boolean Floppy and mdblist understand.
 * Only `private` stays private. `link` and `friends` are rejected at startup on
 * these backends (`GetAndValidateConfigs.checkTargetCompatibility`), so they
 * never reach here; the fallback to public is kept purely as a safety net.
 */
export function isPrivate(privacy: ListPrivacy): boolean {
  return privacy === 'private';
}
