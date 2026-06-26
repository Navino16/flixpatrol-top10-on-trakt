import { logger } from '../Utils/Logger';

export const TIMEOUT_MS = 5000;

export function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const discordMatch = parsed.pathname.match(/^(\/api\/webhooks\/[^/]+\/)[^/]+/);
    if (discordMatch) {
      return `${parsed.origin}${discordMatch[1]}<redacted>`;
    }
    const appriseMatch = parsed.pathname.match(/^(\/notify\/)[^/]+/);
    if (appriseMatch) {
      return `${parsed.origin}${appriseMatch[1]}<redacted>`;
    }
    return url;
  } catch {
    return url;
  }
}

export interface PostJsonOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export async function postJsonWithTimeout(
  url: string,
  body: unknown,
  label: string,
  options: PostJsonOptions = {},
): Promise<void> {
  const timeout = options.timeoutMs ?? TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  const safeUrl = redactUrl(url);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...options.headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      logger.warn(`${label}: HTTP ${response.status} from ${safeUrl}`);
    }
  } catch (err) {
    logger.warn(`${label}: ${(err as Error).message} for ${safeUrl}`);
  } finally {
    clearTimeout(timer);
  }
}
