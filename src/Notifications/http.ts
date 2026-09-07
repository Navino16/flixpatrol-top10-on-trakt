import { logger } from '../Utils/Logger';

export const TIMEOUT_MS = 5000;

export interface PostJsonOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '?';
  }
}

/**
 * POST a JSON body with a bounded timeout and a no-throw contract: a failing
 * notification destination must never break a run. Failure logs carry the
 * destination's host, never the full URL, which can embed webhook secrets.
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
  const host = safeHost(url);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...options.headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      logger.warn(`${label}[${host}]: HTTP ${response.status}`);
    }
  } catch (err) {
    logger.warn(`${label}[${host}]: ${(err as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
}
