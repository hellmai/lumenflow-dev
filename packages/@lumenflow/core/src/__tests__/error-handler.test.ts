/**
 * Tests for error-handler module
 *
 * WU-1104: Port tests from ExampleApp to Vitest
 *
 * Tests structured error handling with error codes.
 * @see {@link ../error-handler.ts}
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  WUError,
  ProcessExitError,
  die,
  createError,
  createAgentFriendlyError,
  toError,
  getErrorMessage,
  ErrorCodes,
} from '../error-handler.js';

describe('error-handler', () => {
  describe('WUError class', () => {
    it('should create error with code and message', () => {
      const error = new WUError('WU_NOT_FOUND', 'WU-123 not found');

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(WUError);
      expect(error.name).toBe('WUError');
      expect(error.code).toBe('WU_NOT_FOUND');
      expect(error.message).toBe('WU-123 not found');
    });

    it('should create error with details', () => {
      const details = { id: 'WU-123', lane: 'Framework: Core' };
      const error = new WUError('WU_NOT_FOUND', 'WU-123 not found', details);

      expect(error.details).toEqual(details);
    });

    it('should default details to empty object', () => {
      const error = new WUError('TEST_ERROR', 'Test message');

      expect(error.details).toEqual({});
    });

    it('should maintain proper stack trace', () => {
      const error = new WUError('TEST_ERROR', 'Test message');

      expect(error.stack).toBeDefined();
      expect(error.stack).toContain('WUError');
    });

    it('should be throwable and catchable', () => {
      const throwError = () => {
        throw new WUError('TEST_ERROR', 'Test throw');
      };

      expect(throwError).toThrow(WUError);
      expect(throwError).toThrow('Test throw');
    });
  });

  describe('createError factory', () => {
    it('should create WUError instance', () => {
      const error = createError('WU_NOT_FOUND', 'WU-123 not found');

      expect(error).toBeInstanceOf(WUError);
      expect(error.code).toBe('WU_NOT_FOUND');
      expect(error.message).toBe('WU-123 not found');
    });

    it('should create error with details', () => {
      const details = { id: 'WU-123' };
      const error = createError('WU_NOT_FOUND', 'WU-123 not found', details);

      expect(error.details).toEqual(details);
    });

    it('should create throwable errors', () => {
      const error = createError('VALIDATION_ERROR', 'Invalid input');

      expect(() => {
        throw error;
      }).toThrow('Invalid input');
    });
  });

  describe('createAgentFriendlyError', () => {
    it('should create error with tryNext suggestions', () => {
      const error = createAgentFriendlyError(ErrorCodes.WU_NOT_FOUND, 'WU-1234 not found', {
        tryNext: ['pnpm wu:create --id WU-1234 --lane "<lane>" --title "..."'],
        context: { wuId: 'WU-1234' },
      });

      expect(error.tryNext).toEqual(['pnpm wu:create --id WU-1234 --lane "<lane>" --title "..."']);
    });

    it('should expose context property', () => {
      const error = createAgentFriendlyError(ErrorCodes.WU_NOT_FOUND, 'WU-1234 not found', {
        context: { wuId: 'WU-1234', lane: 'Operations' },
      });

      expect(error.context).toEqual({ wuId: 'WU-1234', lane: 'Operations' });
      expect(error.details).toEqual({ wuId: 'WU-1234', lane: 'Operations' });
    });

    it('should not set tryNext if not provided', () => {
      const error = createAgentFriendlyError(ErrorCodes.WU_NOT_FOUND, 'WU-1234 not found');

      expect(error.tryNext).toBeUndefined();
    });

    it('should not set tryNext if empty array', () => {
      const error = createAgentFriendlyError(ErrorCodes.WU_NOT_FOUND, 'WU-1234 not found', {
        tryNext: [],
      });

      expect(error.tryNext).toBeUndefined();
    });

    it('should handle multiple tryNext suggestions', () => {
      const error = createAgentFriendlyError(ErrorCodes.VALIDATION_ERROR, 'Invalid state', {
        tryNext: ['pnpm wu:status --id WU-123', 'pnpm wu:recover --id WU-123'],
      });

      expect(error.tryNext).toHaveLength(2);
    });
  });

  describe('WU-1574 strict-mode helpers', () => {
    it('toError returns the original Error instance', () => {
      const original = new Error('boom');
      const normalized = toError(original);
      expect(normalized).toBe(original);
    });

    it('toError normalizes unknown values into Error', () => {
      const normalized = toError({ code: 500 });
      expect(normalized).toBeInstanceOf(Error);
      expect(normalized.message).toBe('Unknown error');
    });

    it('getErrorMessage extracts message from unknown values', () => {
      expect(getErrorMessage('fatal')).toBe('fatal');
      expect(getErrorMessage({ message: 'bad input' })).toBe('bad input');
    });

    it('getErrorMessage supports custom fallback message', () => {
      expect(getErrorMessage(undefined, 'fallback')).toBe('fallback');
    });
  });

  describe('ErrorCodes', () => {
    it('should have WU-related error codes', () => {
      expect(ErrorCodes.WU_NOT_FOUND).toBe('WU_NOT_FOUND');
      expect(ErrorCodes.WU_ALREADY_CLAIMED).toBe('WU_ALREADY_CLAIMED');
      expect(ErrorCodes.WU_NOT_CLAIMED).toBe('WU_NOT_CLAIMED');
      expect(ErrorCodes.INVALID_WU_ID).toBe('INVALID_WU_ID');
    });

    it('should have validation error codes', () => {
      expect(ErrorCodes.VALIDATION_ERROR).toBe('VALIDATION_ERROR');
      expect(ErrorCodes.INVALID_LANE).toBe('INVALID_LANE');
    });

    it('should have file/yaml error codes', () => {
      expect(ErrorCodes.FILE_NOT_FOUND).toBe('FILE_NOT_FOUND');
      expect(ErrorCodes.YAML_PARSE_ERROR).toBe('YAML_PARSE_ERROR');
      expect(ErrorCodes.PARSE_ERROR).toBe('PARSE_ERROR');
    });

    it('should have git/worktree error codes', () => {
      expect(ErrorCodes.GIT_ERROR).toBe('GIT_ERROR');
      expect(ErrorCodes.WORKTREE_ERROR).toBe('WORKTREE_ERROR');
      expect(ErrorCodes.BRANCH_ERROR).toBe('BRANCH_ERROR');
    });

    it('should have gates error codes', () => {
      expect(ErrorCodes.GATES_FAILED).toBe('GATES_FAILED');
    });

    it('should have transaction error codes', () => {
      expect(ErrorCodes.TRANSACTION_ERROR).toBe('TRANSACTION_ERROR');
      expect(ErrorCodes.LOCK_ERROR).toBe('LOCK_ERROR');
    });

    it('should have initiative error codes', () => {
      expect(ErrorCodes.INIT_NOT_FOUND).toBe('INIT_NOT_FOUND');
      expect(ErrorCodes.INIT_ALREADY_EXISTS).toBe('INIT_ALREADY_EXISTS');
      expect(ErrorCodes.INVALID_INIT_ID).toBe('INVALID_INIT_ID');
      expect(ErrorCodes.INVALID_SLUG).toBe('INVALID_SLUG');
      expect(ErrorCodes.INVALID_PHASE).toBe('INVALID_PHASE');
      expect(ErrorCodes.DEPENDENCY_CYCLE).toBe('DEPENDENCY_CYCLE');
    });

    it('should have state/section error codes', () => {
      expect(ErrorCodes.STATE_ERROR).toBe('STATE_ERROR');
      expect(ErrorCodes.SECTION_NOT_FOUND).toBe('SECTION_NOT_FOUND');
      expect(ErrorCodes.INTERNAL_ERROR).toBe('INTERNAL_ERROR');
      expect(ErrorCodes.RECOVERY_ERROR).toBe('RECOVERY_ERROR');
    });
  });

  describe('die function', () => {
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

    it('should log error message with script name', () => {
      process.argv = ['node', 'tools/wu-claim.js', '--id', 'WU-123'];

      try {
        die('WU file not found');
      } catch {
        // Expected ProcessExitError
      }

      expect(errorSpy).toHaveBeenCalledWith('[wu-claim] WU file not found');
    });

    it('should throw ProcessExitError with code 1 by default', () => {
      process.argv = ['node', 'tools/test.js'];

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

    it('should handle missing script path', () => {
      process.argv = [];

      try {
        die('Error message');
      } catch {
        // Expected ProcessExitError
      }

      expect(errorSpy).toHaveBeenCalledWith('[unknown] Error message');
    });

    it('should extract basename from full path', () => {
      process.argv = ['node', 'project/tools/wu-done.js'];

      try {
        die('Something went wrong');
      } catch {
        // Expected ProcessExitError
      }

      expect(errorSpy).toHaveBeenCalledWith('[wu-done] Something went wrong');
    });

    it('should NOT call process.exit directly (WU-1538)', () => {
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
  });
});
