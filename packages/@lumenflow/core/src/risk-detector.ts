#!/usr/bin/env node
/**
 * Risk Detector
 *
 * WU-2062: Implement tiered test execution for faster wu:done
 *
 * Detects risk tier based on changed files to enable tiered test execution:
 * - docs-only: Skip tests, run lint/typecheck only
 * - standard: Run changed tests
 * - high-risk: Run integration tests in addition to unit tests
 *
 * Safety-critical tests (red-flag, PHI, escalation) always run regardless of tier.
 *
 * Note: This is project-specific risk detection logic for PatientPath's
 * healthcare domain (PHI, RLS, auth). No standard library exists for this
 * domain-specific classification.
 *
 * @see {@link tools/gates.mjs} - Consumer of risk detection
 * @see {@link tools/lib/file-classifiers.mjs} - File classification utilities
 */

import path from 'node:path';
import { isDocumentationPath } from './file-classifiers.js';

/**
 * Risk tier constants
 * @readonly
 * @enum {string}
 */
export const RISK_TIERS = Object.freeze({
  /** Documentation-only changes - skip tests, run lint/typecheck only */
  DOCS_ONLY: 'docs-only',

  /** Standard code changes - run incremental tests */
  STANDARD: 'standard',

  /** Safety-critical tests need to run - always include safety test patterns */
  SAFETY_CRITICAL: 'safety-critical',

  /** High-risk changes (auth, PHI, RLS, migrations) - run integration tests */
  HIGH_RISK: 'high-risk',
});

/**
 * Test patterns that should ALWAYS run regardless of which files changed.
 * These are safety-critical tests that verify red-flag detection, PHI protection,
 * escalation triggers, and constitutional enforcement.
 *
 * @type {string[]}
 */
export const SAFETY_CRITICAL_TEST_PATTERNS = Object.freeze([
  // Red-flag detection tests
  'red-flag',
  'redflag',
  'RedFlag',

  // PHI protection tests
  'phi',
  'PHI',
  'PHIGuard',

  // Escalation trigger tests
  'escalation',
  'Escalation',

  // Privacy detection tests
  'privacy',
  'Privacy',
  'privacyDetector',

  // Constitutional enforcement tests
  'constitutional',
  'Constitutional',

  // Safe prompt wrapper tests
  'safePrompt',
  'SafePrompt',

  // Crisis/emergency handling tests
  'crisis',
  'Crisis',

  // Policy enforcement tests
  'policyReferee',
  'PolicyReferee',
]);

/**
 * Path patterns that indicate high-risk code changes.
 * Changes to these paths should trigger integration tests.
 *
 * WU-2242: Added authentication/ pattern
 *
 * @type {string[]}
 */
// constants: HIGH_RISK_PATH_PATTERNS (skip hardcoded string detection)
export const HIGH_RISK_PATH_PATTERNS = Object.freeze([
  // Authentication (WU-2242: include both auth/ and authentication/)
  '/auth/', // constants
  '/auth.', // constants
  '/authentication/', // constants
  '/authentication.', // constants

  // PHI (Protected Health Information)
  '/phi/',
  '/phi.',

  // Row Level Security
  '/rls/',
  '/rls.',
  'rls.sql',

  // Security policies
  '/policy/',
  '/policy.',

  // Supabase configuration
  'supabase/config',

  // API routes (potential attack surface)
  '/api/',
]);

/**
 * Supabase migrations directory (relative to repo root).
 * @type {string}
 */
const SUPABASE_MIGRATIONS_DIR = 'supabase/supabase/migrations/';

/**
 * Filename patterns that indicate RLS or policy changes in migrations.
 * @type {RegExp[]}
 */
const RLS_MIGRATION_PATTERNS = Object.freeze([
  /policy/i,
  /rls/i,
  /row[_-]?level[_-]?security/i,
  /enable[_-]?rls/i,
]);

/**
 * Check if a test file path matches safety-critical patterns.
 *
 * @param {string} testPath - Path to test file
 * @returns {boolean} True if test is safety-critical
 */
export function isSafetyCriticalTest(testPath) {
  if (!testPath || typeof testPath !== 'string') {
    return false;
  }

  // Normalise Windows paths
  const normalized = testPath.replace(/\\/g, '/');

  // Check if any safety-critical pattern matches
  for (const pattern of SAFETY_CRITICAL_TEST_PATTERNS) {
    if (normalized.includes(pattern)) {
      return true;
    }
  }

  return false;
}

/**
 * Check whether a path refers to a Supabase migration file.
 *
 * @param {string} filePath - Path to check
 * @returns {boolean} True if file is a migration SQL
 */
