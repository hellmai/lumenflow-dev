/**
 * Tests for the gates runner.
 * @module @lumenflow/core/gates
 *
 * Tests the runGates function which orchestrates format, lint, typecheck, test.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runGates } from '../../src/gates/index.js';
import type { GatesResult } from '../../src/gates/types.js';

// Mock child_process.spawn
vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';

const mockSpawn = vi.mocked(spawn);

function createMockProcess(
  exitCode: number,
  stdout = '',
  stderr = '',
): EventEmitter & { stdout: EventEmitter; stderr: EventEmitter } {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
  };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();

  setImmediate(() => {
    if (stdout) proc.stdout.emit('data', Buffer.from(stdout));
    if (stderr) proc.stderr.emit('data', Buffer.from(stderr));
    proc.emit('close', exitCode);
  });

  return proc;
}

describe('runGates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('basic execution', () => {
    it('should run all gates by default', async () => {
      mockSpawn.mockImplementation(
        () => createMockProcess(0, 'success') as ReturnType<typeof spawn>,
      );

      const result = await runGates({ cwd: '/test/repo' });

      expect(result.results).toHaveLength(4);
      expect(result.results.map((r) => r.gate)).toEqual(['format', 'lint', 'typecheck', 'test']);
    });

    it('should return passed=true when all gates pass', async () => {
      mockSpawn.mockImplementation(() => createMockProcess(0) as ReturnType<typeof spawn>);

      const result = await runGates({ cwd: '/test/repo' });

      expect(result.passed).toBe(true);
      expect(result.passedCount).toBe(4);
      expect(result.failedCount).toBe(0);
    });

    it('should return passed=false when any gate fails', async () => {
      let callCount = 0;
      mockSpawn.mockImplementation(() => {
        callCount++;
        // Fail on second gate (lint)
        const exitCode = callCount === 2 ? 1 : 0;
        return createMockProcess(exitCode) as ReturnType<typeof spawn>;
      });

      // Default is failFast=true, so only runs 2 gates (format passes, lint fails)
      const result = await runGates({ cwd: '/test/repo' });

      expect(result.passed).toBe(false);
      expect(result.passedCount).toBe(1);
      expect(result.failedCount).toBe(1);
    });
  });

  describe('failFast option', () => {
    it('should stop on first failure when failFast=true', async () => {
      let callCount = 0;
      mockSpawn.mockImplementation(() => {
        callCount++;
        // Fail on first gate
        const exitCode = callCount === 1 ? 1 : 0;
        return createMockProcess(exitCode) as ReturnType<typeof spawn>;
      });

      const result = await runGates({ cwd: '/test/repo', failFast: true });

      expect(result.results).toHaveLength(1);
      expect(result.passed).toBe(false);
    });

    it('should continue on failure when failFast=false', async () => {
      let callCount = 0;
      mockSpawn.mockImplementation(() => {
        callCount++;
        const exitCode = callCount === 1 ? 1 : 0;
        return createMockProcess(exitCode) as ReturnType<typeof spawn>;
      });

      const result = await runGates({ cwd: '/test/repo', failFast: false });

      expect(result.results).toHaveLength(4);
    });
  });

  describe('gates option', () => {
    it('should run only specified gates', async () => {
      mockSpawn.mockImplementation(() => createMockProcess(0) as ReturnType<typeof spawn>);

      const result = await runGates({
        cwd: '/test/repo',
        gates: ['lint', 'typecheck'],
      });

      expect(result.results).toHaveLength(2);
      expect(result.results.map((r) => r.gate)).toEqual(['lint', 'typecheck']);
    });
  });

  describe('commands option', () => {
    it('should use custom commands when provided', async () => {
      mockSpawn.mockImplementation(() => createMockProcess(0) as ReturnType<typeof spawn>);

      await runGates({
        cwd: '/test/repo',
        gates: ['lint'],
        commands: { lint: 'npm run lint:custom' },
      });

      expect(mockSpawn).toHaveBeenCalledWith(
        'npm',
        ['run', 'lint:custom'],
        expect.objectContaining({ cwd: '/test/repo' }),
      );
    });
  });

  describe('gate result details', () => {
    it('should capture stdout and stderr', async () => {
      mockSpawn.mockImplementation(
        () => createMockProcess(0, 'stdout output', 'stderr output') as ReturnType<typeof spawn>,
      );

      const result = await runGates({ cwd: '/test/repo', gates: ['format'] });

      expect(result.results[0]?.stdout).toBe('stdout output');
      expect(result.results[0]?.stderr).toBe('stderr output');
    });

    it('should track duration', async () => {
      mockSpawn.mockImplementation(() => createMockProcess(0) as ReturnType<typeof spawn>);

      const result = await runGates({ cwd: '/test/repo', gates: ['format'] });

      expect(result.results[0]?.durationMs).toBeGreaterThanOrEqual(0);
      expect(result.totalDurationMs).toBeGreaterThanOrEqual(0);
    });

    it('should capture exit code', async () => {
      mockSpawn.mockImplementation(() => createMockProcess(42) as ReturnType<typeof spawn>);

      const result = await runGates({ cwd: '/test/repo', gates: ['format'] });

      expect(result.results[0]?.exitCode).toBe(42);
      expect(result.results[0]?.passed).toBe(false);
    });
  });

  describe('error handling', () => {
    it('should handle spawn errors', async () => {
      mockSpawn.mockImplementation(() => {
        const proc = new EventEmitter() as EventEmitter & {
          stdout: EventEmitter;
          stderr: EventEmitter;
        };
        proc.stdout = new EventEmitter();
        proc.stderr = new EventEmitter();

        setImmediate(() => {
          proc.emit('error', new Error('spawn failed'));
        });

        return proc as ReturnType<typeof spawn>;
      });

      const result = await runGates({ cwd: '/test/repo', gates: ['format'] });

      expect(result.passed).toBe(false);
      expect(result.results[0]?.exitCode).toBe(1);
      expect(result.results[0]?.stderr).toBe('spawn failed');
    });
  });
});
