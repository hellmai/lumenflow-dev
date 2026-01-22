/**
 * Tests for wu-create-validators.ts
 *
 * WU-1062: Tests spec_refs validation including external paths
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock os.homedir before importing
vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os');
  return {
    ...actual,
    homedir: vi.fn(() => '/home/testuser'),
  };
});

import {
  validateSpecRefs,
  hasExternalSpecRefs,
  normalizeSpecRefs,
} from '../wu-create-validators.js';

describe('wu-create-validators', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.LUMENFLOW_HOME;
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.clearAllMocks();
  });

  describe('validateSpecRefs', () => {
    it('should accept empty array', () => {
      const result = validateSpecRefs([]);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should accept repo-relative paths', () => {
      const result = validateSpecRefs(['docs/04-operations/plans/WU-1062-plan.md']);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should accept lumenflow:// protocol', () => {
      const result = validateSpecRefs(['lumenflow://plans/WU-1062-plan.md']);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain('External spec_ref');
    });

    it('should accept tilde paths', () => {
      const result = validateSpecRefs(['~/.lumenflow/plans/WU-1062-plan.md']);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(1);
    });

    it('should accept $LUMENFLOW_HOME paths', () => {
      const result = validateSpecRefs(['$LUMENFLOW_HOME/plans/WU-1062-plan.md']);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(1);
    });

    it('should reject empty spec_ref', () => {
      const result = validateSpecRefs(['', 'docs/plans/plan.md']);
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Empty');
    });

    it('should warn about unconventional paths', () => {
      const result = validateSpecRefs(['random/path/without/convention']);
      expect(result.valid).toBe(true);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain('Unconventional');
    });
  });

  describe('hasExternalSpecRefs', () => {
    it('should return false for empty array', () => {
      expect(hasExternalSpecRefs([])).toBe(false);
    });

    it('should return false for repo-relative paths only', () => {
      expect(hasExternalSpecRefs(['docs/plans/plan.md'])).toBe(false);
    });

    it('should return true for lumenflow:// path', () => {
      expect(hasExternalSpecRefs(['lumenflow://plans/plan.md'])).toBe(true);
    });

    it('should return true for tilde path', () => {
      expect(hasExternalSpecRefs(['~/.lumenflow/plans/plan.md'])).toBe(true);
    });

    it('should return true for mixed paths with external', () => {
      expect(
        hasExternalSpecRefs(['docs/plans/plan.md', 'lumenflow://plans/external.md']),
      ).toBe(true);
    });
  });

  describe('normalizeSpecRefs', () => {
    it('should return empty array for empty input', () => {
      expect(normalizeSpecRefs([])).toEqual([]);
    });

    it('should keep repo-relative paths unchanged', () => {
      const refs = ['docs/plans/plan.md'];
      expect(normalizeSpecRefs(refs)).toEqual(['docs/plans/plan.md']);
    });

    it('should expand lumenflow:// to LUMENFLOW_HOME', () => {
      process.env.LUMENFLOW_HOME = '/custom/lumenflow';
      const refs = ['lumenflow://plans/plan.md'];
      const result = normalizeSpecRefs(refs);
      expect(result[0]).toBe('/custom/lumenflow/plans/plan.md');
    });

    it('should expand tilde paths', () => {
      const refs = ['~/.lumenflow/plans/plan.md'];
      const result = normalizeSpecRefs(refs);
      expect(result[0]).toBe('/home/testuser/.lumenflow/plans/plan.md');
    });
  });
});
