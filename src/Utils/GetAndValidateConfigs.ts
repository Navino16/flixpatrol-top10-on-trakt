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
  FlixPatrolWeeklySchema,
  TargetsSchema,
  CacheOptionsSchema,
  NotificationsSchema,
  ScheduleOptionsSchema,
  FlareSolverrOptionsSchema,
  targetBackend,
  TEMPLATE_CREDENTIALS,
  TARGET_ID_PATTERN,
  TARGET_ID_MAX_LENGTH,
} from '../types';
import type {
  FlixPatrolTop10,
  FlixPatrolPopular,
  FlixPatrolMostWatched,
  FlixPatrolMostHours,
  FlixPatrolWeekly,
  TargetOptions,
  TargetBackendName,
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
  flixpatrolMostWatchedCountry,
  flixpatrolMostWatchedMovieGenre,
  flixpatrolMostWatchedShowGenre,
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

/** Every list block, bundled for `checkTargetCompatibility` even though it only reads one today. */
export interface ListConfigs {
  FlixPatrolTop10: FlixPatrolTop10[];
  FlixPatrolPopular: FlixPatrolPopular[];
  FlixPatrolMostWatched: FlixPatrolMostWatched[];
  FlixPatrolMostHours: FlixPatrolMostHours[];
  FlixPatrolWeekly: FlixPatrolWeekly[];
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object'
  && value !== null
  && !Array.isArray(value);

/** Root-level credential blocks that 3.0.0 no longer reads. */
const OBSOLETE_CREDENTIAL_BLOCKS = ['Trakt', 'Floppy', 'Mdblist'] as const;

type ObsoleteBlockName = (typeof OBSOLETE_CREDENTIAL_BLOCKS)[number];

/**
 * Fields each `Targets` entry must carry per backend, with the placeholder shown when the
 * user has no value yet. A value they already have is never echoed: this message is also
 * dispatched to every `error` notification destination.
 */
const TARGET_FIELDS: Record<TargetBackendName, { key: string; placeholder: string }[]> = {
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

/** Renders a single `Targets` entry object, with no array wrapper around it. */
function renderTargetEntry(type: TargetBackendName, id: string, source?: Record<string, unknown>): string {
  const fields = TARGET_FIELDS[type].map(({ key, placeholder }) => {
    const value = typeof source?.[key] === 'string' ? `<keep your current ${key}>` : placeholder;
    return `      ${JSON.stringify(key)}: ${JSON.stringify(value)}`;
  });
  const body = [
    `      "id": ${JSON.stringify(id)}`,
    `      "type": ${JSON.stringify(type)}`,
    ...fields,
  ].join(',\n');
  return `    {\n${body}\n    }`;
}

/** Renders the exact `Targets` block the user has to paste. Only `type` is carried across. */
function renderTargetsBlock(type: TargetBackendName, source?: Record<string, unknown>): string {
  return `  "Targets": [\n${renderTargetEntry(type, 'main', source)}\n  ]`;
}

/** "Then remove the old `X`, `Y` blocks." — or, when there is none, that there never was one. */
function buildRemovalTail(presentObsoleteBlocks: ObsoleteBlockName[]): string {
  if (presentObsoleteBlocks.length === 0) {
    return 'Credentials live inside each `Targets` entry: there is no separate root-level '
      + 'credential block.';
  }
  return `Then remove the old ${presentObsoleteBlocks.map((b) => `\`${b}\``).join(', ')} `
    + `block${presentObsoleteBlocks.length > 1 ? 's' : ''}.`;
}

/**
 * Nothing in a Trakt configuration maps onto either surviving backend, so this offers both
 * instead of guessing one on the user's behalf. `head` names what has to be replaced.
 */
function buildTraktRemovedMessage(head: string, presentObsoleteBlocks: ObsoleteBlockName[]): string {
  return [
    'Trakt support was removed in 4.0.0.',
    '',
    head,
    '',
    renderTargetsBlock('floppy'),
    '',
    'or',
    '',
    renderTargetsBlock('mdblist'),
    '',
    buildRemovalTail(presentObsoleteBlocks),
    '',
    'You can also delete `./config/.trakt`, which nothing reads any more.',
  ].join('\n');
}

/**
 * Same offer as `buildTraktRemovedMessage`, but for a trakt entry sitting inside an otherwise
 * valid `Targets` array: pasting a full `"Targets": [...]` block in place of one element would
 * be structurally invalid JSON, so only the bare entry objects are rendered here.
 */
function buildTraktEntryReplacementMessage(
  head: string,
  id: string,
  presentObsoleteBlocks: ObsoleteBlockName[],
): string {
  return [
    'Trakt support was removed in 4.0.0.',
    '',
    head,
    '',
    renderTargetEntry('floppy', id),
    '',
    'or',
    '',
    renderTargetEntry('mdblist', id),
    '',
    buildRemovalTail(presentObsoleteBlocks),
    '',
    'You can also delete `./config/.trakt`, which nothing reads any more.',
  ].join('\n');
}

/**
 * The trakt entry's own id is reused when valid and free: it is already the id the user
 * knows this entry by. Otherwise the first `target-N` not already taken by a sibling entry.
 */
function pickReplacementId(traktEntry: Record<string, unknown>, takenIds: ReadonlySet<string>): string {
  const currentId = traktEntry.id;
  if (
    typeof currentId === 'string'
    && currentId.length > 0
    && currentId.length <= TARGET_ID_MAX_LENGTH
    && TARGET_ID_PATTERN.test(currentId)
    && !takenIds.has(currentId)
  ) {
    return currentId;
  }
  let suffix = 1;
  let candidate = `target-${suffix}`;
  while (takenIds.has(candidate)) {
    suffix += 1;
    candidate = `target-${suffix}`;
  }
  return candidate;
}

/**
 * Two distinct situations, and conflating them would leave a Trakt user without an answer:
 * a kept backend only needs an `id`, a removed one needs a different backend entirely.
 * `block` is the singular object being replaced: the old `Target`, or a `Targets` left as one.
 */
function buildTargetsMigrationMessage(
  targetRecord: Record<string, unknown> | undefined,
  presentObsoleteBlocks: ObsoleteBlockName[],
  block: 'Target' | 'Targets',
): string {
  const selected = targetRecord?.type;

  if (selected === 'trakt' || (targetRecord === undefined && presentObsoleteBlocks.includes('Trakt'))) {
    const head = presentObsoleteBlocks.includes('Trakt')
      ? 'Replace your root-level `Trakt` block with one of:'
      : `Your \`${block}\` block still selects the removed \`trakt\` backend. Replace it with one of:`;
    return buildTraktRemovedMessage(head, presentObsoleteBlocks);
  }

  const type: TargetBackendName = isBackendName(selected) ? selected : 'mdblist';
  return [
    block === 'Target'
      ? 'Configuration format changed in 4.0.0: `Target` became `Targets`, an array.'
      : '`Targets` must be an array of entries, not a single object.',
    '',
    `Replace your \`${block}\` block with:`,
    '',
    renderTargetsBlock(type, targetRecord),
    '',
    'Each entry needs a unique `id`, which names the target in the logs and namespaces its',
    'resolution cache. Add as many entries as you want backends written in the same run.',
  ].join('\n');
}

