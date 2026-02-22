// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Package Manager and Test Runner Resolution
 *
 * WU-2037: Extracted from gates-config.ts
 *
 * Resolves package manager, test runner, build commands, gates commands,
 * and ignore patterns from workspace.yaml software_delivery configuration.
 *
 * @module package-manager-resolver
 */

import { asRecord, isString } from './object-guards.js';
import type { GatesCommands } from './gates-schemas.js';
import {
  GATES_RUNTIME_DEFAULTS,
  SOFTWARE_DELIVERY_FIELDS,
  GATES_FIELDS,
  GATES_COMMAND_FIELDS,
  loadSoftwareDeliveryConfig,
  getGatesSection,
} from './gates-config-internal.js';

// ---------------------------------------------------------------------------
// Supported values
// ---------------------------------------------------------------------------

const SUPPORTED_PACKAGE_MANAGERS = ['pnpm', 'npm', 'yarn', 'bun'] as const;
const SUPPORTED_TEST_RUNNERS = ['vitest', 'jest', 'mocha'] as const;

/**
 * WU-1356: Supported package managers type
 */
type PackageManager = (typeof SUPPORTED_PACKAGE_MANAGERS)[number];

/**
 * WU-1356: Supported test runners type
 */
type TestRunner = (typeof SUPPORTED_TEST_RUNNERS)[number];

// ---------------------------------------------------------------------------
// Default command tables
// ---------------------------------------------------------------------------

/**
 * WU-1356: Default gates commands by package manager
 *
 * Provides sensible defaults for different package manager and test runner combinations.
 */
const DEFAULT_GATES_COMMANDS: Record<PackageManager, GatesCommands> = {
  pnpm: {
    test_full: 'pnpm turbo run test',
    test_docs_only: '',
    test_incremental: 'pnpm vitest run --changed origin/main',
    lint: 'pnpm lint',
    typecheck: 'pnpm typecheck',
    format: 'pnpm format:check',
  },
  npm: {
    test_full: 'npm test',
    test_docs_only: '',
    test_incremental: 'npm test -- --onlyChanged',
    lint: 'npm run lint',
    typecheck: 'npm run typecheck',
    format: 'npm run format:check',
  },
  yarn: {
    test_full: 'yarn test',
    test_docs_only: '',
    test_incremental: 'yarn test --onlyChanged',
    lint: 'yarn lint',
    typecheck: 'yarn typecheck',
    format: 'yarn format:check',
  },
  bun: {
    test_full: 'bun test',
    test_docs_only: '',
    test_incremental: 'bun test --changed',
    lint: 'bun run lint',
    typecheck: 'bun run typecheck',
    format: 'bun run format:check',
  },
};

/**
 * WU-1356: Default build commands by package manager
 */
const DEFAULT_BUILD_COMMANDS: Record<PackageManager, string> = {
  pnpm: 'pnpm --filter @lumenflow/cli build',
  npm: 'npm run build --workspace @lumenflow/cli',
  yarn: 'yarn workspace @lumenflow/cli build',
  bun: 'bun run --filter @lumenflow/cli build',
};

/**
 * WU-1356: Ignore patterns by test runner
 *
 * Different test runners use different cache directories that should be ignored.
 */
