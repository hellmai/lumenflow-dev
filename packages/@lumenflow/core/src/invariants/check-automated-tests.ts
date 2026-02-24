// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * INV-AUTOMATED-TESTS-FOR-CODE Invariant Check (WU-2333)
 *
 * Validates that WUs with code files in code_paths have automated tests.
 * Config files are excluded from this requirement.
 *
 * This invariant ensures that manual-only tests cannot satisfy validation
 * for code changes, enforcing TDD discipline.
 *
 * Library-first check: This is custom validation logic for ExampleApp WU workflow.
 * No external library exists for WU YAML validation - this integrates with
 * the existing manual-test-validator.ts which already implements the core logic.
 *
 * @see {@link packages/@lumenflow/cli/src/lib/manual-test-validator.ts} - Core validation logic
 * @see {@link tools/invariants.yml} - Invariant registry
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseYAML } from '../wu-yaml.js';
import { validateAutomatedTestRequirement, isCodeFile } from '../manual-test-validator.js';
import { DIRECTORIES, WU_STATUS } from '../wu-constants.js';

/**
 * Invariant metadata
 */
export const INVARIANT_ID = 'INV-AUTOMATED-TESTS-FOR-CODE';
export const INVARIANT_TYPE = 'wu-automated-tests';

/**
 * WU statuses that should be validated.
 * Only validate active work - in_progress and blocked WUs.
 * Done, ready, and waiting WUs are either already validated or not yet being worked.
 */
const ACTIVE_STATUSES = Object.freeze([WU_STATUS.IN_PROGRESS, WU_STATUS.BLOCKED]);

/**
 * Default path to WU YAML files relative to base directory.
 * WU-1430: Use centralized constant instead of hardcoded path.
 */
const WU_YAML_PATH = DIRECTORIES.WU_DIR;

/**
 * Options for checking WU file
 */
interface CheckWUFileOptions {
  /** Skip status check (WU-2425: for scoped validation) */
  skipStatusCheck?: boolean;
}

/**
 * Check a single WU YAML file for automated test requirement.
 *
 * @param {string} filePath - Path to WU YAML file
 * @param {CheckWUFileOptions} [options={}] - Options
 * @returns {{ valid: boolean, wuId: string|null, error: string|null }} Check result
 */
function checkWUFile(filePath: UnsafeAny, options: CheckWUFileOptions = {}) {
  const { skipStatusCheck = false } = options;

  try {
    const content = readFileSync(filePath, 'utf-8');
    const doc = parseYAML(content);

    if (!doc) {
      return { valid: true, wuId: null, error: null };
    }

    const wuId = (doc.id as string) || path.basename(filePath, '.yaml');
    const status = (doc.status as string) || '';

    // WU-2425: Skip status check when validating a specific WU (e.g., during wu:done)
    // This is needed because wu:done may set status to 'done' before validation runs
    if (!skipStatusCheck && !ACTIVE_STATUSES.includes(status)) {
      return { valid: true, wuId, error: null };
    }

    // Use the existing validation logic from manual-test-validator.ts
    const result = validateAutomatedTestRequirement(doc);

    if (!result.valid) {
      return {
        valid: false,
        wuId,
        error: result.errors.join('\n'),
        codeFiles: getCodeFilesFromPaths(doc.code_paths || []),
      };
    }

    return { valid: true, wuId, error: null };
  } catch {
    // Skip files that can't be parsed
    return { valid: true, wuId: null, error: null };
  }
}

/**
 * Get code files from code_paths (filtering out config files).
 *
 * @param {string[]} codePaths - Array of code paths
 * @returns {string[]} Code files that require automated tests
 */
function getCodeFilesFromPaths(codePaths: UnsafeAny) {
  if (!codePaths || !Array.isArray(codePaths)) {
    return [];
  }
  return codePaths.filter((p) => isCodeFile(p));
}

/**
 * Run the INV-AUTOMATED-TESTS-FOR-CODE invariant check.
 *
 * Scans WU YAML files and validates that UnsafeAny with code files in code_paths
 * have automated tests (unit, e2e, or integration).
 *
 * WU-2425: When wuId is provided, only validates that specific WU instead of
 * all active WUs. This prevents unrelated WUs from blocking wu:done completion.
 *
 * @param {CheckAutomatedTestsInvariantOptions} [options={}] - Options
 * @returns {{ valid: boolean, violations: Array<object> }} Check result
 */
export interface CheckAutomatedTestsInvariantOptions {
  /** Base directory for path resolution */
  baseDir?: string;
  /** Specific WU ID to validate (WU-2425: scoped validation) */
  wuId?: string;
}

export function checkAutomatedTestsInvariant(options: CheckAutomatedTestsInvariantOptions = {}) {
  const { baseDir = process.cwd(), wuId } = options;
  const wuDir = path.join(baseDir, WU_YAML_PATH);
  const violations = [];

  // Check if WU directory exists
  if (!existsSync(wuDir)) {
    return { valid: true, violations: [] };
  }

  // WU-2425: If wuId is provided, only check that specific WU file
  if (wuId) {
    const filePath = path.join(wuDir, `${wuId}.yaml`);

    // If the WU file doesn't exist, pass gracefully (nothing to validate)
    if (!existsSync(filePath)) {
      return { valid: true, violations: [] };
    }

    // When validating a specific WU, skip status check (validate regardless of status)
    // This is needed because wu:done may set status to 'done' before validation runs
    const result = checkWUFile(filePath, { skipStatusCheck: true });

    if (!result.valid) {
      violations.push({
        id: INVARIANT_ID,
        type: INVARIANT_TYPE,
        wuId: result.wuId as string,
        description: `WU ${result.wuId} has code files but no automated tests`,
        message: result.error,
        codeFiles: result.codeFiles,
      });
    }

    return {
      valid: violations.length === 0,
      violations,
    };
  }

  // Default behavior: check all WU files (existing behavior for gates)
  let files;
  try {
    files = readdirSync(wuDir).filter(
      (f) => f.startsWith('WU-') && (f.endsWith('.yaml') || f.endsWith('.yml')),
    );
  } catch {
    return { valid: true, violations: [] };
  }

  // Check each WU file
  for (const file of files) {
    const filePath = path.join(wuDir, file);
    const result = checkWUFile(filePath);

    if (!result.valid) {
      violations.push({
        id: INVARIANT_ID,
        type: INVARIANT_TYPE,
        wuId: result.wuId as string,
        description: `WU ${result.wuId} has code files but no automated tests`,
        message: result.error,
        codeFiles: result.codeFiles,
      });
    }
  }

  return {
    valid: violations.length === 0,
    violations,
  };
}

/**
 * Format a violation for display.
 *
 * @param {object} violation - Violation object
 * @returns {string} Formatted error message
 */
export function formatAutomatedTestsViolation(violation: UnsafeAny) {
  const lines = [
    `INVARIANT VIOLATION: ${violation.id}`,
    `WU: ${violation.wuId}`,
    `Description: ${violation.description}`,
  ];

  if (violation.codeFiles && violation.codeFiles.length > 0) {
    lines.push(`Code files requiring tests: ${violation.codeFiles.join(', ')}`);
  }

  lines.push('');
  lines.push(
    'Action: Add automated tests (unit, e2e, or integration) to the tests field in the WU YAML.',
  );

  return lines.join('\n');
}