/**
 * Names the obsolete root-level blocks a migrated configuration still carries. Dead
 * config is never read, so this warns rather than failing: refusing to start would turn
 * a successful migration into an outage.
 */
function warnAboutObsoleteBlocks(presentObsoleteBlocks: readonly string[]): void {
  if (presentObsoleteBlocks.length === 0) return;

  const names = presentObsoleteBlocks.map((block) => `\`${block}\``).join(', ');
  const plural = presentObsoleteBlocks.length > 1;
  logger.warn(`Obsolete root-level ${names} block${plural ? 's' : ''} found in your configuration. `
    + `Credentials now live in the \`Targets\` array, so ${plural ? 'they are' : 'it is'} no longer `
    + `read and can be deleted.`);
}

/** Where the real credentials come from. Only backends shipping templates need an entry. */
const CREDENTIAL_SOURCE_HINT: Partial<Record<TargetBackendName, string>> = {
  mdblist: 'Copy your API key from https://mdblist.com/preferences/ into the matching `Targets` entry.',
};

/** "a", "a and b", "a, b and c". */
function formatFieldList(names: string[]): string {
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * Refuses to start while a `Targets` entry still carries the template credentials. They
 * satisfy every schema, so without this the failure surfaces much later as `403 Forbidden`
 * and `No match` noise that never names the configuration as the cause.
 *
 * Checked field by field, so replacing only some of the credentials is still caught and
 * the message names the ones left over.
 */
function checkForTemplateCredentials(target: TargetOptions): void {
  const templates = TEMPLATE_CREDENTIALS[target.type];
  if (templates === undefined) return;

  const values: Record<string, unknown> = { ...target };
  const untouched = Object.keys(templates).filter((key) => values[key] === templates[key]);
  if (untouched.length === 0) return;

  const plural = untouched.length > 1;
  const names = formatFieldList(untouched.map((key) => `\`Targets[${JSON.stringify(target.id)}].${key}\``));
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

/**
 * FlixPatrol still serves `/by-views/` but returns an identical order, so the option was
 * inert. Zod ignores unknown keys, so without this check it would survive silently.
 */
function checkMostWatchedMigration(data: unknown): void {
  if (!Array.isArray(data)) return;

  const offenders = data
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => typeof entry === 'object' && entry !== null && 'orderByViews' in entry);
  if (offenders.length === 0) return;

  throw new ConfigurationError([
    `\`orderByViews\` is no longer supported and must be removed from `
    + `${offenders.map(({ index }) => `FlixPatrolMostWatched[${index}]`).join(', ')}.`,
    '',
    'FlixPatrol still answers the `/by-views/` page, but it returns exactly the same order as',
    'the default one, so the option had no effect. It is removed rather than ignored, because a',
    'silently inoperative option is worse than an explicit failure.',
    '',
    'Delete the `orderByViews` line from each entry listed above. Nothing else changes.',
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
      checkMostWatchedMigration(data);
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

  public static getFlixPatrolWeekly(): FlixPatrolWeekly[] {
    try {
      if (!config.has('FlixPatrolWeekly')) {
        return [];
      }
      const data = config.get('FlixPatrolWeekly');
      return validateConfig(z.array(FlixPatrolWeeklySchema), data, 'FlixPatrolWeekly');
    } catch (err) {
      if (err instanceof ConfigurationError) throw err;
      throw new ConfigurationError(`${err}`);
    }
  }

  public static getTargetsOptions(): TargetOptions[] {
    try {
      const presentObsoleteBlocks = OBSOLETE_CREDENTIAL_BLOCKS.filter((block) => config.has(block));
      const rawTargets: unknown = config.has('Targets') ? config.get('Targets') : undefined;

      const parsed = TargetsSchema.safeParse(rawTargets);
      if (parsed.success) {
        parsed.data.forEach(checkForTemplateCredentials);
        warnAboutObsoleteBlocks([...(config.has('Target') ? ['Target'] : []), ...presentObsoleteBlocks]);
        return parsed.data;
      }

      // The likeliest hand-migration mistakes get the block to paste rather than a raw Zod
      // error saying nothing about what to do next: `Targets` absent (every pre-4.0.0 shape,
      // an empty config included), left as a single object, or still holding a trakt entry.
      if (rawTargets === undefined) {
        const rawTarget: unknown = config.has('Target') ? config.get('Target') : undefined;
        throw new ConfigurationError(
          buildTargetsMigrationMessage(isRecord(rawTarget) ? rawTarget : undefined, presentObsoleteBlocks, 'Target'),
        );
      }
      if (isRecord(rawTargets)) {
        throw new ConfigurationError(buildTargetsMigrationMessage(rawTargets, presentObsoleteBlocks, 'Targets'));
      }
      const traktIndex = Array.isArray(rawTargets)
        ? rawTargets.findIndex((entry) => isRecord(entry) && entry.type === 'trakt')
        : -1;
      if (Array.isArray(rawTargets) && traktIndex >= 0) {
        const traktEntry = rawTargets[traktIndex] as Record<string, unknown>;
        const takenIds = new Set(
          rawTargets
            .filter((_, index) => index !== traktIndex)
            .map((entry) => (isRecord(entry) ? entry.id : undefined))
            .filter((id): id is string => typeof id === 'string'),
        );
        throw new ConfigurationError(buildTraktEntryReplacementMessage(
          `\`Targets[${traktIndex}]\` still selects the removed \`trakt\` backend. Replace that entry with one of:`,
          pickReplacementId(traktEntry, takenIds),
          presentObsoleteBlocks,
        ));
      }

      return validateConfig(TargetsSchema, rawTargets, 'Targets');
    } catch (err) {
      if (err instanceof ConfigurationError) throw err;
      throw new ConfigurationError(`${err}`);
    }
  }

  /**
   * Cross-check between the configured backends and every list entry. It cannot live in a
   * Zod schema, because `config` loads `Targets` and the list blocks independently and the
   * two halves only meet here. Also the one place the backend-wide startup warnings are
   * emitted, so they appear once per run rather than once per list entry.
   */
  public static checkTargetCompatibility(targets: TargetOptions[], lists: ListConfigs): void {
    // Once per Floppy target, never once per list: the warning is about the backend.
    targets
      .filter((target) => target.type === 'floppy')
      .forEach((target) => {
        logger.warn(`Target "${target.id}": the Floppy API cannot set list visibility, so the `
          + '`privacy` field of every list entry is ignored and lists are always created private. '
          + 'Flip the ones you want to share by hand in the Floppy web UI.');
      });

    // Neither fails the run, and they differ in what follows: the amazon-prime pairing is skipped
    // by the pipeline, the way an unusable `kids` combination is on Top10, while a country entry
    // with a language is still processed — `language` is simply ignored.
    lists.FlixPatrolWeekly.forEach((entry, index) => {
      if (entry.location !== 'world' && entry.platform === 'amazon-prime') {
        logger.warn(`FlixPatrolWeekly[${index}]: amazon-prime publishes no per-country weekly page, `
          + 'entry skipped');
      }
      if (entry.location !== 'world' && entry.language !== 'all') {
        logger.warn(`FlixPatrolWeekly[${index}]: language is ignored on a country entry, which `
          + 'carries no language split');
      }
    });
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
