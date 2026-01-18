/**
 * WU-1747: Retry strategy tests
 * Tests for exponential backoff and configurable retry mechanisms
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Import the module we're going to create
import {
  createRetryConfig,
  calculateBackoffDelay,
  withRetry,
  DEFAULT_RETRY_CONFIG,
  RETRY_PRESETS,
  RETRYABLE_ERROR_PATTERNS,
} from '../retry-strategy.js';

describe('retry-strategy', () => {
  describe('DEFAULT_RETRY_CONFIG', () => {
    it('should have sensible defaults', () => {
      assert.ok(DEFAULT_RETRY_CONFIG.maxAttempts >= 3, 'should have at least 3 max attempts');
      assert.ok(DEFAULT_RETRY_CONFIG.baseDelayMs > 0, 'should have positive base delay');
      assert.ok(
        DEFAULT_RETRY_CONFIG.maxDelayMs >= DEFAULT_RETRY_CONFIG.baseDelayMs,
        'max delay should be >= base delay',
      );
      assert.ok(
        DEFAULT_RETRY_CONFIG.multiplier > 1,
        'multiplier should be > 1 for exponential backoff',
      );
    });

    it('should export expected properties', () => {
      assert.ok('maxAttempts' in DEFAULT_RETRY_CONFIG, 'should have maxAttempts');
      assert.ok('baseDelayMs' in DEFAULT_RETRY_CONFIG, 'should have baseDelayMs');
      assert.ok('maxDelayMs' in DEFAULT_RETRY_CONFIG, 'should have maxDelayMs');
      assert.ok('multiplier' in DEFAULT_RETRY_CONFIG, 'should have multiplier');
      assert.ok('jitter' in DEFAULT_RETRY_CONFIG, 'should have jitter');
    });
  });

  describe('RETRY_PRESETS', () => {
    it('should have wu_done preset for wu:done merge operations', () => {
      assert.ok('wu_done' in RETRY_PRESETS, 'should have wu_done preset');
      const preset = RETRY_PRESETS.wu_done;
      assert.ok(
        preset.maxAttempts >= 5,
        'wu_done should have at least 5 attempts for concurrent scenarios',
      );
    });

    it('should have recovery preset for zombie state recovery', () => {
      assert.ok('recovery' in RETRY_PRESETS, 'should have recovery preset');
      const preset = RETRY_PRESETS.recovery;
      assert.ok(preset.maxAttempts >= 3, 'recovery should have at least 3 attempts');
    });
  });

  describe('createRetryConfig()', () => {
    it('should return defaults when called without arguments', () => {
      const config = createRetryConfig();
      expect(config).toEqual(DEFAULT_RETRY_CONFIG);
    });

    it('should merge custom options with defaults', () => {
      const config = createRetryConfig({ maxAttempts: 10 });
      expect(config.maxAttempts).toBe(10);
      expect(config.baseDelayMs).toBe(DEFAULT_RETRY_CONFIG.baseDelayMs);
    });

    it('should accept preset name as first argument', () => {
      const config = createRetryConfig('wu_done');
      expect(config).toEqual(RETRY_PRESETS.wu_done);
    });

    it('should merge custom options onto preset', () => {
      const config = createRetryConfig('wu_done', { maxAttempts: 20 });
      expect(config.maxAttempts).toBe(20);
      expect(config.baseDelayMs).toBe(RETRY_PRESETS.wu_done.baseDelayMs);
    });

    it('should not overwrite preset values with undefined', () => {
      const config = createRetryConfig('wu_done', { maxAttempts: undefined });
      expect(config.maxAttempts).toBe(RETRY_PRESETS.wu_done.maxAttempts);
    });
  });

  describe('calculateBackoffDelay()', () => {
    it('should return base delay for first attempt', () => {
      const config = createRetryConfig({
        baseDelayMs: 1000,
        multiplier: 2,
        maxDelayMs: 30000,
        jitter: 0, // Disable jitter for deterministic tests
      });
      const delay = calculateBackoffDelay(0, config);
      expect(delay).toBe(1000);
    });

    it('should double delay for each subsequent attempt', () => {
      const config = createRetryConfig({
        baseDelayMs: 1000,
        multiplier: 2,
        maxDelayMs: 30000,
        jitter: 0,
      });
      assert.equal(calculateBackoffDelay(1, config), 2000);
      assert.equal(calculateBackoffDelay(2, config), 4000);
      assert.equal(calculateBackoffDelay(3, config), 8000);
    });

    it('should cap delay at maxDelayMs', () => {
      const config = createRetryConfig({
        baseDelayMs: 1000,
        multiplier: 2,
        maxDelayMs: 30000,
        jitter: 0,
      });
      // 2^5 * 1000 = 32000, which exceeds maxDelayMs of 30000
      assert.equal(calculateBackoffDelay(5, config), 30000);
      assert.equal(calculateBackoffDelay(10, config), 30000);
    });

    it('should add jitter when enabled', () => {
      const configWithJitter = createRetryConfig({
        baseDelayMs: 1000,
        multiplier: 2,
        maxDelayMs: 30000,
        jitter: 0.2, // 20% jitter
      });

      // Run multiple times to verify variance
      const delays = Array.from({ length: 10 }, () => calculateBackoffDelay(1, configWithJitter));

      // All delays should be within base * multiplier ± jitter range
      const expectedBase = 2000; // 1000 * 2^1
      const minExpected = expectedBase * 0.8;
      const maxExpected = expectedBase * 1.2;

      delays.forEach((delay) => {
        assert.ok(delay >= minExpected, `delay ${delay} should be >= ${minExpected}`);
        assert.ok(delay <= maxExpected, `delay ${delay} should be <= ${maxExpected}`);
      });

      // At least some variance should exist
      const uniqueDelays = new Set(delays);
      assert.ok(uniqueDelays.size > 1, 'jitter should create variance in delays');
    });
  });

  describe('withRetry()', () => {
    it('should retry on failure and succeed eventually', async () => {
      let callCount = 0;
      const mockFn = async () => {
        callCount++;
        if (callCount < 3) {
          throw new Error(`Attempt ${callCount} failed`);
        }
        return { success: true, attempt: callCount };
      };

      const config = createRetryConfig({
        maxAttempts: 5,
        baseDelayMs: 10, // Short delays for test speed
        multiplier: 2,
        jitter: 0,
      });

      const result = await withRetry(mockFn, config);

      expect(result.success).toBe(true);
      expect(result.attempt).toBe(3);
      expect(callCount).toBe(3, 'should have called function 3 times');
    });

    it('should throw after max attempts exhausted', async () => {
      const alwaysFails = async () => {
        throw new Error('Always fails');
      };

      const config = createRetryConfig({
        maxAttempts: 3,
        baseDelayMs: 10,
        multiplier: 2,
        jitter: 0,
      });

      try {
        await withRetry(alwaysFails, config);
        throw new Error('should have thrown');
      } catch (err) {
        assert.ok(err.message.includes('Always fails'), 'should include original error');
        assert.ok(err.message.includes('3'), 'should mention attempt count');
      }
    });

    it('should call onRetry callback before each retry', async () => {
      let callCount = 0;
      const mockFn = async () => {
        callCount++;
        if (callCount < 3) {
          throw new Error(`Attempt ${callCount} failed`);
        }
        return { success: true };
      };

      const retryHistory = [];
      const config = createRetryConfig({
        maxAttempts: 5,
        baseDelayMs: 10,
        multiplier: 2,
        jitter: 0,
        onRetry: (attempt, error, delay) => {
          retryHistory.push({ attempt, error: error.message, delay });
        },
      });

      await withRetry(mockFn, config);

      assert.equal(
        retryHistory.length,
        2,
        'should have 2 retry callbacks (before attempts 2 and 3)',
      );
      expect(retryHistory[0].attempt).toBe(1, 'first retry after attempt 1');
      expect(retryHistory[0].delay).toBe(10, 'first delay should be baseDelayMs');
      expect(retryHistory[1].attempt).toBe(2, 'second retry after attempt 2');
      expect(retryHistory[1].delay).toBe(20, 'second delay should be baseDelayMs * 2');
    });

    it('should not retry if shouldRetry returns false', async () => {
      let calls = 0;
      const fn = async () => {
        calls++;
        throw new Error(calls === 1 ? 'retryable' : 'non-retryable');
      };

      const config = createRetryConfig({
        maxAttempts: 5,
        baseDelayMs: 10,
        shouldRetry: (error) => error.message === 'retryable',
      });

      try {
        await withRetry(fn, config);
        throw new Error('should have thrown');
      } catch (err) {
        // Error is wrapped with attempt count info
        assert.ok(err.message.includes('non-retryable'), 'should include original error');
        expect(calls).toBe(2, 'should have stopped after non-retryable error');
      }
    });

    it('should respect maxAttempts from preset', async () => {
      let callCount = 0;
      const alwaysFails = async () => {
        callCount++;
        // Use error pattern from constants that wu_done preset considers retryable
        throw new Error(`${RETRYABLE_ERROR_PATTERNS.FAST_FORWARD} failed`);
      };

      // wu_done preset should have at least 5 attempts
      const config = createRetryConfig('wu_done', { baseDelayMs: 1 }); // Speed up test

      try {
        await withRetry(alwaysFails, config);
        throw new Error('should have thrown');
      } catch {
        assert.ok(callCount >= 5, 'should have attempted at least 5 times');
      }
    });
  });
});
