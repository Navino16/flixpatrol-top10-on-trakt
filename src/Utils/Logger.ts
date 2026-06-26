import {
  createLogger, format, Logger, transports,
} from 'winston';

const myFormat = format.printf((info) => `[${info.timestamp}][${info.level}] ${info.message}`);

const VALID_LOG_LEVELS = ['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly'];
const requestedLevel = process.env.LOG_LEVEL;
const level = requestedLevel && VALID_LOG_LEVELS.includes(requestedLevel) ? requestedLevel : 'info';

export const logger: Logger = createLogger({
  format: format.combine(
    format.colorize(),
    format.splat(),
    format.simple(),
    format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
    myFormat,
  ),
  level,
  transports: [
    new transports.Console(),
  ],
});

if (requestedLevel && !VALID_LOG_LEVELS.includes(requestedLevel)) {
  logger.warn(`Invalid LOG_LEVEL "${requestedLevel}", falling back to "info". Valid: ${VALID_LOG_LEVELS.join(', ')}`);
}
