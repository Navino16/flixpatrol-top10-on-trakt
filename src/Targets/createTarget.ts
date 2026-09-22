import type { CacheOptions, TargetOptions } from '../types';
import type { ListTarget } from './ListTarget';
import { FloppyTarget } from './adapters/FloppyTarget';
import { MdblistTarget } from './adapters/MdblistTarget';

export function createTarget(
  options: TargetOptions,
  cacheOptions: CacheOptions,
  dryRun: boolean,
): ListTarget {
  // Each branch narrows the union to the variant carrying that backend's credentials,
  // which is the options object its adapter expects.
  switch (options.type) {
    case 'floppy':
      return new FloppyTarget(options, cacheOptions, dryRun);
    default:
      return new MdblistTarget(options, cacheOptions, dryRun);
  }
}
