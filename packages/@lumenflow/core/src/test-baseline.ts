/**
 * Test Baseline - Test Ratchet Pattern (WU-1253)
 *
 * Implements a "ratchet" pattern for test failures:
 * - Track known failures in a baseline file (.lumenflow/test-baseline.json)
 * - Block NEW failures (not in baseline)
 * - Allow pre-existing failures with warning
 * - Auto-update baseline when tests are fixed (ratchet forward)
 *
 * This enables agents to work on WUs without being blocked by unrelated
 * test failures, while still preventing introduction of NEW failures.
 *
 * @see https://lumenflow.dev/reference/test-ratchet/
 */

import { z } from 'zod';
import { parseISO, isValid } from 'date-fns';
import { LUMENFLOW_PATHS } from './wu-constants.js';

// ============================================================================
// Constants
// ============================================================================

/** Default path for the test baseline file (WU-1430: Use centralized constant) */
export const DEFAULT_BASELINE_PATH = LUMENFLOW_PATHS.TEST_BASELINE;

/** Environment variable to override baseline path */
export const BASELINE_PATH_ENV = 'LUMENFLOW_TEST_BASELINE';

/** Current schema version */
export const BASELINE_VERSION = 1;

/**
 * Zod schema for ISO8601 datetime strings.
 * Uses date-fns (well-maintained library) for validation instead of regex.
 */
const isoDateTimeString = z.string().refine(
  (val) => {
    const parsed = parseISO(val);
    return isValid(parsed);
  },
  { message: 'Invalid ISO8601 datetime string' },
);

// ============================================================================
// Schema Definitions
// ============================================================================

/**
 * Schema for a known test failure entry
 */
export const KnownFailureSchema = z.object({
  /** Name of the failing test (describe > it format) */
  test_name: z.string().min(1),

  /** Path to the test file */
  file_path: z.string().min(1),

  /** Why this failure is in the baseline */
  failure_reason: z.string().min(1),

  /** When this failure was added to baseline */
  added_at: isoDateTimeString,

  /** Which WU added this to baseline */
  added_by_wu: z.string().regex(/^WU-\d+$/),

  /** WU expected to fix this failure (optional) */
  expected_fix_wu: z
    .string()
    .regex(/^WU-\d+$/)
    .optional(),

  /** Optional reason for skipping this test */
  skip_reason: z.string().optional(),
});

export type KnownFailure = z.infer<typeof KnownFailureSchema>;

/**
 * Schema for baseline statistics
 */
export const BaselineStatsSchema = z.object({
  /** Total number of known failures */
  total_known_failures: z.number().int().min(0),

  /** Last time the baseline ratcheted forward (tests fixed) */
  last_ratchet_forward: isoDateTimeString.optional(),
});

export type BaselineStats = z.infer<typeof BaselineStatsSchema>;

/**
 * Schema for the complete test baseline file
 */
export const TestBaselineSchema = z.object({
  /** Schema version for future migrations */
  version: z.literal(BASELINE_VERSION),

  /** When the baseline was last updated */
  updated_at: isoDateTimeString,

  /** Which WU last updated the baseline */
  updated_by: z.string().regex(/^WU-\d+$/),

  /** List of known test failures */
  known_failures: z.array(KnownFailureSchema),

  /** Baseline statistics */
  stats: BaselineStatsSchema,
});

export type TestBaseline = z.infer<typeof TestBaselineSchema>;

// ============================================================================
// Types
// ============================================================================

/**
 * Result from a test run (input to comparison)
 */
export interface TestResult {
  test_name: string;
  file_path: string;
  passed: boolean;
  error_message?: string;
}

/**
 * Result of comparing test results against baseline
 */
export interface BaselineComparison {
  /** Tests that failed but are NOT in baseline (blocks gate) */
  newFailures: TestResult[];

  /** Tests that failed and ARE in baseline (warning only) */
  preExistingFailures: KnownFailure[];

  /** Tests that were in baseline but now pass (ratchet forward candidates) */
  fixedTests: KnownFailure[];

  /** Should this block the gate? (true if newFailures > 0) */
  shouldBlock: boolean;

  /** Are there warnings to show? (true if preExistingFailures > 0) */
  hasWarnings: boolean;

  /** Should baseline be updated? (true if fixedTests > 0) */
  shouldRatchetForward: boolean;
}

/**
 * Parse result type
 */
export type ParseResult<T> = { success: true; data: T } | { success: false; error: string };

/**
 * Options for updating the baseline
 */
export interface UpdateBaselineOptions {
  /** Tests that were fixed (to remove from baseline) */
  fixedTests?: string[];

  /** New known failures to add to baseline */
  newKnownFailures?: Array<{
    test_name: string;
    file_path: string;
    failure_reason: string;
    expected_fix_wu?: string;
  }>;
}

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Parse a test baseline JSON string
 *
 * @param json - JSON string content of baseline file
 * @returns Parse result with baseline data or error
 */
export function parseTestBaseline(json: string): ParseResult<TestBaseline> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    return {
      success: false,
      error: `Invalid JSON: ${e instanceof Error ? e.message : 'Unknown error'}`,
    };
  }

  const result = TestBaselineSchema.safeParse(parsed);
  if (!result.success) {
    return {
      success: false,
      error: `Schema validation failed: ${result.error.message}`,
    };
  }

  return { success: true, data: result.data };
}

/**
 * Create a new test baseline
 *
 * @param wuId - WU creating the baseline
 * @param initialFailures - Optional initial failures to add
 * @returns New test baseline
 */
