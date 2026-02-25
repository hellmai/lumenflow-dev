#!/usr/bin/env node
// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Lane-to-Code_Paths Validator (WU-1372)
 *
 * Validates that a WU's code_paths are consistent with its assigned lane.
 * This is an advisory validation - it warns but never blocks wu:claim or wu:done.
 *
 * Uses LANE_PATH_PATTERNS from wu-constants.ts to define which paths
 * are discouraged for each lane parent.
 *
 * Part of INIT-002: Workflow Integrity initiative.
 *
 * @see {@link wu-constants.ts} - LANE_PATH_PATTERNS definition
 * @see {@link lane-checker.ts} - extractParent for lane parsing
 */

import micromatch from 'micromatch';
import { extractParent } from './lane-checker.js';
import { LANE_PATH_PATTERNS } from './wu-constants.js';

/** Minimal WU document shape for lane validation */
interface WuDocForLane {
  code_paths?: string[];
}

/** Lane validation result */
interface LaneValidationResult {
  hasWarnings: boolean;
  warnings: string[];
  violations: string[];
  skipped: boolean;
}

/**
 * @typedef {object} LaneValidationResult
 * @property {boolean} hasWarnings - True if any code_paths violate lane patterns
 * @property {string[]} warnings - Human-readable warning messages
 * @property {string[]} violations - List of violating code_paths
 * @property {boolean} skipped - True if validation was skipped (no patterns or no code_paths)
 */

/**
 * Validate WU code_paths against lane's expected patterns.
 *
 * Checks if any code_paths match the "exclude" patterns for the lane,
 * unless they also match an "allowExceptions" pattern.
 *
 * @param {object} doc - WU YAML document (parsed)
 * @param {string} lane - Lane name (e.g., "Operations: Tooling")
 * @returns {LaneValidationResult} Validation result with warnings if any
 */
export function validateLaneCodePaths(doc: WuDocForLane, lane: string): LaneValidationResult {
  const codePaths = doc.code_paths || [];

  // Skip validation if no code_paths
  if (!codePaths || codePaths.length === 0) {
    return {
      hasWarnings: false,
      warnings: [],
      violations: [],
      skipped: true,
    };
  }

  // Extract parent lane (e.g., "Operations" from "Operations: Tooling")
  const parentLane = extractParent(lane);

  // Get patterns for this lane parent
  const patterns = LANE_PATH_PATTERNS[parentLane as keyof typeof LANE_PATH_PATTERNS];

  // Skip validation if no patterns defined for this lane
  if (!patterns) {
    return {
      hasWarnings: false,
      warnings: [],
      violations: [],
      skipped: true,
    };
  }

  const { exclude = [], allowExceptions = [] } = patterns;

  // Find violations: paths that match exclude patterns but NOT exception patterns
  const violations = codePaths.filter((codePath: string) => {
    // Check if path matches any exclude pattern
    const matchesExclude = micromatch.isMatch(codePath, exclude, { nocase: true });

    if (!matchesExclude) {
      return false; // Path doesn't match any exclude pattern, not a violation
    }

    // Check if path matches any exception pattern
    if (allowExceptions.length > 0) {
      const matchesException = micromatch.isMatch(codePath, allowExceptions, { nocase: true });
      if (matchesException) {
        return false; // Path is allowed by exception, not a violation
      }
    }

    return true; // Path matches exclude and no exception, this is a violation
  });

  if (violations.length === 0) {
    return {
      hasWarnings: false,
      warnings: [],
      violations: [],
      skipped: false,
    };
  }

  // Build warning messages
  const warnings = violations.map((path: string) => {
    return `Lane "${lane}" typically doesn't include "${path}" (expected for different lane)`;
  });

  return {
    hasWarnings: true,
    warnings,
    violations,
    skipped: false,
  };
}

/**
 * Log lane validation warnings to console.
 *
 * Helper function to format and display warnings consistently.
 * Uses LOG_PREFIX.CLAIM format.
 *
 * @param {LaneValidationResult} result - Result from validateLaneCodePaths
 * @param {string} logPrefix - Log prefix (e.g., "[wu-claim]")
 */
export function logLaneValidationWarnings(result: LaneValidationResult, logPrefix = '[wu-claim]') {
  if (!result.hasWarnings) {
    return;
  }

  console.warn(`${logPrefix} Lane/code_paths mismatch detected (advisory only):`);
  for (const warning of result.warnings) {
    console.warn(`${logPrefix}   ${warning}`);
  }
  console.warn(`${logPrefix} This is a warning only - proceeding with claim.`);
}
