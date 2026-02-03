#!/usr/bin/env node

/**
 * Preflight validation functions for wu:preflight command
 *
 * WU-1803: Fast validation of code_paths and test paths before gates run.
 * WU-1810: Upgraded to use canonical Zod schema validation (catches created format issues).
 *
 * This catches YAML mismatches early, saving time compared to full wu:done validation.
 *
 * Key validations:
 * - WU YAML schema is valid (full canonical schema, not just required fields)
 * - created field is YYYY-MM-DD format (fails fast on ISO timestamps)
 * - code_paths files exist
 * - test file paths exist (unit, e2e, integration - not manual)
 *
 * Design goals:
 * - Complete in under 5 seconds
 * - Clear error messages pointing to missing files
 * - Reusable by wu:done for early validation
 */

import { existsSync } from 'node:fs';
import path from 'node:path';
import { WU_PATHS } from './wu-paths.js';
import { readWURaw } from './wu-yaml.js';
import { TEST_TYPES, LOG_PREFIX, EMOJI } from './wu-constants.js';
// WU-1810: Import canonical schema for full validation
import { BaseWUSchema } from './wu-schema.js';
// WU-1810: Import fixer to detect fixable issues
import { detectFixableIssues, FIXABLE_ISSUES } from './wu-yaml-fixer.js';
import fg from 'fast-glob';

/**
 * Result structure for preflight validation
 * @typedef {object} PreflightResult
 * @property {boolean} valid - Whether all validations passed
 * @property {string[]} errors - List of error messages
 * @property {string[]} missingCodePaths - Code paths that don't exist
 * @property {string[]} missingTestPaths - Test file paths that don't exist
 */

/**
 * Create a PreflightResult object
 *
 * @param {object} params - Result parameters
 * @param {boolean} params.valid - Whether validation passed
 * @param {string[]} [params.errors=[]] - Error messages
 * @param {string[]} [params.missingCodePaths=[]] - Missing code paths
 * @param {string[]} [params.missingTestPaths=[]] - Missing test paths
 * @param {Record<string, string[]>} [params.suggestedTestPaths={}] - Suggested test paths
 * @returns {PreflightResult}
 */
export function createPreflightResult({
  valid,
  errors = [],
  missingCodePaths = [],
  missingTestPaths = [],
  suggestedTestPaths = {},
}) {
  return {
    valid,
    errors,
    missingCodePaths,
    missingTestPaths,
    suggestedTestPaths,
  };
}

/**
 * WU-1810: Validate WU YAML schema using canonical Zod schema
 *
 * Uses BaseWUSchema (structural validation) rather than minimal required fields.
 * This catches created format issues, invalid type/status enums, etc. early.
 *
 * Special handling for created field:
 * - Detects ISO timestamps and Date scalars via wu-yaml-fixer
 * - Provides actionable error message suggesting auto-fix
 *
 * @param {object} doc - Parsed WU YAML document
 * @param {string} id - Expected WU ID
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateSchema(doc, id) {
  const errors = [];

  // Check ID matches (before schema validation for clear error)
  if (doc.id !== id) {
    errors.push(`WU ID mismatch: expected ${id}, found ${doc.id}`);
  }

  // WU-1810: Check for fixable issues (especially created field)
  // This provides better error messages than raw Zod schema errors
  const fixableIssues = detectFixableIssues(doc);
  const createdIssue = fixableIssues.find(
    (issue) => issue.type === FIXABLE_ISSUES.DATE_ISO_TIMESTAMP,
  );

  if (createdIssue) {
    errors.push(
      `created field has invalid format: "${createdIssue.current}" is an ISO timestamp. ` +
        `Expected YYYY-MM-DD format. Suggested fix: change to "${createdIssue.suggested}". ` +
        `Fix by editing the WU YAML file (created: '${createdIssue.suggested}').`,
    );
  }

  // WU-1810: Validate against canonical Zod schema
  const schemaResult = BaseWUSchema.safeParse(doc);

  if (!schemaResult.success) {
    // Format Zod errors with field paths
    for (const issue of schemaResult.error.issues) {
      const fieldPath = issue.path.join('.');
      const message = issue.message;

      // Skip created errors if we already reported a fixable issue
      if (fieldPath === 'created' && createdIssue) {
        continue;
      }

      errors.push(`${fieldPath}: ${message}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate code_paths files exist
 *
 * WU-1329: Exported for use by wu:create strict validation.
 *
 * @param {string[]} codePaths - List of code paths from WU YAML
 * @param {string} rootDir - Root directory to resolve paths against
 * @returns {{ valid: boolean, errors: string[], missing: string[] }}
 */
