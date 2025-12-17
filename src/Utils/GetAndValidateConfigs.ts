import config from 'config';
import { z } from 'zod';
import { ConfigurationError } from './Errors';
import {
  FlixPatrolTop10Schema,
  FlixPatrolPopularSchema,
  FlixPatrolMostWatchedSchema,
  FlixPatrolMostHoursTotalSchema,
  TraktOptionsSchema,
  CacheOptionsSchema,
} from '../types';
import type {
  FlixPatrolTop10,
  FlixPatrolPopular,
  FlixPatrolMostWatched,
  FlixPatrolMostHoursTotal,
  TraktAPIOptions,
  CacheOptions,
} from '../types';

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

  public static getFlixPatrolMostHoursTotal(): FlixPatrolMostHoursTotal[] {
    try {
      if (!config.has('FlixPatrolMostHoursTotal')) {
        return [];
      }
      const data = config.get('FlixPatrolMostHoursTotal');
      return validateConfig(z.array(FlixPatrolMostHoursTotalSchema), data, 'FlixPatrolMostHoursTotal');
    } catch (err) {
      if (err instanceof ConfigurationError) throw err;
      throw new ConfigurationError(`${err}`);
    }
  }

  public static getTraktOptions(): TraktAPIOptions {
    try {
      const data = config.get('Trakt');
      return validateConfig(TraktOptionsSchema, data, 'Trakt');
    } catch (err) {
      if (err instanceof ConfigurationError) throw err;
      throw new ConfigurationError(`${err}`);
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
}