// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Gates Configuration Facade
 *
 * WU-1067: Config-driven gates execution
 * WU-2037: Decomposed into focused sub-modules
 *
 * This module is the public entry point for gates configuration.
 * It re-exports from the extracted sub-modules and retains the
 * config-loading, parsing, and lane-health functions that depend
 * on the shared infrastructure.
 *
 * Sub-modules:
 *  - gates-schemas.ts      Zod schemas, types, interfaces
 *  - gates-presets.ts       Preset definitions and expansion
 *  - gates-coverage.ts      Coverage and test policy resolution
 *  - package-manager-resolver.ts  PM, TR, build, commands, ignore
 *  - gates-config-internal.ts     Shared helpers and constants
 *
 * @module gates-config
 */

import { isString } from './object-guards.js';
import { WORKSPACE_CONFIG_FILE_NAME, WORKSPACE_V2_KEYS } from './config-contract.js';
import {
  GatesExecutionConfigSchema,
  LaneHealthModeSchema,
  DEFAULT_LANE_HEALTH_MODE,
} from './gates-schemas.js';
import type {
  GateCommandConfig,
  GatesExecutionConfig,
  ParsedGateCommand,
  LaneHealthMode,
} from './gates-schemas.js';
import { expandPreset } from './gates-presets.js';
import { GATES_RUNTIME_DEFAULTS, GATES_FIELDS, getGatesSection } from './gates-config-internal.js';

// ---------------------------------------------------------------------------
// Re-exports: schemas, types, and interfaces
// ---------------------------------------------------------------------------

export type {
  GateCommandConfig,
  GatesExecutionConfig,
  ParsedGateCommand,
  LaneHealthMode,
  CoverageConfig,
  CoveragePolicy,
  TestRunnerPolicy,
  TestPolicy,
  GatesCommands,
} from './gates-schemas.js';

export {
  GateCommandConfigSchema,
  GatesExecutionConfigSchema,
  LaneHealthModeSchema,
  DEFAULT_LANE_HEALTH_MODE,
} from './gates-schemas.js';

// Re-export presets
export { GATE_PRESETS, expandPreset } from './gates-presets.js';

// Re-export coverage/test policy resolution
export { resolveCoverageConfig, resolveTestPolicy } from './gates-coverage.js';

// Re-export package manager / test runner resolution
export {
  resolvePackageManager,
  resolveTestRunner,
  resolveBuildCommand,
  resolveGatesCommands,
  getIgnorePatterns,
} from './package-manager-resolver.js';

// Re-export shared infrastructure (consumed by child modules and external callers)
export {
  GATES_RUNTIME_DEFAULTS,
  SOFTWARE_DELIVERY_FIELDS,
  GATES_FIELDS,
  GATES_COMMAND_FIELDS,
  loadSoftwareDeliveryConfig,
  getGatesSection,
} from './gates-config-internal.js';

// ---------------------------------------------------------------------------
// Config loading / gate parsing / lane health (facade-owned)
// ---------------------------------------------------------------------------

const SOFTWARE_DELIVERY_KEY = WORKSPACE_V2_KEYS.SOFTWARE_DELIVERY;

/**
 * Parse a gate command configuration into executable form
 *
 * @param config - Gate command configuration (string or object)
 * @returns Parsed command with defaults applied, or null if undefined
 */
export function parseGateCommand(config: GateCommandConfig | undefined): ParsedGateCommand | null {
  if (config === undefined) {
    return null;
  }

  if (isString(config)) {
    return {
      command: config,
      continueOnError: false,
      timeout: GATES_RUNTIME_DEFAULTS.COMMAND_TIMEOUT_MS,
    };
  }

  return {
    command: config.command,
    continueOnError: config.continueOnError ?? false,
    timeout: config.timeout ?? GATES_RUNTIME_DEFAULTS.COMMAND_TIMEOUT_MS,
  };
}

/**
 * Load gates configuration from workspace.yaml software_delivery.gates.execution
 *
 * @param projectRoot - Project root directory
 * @returns Gates execution config, or null if not configured
 */
