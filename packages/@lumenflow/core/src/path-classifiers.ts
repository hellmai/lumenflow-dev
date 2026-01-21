#!/usr/bin/env node
/**
 * Path Classification Utilities for WU Tooling
 *
 * WU-1255: Classifies file paths to determine test scoping.
 * Uses string methods (no regex) for path prefix matching.
 *
 * Paths that skip web app tests:
 * - Documentation: docs/, ai/, .claude/, README*, CLAUDE*.md
 * - Tooling: tools/, scripts/
 *
 * @see {@link ./wu-done-paths.js} - Consumer for detectDocsOnlyByPaths
 */

/**
 * Prefixes for paths that should skip web app tests.
 * These are paths for docs, tooling, and configuration that don't affect app functionality.
 *
 * @constant {string[]}
 */
export const SKIP_TESTS_PREFIXES = Object.freeze([
  'docs/',
  'ai/',
  '.claude/',
  'tools/', // WU-1255: Tooling WUs
  'scripts/', // WU-1255: Scripts WUs
]);

/**
 * Root file patterns that should skip web app tests.
 * These are files in the root directory that are documentation.
 *
 * @constant {string[]}
 */
export const SKIP_TESTS_ROOT_FILES = Object.freeze([
  'readme', // Case-insensitive match
  'claude', // CLAUDE.md, CLAUDE-core.md, etc.
]);

/**
 * Check if a single file path should skip web app tests.
 *
 * Uses string methods for matching:
 * - `startsWith` for directory prefixes (docs/, tools/, etc.)
 * - `toLowerCase` for case-insensitive root file matching
 *
 * @param {string|null|undefined} filePath - File path to check
 * @returns {boolean} True if path should skip web app tests
 *
 * @example
 * isSkipWebTestsPath('docs/README.md') // true
 * isSkipWebTestsPath('tools/wu-done.js') // true
 * isSkipWebTestsPath('apps/web/src/page.tsx') // false
 */
export function isSkipWebTestsPath(filePath) {
  if (!filePath || typeof filePath !== 'string') {
    return false;
  }

  const path = filePath.trim();
  if (path.length === 0) {
    return false;
  }

  // Check directory prefixes (docs/, ai/, .claude/, tools/, scripts/)
  for (const prefix of SKIP_TESTS_PREFIXES) {
    if (path.startsWith(prefix)) {
      return true;
    }
  }

  // Check root file patterns (README*, CLAUDE*.md)
  const lowerPath = path.toLowerCase();
  for (const pattern of SKIP_TESTS_ROOT_FILES) {
    if (lowerPath.startsWith(pattern)) {
      return true;
    }
  }

  return false;
}

/**
 * Check if ALL code paths should skip web app tests.
 *
 * Returns true only if EVERY path in the array is a skip-tests path.
 * This is the aggregate check for WU YAML code_paths array.
 *
 * @param {string[]|null|undefined} codePaths - Array of file paths from WU YAML
 * @returns {boolean} True if all paths should skip web app tests
 *
 * @example
 * shouldSkipWebTests(['docs/README.md', 'tools/wu-done.js']) // true
 * shouldSkipWebTests(['docs/README.md', 'apps/web/src/page.tsx']) // false
 */
export function shouldSkipWebTests(codePaths) {
  if (!codePaths || !Array.isArray(codePaths) || codePaths.length === 0) {
    return false;
  }

  return codePaths.every((path) => isSkipWebTestsPath(path));
}
