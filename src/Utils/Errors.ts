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
 * Erreur d'une plateforme de destination. Porte le backend concerné pour que
 * les messages restent lisibles quand plusieurs adapters coexistent.
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
 * Conservée pour ne rien casser dans le code et les tests existants, qui
 * l'attrapent par son nom. Elle est désormais un cas particulier de TargetError.
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