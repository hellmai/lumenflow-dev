/**
 * ErrorHandler tests (WU-2537)
 */

import { describe, it, expect } from 'vitest';
import { ErrorHandler } from '../../src/utils/error-handler.js';

describe('ErrorHandler', () => {
  describe('wrap', () => {
    it('returns success result on resolved promise', async () => {
      const result = await ErrorHandler.wrap(async () => 42);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value).toBe(42);
      }
    });

    it('returns failure result on rejected promise', async () => {
      const result = await ErrorHandler.wrap(async () => {
        throw new Error('test error');
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toBe('test error');
      }
    });

    it('converts non-Error throws to Error', async () => {
      const result = await ErrorHandler.wrap(async () => {
        throw 'string error';
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBeInstanceOf(Error);
        expect(result.error.message).toBe('string error');
      }
    });
  });

  describe('wrapSync', () => {
    it('returns success result on normal return', () => {
      const result = ErrorHandler.wrapSync(() => 'hello');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value).toBe('hello');
      }
    });

    it('returns failure result on throw', () => {
      const result = ErrorHandler.wrapSync(() => {
        throw new Error('sync error');
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toBe('sync error');
      }
    });
  });

  describe('classify', () => {
    it('classifies network errors as retryable', () => {
      const classified = ErrorHandler.classify(new Error('ECONNRESET'));
      expect(classified.retryable).toBe(true);
      expect(classified.category).toBe('network');
    });

    it('classifies timeout errors as retryable', () => {
      const classified = ErrorHandler.classify(new Error('Connection timeout'));
      expect(classified.retryable).toBe(true);
      expect(classified.category).toBe('network');
    });

    it('classifies rate limit errors as retryable', () => {
      const classified = ErrorHandler.classify(new Error('429 Too Many Requests'));
      expect(classified.retryable).toBe(true);
      expect(classified.category).toBe('network');
    });

    it('classifies 503 errors as retryable', () => {
      const classified = ErrorHandler.classify(new Error('503 Service Unavailable'));
      expect(classified.retryable).toBe(true);
      expect(classified.category).toBe('network');
    });

    it('classifies validation errors as non-retryable', () => {
      const classified = ErrorHandler.classify(new Error('Invalid input'));
      expect(classified.retryable).toBe(false);
      expect(classified.category).toBe('validation');
    });

    it('classifies system errors', () => {
      const classified = ErrorHandler.classify(new Error('ENOENT: file not found'));
      expect(classified.category).toBe('system');
    });

    it('classifies permission errors as system', () => {
      const classified = ErrorHandler.classify(new Error('Permission denied'));
      expect(classified.category).toBe('system');
    });

    it('classifies unknown errors', () => {
      const classified = ErrorHandler.classify(new Error('Something went wrong'));
      expect(classified.retryable).toBe(false);
      expect(classified.category).toBe('unknown');
    });
  });
});
