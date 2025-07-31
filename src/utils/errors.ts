export class BaseError extends Error {
    public readonly timestamp: Date;
    public readonly context?: Record<string, unknown>;
  
    constructor(message: string, context?: Record<string, unknown>) {
      super(message);
      this.name = this.constructor.name;
      this.timestamp = new Date();
      this.context = context;
      Error.captureStackTrace(this, this.constructor);
    }
  
    toJSON() {
      return {
        name: this.name,
        message: this.message,
        timestamp: this.timestamp,
        context: this.context,
        stack: this.stack,
      };
    }
  }
  
  export class ArgoAPIError extends BaseError {
    constructor(
      message: string,
      public readonly statusCode: number,
      public readonly response?: unknown,
      context?: Record<string, unknown>
    ) {
      super(message, { ...context, statusCode, response });
    }
  
    static fromAxiosError(error: any): ArgoAPIError {
      const statusCode = error.response?.status || 0;
      const message = error.response?.data?.message || error.message || 'Unknown API error';
      const response = error.response?.data;
      
      return new ArgoAPIError(message, statusCode, response, {
        url: error.config?.url,
        method: error.config?.method,
      });
    }
  }
  
  export class ConfigurationError extends BaseError {
    constructor(message: string, context?: Record<string, unknown>) {
      super(`Configuration error: ${message}`, context);
    }
  }
  
  export class SchemaParseError extends BaseError {
    constructor(message: string, public readonly schemaPath: string, context?: Record<string, unknown>) {
      super(`Schema parse error: ${message}`, { ...context, schemaPath });
    }
  }
  
  export class RateLimitError extends BaseError {
    constructor(
      public readonly limit: number,
      public readonly windowMs: number,
      public readonly retryAfterMs?: number
    ) {
      super(`Rate limit exceeded: ${limit} requests per ${windowMs}ms`, {
        limit,
        windowMs,
        retryAfterMs,
      });
    }
  }
  
  export class ValidationError extends BaseError {
    constructor(
      message: string,
      public readonly field?: string,
      public readonly value?: unknown,
      context?: Record<string, unknown>
    ) {
      super(`Validation error: ${message}`, { ...context, field, value });
    }
  }
  
  export class TimeoutError extends BaseError {
    constructor(
      operation: string,
      timeoutMs: number,
      context?: Record<string, unknown>
    ) {
      super(`Operation '${operation}' timed out after ${timeoutMs}ms`, {
        ...context,
        operation,
        timeoutMs,
      });
    }
  }
  
  export class AuthenticationError extends BaseError {
    constructor(message: string = 'Authentication failed', context?: Record<string, unknown>) {
      super(message, context);
    }
  }
  
  export class HealthCheckError extends BaseError {
    constructor(
      service: string,
      reason: string,
      context?: Record<string, unknown>
    ) {
      super(`Health check failed for ${service}: ${reason}`, {
        ...context,
        service,
        reason,
      });
    }
  }
  
  // Error type guards
  export function isArgoAPIError(error: unknown): error is ArgoAPIError {
    return error instanceof ArgoAPIError;
  }
  
  export function isRateLimitError(error: unknown): error is RateLimitError {
    return error instanceof RateLimitError;
  }
  
  export function isAuthenticationError(error: unknown): error is AuthenticationError {
    return error instanceof AuthenticationError;
  }
  
  export function isTimeoutError(error: unknown): error is TimeoutError {
    return error instanceof TimeoutError;
  }
  
  // Error handler utility
  export function handleError(error: unknown): BaseError {
    if (error instanceof BaseError) {
      return error;
    }
  
    if (error instanceof Error) {
      return new BaseError(error.message, {
        originalError: error.name,
        stack: error.stack,
      });
    }
  
    return new BaseError('Unknown error occurred', {
      error: String(error),
    });
  }