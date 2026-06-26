import { logger } from '../../Utils/Logger';
import type { Notifier } from '../Notifier';
import type {
  NotificationEvent,
  NotificationPayload,
  AppriseDestination,
} from '../types';

const TIMEOUT_MS = 5000;

const APPRISE_TYPE: Record<NotificationEvent, 'info' | 'success' | 'failure'> = {
  run_start: 'info',
  run_end: 'success',
  error: 'failure',
};

export class AppriseAdapter implements Notifier {
  constructor(private readonly destination: AppriseDestination) {}

  async notify(event: NotificationEvent, payload: NotificationPayload): Promise<void> {
    const base = this.destination.url.replace(/\/+$/, '');
    const url = `${base}/notify/${encodeURIComponent(this.destination.key)}`;
    const body = {
      title: payload.title,
      body: payload.body,
      type: APPRISE_TYPE[event],
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
        logger.warn(`AppriseAdapter: HTTP ${response.status} from ${base}`);
      }
    } catch (err) {
      logger.warn(`AppriseAdapter: ${(err as Error).message} for ${base}`);
    } finally {
      clearTimeout(timer);
    }
  }
}
