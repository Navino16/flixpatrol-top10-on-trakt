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
  TEMPLATE_CREDENTIALS,
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

/**
 * Root-level credential blocks that 3.0.0 does not read. Only `Trakt` ever
 * shipped, in 2.17.0 and earlier. `Floppy` and `Mdblist` existed solely in an
 * unreleased intermediate shape of this branch; they are listed here so anyone
 * running that intermediate shape gets the same guidance, and they are
 * deliberately absent from the user-facing documentation.
 */
const OBSOLETE_CREDENTIAL_BLOCKS = ['Trakt', 'Floppy', 'Mdblist'] as const;

type ObsoleteBlockName = (typeof OBSOLETE_CREDENTIAL_BLOCKS)[number];

const OBSOLETE_BLOCK_OF: Record<TargetBackendName, ObsoleteBlockName> = {
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
 * a schema error, because the raw Zod output on an unmigrated file ("invalid
 * discriminator value") tells the user nothing about what to do next.
 */
function buildMigrationMessage(
  type: TargetBackendName,
  presentObsoleteBlocks: ObsoleteBlockName[],
  targetRecord: Record<string, unknown> | undefined,
  obsoleteRecord: Record<string, unknown> | undefined,
): string {
  const sourceBlock = OBSOLETE_BLOCK_OF[type];
  const head = presentObsoleteBlocks.includes(sourceBlock)
    ? `Replace your root-level \`${sourceBlock}\` block with:`
    : 'Your `Target` block must now carry the credentials of the selected backend. Replace it with:';
  const tail = presentObsoleteBlocks.length > 0
    ? `Then remove the old ${presentObsoleteBlocks.map((b) => `\`${b}\``).join(', ')} `
      + `block${presentObsoleteBlocks.length > 1 ? 's' : ''}.`
    : 'Credentials live in the `Target` block itself: there is no separate root-level '
      + 'credential block.';

  return [
    'Configuration format changed in 3.0.0.',
    '',
    head,
    '',
    // An already-migrated `Target` wins over an obsolete root-level block, so a
    // partial migration is echoed back with the values the user most recently wrote.
    renderTargetBlock(type, [targetRecord, obsoleteRecord]),
    '',
    tail,
  ].join('\n');
}

/**
 * Names the obsolete root-level blocks a migrated configuration still carries.
 * Dead config is harmless — it is never read — so this is a single warning and
 * never an error: refusing to start would turn a successful migration into an
 * outage.
 */
function warnAboutObsoleteBlocks(presentObsoleteBlocks: ObsoleteBlockName[]): void {
  if (presentObsoleteBlocks.length === 0) return;

  const names = presentObsoleteBlocks.map((block) => `\`${block}\``).join(', ');
  const plural = presentObsoleteBlocks.length > 1;
  logger.warn(`Obsolete root-level ${names} block${plural ? 's' : ''} found in your configuration. `
    + `Credentials now live in the \`Target\` block, so ${plural ? 'they are' : 'it is'} no longer `
    + `read and can be deleted.`);
}

/**
 * Where the real credentials come from, per backend. Only backends that ship
 * template credentials need an entry — today, only `trakt`.
 */
const CREDENTIAL_SOURCE_HINT: Partial<Record<TargetBackendName, string>> = {
  trakt: 'Create a Trakt API application at https://trakt.tv/oauth/applications, then copy its '
    + 'client id and client secret into the `Target` block.',
};

