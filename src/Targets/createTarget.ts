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
    case 'mdblist':
      return new MdblistTarget(options, cacheOptions, dryRun);
    default: {
      // Compiler-checked exhaustiveness: a third TargetOptions variant fails to build here
      // instead of silently landing on whichever adapter used to be the catch-all.
      const exhaustive: never = options;
      throw new Error(`Unhandled Target.type: ${JSON.stringify(exhaustive)}`);
    }
  }
}