function isMigrationPath(filePath) {
  if (!filePath || typeof filePath !== 'string') {
    return false;
  }

  const normalized = filePath.replace(/\\/g, '/');
  return normalized.includes(SUPABASE_MIGRATIONS_DIR) && normalized.endsWith('.sql');
}

/**
 * Check if a migration file contains RLS or policy changes.
 *
 * @param {string} filePath - Migration file path
 * @returns {boolean} True if migration is high-risk
 */
export function isHighRiskMigration(filePath) {
  if (!isMigrationPath(filePath)) {
    return false;
  }

  const normalized = filePath.replace(/\\/g, '/');
  const filename = path.basename(normalized);
  return RLS_MIGRATION_PATTERNS.some((pattern) => pattern.test(filename));
}

/**
 * Check if a file path represents a high-risk code change.
 *
 * @param {string} filePath - Path to check
 * @returns {boolean} True if path is high-risk
 */
export function isHighRiskPath(filePath) {
  if (!filePath || typeof filePath !== 'string') {
    return false;
  }

  if (isMigrationPath(filePath)) {
    return false;
  }

  // Normalise Windows paths
  const normalized = filePath.replace(/\\/g, '/');

  // Check if any high-risk pattern matches
  for (const pattern of HIGH_RISK_PATH_PATTERNS) {
    if (normalized.includes(pattern)) {
      return true;
    }
  }

  return false;
}

/**
 * Check if all changed files are documentation-only.
 *
 * @param {string[]} changedFiles - List of changed file paths
 * @returns {boolean} True if all files are documentation
 */
function areAllDocsOnly(changedFiles) {
  if (!changedFiles || changedFiles.length === 0) {
    return true;
  }

  return changedFiles.every((file) => {
    // Normalise Windows paths
    const normalized = file.replace(/\\/g, '/');
    return isDocumentationPath(normalized);
  });
}

/**
 * Find high-risk paths in changed files.
 *
 * @param {string[]} changedFiles - List of changed file paths
 * @returns {string[]} List of high-risk paths found
 */
function findHighRiskPaths(changedFiles) {
  if (!changedFiles || changedFiles.length === 0) {
    return [];
  }

  return changedFiles.filter((file) => {
    // Normalise Windows paths
    const normalized = file.replace(/\\/g, '/');

    if (isMigrationPath(normalized)) {
      return isHighRiskMigration(normalized);
    }

    return isHighRiskPath(normalized);
  });
}

/**
 * Detect the risk tier for a set of changed files.
 *
 * Returns a result object containing:
 * - tier: The detected risk tier
 * - safetyCriticalPatterns: Patterns to filter safety-critical tests
 * - highRiskPaths: List of high-risk paths found in changes
 * - isDocsOnly: Whether this is a docs-only change
 * - shouldRunIntegration: Whether integration tests should run
 *
 * @param {object} options - Detection options
 * @param {string[]} [options.changedFiles=[]] - List of changed file paths
 * @returns {object} Risk detection result
 *
 * @example
 * const result = detectRiskTier({ changedFiles: ['src/lib/auth/getUser.ts'] });
 * // result.tier === 'high-risk'
 * // result.shouldRunIntegration === true
 *
 * @example
 * const result = detectRiskTier({ changedFiles: ['docs/guide.md'] });
 * // result.tier === 'docs-only'
 * // result.isDocsOnly === true
 */
export interface DetectRiskTierOptions {
  /** Array of changed file paths to analyze */
  changedFiles?: string[];
}

export function detectRiskTier(options: DetectRiskTierOptions = {}) {
  const { changedFiles = [] } = options;

  // Normalise all paths
  const normalizedFiles = changedFiles.map((f) => (f ? f.replace(/\\/g, '/') : ''));

  // Check if all files are documentation-only
  const isDocsOnly = areAllDocsOnly(normalizedFiles);

  // Find any high-risk paths
  const highRiskPaths = findHighRiskPaths(normalizedFiles);

  // Determine tier
  let tier;
  if (isDocsOnly) {
    tier = RISK_TIERS.DOCS_ONLY;
  } else if (highRiskPaths.length > 0) {
    tier = RISK_TIERS.HIGH_RISK;
  } else {
    tier = RISK_TIERS.STANDARD;
  }

  // Safety-critical patterns always apply (for test filtering)
  const safetyCriticalPatterns = [...SAFETY_CRITICAL_TEST_PATTERNS];

  return {
    tier,
    safetyCriticalPatterns,
    highRiskPaths,
    isDocsOnly,
    shouldRunIntegration: tier === RISK_TIERS.HIGH_RISK,
  };
}
