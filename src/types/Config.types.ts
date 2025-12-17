import { z } from 'zod';

// Arrays - single source of truth
export const flixpatrolTop10Location = ['world', 'afghanistan', 'albania', 'algeria', 'andorra', 'angola',
  'antigua-and-barbuda', 'argentina', 'armenia', 'australia', 'austria', 'azerbaijan', 'bahamas', 'bahrain',
  'bangladesh', 'barbados', 'belarus', 'belgium', 'belize', 'benin', 'bhutan', 'bolivia', 'bosnia-and-herzegovina',
  'botswana', 'brazil', 'brunei', 'bulgaria', 'burkina-faso', 'burundi', 'cambodia', 'cameroon', 'canada',
  'cape-verde', 'central-african-republic', 'chad', 'chile', 'china', 'colombia', 'comoros', 'costa-rica', 'croatia',
  'cyprus', 'czech-republic', 'democratic-republic-of-the-congo', 'denmark', 'djibouti', 'dominica',
  'dominican-republic', 'east-timor', 'ecuador', 'egypt', 'equatorial-guinea', 'eritrea', 'estonia', 'ethiopia',
  'fiji', 'finland', 'france', 'gabon', 'gambia', 'georgia', 'germany', 'ghana', 'greece', 'grenada', 'guadeloupe',
  'guatemala', 'guinea', 'guinea-bissau', 'guyana', 'haiti', 'honduras', 'hong-kong', 'hungary', 'iceland', 'india',
  'indonesia', 'iraq', 'ireland', 'israel', 'italy', 'ivory-coast', 'jamaica', 'japan', 'jordan', 'kazakhstan',
  'kenya', 'kiribati', 'kosovo', 'kuwait', 'kyrgyzstan', 'laos', 'latvia', 'lebanon', 'lesotho', 'liberia', 'libya',
  'liechtenstein', 'lithuania', 'luxembourg', 'madagascar', 'malawi', 'malaysia', 'maldives', 'mali', 'malta',
  'marshall-islands', 'martinique', 'mauritania', 'mauritius', 'mexico', 'micronesia', 'moldova', 'monaco',
  'mongolia', 'montenegro', 'morocco', 'mozambique', 'myanmar', 'namibia', 'nauru', 'nepal', 'netherlands',
  'new-caledonia', 'new-zealand', 'nicaragua', 'niger', 'nigeria', 'north-macedonia', 'norway', 'oman', 'pakistan',
  'palau', 'palestine', 'panama', 'papua-new-guinea', 'paraguay', 'peru', 'philippines', 'poland', 'portugal',
  'qatar', 'republic-of-the-congo', 'reunion', 'romania', 'russia', 'rwanda', 'saint-kitts-and-nevis', 'saint-lucia',
  'saint-vincent-and-the-grenadines', 'salvador', 'samoa', 'san-marino', 'sao-tome-and-principe', 'saudi-arabia',
  'senegal', 'serbia', 'seychelles', 'sierra-leone', 'singapore', 'slovakia', 'slovenia', 'solomon-islands',
  'somalia', 'south-africa', 'south-korea', 'south-sudan', 'spain', 'sri-lanka', 'sudan', 'suriname', 'swaziland',
  'sweden', 'switzerland', 'taiwan', 'tajikistan', 'tanzania', 'thailand', 'togo', 'tonga', 'trinidad-and-tobago',
  'tunisia', 'turkey', 'turkmenistan', 'tuvalu', 'uganda', 'ukraine', 'united-arab-emirates', 'united-kingdom',
  'united-states', 'uruguay', 'uzbekistan', 'vanuatu', 'vatican-city', 'venezuela', 'vietnam', 'yemen', 'zambia',
  'zimbabwe'] as const;

export const flixpatrolTop10Platform = ['netflix', 'hbo-max', 'disney', 'amazon', 'amazon-channels', 'amazon-prime',
  'amc-plus', 'apple-tv', 'bbc', 'canal', 'catchplay', 'cda', 'chili', 'claro-video', 'crunchyroll', 'discovery-plus',
  'francetv', 'freevee', 'globoplay', 'go3', 'google', 'hotstar', 'hrti', 'hulu', 'hulu-nippon', 'itunes', 'jiocinema',
  'lemino', 'm6plus', 'mgm-plus', 'myvideo', 'now', 'osn', 'paramount-plus', 'peacock', 'player', 'pluto-tv',
  'raiplay', 'rakuten-tv', 'rtl-plus', 'shahid', 'starz', 'streamz', 'tf1', 'tod', 'tubi', 'u-next', 'viaplay',
  'videoland', 'viki', 'vix', 'voyo', 'vudu', 'watchit', 'wavve', 'wow', 'zee5'] as const;