export function loadGatesConfig(projectRoot: string): GatesExecutionConfig | null {
  const gates = getGatesSection(projectRoot);
  if (!gates) {
    return null;
  }

  try {
    // Check if gates.execution section exists
    const executionConfig = gates[GATES_FIELDS.EXECUTION];
    if (!executionConfig) {
      return null;
    }

    // Validate the config
    const result = GatesExecutionConfigSchema.safeParse(executionConfig);
    if (!result.success) {
      console.warn('Warning: Invalid gates.execution config:', result.error.message);
      return null;
    }

    // Expand preset and merge with explicit config (explicit wins)
    const presetDefaults = expandPreset(result.data.preset);
    const merged: GatesExecutionConfig = {
      ...presetDefaults,
      ...result.data,
    };

    return merged;
  } catch (error) {
    console.warn(
      `Warning: Failed to parse ${WORKSPACE_CONFIG_FILE_NAME} ${SOFTWARE_DELIVERY_KEY}.gates.execution:`,
      error instanceof Error ? error.message : String(error),
    );
    return null;
  }
}

/**
 * Get default gates configuration for auto-detection fallback
 *
 * Used when no gates config is present in workspace.yaml software_delivery.
 * These are generic commands that work across common setups.
 *
 * @returns Default gates configuration
 */
export function getDefaultGatesConfig(): GatesExecutionConfig {
  return {
    format:
      'npm run format:check 2>/dev/null || npx prettier --check . 2>/dev/null || echo "No formatter configured"',
    lint: 'npm run lint 2>/dev/null || npx eslint . 2>/dev/null || echo "No linter configured"',
    typecheck:
      'npm run typecheck 2>/dev/null || npx tsc --noEmit 2>/dev/null || echo "No type checker configured"',
    test: 'npm test 2>/dev/null || echo "No test command configured"',
  };
}

/**
 * Resolve the effective gates configuration
 *
 * Priority order:
 * 1. Explicit config from workspace.yaml software_delivery
 * 2. Preset defaults (if preset specified)
 * 3. Auto-detection defaults
 *
 * @param projectRoot - Project root directory
 * @returns Resolved gates configuration
 */
export function resolveGatesConfig(projectRoot: string): GatesExecutionConfig {
  const config = loadGatesConfig(projectRoot);

  if (config) {
    return config;
  }

  // Fall back to defaults for auto-detection
  return getDefaultGatesConfig();
}

/**
 * Check if a specific gate should be skipped
 *
 * @param gateName - Name of the gate (format, lint, typecheck, test)
 * @param config - Gates execution configuration
 * @param skipFlags - Map of skip flags from CLI/Action inputs
 * @returns True if the gate should be skipped
 */
export function shouldSkipGate(
  gateName: keyof Omit<GatesExecutionConfig, 'preset' | 'coverage'>,
  config: GatesExecutionConfig,
  skipFlags: Record<string, boolean>,
): boolean {
  // Check if skip flag is set
  const skipFlagName = `skip-${gateName}`;
  if (skipFlags[skipFlagName] || skipFlags[gateName]) {
    return true;
  }

  // Check if gate is configured (undefined means skip)
  if (config[gateName] === undefined) {
    return true;
  }

  return false;
}

/**
 * WU-1191: Load lane health configuration from workspace.yaml software_delivery
 *
 * Configuration format:
 * ```yaml
 * gates:
 *   lane_health: warn|error|off
 * ```
 *
 * @param projectRoot - Project root directory
 * @returns Lane health mode ('warn', 'error', or 'off'), defaults to 'warn'
 */
export function loadLaneHealthConfig(projectRoot: string): LaneHealthMode {
  const gates = getGatesSection(projectRoot);
  if (!gates) {
    return DEFAULT_LANE_HEALTH_MODE;
  }

  try {
    // Check if gates.lane_health is configured
    const laneHealthConfig =
      gates[GATES_FIELDS.LANE_HEALTH] ?? gates[GATES_FIELDS.LANE_HEALTH_CAMEL];
    if (laneHealthConfig === undefined) {
      return DEFAULT_LANE_HEALTH_MODE;
    }

    // Validate the config value
    const result = LaneHealthModeSchema.safeParse(laneHealthConfig);
    if (!result.success) {
      console.warn(
        `Warning: Invalid gates.lane_health value '${laneHealthConfig}', expected 'warn', 'error', or 'off'. Using default 'warn'.`,
      );
      return DEFAULT_LANE_HEALTH_MODE;
    }

    return result.data;
  } catch (error) {
    console.warn(
      `Warning: Failed to parse ${WORKSPACE_CONFIG_FILE_NAME} ${SOFTWARE_DELIVERY_KEY}.gates.lane_health:`,
      error instanceof Error ? error.message : String(error),
    );
    return DEFAULT_LANE_HEALTH_MODE;
  }
}