export function validateCodePathsExistence(codePaths, rootDir) {
  if (!codePaths || !Array.isArray(codePaths) || codePaths.length === 0) {
    return { valid: true, errors: [], missing: [] };
  }

  const missing = [];

  for (const filePath of codePaths) {
    if (!filePath || typeof filePath !== 'string') continue;

    const fullPath = path.join(rootDir, filePath);
    if (!existsSync(fullPath)) {
      missing.push(filePath);
    }
  }

  if (missing.length > 0) {
    const errors = [
      `code_paths validation failed - ${missing.length} file(s) not found:`,
      ...missing.map((p) => `  - ${p}`),
    ];
    return { valid: false, errors, missing };
  }

  return { valid: true, errors: [], missing: [] };
}

/**
 * Validate test file paths exist (unit, e2e, integration - not manual)
 *
 * Manual tests are descriptions, not file paths, so they're skipped.
 *
 * WU-1329: Exported for use by wu:create strict validation.
 *
 * @param {object} tests - tests object from WU YAML
 * @param {string} rootDir - Root directory to resolve paths against
 * @returns {{ valid: boolean, errors: string[], missing: string[] }}
 */
export function validateTestPathsExistence(tests, rootDir) {
  if (!tests || typeof tests !== 'object') {
    return { valid: true, errors: [], missing: [] };
  }

  const missing = [];

  // Test types that are file paths (not manual descriptions)
  const fileTestTypes = [TEST_TYPES.UNIT, TEST_TYPES.E2E, TEST_TYPES.INTEGRATION];

  for (const testType of fileTestTypes) {
    const paths = tests[testType];
    if (!paths || !Array.isArray(paths)) continue;

    for (const filePath of paths) {
      if (!filePath || typeof filePath !== 'string') continue;

      const fullPath = path.join(rootDir, filePath);
      if (!existsSync(fullPath)) {
        missing.push(filePath);
      }
    }
  }

  if (missing.length > 0) {
    const errors = [
      `test paths validation failed - ${missing.length} test file(s) not found:`,
      ...missing.map((p) => `  - ${p}`),
    ];
    return { valid: false, errors, missing };
  }

  return { valid: true, errors: [], missing: [] };
}

/**
 * Run preflight validation for a WU
 *
 * Validates:
 * 1. WU YAML schema is valid
 * 2. code_paths files exist
 * 3. test file paths exist (unit, e2e, integration)
 *
 * WU-1830: When worktreePath is provided, YAML is read from worktree (not rootDir).
 * This ensures that when agent runs wu:edit to update code_paths in worktree,
 * preflight validation uses the updated YAML, not stale main.
 *
 * @param {string} id - WU ID (e.g., 'WU-999')
 * @param {ValidatePreflightOptions} [options={}] - Options
 * @returns {Promise<PreflightResult>}
 */
export interface ValidatePreflightOptions {
  /** Root directory for path resolution (fallback) */
  rootDir?: string;
  /** Worktree path (preferred source for YAML and file checks) */
  worktreePath?: string | null;
}

