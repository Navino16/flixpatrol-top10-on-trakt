import { logger } from '../Utils/Logger';
import type { Notifier } from './Notifier';
import { NOTIFICATION_EVENTS } from './types';
import type {
  Destination,
  NotificationEvent,
  NotificationPayload,
  NotificationsConfig,
} from './types';
import { WebhookAdapter } from './adapters/WebhookAdapter';
import { GotifyAdapter } from './adapters/GotifyAdapter';
import { NtfyAdapter } from './adapters/NtfyAdapter';
import { AppriseAdapter } from './adapters/AppriseAdapter';

export const DISPATCH_TIMEOUT_MS = 6000;

function buildAdapter(destination: Destination): Notifier {
  switch (destination.type) {
    case 'webhook': return new WebhookAdapter(destination);
    case 'gotify': return new GotifyAdapter(destination);
    case 'ntfy': return new NtfyAdapter(destination);
    case 'apprise': return new AppriseAdapter(destination);
  }
}

export class NotificationManager {
  private constructor(
    private readonly adapters: Partial<Record<NotificationEvent, Notifier[]>>,
  ) {}

  static fromConfig(config: NotificationsConfig): NotificationManager {
    const adapters: Partial<Record<NotificationEvent, Notifier[]>> = {};
    for (const event of NOTIFICATION_EVENTS) {
      const destinations = config[event];
      if (destinations && destinations.length > 0) {
        adapters[event] = destinations.map(buildAdapter);
      }
    }
    return new NotificationManager(adapters);
  }

  async dispatch(event: NotificationEvent, payload: NotificationPayload): Promise<void> {
    const targets = this.adapters[event];
    if (!targets || targets.length === 0) return;

    const sends = targets.map((adapter) =>
      adapter.notify(event, payload).catch((err) => {
        logger.warn(`NotificationManager: adapter for "${event}" threw: ${(err as Error).message}`);
      }),
    );
    let timerId: ReturnType<typeof setTimeout>;
    const cap = new Promise<void>((resolve) => {
      timerId = setTimeout(() => {
        logger.warn(`NotificationManager: dispatch for "${event}" hit the ${DISPATCH_TIMEOUT_MS}ms cap`);
        resolve();
      }, DISPATCH_TIMEOUT_MS);
    });
    await Promise.race([Promise.allSettled(sends).then(() => undefined), cap]);
    clearTimeout(timerId!);
  }
}
