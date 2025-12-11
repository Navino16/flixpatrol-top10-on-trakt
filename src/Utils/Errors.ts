/**
 * Base error class for application-specific errors
 */
export class AppError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AppError';
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Error thrown when configuration validation fails
 */
export class ConfigurationError extends AppError {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

/**
 * Error thrown when FlixPatrol operations fail
 */
export class FlixPatrolError extends AppError {
  constructor(message: string) {
    super(message);
    this.name = 'FlixPatrolError';
  }
}

/**
 * Error thrown when Trakt API operations fail
 */
export class TraktError extends AppError {
  constructor(message: string) {
    super(message);
    this.name = 'TraktError';
  }
}