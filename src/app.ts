import fs from 'fs';
import { logger, Utils, AppError, getPackageInfo } from './Utils';
import { NotificationManager } from './Notifications';
import type {
  NotificationEvent,
  NotificationPayload,
} from './Notifications';
import type { ScheduleOptions } from './types';
import { GetAndValidateConfigs } from './Utils/GetAndValidateConfigs';
import { runPipeline } from './Pipeline';
import type { RunPipelineDeps } from './Pipeline';
import { Scheduler } from './Scheduler';

const { name, version } = getPackageInfo();

logger.info('========================================');
logger.info(`${name} v${version}`);
logger.info(`Node.js ${process.version} on ${process.platform} (${process.arch})`);
logger.info(`Log level: ${logger.level}`);
logger.info('========================================');

const dryRun = process.env.DRY_RUN === 'true';
const listNamePrefix = process.env.LIST_NAME_PREFIX || '';
const dryRunTag = dryRun ? '[DRY-RUN] ' : '';

if (dryRun) {
  logger.info('========================================');
  logger.info('DRY-RUN MODE ENABLED');
  logger.info('No changes will be made to Trakt lists.');
  logger.info('========================================');
}

if (listNamePrefix) {
  logger.warn(`LIST_NAME_PREFIX "${listNamePrefix}" is active — list names will be prefixed`);
}

// Bootstrap order matters for error notifications:
//   1. ensureConfigExist() creates the default config when missing. If it throws
//      (disk full, no write permission), no notifier exists yet so the failure
//      cannot be notified — only logged.
//   2. NotificationManager is built next, synchronously. A broken Notifications
//      block in config.json also fails without a notification (we have no
//      working notifier to talk through). This is an architectural limit.
//   3. From this point on, every failure path can dispatch an 'error' notification.
Utils.ensureConfigExist();

let notifier: NotificationManager;
try {
  notifier = NotificationManager.fromConfig(GetAndValidateConfigs.getNotifications());
} catch (err) {
  logger.error(`${(err as Error).name}: ${(err as Error).message}`);
  process.exit(1);
}

// Track every dispatched notification so we can flush them before any
// process.exit — without this, fire-and-forget dispatches (run_start) and
// in-flight error dispatches can be cut off mid-flight.
const pendingDispatches = new Set<Promise<void>>();

function dispatch(event: NotificationEvent, payload: NotificationPayload): Promise<void> {
  const p = notifier.dispatch(event, payload);
  pendingDispatches.add(p);
  p.finally(() => pendingDispatches.delete(p));
  return p;
}

async function flushPendingDispatches(): Promise<void> {
  if (pendingDispatches.size === 0) return;
  await Promise.allSettled(Array.from(pendingDispatches));
}

// errorDispatchInFlight prevents the SIGINT handler from queuing a duplicate
// 'error' notification when the catch block is already dispatching one.
let errorDispatchInFlight = false;

async function dispatchErrorAndExit(err: unknown, exitCode = 1): Promise<never> {
  errorDispatchInFlight = true;
  try {
    await dispatch('error', {
      title: `${dryRunTag}${name} run failed`,
      body: `${(err as Error).name}: ${(err as Error).message}`,
      timestamp: new Date().toISOString(),
    });
  } finally {
    await flushPendingDispatches();
  }
  if (err instanceof AppError) {
    logger.error(`${err.name}: ${err.message}`);
  } else {
    logger.error(`Unexpected error: ${(err as Error).message}`);
  }
  process.exit(exitCode);
}

async function bootstrapConfigs(): Promise<{
  deps: Omit<RunPipelineDeps, 'signal'>;
  schedule: ScheduleOptions;
}> {
  try {
    logger.info('Loading all configurations values');
    const deps: Omit<RunPipelineDeps, 'signal'> = {
      cacheOptions: GetAndValidateConfigs.getCacheOptions(),
      traktOptions: GetAndValidateConfigs.getTraktOptions(),
      flixPatrolTop10: GetAndValidateConfigs.getFlixPatrolTop10(),
      flixPatrolPopulars: GetAndValidateConfigs.getFlixPatrolPopular(),
      flixPatrolMostWatched: GetAndValidateConfigs.getFlixPatrolMostWatched(),
      flixPatrolMostHours: GetAndValidateConfigs.getFlixPatrolMostHours(),
      dispatch,
      dryRun,
      listNamePrefix,
      appName: name,
      appVersion: version,
    };
    const schedule = GetAndValidateConfigs.getScheduleOptions();
    return { deps, schedule };
  } catch (err) {
    return dispatchErrorAndExit(err);
  }
}

async function main(): Promise<void> {
  const { deps, schedule } = await bootstrapConfigs();

  const authenticated = fs.existsSync(deps.traktOptions.saveFile);
  if (schedule.enabled && !authenticated) {
    logger.warn(`Schedule is enabled but no Trakt token file (${deps.traktOptions.saveFile}) exists yet — running once to complete Trakt authentication. The scheduler will start on the next launch, once a token has been saved.`);
  }

  if (!schedule.enabled || !authenticated) {
    // One-shot mode: unchanged behaviour.
    let shuttingDown = false;
    process.on('SIGINT', async () => {
      if (shuttingDown) {
        logger.warn('System: Force exit on second SIGINT signal');
        process.exit(130);
      }
      shuttingDown = true;
      logger.info('System: Receive SIGINT signal');
      // If the catch block is already dispatching an error, don't queue a duplicate
      // — the user would receive two notifications ("run failed" + "run aborted")
      // for what is logically one incident.
      if (!errorDispatchInFlight) {
        await dispatch('error', {
          title: `${dryRunTag}${name} run aborted`,
          body: 'The run was interrupted by SIGINT',
          timestamp: new Date().toISOString(),
        });
      }
      await flushPendingDispatches();
      logger.info('System: Application stopped');
      // 130 = 128 + SIGINT (2); the standard Unix convention for "terminated by Ctrl-C".
      // Cron/systemd unit branching on $? will correctly see this as a failed run.
      process.exit(130);
    });

    try {
      await runPipeline(deps);
      await flushPendingDispatches();
    } catch (err) {
      await dispatchErrorAndExit(err);
    }
    return;
  }

  // Daemon mode.
  const scheduler = new Scheduler({
    crons: schedule.crons,
    runOnStart: schedule.runOnStart,
    runner: (signal) => runPipeline({ ...deps, signal }).then(() => undefined),
    onError: async (err) => {
      logger.error(`Run failed: ${(err as Error).message}`);
      await dispatch('error', {
        title: `${dryRunTag}${name} run failed`,
        body: `${(err as Error).name}: ${(err as Error).message}`,
        timestamp: new Date().toISOString(),
      });
      await flushPendingDispatches();
    },
  });

  let daemonShuttingDown = false;
  const shutdown = async (signalName: string): Promise<void> => {
    if (daemonShuttingDown) {
      logger.warn('System: Force exit on second signal');
      process.exit(130);
    }
    daemonShuttingDown = true;
    logger.info(`System: Received ${signalName} — stopping scheduler`);
    await scheduler.stop();
    await flushPendingDispatches();
    logger.info('System: Application stopped');
    process.exit(0);
  };
  process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
  process.on('SIGINT', () => { void shutdown('SIGINT'); });

  scheduler.start();
}

main().catch((err: unknown) => {
  logger.error(`Unexpected bootstrap error: ${(err as Error).message}`);
  process.exit(1);
});
