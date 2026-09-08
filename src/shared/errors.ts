export class AppError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly details?: Record<string, unknown>;

  constructor(message: string, code = 'INTERNAL_ERROR', statusCode = 500, details?: Record<string, unknown>) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class ConfigError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'CONFIG_ERROR', 500, details);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'VALIDATION_ERROR', 400, details);
  }
}

export class NotFoundError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'NOT_FOUND', 404, details);
  }
}

export class AuthError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'UNAUTHORIZED', 401, details);
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'FORBIDDEN', 403, details);
  }
}

export class VaultError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'VAULT_ERROR', 500, details);
  }
}

export class AllTargetsExhaustedError extends AppError {
  public readonly decisionTrace: unknown[];

  constructor(decisionTrace: unknown[], message = 'All routing targets in pool are exhausted or unavailable') {
    super(message, 'ALL_TARGETS_EXHAUSTED', 503, { decisionTrace });
    this.decisionTrace = decisionTrace;
  }
}
