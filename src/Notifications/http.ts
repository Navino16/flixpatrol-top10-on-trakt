import { logger } from '../Utils/Logger';

export const TIMEOUT_MS = 5000;

export interface PostJsonOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
}

/**
 * POST a JSON body to a URL with a bounded timeout and a no-throw contract.
 *
 * The destination URL is NEVER written to the log on failure — only the adapter
 * label + status / error message. This keeps webhook secrets (Discord bearer
 * tokens in the path, Slack signing tokens, Apprise routing keys, Gotify
 * tokens, etc.) out of log files, container stdout, and CI bundles. The user
 * knows which destination is failing from their own config.
 */
export async function postJsonWithTimeout(
  url: string,
  body: unknown,
  label: string,
  options: PostJsonOptions = {},
): Promise<void> {
  const timeout = options.timeoutMs ?? TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...options.headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      logger.warn(`${label}: HTTP ${response.status}`);
    }
  } catch (err) {
    logger.warn(`${label}: ${(err as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
}
