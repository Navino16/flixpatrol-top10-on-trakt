import { postJsonWithTimeout } from '../http';
import type { Notifier } from '../Notifier';
import type {
  NotificationEvent,
  NotificationPayload,
  AppriseDestination,
} from '../types';

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
    await postJsonWithTimeout(url, body, 'AppriseAdapter');
  }
}
