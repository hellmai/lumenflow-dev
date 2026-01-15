/**
 * ErrorHandler - Structured error handling utility (WU-2537)
 * @module @lumenflow/core/utils
 */

export interface SuccessResult<T> {
  success: true;
  value: T;
}

export interface FailureResult {
  success: false;
  error: Error;
}

export type Result<T> = SuccessResult<T> | FailureResult;

export interface ClassifiedError {
  error: Error;
  retryable: boolean;
  category: 'network' | 'validation' | 'system' | 'unknown';
}

const RETRYABLE_PATTERNS = [
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ENOTFOUND',
  'ENETUNREACH',
  'EAI_AGAIN',
  'socket hang up',
  'network error',
  'timeout',
  'rate limit',
  '429',
  '502',
  '503',
  '504',
];

export class ErrorHandler {
  static async wrap<T>(fn: () => Promise<T>): Promise<Result<T>> {
    try {
      return { success: true, value: await fn() };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err : new Error(String(err)),
      };
    }
  }

  static wrapSync<T>(fn: () => T): Result<T> {
    try {
      return { success: true, value: fn() };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err : new Error(String(err)),
      };
    }
  }

  static classify(error: Error): ClassifiedError {
    const message = error.message.toLowerCase();
    const isRetryable = RETRYABLE_PATTERNS.some((p) =>
      message.includes(p.toLowerCase())
    );

    let category: ClassifiedError['category'] = 'unknown';
    if (isRetryable) {
      category = 'network';
    } else if (message.includes('invalid') || message.includes('validation')) {
      category = 'validation';
    } else if (message.includes('enoent') || message.includes('permission')) {
      category = 'system';
    }

    return { error, retryable: isRetryable, category };
  }
}
