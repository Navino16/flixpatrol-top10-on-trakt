import config from 'config';
import { z } from 'zod';
import cron from 'node-cron';
import { ConfigurationError } from './Errors';
import { logger } from './Logger';
import {
  FlixPatrolTop10Schema,
  FlixPatrolPopularSchema,
  FlixPatrolMostWatchedSchema,
  FlixPatrolMostHoursSchema,
  TargetSchema,
  CacheOptionsSchema,
  NotificationsSchema,
  ScheduleOptionsSchema,
  FlareSolverrOptionsSchema,
  targetBackend,
} from '../types';
import type {
  FlixPatrolTop10,
  FlixPatrolPopular,
  FlixPatrolMostWatched,
  FlixPatrolMostHours,
  TargetOptions,
  TargetBackendName,
  TraktPrivacy,
  CacheOptions,
  ScheduleOptions,
  FlareSolverrOptions,
} from '../types';
import type { NotificationsConfig } from '../Notifications/types';

// Re-export arrays for backward compatibility
export {
  flixpatrolTop10Location,
  flixpatrolTop10Platform,
  flixpatrolPopularPlatform,
  flixpatrolConfigType,
} from '../types';

// Helper function to format Zod errors
function formatZodError(error: z.ZodError, context: string): string {
  return error.issues.map((issue) => {
    const path = issue.path.join('.');
    return `${context}${path ? `.${path}` : ''}: ${issue.message}`;
  }).join('\n');
}

// Validation helper - throws ConfigurationError instead of process.exit()
function validateConfig<T>(schema: z.ZodSchema<T>, data: unknown, context: string): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new ConfigurationError(formatZodError(result.error, context));
  }
  return result.data;
}

