// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Gates Coverage Policy Resolution
 *
 * WU-2037: Extracted from gates-config.ts
 *
 * Resolves coverage configuration and test policy from methodology settings.
 * Uses resolvePolicy() to derive thresholds and modes from workspace.yaml.
 *
 * @module gates-coverage
 */

import { asRecord, isBoolean, isNumber } from './object-guards.js';
import { resolvePolicy, getDefaultPolicy, MethodologyConfigSchema } from './resolve-policy.js';
import type { CoverageConfig, TestPolicy } from './gates-schemas.js';
import {
  GATES_RUNTIME_DEFAULTS,
  SOFTWARE_DELIVERY_FIELDS,
  GATES_FIELDS,
  loadSoftwareDeliveryConfig,
} from './gates-config-internal.js';

// ---------------------------------------------------------------------------
// Private helpers for reading typed fields from raw config
// ---------------------------------------------------------------------------

function readNumberField(
  source: Record<string, unknown> | undefined,
  primaryKey: string,
  secondaryKey: string,
): number | undefined {
  const primary = source?.[primaryKey];
  if (isNumber(primary)) {
    return primary;
  }
  const secondary = source?.[secondaryKey];
  return isNumber(secondary) ? secondary : undefined;
}

function readBooleanField(
  source: Record<string, unknown> | undefined,
  primaryKey: string,
  secondaryKey: string,
): boolean | undefined {
  const primary = source?.[primaryKey];
  if (isBoolean(primary)) {
    return primary;
  }
  const secondary = source?.[secondaryKey];
  return isBoolean(secondary) ? secondary : undefined;
}

function readGateMinCoverage(gatesRaw: Record<string, unknown> | undefined): number | undefined {
  return readNumberField(gatesRaw, GATES_FIELDS.MIN_COVERAGE, GATES_FIELDS.MIN_COVERAGE_SNAKE);
}

function readGateEnableCoverage(
  gatesRaw: Record<string, unknown> | undefined,
): boolean | undefined {
  return readBooleanField(
    gatesRaw,
    GATES_FIELDS.ENABLE_COVERAGE,
    GATES_FIELDS.ENABLE_COVERAGE_SNAKE,
  );
}

// ---------------------------------------------------------------------------
// Shared policy resolution helper (DRY: used by both public functions)
// ---------------------------------------------------------------------------

function resolvePolicyFromConfig(rawConfig: Record<string, unknown>) {
  const methodologyRaw = asRecord(rawConfig[SOFTWARE_DELIVERY_FIELDS.METHODOLOGY]) ?? undefined;
  const gatesRaw = asRecord(rawConfig[SOFTWARE_DELIVERY_FIELDS.GATES]) ?? undefined;
  const minCoverage = readGateMinCoverage(gatesRaw);
  const enableCoverage = readGateEnableCoverage(gatesRaw);

  // Parse methodology with Zod to get defaults
  const methodology = MethodologyConfigSchema.parse(methodologyRaw ?? {});

  // Build the config structure that resolvePolicy expects
  const minimalConfig = {
    methodology: methodologyRaw, // Pass raw methodology for explicit detection
    gates: {
      minCoverage,
      enableCoverage,
    },
  };

  // Resolve policy using the methodology configuration
  // Pass rawConfig to detect explicit gates.* settings vs Zod defaults
  return resolvePolicy(
    {
      methodology,
      gates: {
        // Default gates values from schema
        maxEslintWarnings: GATES_RUNTIME_DEFAULTS.MAX_ESLINT_WARNINGS,
        enableCoverage: enableCoverage ?? GATES_RUNTIME_DEFAULTS.DEFAULT_ENABLE_COVERAGE,
        minCoverage: minCoverage ?? GATES_RUNTIME_DEFAULTS.DEFAULT_MIN_COVERAGE,
        enableSafetyCriticalTests: true,
        enableInvariants: true,
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Minimal type for config
    } as unknown as Parameters<typeof resolvePolicy>[0],
    {
      rawConfig: minimalConfig,
    },
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * WU-1262: Resolve coverage configuration from methodology policy
 *
 * Uses resolvePolicy() to determine coverage defaults based on methodology.testing:
 * - tdd: 90% threshold, block mode
 * - test-after: 70% threshold, warn mode
 * - none: 0% threshold, off mode
 *
 * Precedence (highest to lowest):
 * 1. Explicit gates.minCoverage / gates.enableCoverage
 * 2. methodology.overrides.coverage_threshold / coverage_mode
 * 3. methodology.testing template defaults
 *
 * @param projectRoot - Project root directory
 * @returns Resolved coverage configuration
 */
export function resolveCoverageConfig(projectRoot: string): CoverageConfig {
  const rawConfig = loadSoftwareDeliveryConfig(projectRoot) ?? {};

  // If no config file, use default policy
  if (Object.keys(rawConfig).length === 0) {
    const defaultPolicy = getDefaultPolicy();
    return {
      threshold: defaultPolicy.coverage_threshold,
      mode: defaultPolicy.coverage_mode,
    };
  }

  const policy = resolvePolicyFromConfig(rawConfig);

  return {
    threshold: policy.coverage_threshold,
    mode: policy.coverage_mode,
  };
}

/**
 * WU-1280: Resolve test policy from methodology configuration
 *
 * Returns the full test policy including coverage config AND tests_required.
 * This is used by gates to determine whether test failures should block or warn.
 *
 * Methodology mapping:
 * - tdd: 90% threshold, block mode, tests_required=true
 * - test-after: 70% threshold, warn mode, tests_required=true
 * - none: 0% threshold, off mode, tests_required=false
 *
 * When tests_required=false:
 * - Test failures produce WARNINGS instead of FAILURES
 * - Gates continue but log the test failures
 * - Coverage gate is effectively skipped (mode='off')
 *
 * @param projectRoot - Project root directory
 * @returns Resolved test policy including tests_required
 */
export function resolveTestPolicy(projectRoot: string): TestPolicy {
  const rawConfig = loadSoftwareDeliveryConfig(projectRoot) ?? {};

  // If no config file, use default policy (TDD)
  if (Object.keys(rawConfig).length === 0) {
    const defaultPolicy = getDefaultPolicy();
    return {
      threshold: defaultPolicy.coverage_threshold,
      mode: defaultPolicy.coverage_mode,
      tests_required: defaultPolicy.tests_required,
    };
  }

  const policy = resolvePolicyFromConfig(rawConfig);

  return {
    threshold: policy.coverage_threshold,
    mode: policy.coverage_mode,
    tests_required: policy.tests_required,
  };
}