const IGNORE_PATTERNS_BY_RUNNER: Record<TestRunner, string[]> = {
  vitest: ['.turbo'],
  jest: ['coverage', '.jest-cache'],
  mocha: ['coverage', '.nyc_output'],
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * WU-1356: Resolve package manager from configuration
 *
 * Reads the package_manager field from workspace.yaml software_delivery.
 * Returns 'pnpm' as default if not configured.
 *
 * @param projectRoot - Project root directory
 * @returns Resolved package manager ('pnpm', 'npm', 'yarn', or 'bun')
 */
export function resolvePackageManager(projectRoot: string): PackageManager {
  const softwareDelivery = loadSoftwareDeliveryConfig(projectRoot);
  if (!softwareDelivery) {
    return GATES_RUNTIME_DEFAULTS.DEFAULT_PACKAGE_MANAGER;
  }

  const pm =
    softwareDelivery[SOFTWARE_DELIVERY_FIELDS.PACKAGE_MANAGER] ??
    softwareDelivery[SOFTWARE_DELIVERY_FIELDS.PACKAGE_MANAGER_CAMEL];
  if (isString(pm) && SUPPORTED_PACKAGE_MANAGERS.includes(pm as PackageManager)) {
    return pm as PackageManager;
  }
  return GATES_RUNTIME_DEFAULTS.DEFAULT_PACKAGE_MANAGER;
}

/**
 * WU-1356: Resolve test runner from configuration
 *
 * Reads the test_runner field from workspace.yaml software_delivery.
 * Returns 'vitest' as default if not configured.
 *
 * @param projectRoot - Project root directory
 * @returns Resolved test runner ('vitest', 'jest', or 'mocha')
 */
export function resolveTestRunner(projectRoot: string): TestRunner {
  const softwareDelivery = loadSoftwareDeliveryConfig(projectRoot);
  if (!softwareDelivery) {
    return GATES_RUNTIME_DEFAULTS.DEFAULT_TEST_RUNNER;
  }

  const runner =
    softwareDelivery[SOFTWARE_DELIVERY_FIELDS.TEST_RUNNER] ??
    softwareDelivery[SOFTWARE_DELIVERY_FIELDS.TEST_RUNNER_CAMEL];
  if (isString(runner) && SUPPORTED_TEST_RUNNERS.includes(runner as TestRunner)) {
    return runner as TestRunner;
  }
  return GATES_RUNTIME_DEFAULTS.DEFAULT_TEST_RUNNER;
}

/**
 * WU-1356: Resolve build command from configuration
 *
 * Reads the build_command field from workspace.yaml software_delivery.
 * If not configured, uses default based on package_manager.
 *
 * @param projectRoot - Project root directory
 * @returns Resolved build command
 */
export function resolveBuildCommand(projectRoot: string): string {
  const defaultPm = resolvePackageManager(projectRoot);
  const softwareDelivery = loadSoftwareDeliveryConfig(projectRoot);
  if (!softwareDelivery) {
    return DEFAULT_BUILD_COMMANDS[defaultPm];
  }

  const configuredBuildCommand =
    softwareDelivery[SOFTWARE_DELIVERY_FIELDS.BUILD_COMMAND] ??
    softwareDelivery[SOFTWARE_DELIVERY_FIELDS.BUILD_COMMAND_CAMEL];
  if (isString(configuredBuildCommand) && configuredBuildCommand.length > 0) {
    return configuredBuildCommand;
  }

  return DEFAULT_BUILD_COMMANDS[defaultPm];
}

/**
 * WU-1356: Resolve gates commands from configuration
 *
 * Reads gates.commands from workspace.yaml software_delivery.
 * Merges with defaults based on package_manager if not fully specified.
 *
 * @param projectRoot - Project root directory
 * @returns Resolved gates commands configuration
 */
export function resolveGatesCommands(projectRoot: string): GatesCommands {
  const pm = resolvePackageManager(projectRoot);
  const defaults = DEFAULT_GATES_COMMANDS[pm];
  const gates = getGatesSection(projectRoot);
  if (!gates) {
    return defaults;
  }

  const commands = asRecord(gates[GATES_FIELDS.COMMANDS]);
  if (!commands) {
    return defaults;
  }

  // Merge user config with defaults (user config wins)
  return {
    test_full:
      (commands[GATES_COMMAND_FIELDS.TEST_FULL] as string | undefined) ?? defaults.test_full,
    test_docs_only:
      (commands[GATES_COMMAND_FIELDS.TEST_DOCS_ONLY] as string | undefined) ??
      defaults.test_docs_only,
    test_incremental:
      (commands[GATES_COMMAND_FIELDS.TEST_INCREMENTAL] as string | undefined) ??
      defaults.test_incremental,
    lint: (commands[GATES_COMMAND_FIELDS.LINT] as string | undefined) ?? defaults.lint,
    typecheck:
      (commands[GATES_COMMAND_FIELDS.TYPECHECK] as string | undefined) ?? defaults.typecheck,
    format: (commands[GATES_COMMAND_FIELDS.FORMAT] as string | undefined) ?? defaults.format,
  };
}

/**
 * WU-1356: Get ignore patterns for test runner
 *
 * Returns patterns to ignore when detecting changed tests,
 * based on the test runner configuration.
 *
 * @param testRunner - Test runner type (vitest, jest, mocha)
 * @returns Array of ignore patterns
 */
export function getIgnorePatterns(testRunner: TestRunner): string[] {
  return (
    IGNORE_PATTERNS_BY_RUNNER[testRunner] ??
    IGNORE_PATTERNS_BY_RUNNER[GATES_RUNTIME_DEFAULTS.DEFAULT_TEST_RUNNER]
  );
}
