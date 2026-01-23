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
  isRepoInternalPath,
  buildRepoInternalPathError,
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

    // WU-1069: Reject repo-internal plan paths
    describe('repo-internal path rejection (WU-1069)', () => {
      it('should reject paths starting with ./', () => {
        const result = validateSpecRefs(['./plans/WU-1069-plan.md']);
        expect(result.valid).toBe(false);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]).toContain('repo-internal');
      });

      it('should reject paths starting with .lumenflow/', () => {
        const result = validateSpecRefs(['.lumenflow/plans/WU-1069-plan.md']);
        expect(result.valid).toBe(false);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]).toContain('repo-internal');
      });

      it('should reject paths starting with ./docs/', () => {
        const result = validateSpecRefs(['./docs/plans/plan.md']);
        expect(result.valid).toBe(false);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]).toContain('repo-internal');
      });

      it('should still accept docs/ paths (without ./)', () => {
        const result = validateSpecRefs(['docs/04-operations/plans/WU-1069-plan.md']);
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });

      it('should include correct path format examples in error message', () => {
        const result = validateSpecRefs(['./plans/plan.md']);
        expect(result.valid).toBe(false);
        expect(result.errors[0]).toContain('lumenflow://');
        expect(result.errors[0]).toContain('~/.lumenflow/plans/');
      });

      it('should reject multiple repo-internal paths', () => {
        const result = validateSpecRefs(['./plans/plan1.md', '.lumenflow/plans/plan2.md']);
        expect(result.valid).toBe(false);
        expect(result.errors).toHaveLength(2);
      });

      it('should reject repo-internal paths mixed with valid external paths', () => {
        const result = validateSpecRefs([
          'lumenflow://plans/valid.md', // valid
          './plans/invalid.md', // invalid
        ]);
        expect(result.valid).toBe(false);
        expect(result.errors).toHaveLength(1);
        expect(result.warnings).toHaveLength(1); // External path warning
      });
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
      expect(hasExternalSpecRefs(['docs/plans/plan.md', 'lumenflow://plans/external.md'])).toBe(
        true,
      );
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

  // WU-1069: Tests for helper functions
  describe('isRepoInternalPath (WU-1069)', () => {
    it('should return true for paths starting with ./', () => {
      expect(isRepoInternalPath('./plans/plan.md')).toBe(true);
      expect(isRepoInternalPath('./docs/plan.md')).toBe(true);
    });

    it('should return true for paths starting with .lumenflow/', () => {
      expect(isRepoInternalPath('.lumenflow/plans/plan.md')).toBe(true);
      expect(isRepoInternalPath('.lumenflow/config.yaml')).toBe(true);
    });

    it('should return false for docs/ paths without ./', () => {
      expect(isRepoInternalPath('docs/plans/plan.md')).toBe(false);
    });

    it('should return false for external paths', () => {
      expect(isRepoInternalPath('lumenflow://plans/plan.md')).toBe(false);
      expect(isRepoInternalPath('~/.lumenflow/plans/plan.md')).toBe(false);
      expect(isRepoInternalPath('$LUMENFLOW_HOME/plans/plan.md')).toBe(false);
    });
  });

  describe('buildRepoInternalPathError (WU-1069)', () => {
    it('should include the rejected path in error', () => {
      const error = buildRepoInternalPathError('./plans/plan.md');
      expect(error).toContain('./plans/plan.md');
    });

    it('should include repo-internal in error', () => {
      const error = buildRepoInternalPathError('./plans/plan.md');
      expect(error).toContain('repo-internal');
    });

    it('should include lumenflow:// example in error', () => {
      const error = buildRepoInternalPathError('./plans/plan.md');
      expect(error).toContain('lumenflow://');
    });

    it('should include ~/.lumenflow/plans/ example in error', () => {
      const error = buildRepoInternalPathError('./plans/plan.md');
      expect(error).toContain('~/.lumenflow/plans/');
    });

    it('should include $LUMENFLOW_HOME example in error', () => {
      const error = buildRepoInternalPathError('./plans/plan.md');
      expect(error).toContain('$LUMENFLOW_HOME');
    });

    it('should mention --plan flag as alternative', () => {
      const error = buildRepoInternalPathError('./plans/plan.md');
      expect(error).toContain('--plan');
    });
  });
});
