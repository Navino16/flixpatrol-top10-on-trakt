import { postJsonWithTimeout } from '../http';
import type { Notifier } from '../Notifier';
import type {
  NotificationEvent,
  NotificationPayload,
  WebhookDestination,
} from '../types';

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
    await postJsonWithTimeout(this.destination.url, body, 'WebhookAdapter');
  }
}