export function createTestBaseline(
  wuId: string,
  initialFailures?: Array<{
    test_name: string;
    file_path: string;
    failure_reason: string;
    expected_fix_wu?: string;
  }>,
): TestBaseline {
  const now = new Date().toISOString();

  const knownFailures: KnownFailure[] = (initialFailures ?? []).map((f) => ({
    test_name: f.test_name,
    file_path: f.file_path,
    failure_reason: f.failure_reason,
    added_at: now,
    added_by_wu: wuId,
    expected_fix_wu: f.expected_fix_wu,
  }));

  return {
    version: BASELINE_VERSION,
    updated_at: now,
    updated_by: wuId,
    known_failures: knownFailures,
    stats: {
      total_known_failures: knownFailures.length,
    },
  };
}

/**
 * Compare current test results against the baseline
 *
 * This is the core ratchet logic:
 * - NEW failures (not in baseline) block the gate
 * - Pre-existing failures (in baseline) show warning
 * - Fixed tests (in baseline but now passing) trigger ratchet forward
 *
 * @param baseline - The test baseline
 * @param currentFailures - Current test failures from test run
 * @returns Comparison result
 */
export function compareTestResults(
  baseline: TestBaseline,
  currentFailures: TestResult[],
): BaselineComparison {
  const failingTests = currentFailures.filter((t) => !t.passed);

  // Build lookup sets for efficient comparison
  const baselineTestNames = new Set(baseline.known_failures.map((f) => f.test_name));
  const currentFailingNames = new Set(failingTests.map((f) => f.test_name));

  // Find NEW failures (in current failures, NOT in baseline)
  const newFailures = failingTests.filter((f) => !baselineTestNames.has(f.test_name));

  // Find pre-existing failures (in current failures AND in baseline)
  const preExistingFailures = baseline.known_failures.filter((f) =>
    currentFailingNames.has(f.test_name),
  );

  // Find fixed tests (in baseline but NOT in current failures)
  const fixedTests = baseline.known_failures.filter((f) => !currentFailingNames.has(f.test_name));

  return {
    newFailures,
    preExistingFailures,
    fixedTests,
    shouldBlock: newFailures.length > 0,
    hasWarnings: preExistingFailures.length > 0,
    shouldRatchetForward: fixedTests.length > 0,
  };
}

/**
 * Update the baseline (ratchet forward or add new known failures)
 *
 * @param baseline - Current baseline
 * @param wuId - WU making the update
 * @param options - Update options
 * @returns Updated baseline (immutable)
 */
export function updateBaseline(
  baseline: TestBaseline,
  wuId: string,
  options: UpdateBaselineOptions,
): TestBaseline {
  const now = new Date().toISOString();
  const { fixedTests = [], newKnownFailures = [] } = options;

  // Remove fixed tests (ratchet forward)
  const fixedTestSet = new Set(fixedTests);
  let knownFailures = baseline.known_failures.filter((f) => !fixedTestSet.has(f.test_name));

  // Add new known failures
  const newEntries: KnownFailure[] = newKnownFailures.map((f) => ({
    test_name: f.test_name,
    file_path: f.file_path,
    failure_reason: f.failure_reason,
    added_at: now,
    added_by_wu: wuId,
    expected_fix_wu: f.expected_fix_wu,
  }));
  knownFailures = [...knownFailures, ...newEntries];

  const stats: BaselineStats = {
    total_known_failures: knownFailures.length,
  };

  // Record ratchet forward if we removed tests
  if (fixedTests.length > 0) {
    stats.last_ratchet_forward = now;
  }

  return {
    version: BASELINE_VERSION,
    updated_at: now,
    updated_by: wuId,
    known_failures: knownFailures,
    stats,
  };
}

// ============================================================================
// Formatting Functions
// ============================================================================

/**
 * Format a warning message for pre-existing failures
 *
 * @param preExisting - Pre-existing failures from baseline
 * @returns Formatted warning string
 */
export function formatBaselineWarning(preExisting: KnownFailure[]): string {
  const lines = [
    '',
    '='.repeat(70),
    '  Pre-existing test failures (from baseline)',
    '='.repeat(70),
    '',
    `  These failures are tracked in .lumenflow/test-baseline.json`,
    '  They do not block your WU, but should be fixed eventually.',
    '',
  ];

  for (const failure of preExisting) {
    lines.push(`  - ${failure.test_name}`);
    lines.push(`    File: ${failure.file_path}`);
    lines.push(`    Reason: ${failure.failure_reason}`);
    if (failure.expected_fix_wu) {
      lines.push(`    Expected fix: ${failure.expected_fix_wu}`);
    }
    lines.push('');
  }

  lines.push('='.repeat(70));

  return lines.join('\n');
}

/**
 * Format an error message for new failures
 *
 * @param newFailures - New test failures
 * @returns Formatted error string
 */
export function formatNewFailureError(newFailures: TestResult[]): string {
  const lines = [
    '',
    '='.repeat(70),
    '  NEW test failure(s) detected!',
    '='.repeat(70),
    '',
    '  The following tests failed and are NOT in the baseline.',
    '  This blocks your WU from completion.',
    '',
    '  Options:',
    '    1. Fix the test or add to baseline with:',
    '       pnpm baseline:add --test "<test_name>" --reason "<why>" --fix-wu WU-XXXX',
    '    2. If this is a pre-existing failure on main, it should be in the baseline.',
    '',
  ];

  for (const failure of newFailures) {
    lines.push(`  - ${failure.test_name}`);
    lines.push(`    File: ${failure.file_path}`);
    if (failure.error_message) {
      lines.push(`    Error: ${failure.error_message.substring(0, 100)}...`);
    }
    lines.push('');
  }

  lines.push('='.repeat(70));

  return lines.join('\n');
}

/**
 * Get the path to the test baseline file
 *
 * @returns Baseline file path
 */
export function getBaselineFilePath(): string {
  return process.env[BASELINE_PATH_ENV] ?? DEFAULT_BASELINE_PATH;
}
