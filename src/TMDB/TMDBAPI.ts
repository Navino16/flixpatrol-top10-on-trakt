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

  public async pushToList(
    items: TmdbMediaItems,
    listId: number,
    updateBanner = true,
    isPublic?: boolean,
  ): Promise<void> {
    if (this.dryRun) {
      logger.info(`[DRY-RUN] Would clear TMDB list ${listId}`);
      logger.info(`[DRY-RUN] Would add ${items.length} item(s) to TMDB list ${listId}`);
      if (updateBanner) logger.info(`[DRY-RUN] Would update TMDB list ${listId} description and backdrop`);
      if (isPublic !== undefined) {
        logger.info(`[DRY-RUN] Would set TMDB list ${listId} to ${isPublic ? 'public' : 'private'}`);
      }
      return;
    }

    logger.info(`Clearing TMDB list ${listId}`);
    await this.request('GET', `/list/${listId}/clear`);

    logger.info(`Adding ${items.length} item(s) to TMDB list ${listId}`);
    await this.request('POST', `/list/${listId}/items`, { items });

    if (updateBanner || isPublic !== undefined) {
      logger.info(`Fetching TMDB list ${listId} metadata`);
      const listData = await this.request('GET', `/list/${listId}?language=en-US&page=1`) as {
        public?: boolean;
        results?: { backdrop_path?: string }[];
      };

      const needsPublicUpdate = isPublic !== undefined && listData.public !== isPublic;
      if (updateBanner || needsPublicUpdate) {
        const putBody: Record<string, unknown> = {};

        if (updateBanner) {
          const backdropPath = listData.results?.[0]?.backdrop_path ?? '';
          const dateOptions: Intl.DateTimeFormatOptions = {
            weekday: 'short', year: 'numeric', day: 'numeric', month: 'long',
            hour: '2-digit', minute: '2-digit', hour12: false, timeZoneName: 'short',
          };
          putBody.description = `Last Updated: ${new Date().toLocaleString(undefined, dateOptions)}`;
          putBody.backdrop_path = backdropPath;
        }

        if (needsPublicUpdate) {
          logger.info(`Updating TMDB list ${listId} privacy to ${isPublic ? 'public' : 'private'}`);
          putBody.public = isPublic;
        }

        logger.info(`Updating TMDB list ${listId} metadata`);
        await this.request('PUT', `/list/${listId}`, putBody);
      }
    }
  }
}
