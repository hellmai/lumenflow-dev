/**
 * ScopeChecker tests (WU-2537)
 * Ported from PatientPath tools/lib/scope-checker.mjs
 *
 * Tests for file scope validation utility.
 */

import { describe, it, expect } from 'vitest';
import { ScopeChecker } from '../../src/lib/scope-checker.js';

describe('ScopeChecker', () => {
  describe('isInScope', () => {
    it('returns true for exact path match', () => {
      const checker = new ScopeChecker(['src/lib/']);
      expect(checker.isInScope('src/lib/foo.ts')).toBe(true);
    });

    it('returns false for path outside scope', () => {
      const checker = new ScopeChecker(['src/lib/']);
      expect(checker.isInScope('src/other/foo.ts')).toBe(false);
    });

    it('supports glob patterns', () => {
      const checker = new ScopeChecker(['src/**/*.ts']);
      expect(checker.isInScope('src/deep/nested/file.ts')).toBe(true);
      expect(checker.isInScope('src/file.ts')).toBe(true);
      expect(checker.isInScope('src/file.js')).toBe(false);
    });

    it('handles multiple code paths', () => {
      const checker = new ScopeChecker(['src/lib/', 'src/utils/']);
      expect(checker.isInScope('src/lib/foo.ts')).toBe(true);
      expect(checker.isInScope('src/utils/bar.ts')).toBe(true);
      expect(checker.isInScope('src/other/baz.ts')).toBe(false);
    });
  });

  describe('filterInScope', () => {
    it('filters array to only in-scope files', () => {
      const checker = new ScopeChecker(['src/lib/']);
      const files = ['src/lib/a.ts', 'src/other/b.ts', 'src/lib/c.ts'];
      expect(checker.filterInScope(files)).toEqual(['src/lib/a.ts', 'src/lib/c.ts']);
    });

    it('returns empty array when no files in scope', () => {
      const checker = new ScopeChecker(['src/lib/']);
      const files = ['src/other/a.ts', 'src/other/b.ts'];
      expect(checker.filterInScope(files)).toEqual([]);
    });
  });

  describe('assertInScope', () => {
    it('does not throw for in-scope file', () => {
      const checker = new ScopeChecker(['src/lib/']);
      expect(() => checker.assertInScope('src/lib/foo.ts')).not.toThrow();
    });

    it('throws for out-of-scope file', () => {
      const checker = new ScopeChecker(['src/lib/']);
      expect(() => checker.assertInScope('src/other/foo.ts')).toThrow(
        'File src/other/foo.ts is out of scope'
      );
    });
  });
});
