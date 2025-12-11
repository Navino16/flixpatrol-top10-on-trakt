import {
  flixpatrolTop10Location,
  flixpatrolTop10Platform,
  flixpatrolPopularPlatform,
  flixpatrolConfigType,
} from './Config.types';

export interface FlixPatrolOptions {
  url?: string;
  agent?: string;
}

// Types derived from the arrays
export type FlixPatrolTop10Location = (typeof flixpatrolTop10Location)[number];
export type FlixPatrolTop10Platform = (typeof flixpatrolTop10Platform)[number];
export type FlixPatrolPopularPlatform = (typeof flixpatrolPopularPlatform)[number];
export type FlixPatrolConfigType = (typeof flixpatrolConfigType)[number];

export type FlixPatrolType = 'Movies' | 'TV Shows';