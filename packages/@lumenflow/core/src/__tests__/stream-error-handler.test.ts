/**
 * Unit tests for StreamErrorHandler
 *
 * WU-1233: EPIPE protection for CLI commands
 *
 * Tests cover:
 * - EPIPE errors on stdout are caught and exit gracefully
 * - EPIPE errors on stderr are caught and exit gracefully
 * - Handler uses constants (no hardcoded strings)
 * - Dependency injection pattern for testability
 * - Non-EPIPE errors are not caught (let them bubble)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { WriteStream } from 'node:tty';
import { STREAM_ERRORS, EXIT_CODES } from '../wu-constants.js';
import { StreamErrorHandler, type StreamErrorHandlerDeps } from '../stream-error-handler.js';

/**
 * Mock WriteStream that can emit errors
 */
function createMockStream(): WriteStream & EventEmitter {
  const emitter = new EventEmitter();
  return emitter as WriteStream & EventEmitter;
}

/**
 * Standard EPIPE error message (used in test assertions)
 */
const EPIPE_ERROR_MESSAGE = 'write EPIPE';

/**
 * Create a mock EPIPE error with proper code property
 */
function createEpipeError(): Error & { code: string } {
  return Object.assign(new Error(EPIPE_ERROR_MESSAGE), {
    code: STREAM_ERRORS.EPIPE,
  });
}

describe('StreamErrorHandler', () => {
  let mockStdout: WriteStream & EventEmitter;
  let mockStderr: WriteStream & EventEmitter;
  let mockExitFn: ReturnType<typeof vi.fn>;
  let handler: StreamErrorHandler;
  let deps: StreamErrorHandlerDeps;

  beforeEach(() => {
    mockStdout = createMockStream();
    mockStderr = createMockStream();
    mockExitFn = vi.fn();

    deps = {
      stdout: mockStdout,
      stderr: mockStderr,
      exitFn: mockExitFn,
    };

    handler = new StreamErrorHandler(deps);
  });

  afterEach(() => {
    // Clean up any listeners
    handler.detach();
  });

  describe('STREAM_ERRORS constant', () => {
    it('should export EPIPE constant from wu-constants', () => {
      expect(STREAM_ERRORS).toBeDefined();
      expect(STREAM_ERRORS.EPIPE).toBe('EPIPE');
    });
  });

  describe('attach()', () => {
    it('should attach error listeners to stdout and stderr', () => {
      handler.attach();

      expect(mockStdout.listenerCount('error')).toBe(1);
      expect(mockStderr.listenerCount('error')).toBe(1);
    });

    it('should not attach multiple times on repeated calls', () => {
      handler.attach();
      handler.attach();

      expect(mockStdout.listenerCount('error')).toBe(1);
      expect(mockStderr.listenerCount('error')).toBe(1);
    });
  });

  describe('detach()', () => {
    it('should remove error listeners from stdout and stderr', () => {
      handler.attach();
      handler.detach();

      expect(mockStdout.listenerCount('error')).toBe(0);
      expect(mockStderr.listenerCount('error')).toBe(0);
    });

    it('should be safe to call detach without attach', () => {
      expect(() => handler.detach()).not.toThrow();
    });
  });

  describe('EPIPE handling on stdout', () => {
    it('should catch EPIPE error and exit with code 0', () => {
      handler.attach();
      mockStdout.emit('error', createEpipeError());
      expect(mockExitFn).toHaveBeenCalledWith(EXIT_CODES.SUCCESS);
    });

    it('should exit silently (no logging) on EPIPE', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      handler.attach();
      mockStdout.emit('error', createEpipeError());
      expect(consoleSpy).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('EPIPE handling on stderr', () => {
    it('should catch EPIPE error and exit with code 0', () => {
      handler.attach();
      mockStderr.emit('error', createEpipeError());
      expect(mockExitFn).toHaveBeenCalledWith(EXIT_CODES.SUCCESS);
    });
  });

  describe('Non-EPIPE error handling', () => {
    it('should not catch non-EPIPE errors on stdout', () => {
      handler.attach();

      const otherError = Object.assign(new Error('other error'), {
        code: 'ENOENT',
      });

      // Non-EPIPE errors should propagate (not call exit)
      expect(() => mockStdout.emit('error', otherError)).not.toThrow();
      expect(mockExitFn).not.toHaveBeenCalled();
    });

    it('should not catch errors without code property', () => {
      handler.attach();

      const errorWithoutCode = new Error('generic error');

      expect(() => mockStdout.emit('error', errorWithoutCode)).not.toThrow();
      expect(mockExitFn).not.toHaveBeenCalled();
    });
  });

  describe('Dependency Injection', () => {
    it('should use injected exit function', () => {
      const customExit = vi.fn();
      const customHandler = new StreamErrorHandler({
        stdout: mockStdout,
        stderr: mockStderr,
        exitFn: customExit,
      });

      customHandler.attach();
      mockStdout.emit('error', createEpipeError());
      expect(customExit).toHaveBeenCalledWith(EXIT_CODES.SUCCESS);
      customHandler.detach();
    });

    it('should accept partial deps with defaults', () => {
      // This tests that we can create a handler with just the streams
      // and use a default exit function
      expect(() => {
        const handlerWithDefaults = StreamErrorHandler.createWithDefaults();
        handlerWithDefaults.attach();
        handlerWithDefaults.detach();
      }).not.toThrow();
    });
  });
});
