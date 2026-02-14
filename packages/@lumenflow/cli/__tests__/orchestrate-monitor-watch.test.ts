/**
 * Orchestrate Monitor Watch Mode Tests (WU-1242)
 *
 * Tests for the --watch flag that enables continuous patrol monitoring.
 *
 * Test categories:
 * 1. Watch mode flag - verifies --watch enters continuous mode
 * 2. Interval flag - verifies --interval configures patrol interval
 * 3. Output format - verifies status summary printed at each cycle
 * 4. Backoff behavior - verifies exponential backoff on failures
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock process signals for graceful shutdown tests
const originalExit = process.exit;

describe('orchestrate:monitor --watch (WU-1242)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // @ts-expect-error - mocking process.exit
    process.exit = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
    process.exit = originalExit;
  });

  describe('--watch flag', () => {
    it('enters continuous patrol mode when --watch is specified', async () => {
      // This test verifies the behavior from the acceptance criteria:
      // "orchestrate:monitor --watch enters continuous patrol mode"
      //
      // Implementation should:
      // 1. Start a PatrolLoop when --watch is present
      // 2. Keep running until SIGINT/SIGTERM

      const { createWatchModeRunner } = await import('../src/orchestrate-monitor.js');

      const mockCheckFn = vi.fn().mockResolvedValue({
        analysis: { pending: 1, completed: 2, timeout: 0, crashed: 0, total: 3 },
        stuckDelegations: [],
        zombieLocks: [],
        suggestions: [],
      });

      const runner = createWatchModeRunner({
        checkFn: mockCheckFn,
        intervalMs: 1000,
      });

      // Start watch mode
      runner.start();

      // Verify it's running
      expect(runner.isRunning).toBe(true);

      // Advance time to trigger first patrol
      await vi.advanceTimersByTimeAsync(1000);
      expect(mockCheckFn).toHaveBeenCalledTimes(1);

      // Advance time to trigger second patrol
      await vi.advanceTimersByTimeAsync(1000);
      expect(mockCheckFn).toHaveBeenCalledTimes(2);

      // Stop watch mode
      runner.stop();
      expect(runner.isRunning).toBe(false);
    });
  });

  describe('--interval flag', () => {
    it('uses default 5 minute interval when --interval not specified', async () => {
      const { parseWatchOptions, DEFAULT_WATCH_INTERVAL_MS } =
        await import('../src/orchestrate-monitor.js');

      // Without --interval, should use default
      const options = parseWatchOptions({});

      expect(options.intervalMs).toBe(DEFAULT_WATCH_INTERVAL_MS);
      expect(DEFAULT_WATCH_INTERVAL_MS).toBe(5 * 60 * 1000); // 5 minutes
    });

    it('parses --interval flag with minute value', async () => {
      const { parseWatchOptions } = await import('../src/orchestrate-monitor.js');

      // --interval 10 (10 minutes)
      const options = parseWatchOptions({ interval: '10' });

      expect(options.intervalMs).toBe(10 * 60 * 1000);
    });

    it('parses --interval flag with human-readable format', async () => {
      const { parseWatchOptions } = await import('../src/orchestrate-monitor.js');

      // --interval 15m (15 minutes)
      const options15m = parseWatchOptions({ interval: '15m' });
      expect(options15m.intervalMs).toBe(15 * 60 * 1000);

      // --interval 1h (1 hour)
      const options1h = parseWatchOptions({ interval: '1h' });
      expect(options1h.intervalMs).toBe(60 * 60 * 1000);
    });

    it('validates minimum interval', async () => {
      const { parseWatchOptions, MIN_WATCH_INTERVAL_MS } =
        await import('../src/orchestrate-monitor.js');

      // Interval too short should be clamped to minimum
      const options = parseWatchOptions({ interval: '10s' }); // 10 seconds too short

      expect(options.intervalMs).toBeGreaterThanOrEqual(MIN_WATCH_INTERVAL_MS);
      expect(MIN_WATCH_INTERVAL_MS).toBe(60 * 1000); // 1 minute minimum
    });
  });

  describe('status summary at each cycle', () => {
    it('prints status summary at each patrol cycle', async () => {
      const { createWatchModeRunner } = await import('../src/orchestrate-monitor.js');

      const mockCheckFn = vi.fn().mockResolvedValue({
        analysis: { pending: 2, completed: 5, timeout: 1, crashed: 0, total: 8 },
        stuckDelegations: [
          {
            delegation: { id: 'dlg-0001', targetWuId: 'WU-1001', lane: 'Framework: CLI' },
            ageMinutes: 45,
            lastCheckpoint: null,
          },
        ],
        zombieLocks: [],
        suggestions: [],
      });

      const outputLines: string[] = [];
      const onOutput = (line: string): void => {
        outputLines.push(line);
      };

      const runner = createWatchModeRunner({
        checkFn: mockCheckFn,
        intervalMs: 1000,
        onOutput,
      });

      runner.start();
      await vi.advanceTimersByTimeAsync(1000);
      runner.stop();

      // Verify output contains expected elements
      const fullOutput = outputLines.join('\n');
      expect(fullOutput).toContain('Cycle');
      expect(fullOutput).toContain('Pending');
      expect(fullOutput).toContain('Stuck');
    });

    it('includes cycle number in output', async () => {
      const { createWatchModeRunner } = await import('../src/orchestrate-monitor.js');

      const mockCheckFn = vi.fn().mockResolvedValue({
        analysis: { pending: 0, completed: 0, timeout: 0, crashed: 0, total: 0 },
        stuckDelegations: [],
        zombieLocks: [],
        suggestions: [],
      });

      const outputLines: string[] = [];

      const runner = createWatchModeRunner({
        checkFn: mockCheckFn,
        intervalMs: 1000,
        onOutput: (line: string) => outputLines.push(line),
      });

      runner.start();

      // First cycle
      await vi.advanceTimersByTimeAsync(1000);
      expect(outputLines.some((line) => line.includes('Cycle 1') || line.includes('#1'))).toBe(
        true,
      );

      // Second cycle
      await vi.advanceTimersByTimeAsync(1000);
      expect(outputLines.some((line) => line.includes('Cycle 2') || line.includes('#2'))).toBe(
        true,
      );

      runner.stop();
    });

    it('includes timestamp in cycle output', async () => {
      const { createWatchModeRunner } = await import('../src/orchestrate-monitor.js');

      const mockCheckFn = vi.fn().mockResolvedValue({
        analysis: { pending: 0, completed: 0, timeout: 0, crashed: 0, total: 0 },
        stuckDelegations: [],
        zombieLocks: [],
        suggestions: [],
      });

      const outputLines: string[] = [];

      const runner = createWatchModeRunner({
        checkFn: mockCheckFn,
        intervalMs: 1000,
        onOutput: (line: string) => outputLines.push(line),
      });

      runner.start();
      await vi.advanceTimersByTimeAsync(1000);
      runner.stop();

      // Should have some form of timestamp
      const fullOutput = outputLines.join('\n');
      // Either ISO format (YYYY-MM-DD) or time format (HH:MM:SS)
      const hasIsoDate = /\d{4}-\d{2}-\d{2}/.test(fullOutput);
      const hasTime = /\d{1,2}:\d{2}:\d{2}/.test(fullOutput);
      expect(hasIsoDate || hasTime).toBe(true);
    });
  });

  describe('exponential backoff on failures', () => {
    it('increases interval on consecutive failures', async () => {
      const { createWatchModeRunner } = await import('../src/orchestrate-monitor.js');

      const mockCheckFn = vi.fn().mockRejectedValue(new Error('check failed'));

      const runner = createWatchModeRunner({
        checkFn: mockCheckFn,
        intervalMs: 1000,
      });

      runner.start();

      // First failure
      await vi.advanceTimersByTimeAsync(1000);
      expect(runner.currentIntervalMs).toBe(1000); // No backoff yet

      // After failure, backoff should be applied for next interval
      await vi.advanceTimersByTimeAsync(1000);
      expect(runner.currentIntervalMs).toBeGreaterThan(1000);

      runner.stop();
    });

    it('caps backoff at 1 hour maximum', async () => {
      const { createWatchModeRunner, MAX_BACKOFF_MS } =
        await import('../src/orchestrate-monitor.js');

      const mockCheckFn = vi.fn().mockRejectedValue(new Error('check failed'));

      const runner = createWatchModeRunner({
        checkFn: mockCheckFn,
        intervalMs: 60 * 1000, // 1 minute base interval
      });

      runner.start();

      // Simulate many failures
      for (let i = 0; i < 10; i++) {
        await vi.advanceTimersByTimeAsync(runner.currentIntervalMs);
      }

      // Should be capped at max
      expect(runner.currentIntervalMs).toBeLessThanOrEqual(MAX_BACKOFF_MS);
      expect(MAX_BACKOFF_MS).toBe(60 * 60 * 1000); // 1 hour

      runner.stop();
    });

    it('resets interval after successful check', async () => {
      const { createWatchModeRunner } = await import('../src/orchestrate-monitor.js');

      const mockCheckFn = vi
        .fn()
        .mockRejectedValueOnce(new Error('fail 1'))
        .mockRejectedValueOnce(new Error('fail 2'))
        .mockResolvedValueOnce({
          analysis: { pending: 0, completed: 0, timeout: 0, crashed: 0, total: 0 },
          stuckDelegations: [],
          zombieLocks: [],
          suggestions: [],
        });

      const baseInterval = 1000;
      const runner = createWatchModeRunner({
        checkFn: mockCheckFn,
        intervalMs: baseInterval,
      });

      runner.start();

      // First failure
      await vi.advanceTimersByTimeAsync(baseInterval);
      expect(runner.consecutiveFailures).toBe(1);

      // Second failure - backoff applied
      await vi.advanceTimersByTimeAsync(runner.currentIntervalMs);
      expect(runner.consecutiveFailures).toBe(2);
      expect(runner.currentIntervalMs).toBeGreaterThan(baseInterval);

      // Success - should reset
      await vi.advanceTimersByTimeAsync(runner.currentIntervalMs);
      expect(runner.consecutiveFailures).toBe(0);
      expect(runner.currentIntervalMs).toBe(baseInterval);

      runner.stop();
    });
  });

  describe('graceful shutdown', () => {
    it('stops cleanly when stop() is called', async () => {
      const { createWatchModeRunner } = await import('../src/orchestrate-monitor.js');

      const mockCheckFn = vi.fn().mockResolvedValue({
        analysis: { pending: 0, completed: 0, timeout: 0, crashed: 0, total: 0 },
        stuckDelegations: [],
        zombieLocks: [],
        suggestions: [],
      });

      const runner = createWatchModeRunner({
        checkFn: mockCheckFn,
        intervalMs: 1000,
      });

      runner.start();
      expect(runner.isRunning).toBe(true);

      runner.stop();
      expect(runner.isRunning).toBe(false);

      // No more checks should happen
      const callCount = mockCheckFn.mock.calls.length;
      await vi.advanceTimersByTimeAsync(5000);
      expect(mockCheckFn.mock.calls.length).toBe(callCount);
    });

    it('prints shutdown message on stop', async () => {
      const { createWatchModeRunner } = await import('../src/orchestrate-monitor.js');

      const outputLines: string[] = [];

      const runner = createWatchModeRunner({
        checkFn: vi.fn().mockResolvedValue({
          analysis: { pending: 0, completed: 0, timeout: 0, crashed: 0, total: 0 },
          stuckDelegations: [],
          zombieLocks: [],
          suggestions: [],
        }),
        intervalMs: 1000,
        onOutput: (line: string) => outputLines.push(line),
      });

      runner.start();
      runner.stop();

      const fullOutput = outputLines.join('\n');
      expect(
        fullOutput.toLowerCase().includes('stop') ||
          fullOutput.toLowerCase().includes('shutdown') ||
          fullOutput.toLowerCase().includes('exit'),
      ).toBe(true);
    });
  });
});
