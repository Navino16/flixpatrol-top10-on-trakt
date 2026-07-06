import { postJsonWithTimeout } from '../http';
import type { Notifier } from '../Notifier';
import type {
  NotificationEvent,
  NotificationPayload,
  NtfyDestination,
} from '../types';

function priorityFor(event: NotificationEvent): number {
  return event === 'error' ? 5 : 3;
}

export class NtfyAdapter implements Notifier {
  constructor(private readonly destination: NtfyDestination) {}

  async notify(event: NotificationEvent, payload: NotificationPayload): Promise<void> {
    const base = this.destination.url.replace(/\/+$/, '');
    const body = {
      topic: this.destination.topic,
      title: payload.title,
      message: payload.body,
      priority: priorityFor(event),
      tags: [event],
    };
    await postJsonWithTimeout(base, body, 'NtfyAdapter');
  }
}
