// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * WU-1747: Retry Strategy Module
 *
 * Provides exponential backoff retry mechanism with configurable parameters
 * for wu:done concurrent load resilience.
 *
 * Features:
 * - Configurable max attempts, base delay, multiplier
 * - Exponential backoff with optional jitter
 * - Presets for common scenarios (wu_done, recovery)
 * - Callback hooks for retry events
 * - Conditional retry based on error type
 *
 * @module retry-strategy
 */

import { LOG_PREFIX, EMOJI } from './wu-constants.js';
import { createError, ErrorCodes } from './error-handler.js';

/** Retry configuration */
interface RetryConfig {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  multiplier: number;
  jitter: number;
  shouldRetry: (error: unknown) => boolean;
  onRetry?: ((attempt: number, error: unknown, delay: number) => void) | null;
}

/**
 * Error message patterns that are considered retryable for wu:done operations
 * Exported for test consistency
 */
export const RETRYABLE_ERROR_PATTERNS = Object.freeze({
  FAST_FORWARD: 'fast-forward',
  NOT_POSSIBLE: 'not possible',
  CANNOT_LOCK_REF: 'Cannot lock ref',
  FETCH: 'fetch',
  PUSH: 'push',
  ETIMEDOUT: 'ETIMEDOUT',
  ECONNRESET: 'ECONNRESET',
});

/**
 * @typedef {Object} RetryConfig
 * @property {number} maxAttempts - Maximum number of attempts (default: 5)
 * @property {number} baseDelayMs - Base delay in milliseconds (default: 1000)
 * @property {number} maxDelayMs - Maximum delay cap in milliseconds (default: 30000)
 * @property {number} multiplier - Exponential multiplier (default: 2)
 * @property {number} jitter - Jitter factor 0-1 (default: 0.1 for 10%)
 * @property {function} [shouldRetry] - Optional function(error) => boolean to determine if error is retryable
 * @property {function} [onRetry] - Optional callback(attempt, error, delay) before each retry
 */

/**
 * Default retry configuration
 * Balanced for typical wu:done operations
 */
export const DEFAULT_RETRY_CONFIG = Object.freeze({
  maxAttempts: 5,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  multiplier: 2,
  jitter: 0.1,
  shouldRetry: (_error?: unknown) => true,
  onRetry: null,
});

/**
 * Pre-configured retry presets for common scenarios
 */
export const RETRY_PRESETS = Object.freeze({
  /**
   * Preset for wu:done merge operations
   * Higher attempts and longer delays for handling concurrent load
   */
  wu_done: Object.freeze({
    maxAttempts: 6,
    baseDelayMs: 2000,
    maxDelayMs: 60000,
    multiplier: 2,
    jitter: 0.15, // 15% jitter to spread concurrent retries
    shouldRetry: (error: unknown) => {
      // Retry fast-forward failures and network errors using defined patterns
      const message = error instanceof Error ? error.message : String(error);
      return Object.values(RETRYABLE_ERROR_PATTERNS).some((pattern) => message.includes(pattern));
    },
    onRetry: null,
  }),

  /**
   * Preset for zombie state recovery
   * More attempts with shorter delays
   */
  recovery: Object.freeze({
    maxAttempts: 4,
    baseDelayMs: 500,
    maxDelayMs: 10000,
    multiplier: 2,
    jitter: 0.1,
    shouldRetry: () => true,
    onRetry: null,
  }),

  /**
   * Preset for quick operations (file I/O, local git)
   * Fast retries for transient errors
   */
  quick: Object.freeze({
    maxAttempts: 3,
    baseDelayMs: 100,
    maxDelayMs: 2000,
    multiplier: 2,
    jitter: 0.05,
    shouldRetry: () => true,
    onRetry: null,
  }),
});

/**
 * Create a retry configuration by merging defaults with custom options
 *
 * @param {string|Object} [presetOrOptions] - Preset name or custom options
 * @param {Object} [options] - Additional options to merge (when first arg is preset name)
 * @returns {RetryConfig} Complete retry configuration
 *
 * @example
 * // Use defaults
 * const config = createRetryConfig();
 *
 * @example
 * // Customize defaults
 * const config = createRetryConfig({ maxAttempts: 10 });
 *
 * @example
 * // Use preset
 * const config = createRetryConfig('wu_done');
 *
 * @example
 * // Customize preset
 * const config = createRetryConfig('wu_done', { maxAttempts: 10 });
 */
export function createRetryConfig(
  presetOrOptions?: string | Partial<RetryConfig>,
  options?: Partial<RetryConfig>,
): RetryConfig {
  // Determine base config
  let baseConfig;
  let customOptions;

  if (typeof presetOrOptions === 'string') {
    // First arg is preset name
    if (!(presetOrOptions in RETRY_PRESETS)) {
      throw createError(ErrorCodes.INVALID_ARGUMENT, `Unknown retry preset: ${presetOrOptions}`);
    }
    baseConfig = RETRY_PRESETS[presetOrOptions as keyof typeof RETRY_PRESETS];
    customOptions = options || {};
  } else {
    // First arg is options (or undefined)
    baseConfig = DEFAULT_RETRY_CONFIG;
    customOptions = presetOrOptions || {};
  }

  // Merge and return
  // Avoid overriding preset/default values with `undefined` (WU-1756):
  // callers often pass option keys conditionally, and spreading `undefined`
  // clobbers required defaults (e.g., maxAttempts) leading to zero-attempt retries.
  const definedOptions = Object.fromEntries(
    Object.entries(customOptions).filter(([, value]) => value != null),
  );
  return {
    ...baseConfig,
    ...definedOptions,
  };
}

