import { logger } from '../Utils/Logger';
import { FlareSolverrError } from '../Utils/Errors';
import type { FlareSolverrOptions } from '../types';

/**
 * Fixed, namespaced session id. FlareSolverr instances are commonly shared with
 * other tools (*arr stack), so an unqualified name like "default" could collide.
 */
const SESSION_NAME = 'flixpatrol-top10';

// Mirrors FlixPatrol.ts's own retry constants: same retryable HTTP statuses,
// same attempt budget, same exponential backoff shape (1s, 2s, 4s).
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
 * Minimal FlareSolverr v1 client.
 *
 * The three session commands are issued explicitly and in order:
 * `sessions.create` -> N x `request.get` -> `sessions.destroy`.
 *
 * This is deliberate. Per the FlareSolverr docs, a `request.get` sent WITHOUT a
 * session field "will create a temporary instance that will be destroyed
 * immediately after the request is completed" — so no cf_clearance cookie is
 * reused and every request re-solves the challenge (measured: 15.4s per request
 * versus 1.3-2.5s on a warm session). Dropping the session would still "work",
 * just ~10x slower, which is why the tests assert the session id is present in
 * every request.get payload.
 */
export class FlareSolverrClient {
  private readonly endpoint: string;

  private readonly maxTimeout: number;

  private sessionId: string | null = null;

  constructor(options: FlareSolverrOptions) {
    if (!options.url) {
      throw new FlareSolverrError('FlareSolverr url must be set when FlareSolverr is enabled');
    }
    this.endpoint = options.url;
    this.maxTimeout = options.maxTimeout;
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
   * Formats a caught error for a thrown/logged message, appending the underlying
   * `cause` when present. Node's fetch collapses every transport failure — dead
   * container, wrong port, wrong host, DNS failure, missing `http://` scheme —
   * into the same generic `TypeError: fetch failed`; the actionable detail lives
   * in `err.cause`, which is otherwise silently dropped.
   */
  private static formatError(err: unknown): string {
    const message = err instanceof Error ? err.message : String(err);
    // `Error.cause` (ES2022) isn't in this project's configured TS lib, so it is
    // read through an explicit shape rather than widening the whole tsconfig target.
    const cause = err instanceof Error ? (err as Error & { cause?: unknown }).cause : undefined;
    if (cause === undefined) {
      return message;
    }
    const causeText = cause instanceof Error ? cause.message : String(cause);
    return `${message} (${causeText})`;
  }

  /**
   * Opens the browser session. Throws on failure: without a session there is no
   * point starting the run, and failing here surfaces a dead container before any
   * list is processed rather than midway through.
   */
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
   * contract of FlixPatrol.getFlixPatrolHTMLPage so callers gain no new case.
   *
   * Retries up to MAX_RETRIES times, mirroring the impit retry loop in
   * FlixPatrol.getFlixPatrolHTMLPage (same attempt budget, same 1s/2s/4s
   * exponential backoff). This is deliberately selective, not a blanket
   * retry-on-everything:
   *  - a thrown/transport error is retried;
   *  - an envelope with `status !== 'ok'` is retried — this is how FlareSolverr
   *    reports a challenge-solve timeout, which is measurably flaky;
   *  - a `solution.status` in RETRY_STATUS_CODES is retried;
   *  - any other definitive `solution.status` (e.g. 404, 403) returns null
   *    immediately, exactly as impit does for a non-retryable status — retrying
   *    would only waste up to two more 60s solves on a page that will never work.
   */
  public async get(url: string): Promise<string | null> {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
      try {
        const envelope = await this.command({
          cmd: 'request.get',
          url,
          session: this.sessionId ?? SESSION_NAME,
          maxTimeout: this.maxTimeout,
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
          // ok/200 envelope with no usable body: treat as a definitive failure rather
          // than silently returning undefined (which callers can't distinguish from a
          // real empty page, and which would flow into JSDOM/downstream parsing).
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
   * Closes the browser session. Never throws: it runs in a finally block after the
   * useful work is done, so a failure here must not turn a successful run into a
   * failed one. Leaking a session would keep a Chrome resident in the container,
   * which matters in daemon mode where runs repeat.
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
