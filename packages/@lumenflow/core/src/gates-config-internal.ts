// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Gates Configuration Internals
 *
 * WU-2037: Shared infrastructure for gates modules
 *
 * Contains runtime defaults, field-name constants, and config-loading helpers
 * used by gates-config.ts, gates-coverage.ts, and package-manager-resolver.ts.
 *
 * This module exists to break circular imports between the facade (gates-config.ts)
 * and its extracted sub-modules.
 *
 * @module gates-config-internal
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as yaml from 'yaml';
import { WORKSPACE_CONFIG_FILE_NAME, WORKSPACE_V2_KEYS } from './config-contract.js';
import { asRecord } from './object-guards.js';
import { getDefaultPolicy } from './resolve-policy.js';

// ---------------------------------------------------------------------------
// Runtime defaults
// ---------------------------------------------------------------------------

const DEFAULT_POLICY = getDefaultPolicy();

export const GATES_RUNTIME_DEFAULTS = {
  COMMAND_TIMEOUT_MS: 120000,
  MAX_ESLINT_WARNINGS: 100,
  DEFAULT_MIN_COVERAGE: DEFAULT_POLICY.coverage_threshold,
  DEFAULT_ENABLE_COVERAGE: true,
  DEFAULT_PACKAGE_MANAGER: 'pnpm',
  DEFAULT_TEST_RUNNER: 'vitest',
} as const;

// ---------------------------------------------------------------------------
// Field-name constants (avoid magic strings across modules)
// ---------------------------------------------------------------------------

const SOFTWARE_DELIVERY_KEY = WORKSPACE_V2_KEYS.SOFTWARE_DELIVERY;

export const SOFTWARE_DELIVERY_FIELDS = {
  GATES: 'gates',
  METHODOLOGY: 'methodology',
  PACKAGE_MANAGER: 'package_manager',
  PACKAGE_MANAGER_CAMEL: 'packageManager',
  TEST_RUNNER: 'test_runner',
  TEST_RUNNER_CAMEL: 'testRunner',
  BUILD_COMMAND: 'build_command',
  BUILD_COMMAND_CAMEL: 'buildCommand',
} as const;

export const GATES_FIELDS = {
  EXECUTION: 'execution',
  LANE_HEALTH: 'lane_health',
  LANE_HEALTH_CAMEL: 'laneHealth',
  MIN_COVERAGE: 'minCoverage',
  MIN_COVERAGE_SNAKE: 'min_coverage',
  ENABLE_COVERAGE: 'enableCoverage',
  ENABLE_COVERAGE_SNAKE: 'enable_coverage',
  COMMANDS: 'commands',
} as const;

export const GATES_COMMAND_FIELDS = {
  TEST_FULL: 'test_full',
  TEST_DOCS_ONLY: 'test_docs_only',
  TEST_INCREMENTAL: 'test_incremental',
  LINT: 'lint',
  TYPECHECK: 'typecheck',
  FORMAT: 'format',
} as const;

// ---------------------------------------------------------------------------
// Config loading helpers
// ---------------------------------------------------------------------------

/**
 * Load the software_delivery section from workspace.yaml
 *
 * @param projectRoot - Project root directory
 * @returns Parsed software_delivery record, or null
 */
export function loadSoftwareDeliveryConfig(projectRoot: string): Record<string, unknown> | null {
  const configPath = path.join(projectRoot, WORKSPACE_CONFIG_FILE_NAME);

  if (!fs.existsSync(configPath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(configPath, 'utf8');
    const data = asRecord(yaml.parse(content));
    if (!data) {
      return null;
    }
    return asRecord(data[SOFTWARE_DELIVERY_KEY]);
  } catch {
    return null;
  }
}

/**
 * Load the gates sub-section from workspace.yaml software_delivery
 *
 * @param projectRoot - Project root directory
 * @returns Parsed gates record, or null
 */
export function getGatesSection(projectRoot: string): Record<string, unknown> | null {
  const softwareDelivery = loadSoftwareDeliveryConfig(projectRoot);
  if (!softwareDelivery) {
    return null;
  }
  return asRecord(softwareDelivery[SOFTWARE_DELIVERY_FIELDS.GATES]);
}
