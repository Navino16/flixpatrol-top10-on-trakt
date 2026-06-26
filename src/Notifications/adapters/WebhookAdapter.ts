import { logger } from '../../Utils/Logger';
import type { Notifier } from '../Notifier';
import type {
  NotificationEvent,
  NotificationPayload,
  WebhookDestination,
} from '../types';

const TIMEOUT_MS = 5000;

const DISCORD_COLORS: Record<NotificationEvent, number> = {
  run_start: 0x3498db,
  run_end: 0x2ecc71,
  error: 0xe74c3c,
};

function isDiscordUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const isDiscordHost = parsed.host === 'discord.com' || parsed.host === 'discordapp.com';
    return isDiscordHost && parsed.pathname.startsWith('/api/webhooks/');
  } catch {
    return false;
  }
}

function buildDiscordPayload(event: NotificationEvent, payload: NotificationPayload): unknown {
  return {
    content: payload.title,
    embeds: [{
      title: payload.title,
      description: payload.body,
      timestamp: payload.timestamp,
      color: DISCORD_COLORS[event],
    }],
  };
}

function buildGenericPayload(event: NotificationEvent, payload: NotificationPayload): unknown {
  return {
    event,
    title: payload.title,
    body: payload.body,
    timestamp: payload.timestamp,
    ...(payload.summary ? { summary: payload.summary } : {}),
  };
}

export class WebhookAdapter implements Notifier {
  constructor(private readonly destination: WebhookDestination) {}

  async notify(event: NotificationEvent, payload: NotificationPayload): Promise<void> {
    const body = isDiscordUrl(this.destination.url)
      ? buildDiscordPayload(event, payload)
      : buildGenericPayload(event, payload);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(this.destination.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) {
        logger.warn(`WebhookAdapter: HTTP ${response.status} from ${this.destination.url}`);
      }
    } catch (err) {
      logger.warn(`WebhookAdapter: ${(err as Error).message} for ${this.destination.url}`);
    } finally {
      clearTimeout(timer);
    }
  }
}
