import {
  createLogger, format, Logger, transports,
} from 'winston';

const myFormat = format.printf((info) => `[${info.timestamp}][${info.level}] ${info.message}`);

export const VALID_LOG_LEVELS = ['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly'] as const;
export const DEFAULT_LOG_LEVEL = 'info';

export function resolveLogLevel(requested: string | undefined): { level: string; warning: string | null } {
  if (!requested) return { level: DEFAULT_LOG_LEVEL, warning: null };
  if ((VALID_LOG_LEVELS as readonly string[]).includes(requested)) return { level: requested, warning: null };
  return {
    level: DEFAULT_LOG_LEVEL,
    warning: `Invalid LOG_LEVEL "${requested}", falling back to "${DEFAULT_LOG_LEVEL}". Valid: ${VALID_LOG_LEVELS.join(', ')}`,
  };
}

const resolved = resolveLogLevel(process.env.LOG_LEVEL);

export const logger: Logger = createLogger({
  format: format.combine(
    format.colorize(),
    format.splat(),
    format.simple(),
    format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
    myFormat,
  ),
  level: resolved.level,
  transports: [
    new transports.Console(),
  ],
});

if (resolved.warning) {
  logger.warn(resolved.warning);
}
