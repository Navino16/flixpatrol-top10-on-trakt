export type NotificationEvent = 'run_start' | 'run_end' | 'error';

export interface RunSummary {
  listsProcessed: number;
  moviesAdded: number;
  showsAdded: number;
  unmatchedMovies: number;
  unmatchedShows: number;
  durationMs: number;
}

export interface NotificationPayload {
  title: string;
  body: string;
  timestamp: string;
  summary?: RunSummary;
}

export interface WebhookDestination {
  type: 'webhook';
  url: string;
}

export interface GotifyDestination {
  type: 'gotify';
  url: string;
  token: string;
}

export interface NtfyDestination {
  type: 'ntfy';
  url: string;
  topic: string;
}

export interface AppriseDestination {
  type: 'apprise';
  url: string;
  key: string;
}

export type Destination =
  | WebhookDestination
  | GotifyDestination
  | NtfyDestination
  | AppriseDestination;

export type NotificationsConfig = Partial<Record<NotificationEvent, Destination[]>>;