export const flixpatrolPopularPlatform = ['movie-db', 'facebook', 'twitter', 'twitter-trends', 'instagram',
  'instagram-trends', 'youtube', 'imdb', 'letterboxd', 'rotten-tomatoes', 'tmdb', 'trakt', 'wikipedia-trends',
  'reddit'] as const;

export const flixpatrolConfigType = ['movies', 'shows', 'both'] as const;
const traktPrivacy = ['private', 'link', 'friends', 'public'] as const;

// Zod schemas
const FlixPatrolTop10LocationSchema = z.enum(flixpatrolTop10Location);
const FlixPatrolTop10PlatformSchema = z.enum(flixpatrolTop10Platform);
const FlixPatrolPopularPlatformSchema = z.enum(flixpatrolPopularPlatform);
const FlixPatrolConfigTypeSchema = z.enum(flixpatrolConfigType);
const TraktPrivacySchema = z.enum(traktPrivacy);

export const FlixPatrolTop10Schema = z.object({
  platform: FlixPatrolTop10PlatformSchema,
  location: FlixPatrolTop10LocationSchema,
  fallback: z.union([FlixPatrolTop10LocationSchema, z.literal(false)]),
  privacy: TraktPrivacySchema,
  limit: z.number().min(1, 'limit must be >= 1'),
  type: FlixPatrolConfigTypeSchema,
  name: z.string().optional(),
  normalizeName: z.boolean().optional(),
  kids: z.boolean().optional(),
});

export const FlixPatrolPopularSchema = z.object({
  platform: FlixPatrolPopularPlatformSchema,
  privacy: TraktPrivacySchema,
  limit: z.number().min(1).max(100, 'limit must be between 1 and 100'),
  type: FlixPatrolConfigTypeSchema,
  name: z.string().optional(),
  normalizeName: z.boolean().optional(),
});

const currentYear = new Date().getFullYear();

export const FlixPatrolMostWatchedSchema = z.object({
  enabled: z.boolean(),
  privacy: TraktPrivacySchema,
  limit: z.number().min(1).max(50, 'limit must be between 1 and 50'),
  type: FlixPatrolConfigTypeSchema,
  year: z.number().min(2023).max(currentYear, `year must be between 2023 and ${currentYear}`),
  name: z.string().optional(),
  normalizeName: z.boolean().optional(),
  premiere: z.number().min(1980).max(currentYear, `premiere must be between 1980 and ${currentYear}`).optional(),
  country: FlixPatrolTop10LocationSchema.optional(),
  original: z.boolean().optional(),
  orderByViews: z.boolean().optional(),
});

export const flixpatrolMostHoursPeriod = ['total', 'first-week', 'first-month'] as const;
export const flixpatrolMostHoursLanguage = ['all', 'english', 'non-english'] as const;
const FlixPatrolMostHoursPeriodSchema = z.enum(flixpatrolMostHoursPeriod);
const FlixPatrolMostHoursLanguageSchema = z.enum(flixpatrolMostHoursLanguage);

export const FlixPatrolMostHoursSchema = z.object({
  enabled: z.boolean(),
  privacy: TraktPrivacySchema,
  limit: z.number().min(1).max(100, 'limit must be between 1 and 100'),
  type: FlixPatrolConfigTypeSchema,
  period: FlixPatrolMostHoursPeriodSchema,
  language: FlixPatrolMostHoursLanguageSchema.optional().default('all'),
  name: z.string().optional(),
  normalizeName: z.boolean().optional(),
});

export const TraktOptionsSchema = z.object({
  saveFile: z.string(),
  clientId: z.string(),
  clientSecret: z.string(),
});

export const CacheOptionsSchema = z.object({
  enabled: z.boolean(),
  savePath: z.string(),
  ttl: z.number(),
});

// Infer types from schemas
export type FlixPatrolTop10 = z.infer<typeof FlixPatrolTop10Schema>;
export type FlixPatrolPopular = z.infer<typeof FlixPatrolPopularSchema>;
export type FlixPatrolMostWatched = z.infer<typeof FlixPatrolMostWatchedSchema>;
export type FlixPatrolMostHours = z.infer<typeof FlixPatrolMostHoursSchema>;
export type FlixPatrolMostHoursPeriod = z.infer<typeof FlixPatrolMostHoursPeriodSchema>;
export type FlixPatrolMostHoursLanguage = z.infer<typeof FlixPatrolMostHoursLanguageSchema>;
export type TraktAPIOptions = z.infer<typeof TraktOptionsSchema>;
export type CacheOptions = z.infer<typeof CacheOptionsSchema>;