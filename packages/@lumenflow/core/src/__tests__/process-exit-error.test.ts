/**
 * Tests for ProcessExitError typed error class
 *
 * WU-1538: Refactor core exit handling to throw typed errors
 *
 * Validates that:
 * - ProcessExitError carries exit code and message
 * - die() throws ProcessExitError instead of calling process.exit
 * - ErrorCodes includes PROCESS_EXIT
 * - ProcessExitError preserves existing error messages from die()
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ProcessExitError, die, ErrorCodes } from '../error-handler.js';

describe('ProcessExitError (WU-1538)', () => {
  describe('class', () => {
    it('should extend Error', () => {
      const error = new ProcessExitError('Something failed', 1);
      expect(error).toBeInstanceOf(Error);
    });

    it('should have name ProcessExitError', () => {
      const error = new ProcessExitError('fail', 1);
      expect(error.name).toBe('ProcessExitError');
    });

    it('should carry exitCode property', () => {
      const error = new ProcessExitError('Gates failed', 2);
      expect(error.exitCode).toBe(2);
    });

    it('should carry message property', () => {
      const error = new ProcessExitError('WU not found', 1);
      expect(error.message).toBe('WU not found');
    });

    it('should default exitCode to 1', () => {
      const error = new ProcessExitError('Something failed');
      expect(error.exitCode).toBe(1);
    });

    it('should support exit code 0 for successful exits', () => {
      const error = new ProcessExitError('Help displayed', 0);
      expect(error.exitCode).toBe(0);
    });

    it('should maintain proper stack trace', () => {
      const error = new ProcessExitError('test', 1);
      expect(error.stack).toBeDefined();
      expect(error.stack).toContain('ProcessExitError');
    });

    it('should be catchable by type', () => {
      const fn = () => {
        throw new ProcessExitError('test error', 1);
      };
      expect(fn).toThrow(ProcessExitError);
    });
  });

  describe('ErrorCodes.PROCESS_EXIT', () => {
    it('should have PROCESS_EXIT error code', () => {
      expect(ErrorCodes.PROCESS_EXIT).toBe('PROCESS_EXIT');
    });
  });

  describe('die() throws ProcessExitError instead of process.exit', () => {
    let originalArgv: string[];
    let errorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      originalArgv = [...process.argv];
      errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
      process.argv = originalArgv;
      errorSpy.mockRestore();
    });

    it('should throw ProcessExitError with exit code 1 by default', () => {
      process.argv = ['node', 'tools/test.js'];

      expect(() => die('Error message')).toThrow(ProcessExitError);

      try {
        die('Error message');
      } catch (err) {
        expect(err).toBeInstanceOf(ProcessExitError);
        expect((err as ProcessExitError).exitCode).toBe(1);
      }
    });

    it('should throw ProcessExitError with custom exit code', () => {
      process.argv = ['node', 'tools/test.js'];

      try {
        die('Gates failed', 2);
      } catch (err) {
        expect(err).toBeInstanceOf(ProcessExitError);
        expect((err as ProcessExitError).exitCode).toBe(2);
      }
    });

    it('should NOT call process.exit directly', () => {
      process.argv = ['node', 'tools/test.js'];
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

      try {
        die('Error message');
      } catch {
        // Expected ProcessExitError
      }

      expect(exitSpy).not.toHaveBeenCalled();
      exitSpy.mockRestore();
    });

    it('should preserve the formatted error message with script name', () => {
      process.argv = ['node', 'tools/wu-claim.js'];

      try {
        die('WU file not found');
      } catch (err) {
        expect((err as ProcessExitError).message).toContain('WU file not found');
      }
    });

    it('should still log to console.error for backward compatibility', () => {
      process.argv = ['node', 'tools/wu-claim.js'];

      try {
        die('WU file not found');
      } catch {
        // Expected
      }

      expect(errorSpy).toHaveBeenCalledWith('[wu-claim] WU file not found');
    });
  });
});
