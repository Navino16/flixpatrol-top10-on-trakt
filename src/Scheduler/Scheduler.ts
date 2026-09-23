import cron from 'node-cron';
import type { ScheduledTask } from 'node-cron';
import { logger } from '../Utils';
import type { RunSummary } from '../Notifications';

export interface SchedulerOptions {
  crons: string[];
  runOnStart: boolean;
  runner: (signal: AbortSignal) => Promise<RunSummary>;
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
        Scheduler.reportLosses(await this.options.runner(this.abortController.signal));
      } catch (err) {
        try {
          await this.options.onError(err);
        } catch (onErrorErr) {
          logger.error(`Scheduler: onError handler itself failed: ${(onErrorErr as Error).message}`);
        }
      }
    })();
    try {
      await this.currentRun;
    } finally {
      this.isRunning = false;
      this.currentRun = null;
    }
  }

  /** Never exits the process: the next tick retries every target, the dropped ones included. */
  private static reportLosses(summary: RunSummary): void {
    const lost = summary.targets.filter((target) => target.status === 'aborted');
    if (lost.length === 0) return;
    const names = lost.map((target) => `"${target.id}" (${target.backend})`).join(', ');
    logger.warn(`Scheduler: ${lost.length}/${summary.targets.length} target(s) dropped from this run: ${names} `
      + '— retried on the next tick');
  }

  public async stop(): Promise<void> {
    this.abortController.abort();
    for (const task of this.tasks) {
      await task.stop();
    }
    if (this.currentRun) {
      logger.info('Scheduler: waiting for current run to finish (graceful stop after current write)');
      await this.currentRun;
    }
  }
}
