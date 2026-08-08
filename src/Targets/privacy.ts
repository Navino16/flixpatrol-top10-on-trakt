import type { ListPrivacy } from './ListTarget';

/**
 * Réduit les quatre niveaux Trakt au booléen que comprennent Floppy et mdblist.
 * Seul `private` reste privé ; `link` et `friends` n'ont pas d'équivalent et
 * sont traités comme public, ce que l'appelant signale à l'utilisateur.
 */
export function isPrivate(privacy: ListPrivacy): boolean {
  return privacy === 'private';
}
