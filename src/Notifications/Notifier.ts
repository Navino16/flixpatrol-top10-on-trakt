import type { NotificationEvent, NotificationPayload } from './types';

export interface Notifier {
  notify(event: NotificationEvent, payload: NotificationPayload): Promise<void>;
}
