import { logger } from '../Utils/Logger';
import { FlareSolverrError } from '../Utils/Errors';
import type { FlareSolverrOptions } from '../types';

/**
 * Fixed, namespaced session id. FlareSolverr instances are commonly shared with
 * other tools (*arr stack), so an unqualified name like "default" could collide.
 */
const SESSION_NAME = 'flixpatrol-top10';

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
        `sessions.create failed at ${this.endpoint}: ${(err as Error).message}`,
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
   */
  public async get(url: string): Promise<string | null> {
    try {
      const envelope = await this.command({
        cmd: 'request.get',
        url,
        session: this.sessionId ?? SESSION_NAME,
        maxTimeout: this.maxTimeout,
      });
      if (envelope.status !== 'ok') {
        logger.error(`FlareSolverr failed for ${url}: ${envelope.message ?? envelope.status}`);
        return null;
      }
      if (!envelope.solution || envelope.solution.status !== 200) {
        logger.error(`FlareSolverr returned HTTP ${envelope.solution?.status} for ${url}`);
        return null;
      }
      logger.debug(`FlareSolverr fetched ${url} (HTTP ${envelope.solution.status})`);
      return envelope.solution.response;
    } catch (err) {
      logger.error(`FlareSolverr request failed for ${url}: ${(err as Error).message}`);
      return null;
    }
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
      logger.warn(`FlareSolverr sessions.destroy failed for ${id}: ${(err as Error).message}`);
    }
  }
}
