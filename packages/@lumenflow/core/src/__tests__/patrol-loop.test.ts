/**
 * Patrol Loop Tests (WU-1242)
 *
 * Tests for the continuous patrol loop that monitors spawn health.
 *
 * Test categories:
 * 1. Patrol loop creation - verifies PatrolLoop can be instantiated
 * 2. Interval configuration - verifies default and custom intervals
 * 3. Exponential backoff - verifies backoff on repeated failures (max 1hr)
 * 4. Cycle callback - verifies status summary is provided at each patrol cycle
 * 5. Graceful shutdown - verifies SIGINT/SIGTERM handling
 * 6. State tracking - verifies consecutive failure counting
 * 7. Promise safety - verifies .catch() on async setTimeout callbacks (WU-1551)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';

// Constants for testing
const DEFAULT_PATROL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes in milliseconds
const MAX_BACKOFF_MS = 60 * 60 * 1000; // 1 hour max backoff

describe('patrol-loop (WU-1242)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('PatrolLoop creation', () => {
    it('creates a patrol loop with default options', async () => {
      // Import will fail until implementation exists - this is expected for RED phase
      const { PatrolLoop } = await import('../patrol-loop.js');

      const patrol = new PatrolLoop({
        checkFn: vi.fn().mockResolvedValue({ healthy: true, stuckCount: 0, zombieCount: 0 }),
      });

      expect(patrol).toBeDefined();
      expect(patrol.intervalMs).toBe(DEFAULT_PATROL_INTERVAL_MS);
    });

    it('creates a patrol loop with custom interval', async () => {
      const { PatrolLoop } = await import('../patrol-loop.js');

      const customIntervalMs = 10 * 60 * 1000; // 10 minutes
      const patrol = new PatrolLoop({
        checkFn: vi.fn().mockResolvedValue({ healthy: true, stuckCount: 0, zombieCount: 0 }),
        intervalMs: customIntervalMs,
      });

      expect(patrol.intervalMs).toBe(customIntervalMs);
    });
  });

  describe('interval configuration', () => {
    it('uses default 5 minute interval', async () => {
      const { DEFAULT_PATROL_INTERVAL_MS: defaultInterval } = await import('../patrol-loop.js');

      expect(defaultInterval).toBe(5 * 60 * 1000);
    });

    it('allows interval to be configured via options', async () => {
      const { PatrolLoop } = await import('../patrol-loop.js');

      const customIntervalMs = 15 * 60 * 1000; // 15 minutes
      const patrol = new PatrolLoop({
        checkFn: vi.fn().mockResolvedValue({ healthy: true, stuckCount: 0, zombieCount: 0 }),
        intervalMs: customIntervalMs,
      });

      expect(patrol.intervalMs).toBe(customIntervalMs);
    });
  });

  describe('exponential backoff', () => {
    it('applies exponential backoff on repeated failures', async () => {
      const { calculateBackoff } = await import('../patrol-loop.js');

      // First failure: no backoff (still 5min)
      expect(calculateBackoff(1, DEFAULT_PATROL_INTERVAL_MS)).toBe(DEFAULT_PATROL_INTERVAL_MS);

      // Second failure: 2x backoff (10min)
      expect(calculateBackoff(2, DEFAULT_PATROL_INTERVAL_MS)).toBe(10 * 60 * 1000);

      // Third failure: 4x backoff (20min)
      expect(calculateBackoff(3, DEFAULT_PATROL_INTERVAL_MS)).toBe(20 * 60 * 1000);
    });

    it('caps backoff at 1 hour maximum', async () => {
      const { calculateBackoff } = await import('../patrol-loop.js');

      // Very high failure count should still cap at 1 hour
      const backoff = calculateBackoff(10, DEFAULT_PATROL_INTERVAL_MS);

      expect(backoff).toBe(MAX_BACKOFF_MS);
      expect(backoff).toBeLessThanOrEqual(60 * 60 * 1000);
    });

    it('resets backoff on successful patrol', async () => {
      const { PatrolLoop } = await import('../patrol-loop.js');

      const checkFn = vi.fn();
      // First two calls fail, third succeeds
      checkFn
        .mockRejectedValueOnce(new Error('fail 1'))
        .mockRejectedValueOnce(new Error('fail 2'))
        .mockResolvedValueOnce({ healthy: true, stuckCount: 0, zombieCount: 0 });

      const patrol = new PatrolLoop({
        checkFn,
        intervalMs: 1000, // Use short interval for test
      });

      patrol.start();

      // After first failure
      await vi.advanceTimersByTimeAsync(1000);
      expect(patrol.consecutiveFailures).toBe(1);

      // After second failure - backoff should be applied
      await vi.advanceTimersByTimeAsync(1000);
      expect(patrol.consecutiveFailures).toBe(2);

      // After success - failures should reset
      await vi.advanceTimersByTimeAsync(2000); // Account for backoff
      expect(patrol.consecutiveFailures).toBe(0);

      patrol.stop();
    });
  });

  describe('cycle callback', () => {
    it('calls onCycle callback with status summary at each patrol', async () => {
      const { PatrolLoop } = await import('../patrol-loop.js');

      const mockCheckResult = {
        healthy: false,
        stuckCount: 2,
        zombieCount: 1,
        suggestions: ['pnpm wu:block --id WU-1234'],
      };

      const checkFn = vi.fn().mockResolvedValue(mockCheckResult);
      const onCycle = vi.fn();

      const patrol = new PatrolLoop({
        checkFn,
        onCycle,
        intervalMs: 1000,
      });

      patrol.start();
      await vi.advanceTimersByTimeAsync(1000);

      expect(onCycle).toHaveBeenCalledWith(
        expect.objectContaining({
          healthy: false,
          stuckCount: 2,
          zombieCount: 1,
        }),
        expect.objectContaining({
          cycleNumber: 1,
        }),
      );

      patrol.stop();
    });

    it('provides cycle count in callback', async () => {
      const { PatrolLoop } = await import('../patrol-loop.js');

      const checkFn = vi.fn().mockResolvedValue({ healthy: true, stuckCount: 0, zombieCount: 0 });
      const onCycle = vi.fn();

      const patrol = new PatrolLoop({
        checkFn,
        onCycle,
        intervalMs: 1000,
      });

      patrol.start();

      // First cycle
      await vi.advanceTimersByTimeAsync(1000);
      expect(onCycle).toHaveBeenLastCalledWith(
        expect.anything(),
        expect.objectContaining({ cycleNumber: 1 }),
      );

      // Second cycle
      await vi.advanceTimersByTimeAsync(1000);
      expect(onCycle).toHaveBeenLastCalledWith(
        expect.anything(),
        expect.objectContaining({ cycleNumber: 2 }),
      );

      patrol.stop();
    });
  });

  describe('graceful shutdown', () => {
    it('stops patrol loop on stop() call', async () => {
      const { PatrolLoop } = await import('../patrol-loop.js');

      const checkFn = vi.fn().mockResolvedValue({ healthy: true, stuckCount: 0, zombieCount: 0 });

      const patrol = new PatrolLoop({
        checkFn,
        intervalMs: 1000,
      });

      patrol.start();
      expect(patrol.isRunning).toBe(true);

      patrol.stop();
      expect(patrol.isRunning).toBe(false);
    });

    it('does not throw if stop() called when not running', async () => {
      const { PatrolLoop } = await import('../patrol-loop.js');

      const patrol = new PatrolLoop({
        checkFn: vi.fn().mockResolvedValue({ healthy: true, stuckCount: 0, zombieCount: 0 }),
      });

      expect(() => patrol.stop()).not.toThrow();
    });

    it('calling start() twice does not create multiple timers', async () => {
      const { PatrolLoop } = await import('../patrol-loop.js');

      const checkFn = vi.fn().mockResolvedValue({ healthy: true, stuckCount: 0, zombieCount: 0 });

      const patrol = new PatrolLoop({
        checkFn,
        intervalMs: 1000,
      });

      patrol.start();
      patrol.start(); // Should not create second timer

      await vi.advanceTimersByTimeAsync(1000);

      // Should only have been called once per interval, not twice
      expect(checkFn).toHaveBeenCalledTimes(1);

      patrol.stop();
    });
  });

  describe('state tracking', () => {
    it('tracks consecutive failure count', async () => {
      const { PatrolLoop } = await import('../patrol-loop.js');

      const checkFn = vi.fn().mockRejectedValue(new Error('test failure'));

      const patrol = new PatrolLoop({
        checkFn,
        intervalMs: 1000,
      });

      expect(patrol.consecutiveFailures).toBe(0);

      patrol.start();

      await vi.advanceTimersByTimeAsync(1000);
      expect(patrol.consecutiveFailures).toBe(1);

      await vi.advanceTimersByTimeAsync(1000);
      expect(patrol.consecutiveFailures).toBe(2);

      patrol.stop();
    });

    it('tracks total cycle count', async () => {
      const { PatrolLoop } = await import('../patrol-loop.js');

      const checkFn = vi.fn().mockResolvedValue({ healthy: true, stuckCount: 0, zombieCount: 0 });

      const patrol = new PatrolLoop({
        checkFn,
        intervalMs: 1000,
      });

      expect(patrol.totalCycles).toBe(0);

      patrol.start();

      await vi.advanceTimersByTimeAsync(1000);
      expect(patrol.totalCycles).toBe(1);

      await vi.advanceTimersByTimeAsync(1000);
      expect(patrol.totalCycles).toBe(2);

      patrol.stop();
    });
  });

  describe('error handling', () => {
    it('calls onError callback when checkFn throws', async () => {
      const { PatrolLoop } = await import('../patrol-loop.js');

      const testError = new Error('check failed');
      const checkFn = vi.fn().mockRejectedValue(testError);
      const onError = vi.fn();

      const patrol = new PatrolLoop({
        checkFn,
        onError,
        intervalMs: 1000,
      });

      patrol.start();
      await vi.advanceTimersByTimeAsync(1000);

      expect(onError).toHaveBeenCalledWith(testError, expect.any(Number));

      patrol.stop();
    });

    it('continues running after errors', async () => {
      const { PatrolLoop } = await import('../patrol-loop.js');

      const checkFn = vi
        .fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValueOnce({ healthy: true, stuckCount: 0, zombieCount: 0 });

      const patrol = new PatrolLoop({
        checkFn,
        intervalMs: 1000,
      });

      patrol.start();

      // First call fails
      await vi.advanceTimersByTimeAsync(1000);
      expect(checkFn).toHaveBeenCalledTimes(1);

      // Second call should still happen
      await vi.advanceTimersByTimeAsync(1000);
      expect(checkFn).toHaveBeenCalledTimes(2);

      patrol.stop();
    });
  });

  describe('promise safety (WU-1551)', () => {
    it('does not produce unhandled rejections when checkFn throws without onError', async () => {
      const { PatrolLoop } = await import('../patrol-loop.js');

      // Verify the patrol continues gracefully when checkFn throws
      // and no onError callback is provided. If .catch() were missing,
      // the promise rejection would be unhandled.
      const checkFn = vi.fn().mockRejectedValue(new Error('should be caught'));

      const patrol = new PatrolLoop({
        checkFn,
        intervalMs: 1000,
        // No onError callback - this is the scenario that would cause
        // unhandled rejection if .catch() is missing
      });

      patrol.start();

      // Run a cycle - if .catch() is missing, this would cause unhandled rejection
      await vi.advanceTimersByTimeAsync(1000);

      // Patrol should still be running (not crashed)
      expect(patrol.isRunning).toBe(true);
      // Failure should be tracked
      expect(patrol.consecutiveFailures).toBe(1);

      // Run another cycle to prove it continues
      await vi.advanceTimersByTimeAsync(1000);
      expect(patrol.consecutiveFailures).toBe(2);
      expect(checkFn).toHaveBeenCalledTimes(2);

      patrol.stop();
    });

    it('patrol-loop.ts source has .catch() on promise chain in setTimeout', async () => {
      const sourcePath = path.resolve(import.meta.dirname, '..', 'patrol-loop.ts');
      const source = await fs.readFile(sourcePath, 'utf-8');

      // The setTimeout callback that calls runCycle().then() must have .catch()
      // to prevent floating promises from silently swallowing errors
      expect(source).toContain('.catch(');
    });
  });
});
