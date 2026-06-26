import { logger } from './Logger';

export interface PackageInfo {
  name: string;
  version: string;
}

export const DEFAULT_PACKAGE_INFO: PackageInfo = {
  name: 'flixpatrol-top10',
  version: 'unknown',
};

export function parsePackageInfo(raw: unknown): PackageInfo {
  const result: PackageInfo = { ...DEFAULT_PACKAGE_INFO };
  if (raw && typeof raw === 'object') {
    const pkg = raw as Record<string, unknown>;
    if (typeof pkg.name === 'string' && pkg.name.length > 0) result.name = pkg.name;
    if (typeof pkg.version === 'string' && pkg.version.length > 0) result.version = pkg.version;
  }
  return result;
}

export function getPackageInfo(): PackageInfo {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return parsePackageInfo(require('../../package.json'));
  } catch (err) {
    logger.warn(`Could not read package.json: ${(err as Error).message}`);
    return { ...DEFAULT_PACKAGE_INFO };
  }
}
