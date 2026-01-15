/**
 * RetryStrategy - Retry logic with exponential backoff (WU-2537)
 * @module @lumenflow/core/utils
 */

export interface RetryStrategyOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  shouldRetry?: (error: Error) => boolean;
}

export class RetryStrategy {
  private readonly maxRetries: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly shouldRetry: (error: Error) => boolean;

  constructor(options: RetryStrategyOptions = {}) {
    this.maxRetries = options.maxRetries ?? 3;
    this.baseDelayMs = options.baseDelayMs ?? 100;
    this.maxDelayMs = options.maxDelayMs ?? 10000;
    this.shouldRetry = options.shouldRetry ?? (() => true);
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: Error | undefined;
    const totalAttempts = this.maxRetries + 1;

    for (let attempt = 0; attempt < totalAttempts; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));

        if (attempt < this.maxRetries && this.shouldRetry(lastError)) {
          await this.sleep(this.calculateDelay(attempt));
        } else {
          throw lastError;
        }
      }
    }

    throw lastError ?? new Error('Retry exhausted');
  }

  calculateDelay(attempt: number): number {
    return Math.min(this.baseDelayMs * Math.pow(2, attempt), this.maxDelayMs);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
