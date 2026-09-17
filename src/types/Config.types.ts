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

export const flixpatrolTop10Platform = ['9now', 'abema', 'amazon', 'amazon-channels', 'amazon-prime', 'amc-plus',
  'antenna-tv', 'apple-tv', 'bbc', 'canal', 'catchplay', 'cda', 'chili', 'claro-video', 'coupang-play', 'crunchyroll',
  'discovery-plus', 'disney', 'francetv', 'friday', 'globoplay', 'go3', 'google', 'hami-video', 'hayu', 'hbo-max',
  'hrti', 'hulu', 'hulu-nippon', 'itunes', 'jiocinema', 'jiohotstar', 'joyn', 'lemino', 'm6plus', 'mgm-plus', 'myvideo',
  'neon-tv', 'netflix', 'now', 'oneplay', 'osn', 'paramount-plus', 'peacock', 'player', 'pluto-tv', 'raiplay',
  'rakuten-tv', 'rtl-plus', 'sbs', 'shahid', 'skyshowtime', 'stan', 'starz', 'streamz', 'telasa', 'tf1', 'tod',
  'trueid', 'tubi', 'tv-2-norge', 'u-next', 'viaplay', 'videoland', 'vidio', 'viki', 'viu', 'vix', 'voyo', 'vudu',
  'watchit', 'wavve', 'wow', 'zee5'] as const;

export const flixpatrolPopularPlatform = ['wikipedia', 'youtube'] as const;

export const flixpatrolConfigType = ['movies', 'shows', 'both'] as const;

// Sous-ensemble strict de flixpatrolTop10Location : le select `from` de la page /hours/
// n'offre que ces 93 pays, et un pays hors liste renvoie une page "Page Not Found" en
// HTTP 200, donc une liste vidée plutôt qu'une erreur. Relevé le 2026-09-16.
export const flixpatrolMostWatchedCountry = ['argentina', 'australia', 'austria', 'bahamas', 'bahrain',
  'bangladesh', 'belgium', 'bolivia', 'brazil', 'bulgaria', 'canada', 'chile', 'colombia', 'costa-rica', 'croatia',
  'cyprus', 'czech-republic', 'denmark', 'dominican-republic', 'ecuador', 'egypt', 'estonia', 'finland', 'france',
  'germany', 'greece', 'guadeloupe', 'guatemala', 'honduras', 'hong-kong', 'hungary', 'iceland', 'india', 'indonesia',
  'ireland', 'israel', 'italy', 'jamaica', 'japan', 'jordan', 'kenya', 'kuwait', 'latvia', 'lebanon', 'lithuania',
  'luxembourg', 'malaysia', 'maldives', 'malta', 'martinique', 'mauritius', 'mexico', 'morocco', 'netherlands',
  'new-caledonia', 'new-zealand', 'nicaragua', 'nigeria', 'norway', 'oman', 'pakistan', 'panama', 'paraguay', 'peru',
  'philippines', 'poland', 'portugal', 'qatar', 'reunion', 'romania', 'salvador', 'saudi-arabia', 'serbia',
  'singapore', 'slovakia', 'slovenia', 'south-africa', 'south-korea', 'spain', 'sri-lanka', 'sweden', 'switzerland',
  'taiwan', 'thailand', 'trinidad-and-tobago', 'turkey', 'ukraine', 'united-arab-emirates', 'united-kingdom',
  'united-states', 'uruguay', 'venezuela', 'vietnam'] as const;

// `sports` pour les films, `sport` pour les séries : c'est la graphie de FlixPatrol,
// ne pas l'harmoniser.
export const flixpatrolMostWatchedMovieGenre = ['action', 'adventure', 'animation', 'biography', 'comedy',
  'concerts', 'crime', 'documentary', 'drama', 'fairy-tale', 'family', 'fantasy', 'history', 'horror', 'musical',
  'record', 'romance', 'science-fiction', 'sports', 'superhero', 'thriller', 'war', 'western'] as const;

export const flixpatrolMostWatchedShowGenre = ['action', 'adventure', 'animation', 'biography', 'broadcast',
  'comedy', 'crime', 'documentary', 'drama', 'family', 'fantasy', 'game-show', 'history', 'horror', 'music', 'news',
  'reality-show', 'romance', 'science-fiction', 'sport', 'superhero', 'talk-show', 'thriller', 'war',
  'western'] as const;

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

