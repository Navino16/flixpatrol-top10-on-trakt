import { postJsonWithTimeout } from '../http';
import type { Notifier } from '../Notifier';
import type {
  NotificationEvent,
  NotificationPayload,
  GotifyDestination,
} from '../types';

function priorityFor(event: NotificationEvent): number {
  return event === 'error' ? 8 : 5;
}

export class GotifyAdapter implements Notifier {
  constructor(private readonly destination: GotifyDestination) {}

  async notify(event: NotificationEvent, payload: NotificationPayload): Promise<void> {
    const base = this.destination.url.replace(/\/+$/, '');
    const url = `${base}/message`;
    const body = {
      title: payload.title,
      message: payload.body,
      priority: priorityFor(event),
    };
    await postJsonWithTimeout(url, body, 'GotifyAdapter', {
      headers: { 'X-Gotify-Key': this.destination.token },
    });
  }
}
