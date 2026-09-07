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

  /** HTTP status that caused the error, when it came from a response rather than a transport failure. */
  public readonly status?: number;

  constructor(backend: string, message: string, status?: number) {
    super(message);
    this.name = 'TargetError';
    this.backend = backend;
    this.status = status;
  }
}

/**
 * Error thrown when Trakt API operations fail: the Trakt case of TargetError.
 */
export class TraktError extends TargetError {
  constructor(message: string) {
    super('trakt', message);
    this.name = 'TraktError';
  }
}

export class FloppyError extends TargetError {
  constructor(message: string, status?: number) {
    super('floppy', message, status);
    this.name = 'FloppyError';
  }
}

export class MdblistError extends TargetError {
  constructor(message: string, status?: number) {
    super('mdblist', message, status);
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