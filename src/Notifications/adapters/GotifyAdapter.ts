import { logger } from '../../Utils/Logger';
import type { Notifier } from '../Notifier';
import type {
  NotificationEvent,
  NotificationPayload,
  GotifyDestination,
} from '../types';

const TIMEOUT_MS = 5000;

function priorityFor(event: NotificationEvent): number {
  return event === 'error' ? 8 : 5;
}

export class GotifyAdapter implements Notifier {
  constructor(private readonly destination: GotifyDestination) {}

  async notify(event: NotificationEvent, payload: NotificationPayload): Promise<void> {
    const base = this.destination.url.replace(/\/+$/, '');
    const url = `${base}/message?token=${encodeURIComponent(this.destination.token)}`;
    const body = {
      title: payload.title,
      message: payload.body,
      priority: priorityFor(event),
    };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) {
        logger.warn(`GotifyAdapter: HTTP ${response.status} from ${base}`);
      }
    } catch (err) {
      logger.warn(`GotifyAdapter: ${(err as Error).message} for ${base}`);
    } finally {
      clearTimeout(timer);
    }
  }
}