/** Every list block, as `checkTargetCompatibility` needs all four at once. */
export interface ListConfigs {
  FlixPatrolTop10: FlixPatrolTop10[];
  FlixPatrolPopular: FlixPatrolPopular[];
  FlixPatrolMostWatched: FlixPatrolMostWatched[];
  FlixPatrolMostHours: FlixPatrolMostHours[];
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object'
  && value !== null
  && !Array.isArray(value);

/** Root-level credential blocks of 2.x, dropped in 3.0.0 in favour of the `Target` union. */
const LEGACY_CREDENTIAL_BLOCKS = ['Trakt', 'Floppy', 'Mdblist'] as const;

type LegacyBlockName = (typeof LEGACY_CREDENTIAL_BLOCKS)[number];

const LEGACY_BLOCK_OF: Record<TargetBackendName, LegacyBlockName> = {
  trakt: 'Trakt',
  floppy: 'Floppy',
  mdblist: 'Mdblist',
};

/**
 * Fields the 3.0.0 `Target` block must carry per backend, with the placeholder
 * shown when the value cannot be recovered from the user's own configuration.
 * Placeholders are never secrets: only values actually read from the user's
 * file are echoed back.
 */
const TARGET_FIELDS: Record<TargetBackendName, { key: string; placeholder: string }[]> = {
  trakt: [
    { key: 'saveFile', placeholder: './config/.trakt' },
    { key: 'clientId', placeholder: '<your Trakt client id>' },
    { key: 'clientSecret', placeholder: '<your Trakt client secret>' },
  ],
  floppy: [
    { key: 'url', placeholder: '<your Floppy instance URL>' },
    { key: 'apiKey', placeholder: '<your Floppy API token>' },
  ],
  mdblist: [
    { key: 'apiKey', placeholder: '<your mdblist API key>' },
  ],
};

const isBackendName = (value: unknown): value is TargetBackendName => typeof value === 'string'
  && (targetBackend as readonly string[]).includes(value);

/** Renders the exact `Target` block the user has to paste, values carried across verbatim. */
function renderTargetBlock(
  type: TargetBackendName,
  sources: (Record<string, unknown> | undefined)[],
): string {
  const fields = TARGET_FIELDS[type].map(({ key, placeholder }) => {
    const carried = sources.map((source) => source?.[key]).find((value) => typeof value === 'string');
    return `    ${JSON.stringify(key)}: ${JSON.stringify(carried ?? placeholder)}`;
  });
  const body = [`    "type": ${JSON.stringify(type)}`, ...fields].join(',\n');
  return `  "Target": {\n${body}\n  }`;
}

/**
 * Builds the migration message. It shows the block to write rather than dumping
 * a schema error, because the raw Zod output on a 2.x file ("invalid
 * discriminator value") tells the user nothing about what to do next.
 */
function buildMigrationMessage(
  type: TargetBackendName,
  presentLegacyBlocks: LegacyBlockName[],
  targetRecord: Record<string, unknown> | undefined,
  legacyRecord: Record<string, unknown> | undefined,
): string {
  const sourceBlock = LEGACY_BLOCK_OF[type];
  const head = presentLegacyBlocks.includes(sourceBlock)
    ? `Replace your root-level \`${sourceBlock}\` block with:`
    : 'Your `Target` block must now carry the credentials of the selected backend. Replace it with:';
  const tail = presentLegacyBlocks.length > 0
    ? `Then remove the old ${presentLegacyBlocks.map((b) => `\`${b}\``).join(', ')} `
      + `block${presentLegacyBlocks.length > 1 ? 's' : ''}.`
    : 'The root-level `Trakt`, `Floppy` and `Mdblist` blocks are no longer read.';

  return [
    'Configuration format changed in 3.0.0.',
    '',
    head,
    '',
    // An already-migrated `Target` wins over a stale legacy block, so a partial
    // migration is echoed back with the values the user most recently wrote.
    renderTargetBlock(type, [targetRecord, legacyRecord]),
    '',
    tail,
  ].join('\n');
}

export class GetAndValidateConfigs {
  public static getFlixPatrolTop10(): FlixPatrolTop10[] {
    try {
      const data = config.get('FlixPatrolTop10');
      return validateConfig(z.array(FlixPatrolTop10Schema), data, 'FlixPatrolTop10');
    } catch (err) {
      if (err instanceof ConfigurationError) throw err;
      throw new ConfigurationError(`${err}`);
    }
  }

  public static getFlixPatrolPopular(): FlixPatrolPopular[] {
    try {
      const data = config.get('FlixPatrolPopular');
      return validateConfig(z.array(FlixPatrolPopularSchema), data, 'FlixPatrolPopular');
    } catch (err) {
      if (err instanceof ConfigurationError) throw err;
      throw new ConfigurationError(`${err}`);
    }
  }

  public static getFlixPatrolMostWatched(): FlixPatrolMostWatched[] {
    try {
      const data = config.get('FlixPatrolMostWatched');
      return validateConfig(z.array(FlixPatrolMostWatchedSchema), data, 'FlixPatrolMostWatched');
    } catch (err) {
      if (err instanceof ConfigurationError) throw err;
      throw new ConfigurationError(`${err}`);
    }
  }

  public static getFlixPatrolMostHours(): FlixPatrolMostHours[] {
    try {
      if (!config.has('FlixPatrolMostHours')) {
        return [];
      }
      const data = config.get('FlixPatrolMostHours');
      return validateConfig(z.array(FlixPatrolMostHoursSchema), data, 'FlixPatrolMostHours');
    } catch (err) {
      if (err instanceof ConfigurationError) throw err;
      throw new ConfigurationError(`${err}`);
    }
  }

  /**
   * Returns the actionable migration message when the configuration still uses
   * the 2.x shape, `null` when it is already in the 3.0.0 shape.
   *
   * Two signals mark a 2.x file: a root-level credential block that nothing
   * reads any more, and a `Target` that carries only the selector (including no
   * `Target` at all, which used to default to Trakt).
   */
  private static detectLegacyTargetConfig(): string | null {
    const presentLegacyBlocks = LEGACY_CREDENTIAL_BLOCKS.filter((block) => config.has(block));
    const rawTarget: unknown = config.has('Target') ? config.get('Target') : undefined;
    const targetRecord = isRecord(rawTarget) ? rawTarget : undefined;

    // A `Target` that is present but not an object is not a 2.x shape: let the
    // schema report it instead of guessing a migration.
    if (rawTarget !== undefined && targetRecord === undefined) {
      if (presentLegacyBlocks.length === 0) return null;
      return buildMigrationMessage('trakt', presentLegacyBlocks, undefined, undefined);
    }

    const selectorOnly = targetRecord === undefined
      || Object.keys(targetRecord).every((key) => key === 'type');
    if (presentLegacyBlocks.length === 0 && !selectorOnly) return null;

    // Which backend to show: what the user selected, else the single legacy
    // block they kept, else the historical default.
    const selected = targetRecord?.type;
    let type: TargetBackendName = 'trakt';
    if (isBackendName(selected)) {
      type = selected;
    } else if (presentLegacyBlocks.length === 1) {
      type = targetBackend.find((backend) => LEGACY_BLOCK_OF[backend] === presentLegacyBlocks[0]) ?? 'trakt';
    }

    const legacyBlock = LEGACY_BLOCK_OF[type];
    const rawLegacy: unknown = config.has(legacyBlock) ? config.get(legacyBlock) : undefined;
    return buildMigrationMessage(
      type,
      presentLegacyBlocks,
      targetRecord,
      isRecord(rawLegacy) ? rawLegacy : undefined,
    );
  }

  public static getTargetOptions(): TargetOptions {
    try {
      const migration = GetAndValidateConfigs.detectLegacyTargetConfig();
      if (migration !== null) throw new ConfigurationError(migration);

      return validateConfig(TargetSchema, config.get('Target'), 'Target');
    } catch (err) {
      if (err instanceof ConfigurationError) throw err;
      throw new ConfigurationError(`${err}`);
    }
  }

  /**
   * Cross-check between the selected backend and every list entry. It cannot
   * live in a Zod schema: the `config` package loads `Target` and the list
   * blocks independently, so the two halves only exist together here.
   *
   * Also the single place where the backend-wide startup warnings are emitted —
   * once per run, never once per list entry.
   */
  public static checkTargetCompatibility(target: TargetOptions, lists: ListConfigs): void {
    if (target.type !== 'trakt') {
      const blocks: [string, { privacy: TraktPrivacy }[]][] = [
        ['FlixPatrolTop10', lists.FlixPatrolTop10],
        ['FlixPatrolPopular', lists.FlixPatrolPopular],
        ['FlixPatrolMostWatched', lists.FlixPatrolMostWatched],
        ['FlixPatrolMostHours', lists.FlixPatrolMostHours],
      ];
      const offenders = blocks.flatMap(([block, entries]) => entries
        .map((entry, index) => ({ entry, index }))
        .filter(({ entry }) => entry.privacy === 'link' || entry.privacy === 'friends')
        .map(({ entry, index }) => `  ${block}[${index}].privacy = "${entry.privacy}"`));

      if (offenders.length > 0) {
        throw new ConfigurationError([
          `Target.type is "${target.type}", which cannot express the "link" and "friends" privacy `
          + 'levels — they only exist on Trakt. Use "private" or "public" instead for:',
          ...offenders,
        ].join('\n'));
      }
    }

    if (target.type === 'floppy') {
      logger.warn('The Floppy API cannot set list visibility, so the `privacy` field of every list '
        + 'entry is ignored: lists are always created private. Flip the ones you want to share by '
        + 'hand in the Floppy web UI.');
    }
  }

  public static getCacheOptions(): CacheOptions {
    try {
      const data = config.get('Cache');
      return validateConfig(CacheOptionsSchema, data, 'Cache');
    } catch (err) {
      if (err instanceof ConfigurationError) throw err;
      throw new ConfigurationError(`${err}`);
    }
  }

  public static getNotifications(): NotificationsConfig {
    try {
      if (!config.has('Notifications')) {
        return {};
      }
      const data = config.get('Notifications');
      return validateConfig(NotificationsSchema, data, 'Notifications');
    } catch (err) {
      if (err instanceof ConfigurationError) throw err;
      throw new ConfigurationError(`${err}`);
    }
  }

  public static getScheduleOptions(): ScheduleOptions {
    try {
      const data = config.has('Schedule') ? config.get('Schedule') : {};
      const options = validateConfig(ScheduleOptionsSchema, data, 'Schedule');
      if (options.enabled) {
        const invalid = options.crons.filter((expr) => !cron.validate(expr));
        if (invalid.length > 0) {
          throw new ConfigurationError(
            `Schedule.crons contains invalid cron expression(s): ${invalid.map((e) => `"${e}"`).join(', ')}`,
          );
        }
      }
      return options;
    } catch (err) {
      if (err instanceof ConfigurationError) throw err;
      throw new ConfigurationError(`${err}`);
    }
  }

  public static getFlareSolverrOptions(): FlareSolverrOptions {
    try {
      const data = config.has('FlareSolverr') ? config.get('FlareSolverr') : {};
      return validateConfig(FlareSolverrOptionsSchema, data, 'FlareSolverr');
    } catch (err) {
      if (err instanceof ConfigurationError) throw err;
      throw new ConfigurationError(`${err}`);
    }
  }
}