/** "a", "a and b", "a, b and c". */
function formatFieldList(names: string[]): string {
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * Refuses to start while the `Target` block still carries the credentials
 * shipped in the configuration template. They satisfy every schema, so without
 * this the run starts, scrapes FlixPatrol for twenty seconds and only then
 * collapses into a wall of `403 Forbidden` responses and `No match` warnings,
 * with nothing anywhere naming the configuration as the cause.
 *
 * Checked field by field, so replacing only one of the two credentials is still
 * caught and the message names the one left over.
 */
function checkForTemplateCredentials(target: TargetOptions): void {
  const templates = TEMPLATE_CREDENTIALS[target.type];
  if (templates === undefined) return;

  const values: Record<string, unknown> = { ...target };
  const untouched = Object.keys(templates).filter((key) => values[key] === templates[key]);
  if (untouched.length === 0) return;

  const plural = untouched.length > 1;
  const names = formatFieldList(untouched.map((key) => `\`Target.${key}\``));
  const hint = CREDENTIAL_SOURCE_HINT[target.type];

  throw new ConfigurationError([
    `${names} still ${plural ? 'hold' : 'holds'} the placeholder value${plural ? 's' : ''} `
    + 'shipped in the configuration template:',
    '',
    ...untouched.map((key) => `  ${JSON.stringify(key)}: ${JSON.stringify(templates[key])}`),
    '',
    `Replace ${plural ? 'them' : 'it'} with your own \`${target.type}\` credentials before running.`
    + (hint === undefined ? '' : ` ${hint}`),
  ].join('\n'));
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
   * Returns the actionable migration message when the configuration has not been
   * migrated to the 3.0.0 `Target` block, `null` when the schema should report
   * the problem itself.
   *
   * Only reached once `Target` has failed to satisfy the union, so it never sees
   * an already-migrated file. Two signals mark an unmigrated one: a root-level
   * credential block that nothing reads any more, and a `Target` that carries
   * only the selector — including no `Target` at all.
   */
  private static detectUnmigratedConfig(
    rawTarget: unknown,
    presentObsoleteBlocks: ObsoleteBlockName[],
  ): string | null {
    const targetRecord = isRecord(rawTarget) ? rawTarget : undefined;

    // A `Target` that is present but not an object is not an unmigrated shape:
    // let the schema report it instead of guessing a migration.
    if (rawTarget !== undefined && targetRecord === undefined) {
      if (presentObsoleteBlocks.length === 0) return null;
      return buildMigrationMessage('trakt', presentObsoleteBlocks, undefined, undefined);
    }

    const selectorOnly = targetRecord === undefined
      || Object.keys(targetRecord).every((key) => key === 'type');
    if (presentObsoleteBlocks.length === 0 && !selectorOnly) return null;

    // Which backend to show: what the user selected, else the single obsolete
    // block they kept, else the historical default.
    const selected = targetRecord?.type;
    let type: TargetBackendName = 'trakt';
    if (isBackendName(selected)) {
      type = selected;
    } else if (presentObsoleteBlocks.length === 1) {
      type = targetBackend
        .find((backend) => OBSOLETE_BLOCK_OF[backend] === presentObsoleteBlocks[0]) ?? 'trakt';
    }

    const obsoleteBlock = OBSOLETE_BLOCK_OF[type];
    const rawObsolete: unknown = config.has(obsoleteBlock) ? config.get(obsoleteBlock) : undefined;
    return buildMigrationMessage(
      type,
      presentObsoleteBlocks,
      targetRecord,
      isRecord(rawObsolete) ? rawObsolete : undefined,
    );
  }

  public static getTargetOptions(): TargetOptions {
    try {
      const presentObsoleteBlocks = OBSOLETE_CREDENTIAL_BLOCKS.filter((block) => config.has(block));
      const rawTarget: unknown = config.has('Target') ? config.get('Target') : undefined;

      // A valid `Target` is a migrated configuration, whatever else is lying
      // around: obsolete root-level blocks are dead config, worth a warning and
      // never a failed startup.
      const parsed = TargetSchema.safeParse(rawTarget);
      if (parsed.success) {
        // Before the obsolete-block warning: unreplaced credentials are fatal,
        // so advice about dead config would only be noise ahead of the error.
        checkForTemplateCredentials(parsed.data);
        warnAboutObsoleteBlocks(presentObsoleteBlocks);
        return parsed.data;
      }

      const migration = GetAndValidateConfigs.detectUnmigratedConfig(rawTarget, presentObsoleteBlocks);
      if (migration !== null) throw new ConfigurationError(migration);

      return validateConfig(TargetSchema, rawTarget, 'Target');
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