/**
 * Calculate the backoff delay for a given attempt number
 *
 * Uses exponential backoff formula: baseDelay * (multiplier ^ attempt)
 * with optional jitter to spread concurrent retry attempts
 *
 * @param {number} attempt - Zero-based attempt number (0 = first attempt)
 * @param {RetryConfig} config - Retry configuration
 * @returns {number} Delay in milliseconds
 */
export function calculateBackoffDelay(
  attempt: number,
  config: Pick<RetryConfig, 'baseDelayMs' | 'multiplier' | 'maxDelayMs' | 'jitter'>,
) {
  const { baseDelayMs, multiplier, maxDelayMs, jitter } = config;

  // Exponential backoff: base * multiplier^attempt
  let delay = baseDelayMs * Math.pow(multiplier, attempt);

  // Cap at max delay
  delay = Math.min(delay, maxDelayMs);

  // Add jitter if enabled (spreads concurrent retries)
  if (jitter > 0) {
    // Jitter adds/subtracts random percentage
    const jitterRange = delay * jitter;
    const jitterOffset = (Math.random() * 2 - 1) * jitterRange;
    delay = delay + jitterOffset;
  }

  return Math.round(delay);
}

/**
 * Sleep for specified milliseconds
 *
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute a function with retry logic and exponential backoff
 *
 * @template T
 * @param {function(): Promise<T>} fn - Async function to execute
 * @param {RetryConfig} [config] - Retry configuration (uses defaults if not provided)
 * @returns {Promise<T>} Result of successful execution
 * @throws {Error} Last error if all attempts fail
 *
 * @example
 * const result = await withRetry(
 *   async () => await mergeBranch(),
 *   createRetryConfig('wu_done')
 * );
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig = DEFAULT_RETRY_CONFIG,
): Promise<T> {
  const { maxAttempts, shouldRetry, onRetry } = config;

  let lastError;
  let attempt = 0;

  while (attempt < maxAttempts) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      attempt++;

      // Check if we should retry
      if (attempt >= maxAttempts) {
        break; // Max attempts reached
      }

      if (!shouldRetry(error)) {
        break; // Error not retryable
      }

      // Calculate delay for next retry
      const delay = calculateBackoffDelay(attempt - 1, config);

      // Call onRetry callback if provided
      if (typeof onRetry === 'function') {
        onRetry(attempt, error, delay);
      }

      // Log retry info
      const retryMessage = error instanceof Error ? error.message : String(error);
      console.log(
        `${LOG_PREFIX.DONE} ${EMOJI.WARNING} Attempt ${attempt}/${maxAttempts} failed: ${retryMessage}`,
      );
      console.log(`${LOG_PREFIX.DONE} ${EMOJI.INFO} Retrying in ${delay}ms...`);

      // Wait before retry
      await sleep(delay);
    }
  }

  // All attempts failed
  // Defensive: if a caller passes an invalid config, ensure we throw a useful error.
  if (!lastError) {
    throw createError(
      ErrorCodes.RETRY_EXHAUSTION,
      `Operation failed: invalid retry configuration (maxAttempts=${maxAttempts})`,
    );
  }
  const lastMessage = lastError instanceof Error ? lastError.message : String(lastError);
  const lastStack = lastError instanceof Error ? lastError.stack : undefined;
  throw createError(
    ErrorCodes.RETRY_EXHAUSTION,
    `Operation failed after ${attempt} attempt(s): ${lastMessage}\n` +
      `Original error: ${lastStack || lastMessage}`,
  );
}

/**
 * Higher-order function to wrap a function with retry logic
 *
 * @template T
 * @param {function(...args): Promise<T>} fn - Function to wrap
 * @param {RetryConfig} [config] - Retry configuration
 * @returns {function(...args): Promise<T>} Wrapped function with retry logic
 *
 * @example
 * const retryableMerge = withRetryWrapper(mergeBranch, createRetryConfig('wu_done'));
 * await retryableMerge(branch);
 */
export function withRetryWrapper<T>(
  fn: (...args: unknown[]) => Promise<T>,
  config: RetryConfig = DEFAULT_RETRY_CONFIG,
) {
  return async (...args: unknown[]) => {
    return withRetry(() => fn(...args), config);
  };
}

/**
 * Determine if an error is a git conflict error (non-retryable)
 *
 * @param {Error} error - Error to check
 * @returns {boolean} True if conflict error
 */
export function isConflictError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes('conflict') ||
    message.includes('CONFLICT') ||
    message.includes('<<<<<<<') ||
    message.includes('not possible to fast-forward')
  );
}

/**
 * Determine if an error is a network/transient error (retryable)
 *
 * @param {Error} error - Error to check
 * @returns {boolean} True if likely transient
 */
export function isTransientError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes('ETIMEDOUT') ||
    message.includes('ECONNRESET') ||
    message.includes('ECONNREFUSED') ||
    message.includes('fetch failed') ||
    message.includes('network') ||
    message.includes('timeout')
  );
}
