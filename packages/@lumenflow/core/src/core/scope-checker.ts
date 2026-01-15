/**
 * @file scope-checker.mjs
 * @description WU scope validation and code_paths enforcement (WU-1397)
 *
 * Provides runtime validation that file modifications stay within WU code_paths.
 * Prevents scope creep and ensures agents only modify authorized files.
 *
 * Features:
 * - Load code_paths from active WU YAML
 * - Validate file paths against glob patterns
 * - Throw descriptive errors for scope violations
 * - Support both exact paths and glob patterns
 *
 * Used by wu- scripts and future file operation guards.
 *
 * @see {@link tools/lib/core/worktree-guard.mjs} - WU context detection
 * @see {@link tools/lib/wu-schema.mjs} - WU YAML parsing
 */

import micromatch from 'micromatch';
import { getWUContext } from './worktree-guard.js';
import { readWU } from '../wu-yaml.js';
import { WU_PATHS } from '../wu-paths.js';

/**
 * Normalize path separators to forward slashes
 *
 * Handles both Unix and Windows path separators for cross-platform compatibility.
 *
 * @param {string} p - Path to normalize
 * @returns {string} Path with forward slashes
 * @private
 */
function normalizePath(p) {
  return p.replace(/\\/g, '/');
}

/**
 * Load WU YAML data for a given WU ID
 *
 * Wrapper around readWU that constructs the path.
 * Exported for testing injection.
 *
 * @param {string} wuId - WU identifier
 * @returns {Object} Parsed WU YAML
 * @private
 */
function loadWUYaml(wuId) {
  const wuPath = WU_PATHS.WU(wuId);
  return readWU(wuPath, wuId);
}

/**
 * Get active WU scope (WU ID + code_paths)
 *
 * Retrieves the current WU context and loads code_paths from WU YAML.
 * Returns null if not in a WU workspace.
 *
 * @param {Object} [options] - Options
 * @param {Function} [options.getWUContext] - WU context getter (for testing)
 * @param {Function} [options.loadWUYaml] - WU YAML loader (for testing)
 * @returns {Promise<Object|null>} Scope object {wuId, code_paths} or null
 *
 * @example
 * const scope = await getActiveScope();
 * if (scope) {
 *   console.log(`WU ${scope.wuId} code_paths:`, scope.code_paths);
 * }
 */
export async function getActiveScope(options = {}) {
  const getContextFn = options.getWUContext || getWUContext;
  const loadYamlFn = options.loadWUYaml || loadWUYaml;

  // Get current WU context from worktree path or git branch
  const context = await getContextFn();
  if (!context) {
    return null;
  }

  // Load WU YAML to get code_paths
  const wuData = loadYamlFn(context.wuId);

  return {
    wuId: context.wuId,
    code_paths: wuData.code_paths || [],
  };
}

/**
 * Check if a file path is within WU scope
 *
 * Validates a file path against the WU's code_paths using glob matching.
 * Supports exact paths and glob patterns (*, **, {a,b}, etc.).
 *
 * Empty code_paths = no restrictions (documentation/process WUs).
 *
 * @param {string} filePath - File path to check
 * @param {Object|null} scope - Scope object from getActiveScope()
 * @param {string} scope.wuId - WU identifier
 * @param {string[]} scope.code_paths - Allowed file paths/patterns
 * @returns {boolean} True if path is in scope, false otherwise
 *
 * @example
 * const scope = await getActiveScope();
 * if (isPathInScope('apps/web/src/Header.tsx', scope)) {
 *   console.log('Path is in scope');
 * }
 */
export function isPathInScope(filePath, scope) {
  if (!scope) {
    return false;
  }

  // Empty code_paths = no restrictions (documentation/process WUs)
  if (!scope.code_paths || scope.code_paths.length === 0) {
    return true;
  }

  // Normalize path separators for cross-platform compatibility
  const normalizedPath = normalizePath(filePath);

  // Check exact match first (fast path)
  if (scope.code_paths.includes(normalizedPath)) {
    return true;
  }

  // Check glob patterns using micromatch
  return micromatch.isMatch(normalizedPath, scope.code_paths);
}

/**
 * Assert that a file path is within WU scope
 *
 * Throws descriptive error if path is outside WU code_paths.
 * Use this for write operations that must enforce scope boundaries.
 *
 * @param {string} filePath - File path to check
 * @param {Object|null} scope - Scope object from getActiveScope()
 * @param {string} [operation] - Operation name for error message context
 * @throws {Error} If path is outside scope or no scope available
 *
 * @example
 * const scope = await getActiveScope();
 * assertPathInScope('apps/web/src/Header.tsx', scope, 'file write');
 * // Throws if path not in WU code_paths
 */
export function assertPathInScope(filePath, scope, operation = 'this operation') {
  if (!scope) {
    throw new Error(
      `❌ SCOPE VIOLATION: No active WU context.

Operation: ${operation}
File path: ${filePath}

You must claim a WU before performing operations.
Run: pnpm wu:claim --id WU-XXX --lane "<lane>"
`
    );
  }

  if (!isPathInScope(filePath, scope)) {
    const normalizedPath = normalizePath(filePath);

    throw new Error(
      `❌ SCOPE VIOLATION: File path outside WU code_paths.

Operation: ${operation}
WU ID: ${scope.wuId}
File path: ${normalizedPath}

Allowed code_paths:
${scope.code_paths.map((p) => `  - ${p}`).join('\n')}

This file is not authorized for modification in this WU.
Either:
  1. Add this path to code_paths in WU YAML (if legitimately needed)
  2. Create a separate WU for this change
  3. Choose a different file within scope

See: CLAUDE.md §2 (Worktree Discipline)
`
    );
  }
}
