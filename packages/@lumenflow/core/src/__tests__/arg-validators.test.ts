/**
 * @file arg-validators.test.ts
 * @description Tests for CLI arg validation using shared schemas (WU-1431)
 *
 * These tests verify that CLI commands validate inputs using shared schemas.
 */

import { describe, it, expect } from 'vitest';

// Import the schema-based argument validators
import {
  validateWuCreateArgs,
  validateWuClaimArgs,
  validateWuStatusArgs,
  validateWuDoneArgs,
  validateGatesArgs,
} from '../schemas/arg-validators.js';

describe('CLI Argument Validation (WU-1431)', () => {
  describe('validateWuCreateArgs', () => {
    it('should reject missing required fields', () => {
      const result = validateWuCreateArgs({});
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('lane is required');
      expect(result.errors).toContain('title is required');
    });

    it('should accept valid args', () => {
      const result = validateWuCreateArgs({
        lane: 'Framework: Core',
        title: 'Test WU',
      });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should validate exposure enum', () => {
      const result = validateWuCreateArgs({
        lane: 'Framework: Core',
        title: 'Test WU',
        exposure: 'invalid-exposure',
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('exposure'))).toBe(true);
    });

    it('should accept CLI alias codePath and map to code_paths', () => {
      const result = validateWuCreateArgs({
        lane: 'Framework: Core',
        title: 'Test WU',
        codePath: ['src/file.ts'],
      });
      expect(result.valid).toBe(true);
      expect(result.normalized.code_paths).toEqual(['src/file.ts']);
    });

    it('should accept CLI alias manualTest and map to test_paths_manual', () => {
      const result = validateWuCreateArgs({
        lane: 'Framework: Core',
        title: 'Test WU',
        manualTest: ['Verify feature works'],
      });
      expect(result.valid).toBe(true);
      expect(result.normalized.test_paths_manual).toEqual(['Verify feature works']);
    });
  });

  describe('validateWuClaimArgs', () => {
    it('should reject missing required fields', () => {
      const result = validateWuClaimArgs({});
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('id is required');
      expect(result.errors).toContain('lane is required');
    });

    it('should accept valid args', () => {
      const result = validateWuClaimArgs({
        id: 'WU-1234',
        lane: 'Framework: Core',
      });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('validateWuStatusArgs', () => {
    it('should accept empty args (no required fields)', () => {
      const result = validateWuStatusArgs({});
      expect(result.valid).toBe(true);
    });

    it('should accept id', () => {
      const result = validateWuStatusArgs({ id: 'WU-1234' });
      expect(result.valid).toBe(true);
    });
  });

  describe('validateWuDoneArgs', () => {
    it('should reject missing id', () => {
      const result = validateWuDoneArgs({});
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('id is required');
    });

    it('should accept valid args', () => {
      const result = validateWuDoneArgs({ id: 'WU-1234' });
      expect(result.valid).toBe(true);
    });

    it('should validate skip_gates requires reason', () => {
      const result = validateWuDoneArgs({
        id: 'WU-1234',
        skip_gates: true,
      });
      // When skip_gates is true, reason should be required
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('reason'))).toBe(true);
    });
  });

  describe('validateGatesArgs', () => {
    it('should accept empty args', () => {
      const result = validateGatesArgs({});
      expect(result.valid).toBe(true);
    });

    it('should accept docs_only', () => {
      const result = validateGatesArgs({ docs_only: true });
      expect(result.valid).toBe(true);
    });
  });
});
