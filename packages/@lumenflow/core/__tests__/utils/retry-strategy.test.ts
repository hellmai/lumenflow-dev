/**
 * RetryStrategy tests (WU-2537)
 */

import { describe, it, expect, vi } from 'vitest';
import { RetryStrategy } from '../../src/utils/retry-strategy.js';

describe('RetryStrategy', () => {
  describe('execute', () => {
    it('returns result on first success', async () => {
      const strategy = new RetryStrategy();
      const result = await strategy.execute(async () => 'success');
      expect(result).toBe('success');
    });

    it('retries on failure and succeeds', async () => {
      let attempts = 0;
      const strategy = new RetryStrategy({ maxRetries: 3, baseDelayMs: 1 });

      const result = await strategy.execute(async () => {
        attempts++;
        if (attempts < 3) {
          throw new Error('retry');
        }
        return 'success';
      });

      expect(result).toBe('success');
      expect(attempts).toBe(3);
    });

    it('throws after max retries exhausted', async () => {
      const strategy = new RetryStrategy({ maxRetries: 2, baseDelayMs: 1 });

      await expect(
        strategy.execute(async () => {
          throw new Error('always fails');
        })
      ).rejects.toThrow('always fails');
    });

    it('respects shouldRetry predicate', async () => {
      let attempts = 0;
      const strategy = new RetryStrategy({
        maxRetries: 3,
        baseDelayMs: 1,
        shouldRetry: (err) => !err.message.includes('fatal'),
      });

      await expect(
        strategy.execute(async () => {
          attempts++;
          throw new Error('fatal error');
        })
      ).rejects.toThrow('fatal');

      expect(attempts).toBe(1); // No retry because shouldRetry returned false
    });

    it('converts non-Error throws to Error', async () => {
      const strategy = new RetryStrategy({ maxRetries: 0 });

      await expect(
        strategy.execute(async () => {
          throw 'string error';
        })
      ).rejects.toThrow('string error');
    });
  });

  describe('calculateDelay', () => {
    it('calculates exponential backoff', () => {
      const strategy = new RetryStrategy({ baseDelayMs: 100 });

      expect(strategy.calculateDelay(0)).toBe(100);
      expect(strategy.calculateDelay(1)).toBe(200);
      expect(strategy.calculateDelay(2)).toBe(400);
      expect(strategy.calculateDelay(3)).toBe(800);
    });

    it('respects maxDelayMs', () => {
      const strategy = new RetryStrategy({ baseDelayMs: 100, maxDelayMs: 500 });

      expect(strategy.calculateDelay(0)).toBe(100);
      expect(strategy.calculateDelay(3)).toBe(500); // Would be 800, but capped at 500
      expect(strategy.calculateDelay(10)).toBe(500);
    });
  });

  describe('default options', () => {
    it('uses sensible defaults', () => {
      const strategy = new RetryStrategy();

      expect(strategy.calculateDelay(0)).toBe(100);
      expect(strategy.calculateDelay(10)).toBeLessThanOrEqual(10000);
    });
  });
});
