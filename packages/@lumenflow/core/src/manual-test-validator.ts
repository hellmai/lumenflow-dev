#!/usr/bin/env node
// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Manual Test Escape Hatch Validator
 *
 * WU-1433: Restricts manual-only tests for WUs touching hex core code.
 * WU-2332: Require automated tests for all code files, remove lane exemptions.
 *
 * Implementation WUs must have at least one automated test (unit/e2e/integration).
 *
 * Exemptions:
 * - type: documentation only
 * - code_paths containing only documentation/config files (no code files)
 *
 * @see {@link packages/@lumenflow/cli/src/lib/wu-done-validators.ts} - Integration point
 * @see {@link config.directories.completeGuidePath} - TDD requirements
 */

import path from 'node:path';
import { TEST_TYPES, WU_TYPES } from './wu-constants.js';

/** Minimal WU document shape for test validation */
interface WuDocForTests {
  type?: string;
  code_paths?: unknown;
  tests?: unknown;
  test_paths?: unknown;
}

/**
 * Code file extensions that require automated tests.
 * @constant {string[]}
 */
const CODE_EXTENSIONS = Object.freeze(['.js', '.ts', '.tsx', '.ts']);

/**
 * Non-code file extensions (documentation, data, config).
 * @constant {string[]}
 */
const NON_CODE_EXTENSIONS = Object.freeze(['.md', '.yaml', '.yml', '.json']);

/**
 * Patterns that indicate a config file (even with code extensions).
 * @constant {RegExp[]}
 */
const CONFIG_PATTERNS = Object.freeze([
  /config\./i, // vitest.config.ts, eslint.config.js
  /\.config\./i, // *.config.ts, *.config.js
  /rc\.[jt]s$/i, // .eslintrc.js, .prettierrc.ts
  /^\.[a-z]+rc\./i, // .eslintrc.*, .prettierrc.*
]);

/**
 * Path prefixes for hex core code requiring automated tests.
 * These are the critical application layer paths.
 *
 * WU-1068: Changed from @exampleapp to @lumenflow for framework reusability.
 * Project-specific patterns should be configured in workspace.yaml.
 *
 * @constant {string[]}
 */
export const HEX_CORE_CODE_PATTERNS = Object.freeze([
  'packages/@lumenflow/core/',
  'packages/@lumenflow/cli/',
  'packages/@lumenflow/agent/',
]);

/**
 * @deprecated Lane-based exemptions removed in WU-2332.
 * Test requirements are now based on file types, not lanes.
 * Kept for backward compatibility but no longer used.
 * @constant {string[]}
 */
export const EXEMPT_LANES = Object.freeze([]);

/**
 * WU types exempt from automated test requirement.
 * Only 'documentation' type is exempt - actual code changes require automated tests.
 *
 * @constant {string[]}
 */
export const EXEMPT_TYPES = Object.freeze([WU_TYPES.DOCUMENTATION]);

/**
 * Determine if a file path represents a code file requiring automated tests.
 *
 * Code files are those with extensions like .ts, .ts, .tsx, .js
 * EXCEPT config files (vitest.config.ts, .eslintrc.js, etc.)
 *
 * @param {string} filePath - File path to check
 * @returns {boolean} True if the file is a code file requiring tests
 */
export function isCodeFile(filePath: string) {
  if (!filePath || typeof filePath !== 'string') {
    return false;
  }

  // Get the filename from the path
  const fileName = path.basename(filePath);
  const ext = path.extname(filePath).toLowerCase();

  // Check if it's a non-code extension (docs, data)
  if (NON_CODE_EXTENSIONS.includes(ext)) {
    return false;
  }

  // Check if it's a code extension
  if (!CODE_EXTENSIONS.includes(ext)) {
    return false;
  }

  // Check if it's a config file (even with code extension)
  const isConfig = CONFIG_PATTERNS.some((pattern) => pattern.test(fileName));
  if (isConfig) {
    return false;
  }

  return true;
}

