import { logger } from '../../Utils/Logger';
import type { Notifier } from '../Notifier';
import type {
  NotificationEvent,
  NotificationPayload,
  NtfyDestination,
} from '../types';

const TIMEOUT_MS = 5000;

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
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(base, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) {
        logger.warn(`NtfyAdapter: HTTP ${response.status} from ${base}`);
      }
    } catch (err) {
      logger.warn(`NtfyAdapter: ${(err as Error).message} for ${base}`);
    } finally {
      clearTimeout(timer);
    }
  }
}