// L'union des deux z.enum plutôt qu'un z.enum sur le tableau fusionné : elle conserve le
// type littéral de `genre`, qu'un cast vers [string, ...string[]] détruirait.
const FlixPatrolMostWatchedGenreSchema = z.union([
  z.enum(flixpatrolMostWatchedMovieGenre),
  z.enum(flixpatrolMostWatchedShowGenre),
]);

// Le message par défaut de Zod énumère les 93 valeurs ; celui-ci nomme la valeur refusée
// et renvoie au README. Voir spec §5.
const FlixPatrolMostWatchedCountrySchema = z.enum(flixpatrolMostWatchedCountry, {
  error: (issue) => `country "${String(issue.input)}" is not one of the 93 countries FlixPatrol `
    + 'serves on the Most-watched pages — see the README for the full list. Note it is NOT the '
    + 'same set as the Top10 locations.',
});

export const FlixPatrolMostWatchedSchema = z.object({
  enabled: z.boolean(),
  privacy: TraktPrivacySchema,
  limit: z.number().min(1).max(50, 'limit must be between 1 and 50'),
  type: FlixPatrolConfigTypeSchema,
  year: z.number().min(2023).max(currentYear, `year must be between 2023 and ${currentYear}`),
  name: z.string().optional(),
  normalizeName: z.boolean().optional(),
  premiere: z.number().min(1980).max(currentYear, `premiere must be between 1980 and ${currentYear}`).optional(),
  country: FlixPatrolMostWatchedCountrySchema.optional(),
  genre: FlixPatrolMostWatchedGenreSchema.optional(),
  original: z.boolean().optional(),
}).superRefine((block, ctx) => {
  if (block.genre === undefined) return;

  const needsMovie = block.type === 'movies' || block.type === 'both';
  const needsShow = block.type === 'shows' || block.type === 'both';
  const missing: string[] = [];

  if (needsMovie && !(flixpatrolMostWatchedMovieGenre as readonly string[]).includes(block.genre)) {
    missing.push('movies');
  }
  if (needsShow && !(flixpatrolMostWatchedShowGenre as readonly string[]).includes(block.genre)) {
    missing.push('shows');
  }
  if (missing.length === 0) return;

  // Une page de genre absente répond 200 "Page Not Found", donc un scrape vide, donc
  // un kind vidé sans erreur : refuser ici est la seule barrière. Voir spec §1.
  ctx.addIssue({
    code: 'custom',
    path: ['genre'],
    message: `genre "${block.genre}" does not exist for ${missing.join(' and ')} on FlixPatrol, `
      + `and type is "${block.type}". FlixPatrol would answer an empty page, which would ERASE `
      + 'that part of the list. Pick a genre valid for every type this block requests.',
  });
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

export const FloppyOptionsSchema = z.object({
  url: z.url(),
  apiKey: z.string().min(1, 'apiKey must not be empty'),
});

export const MdblistOptionsSchema = z.object({
  apiKey: z.string().min(1, 'apiKey must not be empty'),
});

export const targetBackend = ['trakt', 'floppy', 'mdblist'] as const;

/**
 * Credential values shipped in the configuration template. Both template sites and the
 * startup guard that rejects them read from here, so rewording the template cannot
 * silently leave the guard behind.
 */
export const TRAKT_TEMPLATE_CLIENT_ID = 'You need to replace this client ID';
export const TRAKT_TEMPLATE_CLIENT_SECRET = 'You need to replace this client secret';

/**
 * Template credentials per backend, keyed by the field they occupy in the `Target` block.
 * Only `trakt` is listed, being the only backend the template carries credentials for.
 *
 * `saveFile` is deliberately absent: `./config/.trakt` is a sensible default users are
 * expected to keep, not a placeholder to replace.
 */
export const TEMPLATE_CREDENTIALS: Partial<Record<TargetBackendName, Readonly<Record<string, string>>>> = {
  trakt: {
    clientId: TRAKT_TEMPLATE_CLIENT_ID,
    clientSecret: TRAKT_TEMPLATE_CLIENT_SECRET,
  },
};

/**
 * The backend selector and its credentials form one discriminated union rather than a
 * selector plus sibling credential blocks, so a `Target` carries exactly the fields its
 * backend needs and "type: floppy with only Trakt credentials" is not representable.
 */
export const TraktTargetSchema = TraktOptionsSchema.extend({ type: z.literal('trakt') });
export const FloppyTargetSchema = FloppyOptionsSchema.extend({ type: z.literal('floppy') });
export const MdblistTargetSchema = MdblistOptionsSchema.extend({ type: z.literal('mdblist') });

export const TargetSchema = z.discriminatedUnion('type', [
  TraktTargetSchema,
  FloppyTargetSchema,
  MdblistTargetSchema,
]);

export const CacheOptionsSchema = z.object({
  enabled: z.boolean(),
  savePath: z.string(),
  ttl: z.number(),
});

export const WebhookDestinationSchema = z.object({
  type: z.literal('webhook'),
  url: z.url(),
});

export const GotifyDestinationSchema = z.object({
  type: z.literal('gotify'),
  url: z.url(),
  token: z.string().min(1),
});

export const NtfyDestinationSchema = z.object({
  type: z.literal('ntfy'),
  url: z.url(),
  topic: z.string().min(1),
});

export const AppriseDestinationSchema = z.object({
  type: z.literal('apprise'),
  url: z.url(),
  key: z.string().min(1),
});

export const DestinationSchema = z.discriminatedUnion('type', [
  WebhookDestinationSchema,
  GotifyDestinationSchema,
  NtfyDestinationSchema,
  AppriseDestinationSchema,
]);

export const NotificationsSchema = z.object({
  run_start: z.array(DestinationSchema).optional(),
  run_end: z.array(DestinationSchema).optional(),
  error: z.array(DestinationSchema).optional(),
});

export const ScheduleOptionsSchema = z.object({
  enabled: z.boolean().default(false),
  crons: z.array(z.string()).default([]),
  runOnStart: z.boolean().default(false),
}).refine(
  (s) => !s.enabled || s.crons.length > 0,
  { message: 'crons must contain at least one expression when enabled' },
);

export const FlareSolverrOptionsSchema = z.object({
  enabled: z.boolean().default(false),
  url: z.url().optional(),
  maxTimeout: z.number().default(60000),
  // Blocks images, CSS and fonts in the solver's browser. Measured at ~17% off warm
  // requests with no effect on the challenge solve — see issue #525.
  disableMedia: z.boolean().default(false),
}).refine(
  (f) => !f.enabled || (f.url !== undefined && f.url.length > 0),
  { message: 'url must be set when enabled' },
);

// Infer types from schemas
export type FlixPatrolTop10 = z.infer<typeof FlixPatrolTop10Schema>;
export type FlixPatrolPopular = z.infer<typeof FlixPatrolPopularSchema>;
export type FlixPatrolMostWatched = z.infer<typeof FlixPatrolMostWatchedSchema>;
export type FlixPatrolMostWatchedCountry = (typeof flixpatrolMostWatchedCountry)[number];
export type FlixPatrolMostWatchedGenre =
  | (typeof flixpatrolMostWatchedMovieGenre)[number]
  | (typeof flixpatrolMostWatchedShowGenre)[number];
export type FlixPatrolMostHours = z.infer<typeof FlixPatrolMostHoursSchema>;
export type FlixPatrolMostHoursPeriod = z.infer<typeof FlixPatrolMostHoursPeriodSchema>;
export type FlixPatrolMostHoursLanguage = z.infer<typeof FlixPatrolMostHoursLanguageSchema>;
export type TraktAPIOptions = z.infer<typeof TraktOptionsSchema>;
export type TargetBackendName = (typeof targetBackend)[number];
export type FloppyOptions = z.infer<typeof FloppyOptionsSchema>;
export type MdblistOptions = z.infer<typeof MdblistOptionsSchema>;

/** A discriminated union on `type`, which is what `createTarget` narrows on. */
export type TargetOptions = z.infer<typeof TargetSchema>;
export type TraktPrivacy = z.infer<typeof TraktPrivacySchema>;

export type CacheOptions = z.infer<typeof CacheOptionsSchema>;
export type NotificationsConfigFromSchema = z.infer<typeof NotificationsSchema>;
export type ScheduleOptions = z.infer<typeof ScheduleOptionsSchema>;
export type FlareSolverrOptions = z.infer<typeof FlareSolverrOptionsSchema>;
