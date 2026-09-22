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
 * A FlixPatrol path that answered 200 with its "Page Not Found" body. Distinguished from
 * the base class so callers can skip just that entry, unlike a genuine fetch failure —
 * which hits every list alike and must stay fatal.
 */
export class FlixPatrolPageNotFoundError extends FlixPatrolError {
  public readonly path: string;

  constructor(path: string, message: string) {
    super(message);
    this.name = 'FlixPatrolPageNotFoundError';
    this.path = path;
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