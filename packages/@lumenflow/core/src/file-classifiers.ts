#!/usr/bin/env node
/**
 * File Classifiers
 *
 * Shared utilities for classifying file types.
 * Consolidates duplicated classification logic from wu-validator.mjs
 * and code-path-validator.mjs.
 *
 * WU-1848: DRY Consolidation - Eliminate duplicated code patterns
 *
 * @see tools/lib/wu-validator.mjs - Original isTestFile, isMarkdownFile
 * @see tools/lib/code-path-validator.mjs - Duplicated implementations
 */

/**
 * Prefixes for paths that qualify as documentation-only.
 * @constant {string[]}
 */
const DOCS_ONLY_PREFIXES = Object.freeze(['docs/', 'ai/', '.claude/', 'memory-bank/']);

/**
 * Root file patterns that qualify as docs-only.
 * @constant {string[]}
 */
const DOCS_ONLY_ROOT_FILES = Object.freeze(['readme', 'claude']);

/**
 * Test file patterns for detection
 * @constant {RegExp[]}
 */
const TEST_FILE_PATTERNS = Object.freeze([
  /\.test\.(ts|tsx|js|jsx|mjs)$/,
  /\.spec\.(ts|tsx|js|jsx|mjs)$/,
  /__tests__\//,
  /\.test-utils\./,
  /\.mock\./,
]);

/**
 * Check if a file path is a test file
 *
 * Detects test files by extension and directory patterns:
 * - *.test.ts, *.test.tsx, *.test.js, *.test.jsx, *.test.mjs
 * - *.spec.ts, *.spec.tsx, *.spec.js, *.spec.jsx, *.spec.mjs
 * - Files in __tests__ directories
 * - *.test-utils.* files
 * - *.mock.* files
 *
 * @param {string} filePath - Path to check
 * @returns {boolean} True if file is a test file
 */
export function isTestFile(filePath) {
  if (!filePath || typeof filePath !== 'string') {
    return false;
  }
  // Normalise Windows paths to forward slashes
  const normalized = filePath.replace(/\\/g, '/');
  return TEST_FILE_PATTERNS.some((pattern) => pattern.test(normalized));
}

/**
 * Check if a file path is a markdown file
 *
 * @param {string} filePath - Path to check
 * @returns {boolean} True if file is a markdown file (.md extension)
 */
export function isMarkdownFile(filePath) {
  if (!filePath || typeof filePath !== 'string') {
    return false;
  }
  // Normalise Windows paths to forward slashes
  const normalized = filePath.replace(/\\/g, '/');
  return /\.md$/i.test(normalized);
}

/**
 * Check if a file path is a documentation-only path
 *
 * Documentation paths include:
 * - docs/, ai/, .claude/, memory-bank/ directories
 * - README* files at root
 * - CLAUDE*.md files at root
 *
 * @param {string} filePath - Path to check
 * @returns {boolean} True if file is in a documentation path
 */
export function isDocumentationPath(filePath) {
  if (!filePath || typeof filePath !== 'string') {
    return false;
  }

  const path = filePath.trim();
  if (path.length === 0) {
    return false;
  }

  // Check docs-only prefixes (docs/, ai/, .claude/, memory-bank/)
  for (const prefix of DOCS_ONLY_PREFIXES) {
    if (path.startsWith(prefix)) {
      return true;
    }
  }

  // Check if it's a markdown file (*.md)
  if (isMarkdownFile(path)) {
    // Check root file patterns (README*, CLAUDE*.md)
    const lowerPath = path.toLowerCase();
    for (const pattern of DOCS_ONLY_ROOT_FILES) {
      if (lowerPath.startsWith(pattern)) {
        return true;
      }
    }
  }

  return false;
}

// Export constants for external use
export { DOCS_ONLY_PREFIXES, DOCS_ONLY_ROOT_FILES, TEST_FILE_PATTERNS };
