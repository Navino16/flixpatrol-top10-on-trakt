import type { TargetBackend } from '../Targets';

export const NOTIFICATION_EVENTS = ['run_start', 'run_end', 'error'] as const;
export type NotificationEvent = typeof NOTIFICATION_EVENTS[number];

export interface TargetSummary {
  id: string;
  backend: TargetBackend;
  listsProcessed: number;
  moviesAdded: number;
  showsAdded: number;
  status: 'ok' | 'aborted';
  /** Present only when `status` is `aborted`. */
  error?: string;
}

export interface RunSummary {
  targets: TargetSummary[];
  durationMs: number;
  /**
   * FlixPatrol paths that answered "Page Not Found" — each one's entry was skipped on every
   * target. Kept beyond the plan's shape: it is what makes a one-shot run exit 1 on a dead path.
   */
  deadPaths: string[];
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
