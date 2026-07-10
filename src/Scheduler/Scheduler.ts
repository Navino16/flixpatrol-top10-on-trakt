import cron from 'node-cron';
import type { ScheduledTask } from 'node-cron';
import { logger } from '../Utils';

export interface SchedulerOptions {
  crons: string[];
  runOnStart: boolean;
  runner: (signal: AbortSignal) => Promise<void>;
  onError: (err: unknown) => Promise<void>;
}

export class Scheduler {
  private readonly tasks: ScheduledTask[] = [];

  private isRunning = false;

  private currentRun: Promise<void> | null = null;

  private readonly abortController = new AbortController();

  public constructor(private readonly options: SchedulerOptions) {}

  public start(): void {
    for (const expr of this.options.crons) {
      this.tasks.push(cron.schedule(expr, () => { void this.trigger(); }));
    }
    const list = this.options.crons.map((c) => `"${c}"`).join(', ');
    logger.info(`Scheduler started — ${this.options.crons.length} cron(s): ${list}`);
    if (this.options.runOnStart) {
      logger.info('Scheduler: runOnStart enabled — triggering initial run');
      void this.trigger();
    }
  }

  private async trigger(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Scheduler: run already in progress, skipping this trigger');
      return;
    }
    this.isRunning = true;
    this.currentRun = (async () => {
      try {
        await this.options.runner(this.abortController.signal);
      } catch (err) {
        await this.options.onError(err);
      }
    })();
    try {
      await this.currentRun;
    } finally {
      this.isRunning = false;
      this.currentRun = null;
    }
  }

  public async stop(): Promise<void> {
    this.abortController.abort();
    for (const task of this.tasks) {
      await task.stop();
    }
    if (this.currentRun) {
      logger.info('Scheduler: waiting for current run to finish (graceful stop after current Trakt write)');
      await this.currentRun;
    }
  }
}
