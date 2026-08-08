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
 * Error thrown by a destination platform. Carries the backend concerned so that
 * messages stay readable when several adapters coexist.
 */
export class TargetError extends AppError {
  public readonly backend: string;

  constructor(backend: string, message: string) {
    super(message);
    this.name = 'TargetError';
    this.backend = backend;
  }
}

/**
 * Error thrown when Trakt API operations fail. Kept so nothing breaks in the
 * existing code and tests, which catch it by its name. It is now a special case
 * of TargetError.
 */
export class TraktError extends TargetError {
  constructor(message: string) {
    super('trakt', message);
    this.name = 'TraktError';
  }
}

export class FloppyError extends TargetError {
  constructor(message: string) {
    super('floppy', message);
    this.name = 'FloppyError';
  }
}

export class MdblistError extends TargetError {
  constructor(message: string) {
    super('mdblist', message);
    this.name = 'MdblistError';
  }
}

/**
 * Error thrown when FlareSolverr session management fails
 */
export class FlareSolverrError extends AppError {
  constructor(message: string) {
    super(message);
    this.name = 'FlareSolverrError';
  }
}