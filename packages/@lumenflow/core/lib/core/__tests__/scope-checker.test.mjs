/**
 * @file scope-checker.test.mjs
 * @description Tests for scope-checker.mjs (WU-1397)
 *
 * Tests scope validation for WU code_paths enforcement.
 * Ensures agents can only modify files within their WU scope.
 */

import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { isPathInScope, assertPathInScope, getActiveScope } from '../scope-checker.mjs';

describe('scope-checker', () => {
  describe('getActiveScope', () => {
    it('should return null when no WU context available', async () => {
      const mockGetWUContext = mock.fn(() => null);
      const mockLoadWUYaml = mock.fn();

      const scope = await getActiveScope({
        getWUContext: mockGetWUContext,
        loadWUYaml: mockLoadWUYaml,
      });

      assert.equal(scope, null);
      assert.strictEqual(mockGetWUContext.mock.calls.length, 1);
      assert.strictEqual(mockLoadWUYaml.mock.calls.length, 0);
    });

    it('should return code_paths from WU YAML when context available', async () => {
      const mockGetWUContext = mock.fn(() => ({
        wuId: 'WU-1397',
        lane: 'operations-tooling',
        worktreePath: 'worktrees/operations-tooling-wu-1397',
      }));
      const mockLoadWUYaml = mock.fn(() => ({
        id: 'WU-1397',
        code_paths: ['tools/lib/core/scope-checker.mjs', 'tools/lib/core/__tests__/*.mjs'],
      }));

      const scope = await getActiveScope({
        getWUContext: mockGetWUContext,
        loadWUYaml: mockLoadWUYaml,
      });

      assert.deepEqual(scope, {
        wuId: 'WU-1397',
        code_paths: ['tools/lib/core/scope-checker.mjs', 'tools/lib/core/__tests__/*.mjs'],
      });
      assert.strictEqual(mockGetWUContext.mock.calls.length, 1);
      assert.strictEqual(mockLoadWUYaml.mock.calls.length, 1);
      assert.strictEqual(mockLoadWUYaml.mock.calls[0].arguments[0], 'WU-1397');
    });

    it('should handle empty code_paths', async () => {
      const mockGetWUContext = mock.fn(() => ({
        wuId: 'WU-999',
        lane: 'operations',
      }));
      const mockLoadWUYaml = mock.fn(() => ({
        id: 'WU-999',
        code_paths: [],
      }));

      const scope = await getActiveScope({
        getWUContext: mockGetWUContext,
        loadWUYaml: mockLoadWUYaml,
      });

      assert.deepEqual(scope, {
        wuId: 'WU-999',
        code_paths: [],
      });
    });
  });

  describe('isPathInScope', () => {
    it('should return true for exact path match', () => {
      const scope = {
        wuId: 'WU-1397',
        code_paths: ['tools/lib/core/scope-checker.mjs', 'tools/lib/wu-schema.mjs'],
      };

      assert.strictEqual(isPathInScope('tools/lib/core/scope-checker.mjs', scope), true);
      assert.strictEqual(isPathInScope('tools/lib/wu-schema.mjs', scope), true);
    });

    it('should return false for path not in scope', () => {
      const scope = {
        wuId: 'WU-1397',
        code_paths: ['tools/lib/core/scope-checker.mjs'],
      };

      assert.strictEqual(isPathInScope('apps/web/src/components/Header.tsx', scope), false);
      assert.strictEqual(isPathInScope('tools/wu-done.mjs', scope), false);
    });

    it('should handle glob patterns correctly', () => {
      const scope = {
        wuId: 'WU-1397',
        code_paths: ['tools/lib/core/**/*.mjs', 'apps/web/src/**/*.tsx'],
      };

      // Should match glob patterns
      assert.strictEqual(isPathInScope('tools/lib/core/scope-checker.mjs', scope), true);
      assert.strictEqual(
        isPathInScope('tools/lib/core/__tests__/scope-checker.test.mjs', scope),
        true
      );
      assert.strictEqual(isPathInScope('apps/web/src/components/Header.tsx', scope), true);
      assert.strictEqual(
        isPathInScope('apps/web/src/lib/utils/validators.tsx', scope),
        true
      );

      // Should not match outside glob scope
      assert.strictEqual(isPathInScope('tools/wu-done.mjs', scope), false);
      assert.strictEqual(isPathInScope('apps/web/README.md', scope), false);
    });

    it('should handle wildcard patterns', () => {
      const scope = {
        wuId: 'WU-999',
        code_paths: ['tools/lib/*.mjs'],
      };

      assert.strictEqual(isPathInScope('tools/lib/wu-schema.mjs', scope), true);
      assert.strictEqual(isPathInScope('tools/lib/wu-constants.mjs', scope), true);

      // Should not match nested paths
      assert.strictEqual(isPathInScope('tools/lib/core/scope-checker.mjs', scope), false);
    });

    it('should return true for empty code_paths (no restrictions)', () => {
      const scope = {
        wuId: 'WU-999',
        code_paths: [],
      };

      // Empty code_paths = no restrictions (documentation WU)
      assert.strictEqual(isPathInScope('any/path/here.ts', scope), true);
      assert.strictEqual(isPathInScope('apps/web/src/components/Header.tsx', scope), true);
    });

    it('should handle null scope (no active WU)', () => {
      assert.strictEqual(isPathInScope('any/path/here.ts', null), false);
    });

    it('should normalize path separators', () => {
      const scope = {
        wuId: 'WU-1397',
        code_paths: ['tools/lib/core/scope-checker.mjs'],
      };

      // Windows-style path should match Unix-style pattern
      assert.strictEqual(isPathInScope('tools\\lib\\core\\scope-checker.mjs', scope), true);
    });
  });

  describe('assertPathInScope', () => {
    it('should not throw for path in scope', () => {
      const scope = {
        wuId: 'WU-1397',
        code_paths: ['tools/lib/core/scope-checker.mjs'],
      };

      assert.doesNotThrow(() => {
        assertPathInScope('tools/lib/core/scope-checker.mjs', scope);
      });
    });

    it('should throw with clear message for path out of scope', () => {
      const scope = {
        wuId: 'WU-1397',
        code_paths: ['tools/lib/core/scope-checker.mjs', 'tools/lib/core/__tests__/*.mjs'],
      };

      assert.throws(
        () => {
          assertPathInScope('apps/web/src/components/Header.tsx', scope);
        },
        (error) => {
          assert.ok(error instanceof Error);
          assert.match(error.message, /SCOPE VIOLATION/);
          assert.match(error.message, /apps\/web\/src\/components\/Header\.tsx/);
          assert.match(error.message, /WU-1397/);
          assert.match(error.message, /tools\/lib\/core\/scope-checker\.mjs/);
          assert.match(error.message, /tools\/lib\/core\/__tests__\/\*\.mjs/);
          return true;
        }
      );
    });

    it('should throw for null scope', () => {
      assert.throws(
        () => {
          assertPathInScope('any/path/here.ts', null);
        },
        (error) => {
          assert.ok(error instanceof Error);
          assert.match(error.message, /No active WU/);
          return true;
        }
      );
    });

    it('should not throw for empty code_paths', () => {
      const scope = {
        wuId: 'WU-999',
        code_paths: [],
      };

      assert.doesNotThrow(() => {
        assertPathInScope('any/path/here.ts', scope);
      });
    });

    it('should include operation context in error message when provided', () => {
      const scope = {
        wuId: 'WU-1397',
        code_paths: ['tools/lib/core/scope-checker.mjs'],
      };

      assert.throws(
        () => {
          assertPathInScope('apps/web/src/components/Header.tsx', scope, 'file write');
        },
        (error) => {
          assert.ok(error instanceof Error);
          assert.match(error.message, /file write/);
          return true;
        }
      );
    });
  });

  describe('cross-platform path handling', () => {
    it('should handle mixed path separators', () => {
      const scope = {
        wuId: 'WU-1397',
        code_paths: ['tools/lib/**/*.mjs'],
      };

      // Unix paths
      assert.strictEqual(isPathInScope('tools/lib/core/scope-checker.mjs', scope), true);

      // Windows paths
      assert.strictEqual(isPathInScope('tools\\lib\\core\\scope-checker.mjs', scope), true);

      // Mixed (shouldn't happen but be defensive)
      assert.strictEqual(isPathInScope('tools/lib\\core/scope-checker.mjs', scope), true);
    });
  });

  describe('glob edge cases', () => {
    it('should handle double-star glob correctly', () => {
      const scope = {
        wuId: 'WU-999',
        code_paths: ['src/**/*.ts'],
      };

      assert.strictEqual(isPathInScope('src/index.ts', scope), true);
      assert.strictEqual(isPathInScope('src/lib/utils.ts', scope), true);
      assert.strictEqual(isPathInScope('src/a/b/c/deep.ts', scope), true);
      assert.strictEqual(isPathInScope('src/index.js', scope), false);
    });

    it('should handle single-star glob correctly', () => {
      const scope = {
        wuId: 'WU-999',
        code_paths: ['src/*.ts'],
      };

      assert.strictEqual(isPathInScope('src/index.ts', scope), true);
      assert.strictEqual(isPathInScope('src/lib/utils.ts', scope), false);
    });

    it('should handle brace expansion patterns', () => {
      const scope = {
        wuId: 'WU-999',
        code_paths: ['src/**/*.{ts,tsx}'],
      };

      assert.strictEqual(isPathInScope('src/component.tsx', scope), true);
      assert.strictEqual(isPathInScope('src/utils.ts', scope), true);
      assert.strictEqual(isPathInScope('src/style.css', scope), false);
    });
  });
});
