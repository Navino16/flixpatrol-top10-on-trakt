import { logger, TmdbError } from '../Utils';
import type { TmdbMediaItems, TmdbOptions } from '../types';

interface TmdbAPIRuntimeOptions extends TmdbOptions {
  dryRun?: boolean;
}

const BASE_URL = 'https://api.themoviedb.org/4';

export class TMDBAPI {
  private readonly accessToken: string;

  private readonly dryRun: boolean;

  constructor(options: TmdbAPIRuntimeOptions) {
    this.accessToken = options.accessToken;
    this.dryRun = options.dryRun ?? false;
  }

  private get authHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.accessToken}`,
      accept: 'application/json',
      'content-type': 'application/json',
    };
  }

  private async request(method: string, path: string, body?: unknown): Promise<unknown> {
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: this.authHeaders,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new TmdbError(`TMDB ${method} ${path} failed (${res.status}): ${text}`);
    }
    return res.json();
  }

  public async pushToList(items: TmdbMediaItems, listId: number, updateBanner = true): Promise<void> {
    if (this.dryRun) {
      logger.info(`[DRY-RUN] Would clear TMDB list ${listId}`);
      logger.info(`[DRY-RUN] Would add ${items.length} item(s) to TMDB list ${listId}`);
      if (updateBanner) {
        logger.info(`[DRY-RUN] Would update TMDB list ${listId} description and backdrop`);
      }
      return;
    }

    logger.info(`Clearing TMDB list ${listId}`);
    await this.request('GET', `/list/${listId}/clear`);

    logger.info(`Adding ${items.length} item(s) to TMDB list ${listId}`);
    await this.request('POST', `/list/${listId}/items`, { items });

    if (updateBanner) {
      logger.info(`Fetching TMDB list ${listId} to get backdrop`);
      const listData = await this.request('GET', `/list/${listId}?language=en-US&page=1`) as {
        results?: { backdrop_path?: string }[];
      };
      const backdropPath = listData.results?.[0]?.backdrop_path ?? '';

      const dateOptions: Intl.DateTimeFormatOptions = {
        weekday: 'short', year: 'numeric', day: 'numeric', month: 'long',
        hour: '2-digit', minute: '2-digit', hour12: false, timeZoneName: 'short',
      };
      const description = `Last Updated: ${new Date().toLocaleString(undefined, dateOptions)}`;
      logger.info(`Updating TMDB list ${listId} description and backdrop`);
      await this.request('PUT', `/list/${listId}`, { description, backdrop_path: backdropPath });
    }
  }
}