export async function validatePreflight(id, options: ValidatePreflightOptions = {}) {
  const rootDir = options.rootDir || process.cwd();
  const worktreePath = options.worktreePath || rootDir;

  const allErrors = [];
  const missingCodePaths = [];
  const missingTestPaths = [];

  // Step 1: Read WU YAML from worktree (WU-1830)
  // When worktreePath is provided, read YAML from there to get latest code_paths
  const wuPath = path.join(worktreePath, WU_PATHS.WU(id));

  // Debug logging for YAML source (WU-1830)
  if (options.worktreePath && options.worktreePath !== rootDir) {
    if (process.env.DEBUG) console.log(`[wu-preflight] Reading WU YAML from worktree: ${wuPath}`);
  }

  let doc;
  try {
    // First try to read raw (without ID validation) to provide better errors
    doc = readWURaw(wuPath);
  } catch (err) {
    return createPreflightResult({
      valid: false,
      errors: [`Failed to read WU YAML: ${err.message}`],
    });
  }

  // Step 2: Validate schema
  const schemaResult = validateSchema(doc, id);
  if (!schemaResult.valid) {
    allErrors.push(...schemaResult.errors);
  }

  // Step 3: Validate code_paths exist
  const codePathsResult = validateCodePathsExistence(doc.code_paths, worktreePath);
  if (!codePathsResult.valid) {
    allErrors.push(...codePathsResult.errors);
    missingCodePaths.push(...codePathsResult.missing);
  }

  // Step 4: Validate test file paths exist
  // Support both 'tests' and legacy 'test_paths' field
  const testsObj = doc.tests || doc.test_paths || {};
  const testPathsResult = validateTestPathsExistence(testsObj, worktreePath);
  if (!testPathsResult.valid) {
    allErrors.push(...testPathsResult.errors);
    missingTestPaths.push(...testPathsResult.missing);
  }

  // Step 5 (WU-1154): Generate suggestions for missing test paths
  let suggestedTestPaths = {};
  if (missingTestPaths.length > 0) {
    const searchRoot = worktreePath || rootDir;
    try {
      suggestedTestPaths = await findSuggestedTestPaths(missingTestPaths, searchRoot);
    } catch (err) {
      if (process.env.DEBUG)
        console.log(`[wu-preflight] Failed to find suggestions: ${err.message}`);
    }
  }

  return createPreflightResult({
    valid: allErrors.length === 0,
    errors: allErrors,
    missingCodePaths,
    missingTestPaths,
    suggestedTestPaths,
  });
}

/**
 * Format preflight result as user-friendly message
 *
 * @param {string} id - WU ID
 * @param {PreflightResult} result - Validation result
 * @returns {string} Formatted message
 */
export function formatPreflightResult(id, result) {
  if (result.valid) {
    return `${LOG_PREFIX.PREFLIGHT} ${EMOJI.SUCCESS} Preflight validation passed for ${id}`;
  }

  const lines = [
    `${LOG_PREFIX.PREFLIGHT} ${EMOJI.FAILURE} Preflight validation failed for ${id}`,
    '',
    ...result.errors,
  ];

  if (result.missingCodePaths.length > 0) {
    lines.push('');
    lines.push('Fix options:');
    lines.push('  1. Create the missing files');
    lines.push(`  2. Update code_paths in ${id}.yaml to match actual files`);
  }

  if (result.missingTestPaths.length > 0) {
    lines.push('');
    lines.push('For test paths:');
    lines.push('  1. Create the missing test files');
    lines.push(`  2. Update tests in ${id}.yaml to match actual files`);
    lines.push('  3. Or use tests.manual for non-file test descriptions');
  }

  return lines.join('\n');
}

// Export PreflightResult type for documentation
export const PreflightResult = {};
/**
 * Find suggested paths for missing test files
 *
 * @param {string[]} missingPaths - List of missing test paths
 * @param {string} rootDir - Root directory to search in
 * @returns {Promise<Record<string, string[]>>} Map of missing path -> suggestions
 */
export async function findSuggestedTestPaths(missingPaths, rootDir) {
  const suggestions = {};

  if (missingPaths.length === 0) return suggestions;

  // Cache strict searches to avoid re-reading fs
  const globOptions = {
    cwd: rootDir,
    caseSensitiveMatch: false,
    limit: 5,
    ignore: ['**/node_modules/**'],
  };

  for (const missingPath of missingPaths) {
    const filename = path.basename(missingPath);
    const basename = path.basename(filename, path.extname(filename));
    const cleanBasename = basename.replace(/(\.test|\.spec)$/, '');

    // Strategy 1: Search for exact filename elsewhere
    let matches = await fg(`**/${filename}`, globOptions);

    // Strategy 2: Search for filename with different extension (ts/js/mjs)
    if (matches.length === 0) {
      matches = await fg(`**/${basename}.{ts,js,mjs,tsx,jsx}`, globOptions);
    }

    // Strategy 3: Search for fuzzy match on basename (without .test/.spec)
    if (matches.length === 0) {
      // Look for the code file the test might be for
      matches = await fg(`**/${cleanBasename}.{ts,js,mjs,tsx,jsx}`, globOptions);
    }

    if (matches.length > 0) {
      // Filter out the missing path itself if it somehow showed up
      suggestions[missingPath] = matches.filter((m) => m !== missingPath);
    }
  }

  return suggestions;
}