/**
 * Check if code_paths contains any hex core code.
 *
 * @param {string[]|null|undefined} codePaths - Array of file paths from WU YAML
 * @returns {boolean} True if any path is in hex core layer
 */
export function containsHexCoreCode(codePaths: unknown) {
  if (!codePaths || !Array.isArray(codePaths) || codePaths.length === 0) {
    return false;
  }

  return codePaths.some((path) => {
    if (!path || typeof path !== 'string') return false;
    return HEX_CORE_CODE_PATTERNS.some((pattern) => path.startsWith(pattern));
  });
}

/**
 * Check if a WU is exempt from automated test requirement.
 *
 * WU-2332: Only type: 'documentation' is exempt.
 * Lane-based exemptions have been removed - test requirements
 * are now based on file types in code_paths.
 *
 * @param {object} doc - WU YAML document
 * @returns {boolean} True if WU is exempt
 */
export function isExemptFromAutomatedTests(doc: WuDocForTests | null | undefined) {
  if (!doc) return false;

  // Only type: documentation is exempt
  const type = doc.type || '';
  if (typeof type === 'string' && EXEMPT_TYPES.includes(type)) {
    return true;
  }

  return false;
}

/**
 * Check if WU has at least one automated test.
 *
 * @param {object} tests - Tests object from WU YAML
 * @returns {boolean} True if has at least one automated test
 */
function hasAutomatedTest(tests: unknown): boolean {
  if (!tests || typeof tests !== 'object') return false;

  const hasItems = (arr: unknown) => Array.isArray(arr) && arr.length > 0;
  const t = tests as Record<string, unknown>;

  return (
    hasItems(t[TEST_TYPES.UNIT]) ||
    hasItems(t[TEST_TYPES.E2E]) ||
    hasItems(t[TEST_TYPES.INTEGRATION])
  );
}

/**
 * Check if any code_paths contain actual code files (not docs/config).
 *
 * @param {string[]} codePaths - Array of file paths from WU YAML
 * @returns {{ hasCodeFiles: boolean, codeFiles: string[] }} Result with list of code files
 */
function analyzeCodePaths(codePaths: unknown) {
  if (!codePaths || !Array.isArray(codePaths) || codePaths.length === 0) {
    return { hasCodeFiles: false, codeFiles: [] };
  }

  const codeFiles = codePaths.filter((p) => isCodeFile(p));
  return {
    hasCodeFiles: codeFiles.length > 0,
    codeFiles,
  };
}

/**
 * Validate automated test requirement for WU.
 *
 * WU-2332: Requirements are based on file types, not lanes.
 * - WUs with ANY code files in code_paths must have automated tests
 * - WUs with only docs/config files can use manual-only tests
 * - type: 'documentation' is always exempt
 *
 * @param {object} doc - WU YAML document
 * @returns {{ valid: boolean, errors: string[] }} Validation result
 */
export function validateAutomatedTestRequirement(doc: WuDocForTests | null | undefined) {
  const errors = [];

  if (!doc) {
    return { valid: true, errors: [] };
  }

  // Check if WU is exempt by type
  if (isExemptFromAutomatedTests(doc)) {
    return { valid: true, errors: [] };
  }

  // Analyze code_paths for actual code files
  const codePaths = doc.code_paths || [];
  const { hasCodeFiles, codeFiles } = analyzeCodePaths(codePaths);

  // If no code files, manual tests are fine
  if (!hasCodeFiles) {
    return { valid: true, errors: [] };
  }

  // WU has code files - require automated tests
  // Support both tests: (current) and test_paths: (legacy)
  const tests = doc.tests || doc.test_paths || {};
  if (!hasAutomatedTest(tests)) {
    errors.push(
      `WU modifies code files but has no automated tests.\n` +
        `  Code files: ${codeFiles.join(', ')}\n` +
        `  Required: At least one automated test (unit, e2e, or integration)\n` +
        `  Manual-only tests are not allowed for code changes.\n\n` +
        `  Fix: Add tests to tests.unit, tests.e2e, or tests.integration in WU YAML.`,
    );
    return { valid: false, errors };
  }

  return { valid: true, errors: [] };
}
