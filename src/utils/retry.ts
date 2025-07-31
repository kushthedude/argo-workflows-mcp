import { createLogger } from './logger.js';
import { isArgoAPIError, isTimeoutError } from './errors.js';

const logger = createLogger('RetryStrategy');

export interface RetryOptions {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier?: number;
  jitterFactor?: number;
  retryableStatuses?: number[];
}

export class RetryStrategy {
  private readonly backoffMultiplier: number;
  private readonly jitterFactor: number;
  private readonly retryableStatuses: Set<number>;

  constructor(private readonly options: RetryOptions) {
    this.backoffMultiplier = options.backoffMultiplier || 2;
    this.jitterFactor = options.jitterFactor || 0.1;
    this.retryableStatuses = new Set(options.retryableStatuses || [
      408, // Request Timeout
      429, // Too Many Requests
      500, // Internal Server Error
      502, // Bad Gateway
      503, // Service Unavailable
      504, // Gateway Timeout
    ]);
  }

  async execute<T>(
    fn: () => Promise<T>,
    context?: Record<string, unknown>
  ): Promise<T> {
    let lastError: Error | undefined;
    
    for (let attempt = 1; attempt <= this.options.maxAttempts; attempt++) {
      try {
        logger.debug('Executing attempt', { attempt, maxAttempts: this.options.maxAttempts, context });
        return await fn();
      } catch (error) {
        lastError = error as Error;
        
        if (!this.shouldRetry(error, attempt)) {
          logger.debug('Not retrying', { 
            attempt, 
            reason: 'Non-retryable error',
            error: lastError.message,
            context 
          });
          throw error;
        }

        const delay = this.calculateDelay(attempt);
        logger.warn('Retrying after delay', {
          attempt,
          delay,
          error: lastError.message,
          context,
        });

        await this.sleep(delay);
      }
    }

    logger.error('Max retry attempts reached', {
      maxAttempts: this.options.maxAttempts,
      lastError: lastError?.message,
      context,
    });

    throw lastError || new Error('Max retry attempts reached');
  }

  private shouldRetry(error: unknown, attempt: number): boolean {
    if (attempt >= this.options.maxAttempts) {
      return false;
    }

    // Always retry timeouts
    if (isTimeoutError(error)) {
      return true;
    }

    // Check if it's a retryable API error
    if (isArgoAPIError(error)) {
      return this.retryableStatuses.has(error.statusCode);
    }

    // Retry network errors
    if (error instanceof Error) {
      const networkErrors = [
        'ECONNREFUSED',
        'ECONNRESET',
        'ETIMEDOUT',
        'ENOTFOUND',
        'ENETUNREACH',
        'EAI_AGAIN',
      ];
      
      return networkErrors.some(code => error.message.includes(code));
    }

    return false;
  }

  private calculateDelay(attempt: number): number {
    // Exponential backoff with jitter
    const exponentialDelay = this.options.initialDelayMs * Math.pow(this.backoffMultiplier, attempt - 1);
    const clampedDelay = Math.min(exponentialDelay, this.options.maxDelayMs);
    
    // Add jitter to prevent thundering herd
    const jitter = clampedDelay * this.jitterFactor * (Math.random() * 2 - 1);
    
    return Math.max(0, Math.floor(clampedDelay + jitter));
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}