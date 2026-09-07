import { logger } from '../Utils/Logger';
import { FlareSolverrError } from '../Utils/Errors';
import type { FlareSolverrOptions } from '../types';

// Namespaced: a FlareSolverr instance shared with other tools could collide on the name.
const SESSION_NAME = 'flixpatrol-top10';

// Mirrors the retry constants in FlixPatrol.ts; keep the two in sync.
const RETRY_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);
const MAX_RETRIES = 3;

interface FlareSolverrSolution {
  url: string;
  status: number;
  response: string;
}

interface FlareSolverrEnvelope {
  status: string;
  message?: string;
  session?: string;
  solution?: FlareSolverrSolution;
}

/**
 * Minimal FlareSolverr v1 client. Commands are issued explicitly and in order:
 * `sessions.create` -> N x `request.get` -> `sessions.destroy`. A `request.get`
 * without a `session` re-solves the challenge on a throwaway browser instance.
 */
export class FlareSolverrClient {
  private readonly endpoint: string;

  private readonly maxTimeout: number;

  private readonly disableMedia: boolean;

  private sessionId: string | null = null;

  constructor(options: FlareSolverrOptions) {
    if (!options.url) {
      throw new FlareSolverrError('FlareSolverr url must be set when FlareSolverr is enabled');
    }
    this.endpoint = options.url;
    this.maxTimeout = options.maxTimeout;
    this.disableMedia = options.disableMedia;
  }

  private async command(payload: Record<string, unknown>): Promise<FlareSolverrEnvelope> {
    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return await res.json() as FlareSolverrEnvelope;
  }

  /**
   * Appends the underlying `cause` to the message: Node's fetch collapses every
   * transport failure into a generic `TypeError: fetch failed`, and the actionable
   * detail lives in `err.cause`.
   */
  private static formatError(err: unknown): string {
    const message = err instanceof Error ? err.message : String(err);
    // `Error.cause` isn't in this project's configured TS lib, hence the explicit shape.
    const cause = err instanceof Error ? (err as Error & { cause?: unknown }).cause : undefined;
    if (cause === undefined) {
      return message;
    }
    const causeText = cause instanceof Error ? cause.message : String(cause);
    return `${message} (${causeText})`;
  }

  /** Throws on failure: a dead FlareSolverr must abort the run before any list is processed. */
  public async createSession(): Promise<void> {
    logger.debug(`Creating FlareSolverr session "${SESSION_NAME}" at ${this.endpoint}`);
    let envelope: FlareSolverrEnvelope;
    try {
      envelope = await this.command({ cmd: 'sessions.create', session: SESSION_NAME });
    } catch (err) {
      throw new FlareSolverrError(
        `sessions.create failed at ${this.endpoint}: ${FlareSolverrClient.formatError(err)}`,
      );
    }
    if (envelope.status !== 'ok') {
      throw new FlareSolverrError(
        `sessions.create failed at ${this.endpoint}: ${envelope.message ?? envelope.status}`,
      );
    }
    this.sessionId = envelope.session ?? SESSION_NAME;
    logger.info(`FlareSolverr session ready (${this.sessionId})`);
  }

  /**
   * Fetches a URL through FlareSolverr. Returns null on any failure, matching the
   * contract of FlixPatrol.getFlixPatrolHTMLPage. An envelope with `status !== 'ok'`
   * is how FlareSolverr reports a challenge-solve timeout, so it is retried.
   */
  public async get(url: string): Promise<string | null> {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
      try {
        const envelope = await this.command({
          cmd: 'request.get',
          url,
          session: this.sessionId ?? SESSION_NAME,
          maxTimeout: this.maxTimeout,
          // Sent only when true: FlareSolverr lets the request parameter override its
          // own DISABLE_MEDIA env var, so sending `false` would silently defeat an
          // operator who enabled it on the container.
          ...(this.disableMedia ? { disableMedia: true } : {}),
        });

        if (envelope.status !== 'ok') {
          const reason = envelope.message ?? envelope.status;
          if (attempt === MAX_RETRIES) {
            logger.error(`FlareSolverr failed for ${url}: ${reason}`);
            return null;
          }
          logger.warn(`Retry attempt ${attempt} for ${url}: ${reason}`);
        } else if (!envelope.solution || envelope.solution.status !== 200) {
          const solutionStatus = envelope.solution?.status;
          const retryable = solutionStatus !== undefined && RETRY_STATUS_CODES.has(solutionStatus);
          if (!retryable || attempt === MAX_RETRIES) {
            logger.error(`FlareSolverr returned HTTP ${solutionStatus} for ${url}`);
            return null;
          }
          logger.warn(`Retry attempt ${attempt} for ${url}: HTTP ${solutionStatus}`);
        } else if (typeof envelope.solution.response !== 'string') {
          // ok/200 envelope with no usable body: a definitive failure, not an empty page.
          logger.error(`FlareSolverr returned no response body for ${url}`);
          return null;
        } else {
          logger.debug(`FlareSolverr fetched ${url} (HTTP ${envelope.solution.status})`);
          return envelope.solution.response;
        }
      } catch (err) {
        if (attempt === MAX_RETRIES) {
          logger.error(`FlareSolverr request failed for ${url}: ${FlareSolverrClient.formatError(err)}`);
          return null;
        }
        logger.warn(`Retry attempt ${attempt} for ${url}: ${FlareSolverrClient.formatError(err)}`);
      }
      // Exponential backoff: 1s, 2s, 4s
      await new Promise((resolve) => { setTimeout(resolve, 2 ** (attempt - 1) * 1000); });
    }
    return null;
  }

  /**
   * Never throws: it runs in a `finally` block, so a failure here must not fail an
   * otherwise successful run. A leaked session keeps a Chrome resident alive.
   */
  public async destroySession(): Promise<void> {
    if (this.sessionId === null) {
      return;
    }
    const id = this.sessionId;
    this.sessionId = null;
    try {
      const envelope = await this.command({ cmd: 'sessions.destroy', session: id });
      if (envelope.status !== 'ok') {
        logger.warn(`FlareSolverr sessions.destroy failed for ${id}: ${envelope.message ?? envelope.status}`);
        return;
      }
      logger.debug(`FlareSolverr session ${id} destroyed`);
    } catch (err) {
      logger.warn(`FlareSolverr sessions.destroy failed for ${id}: ${FlareSolverrClient.formatError(err)}`);
    }
  }
}
