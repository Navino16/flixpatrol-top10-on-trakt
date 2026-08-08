import type { CacheOptions, TargetOptions } from '../types';
import type { ListTarget } from './ListTarget';
import { TraktTarget } from './adapters/TraktTarget';
import { FloppyTarget } from './adapters/FloppyTarget';
import { MdblistTarget } from './adapters/MdblistTarget';

export function createTarget(
  options: TargetOptions,
  cacheOptions: CacheOptions,
  dryRun: boolean,
): ListTarget {
  switch (options.type) {
    case 'floppy':
      return new FloppyTarget(options.floppy, cacheOptions, dryRun);
    case 'mdblist':
      return new MdblistTarget(options.mdblist, cacheOptions, dryRun);
    default:
      return new TraktTarget(options.trakt, cacheOptions, dryRun);
  }
}
