// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Gates Configuration
 *
 * WU-1067: Config-driven gates execution
 *
 * Provides a config-driven gates system that allows users to define
 * custom format, lint, test commands in workspace.yaml software_delivery instead
 * of relying on hardcoded language presets.
 *
 * @module gates-config
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as yaml from 'yaml';
import { z } from 'zod';
import { WORKSPACE_CONFIG_FILE_NAME, WORKSPACE_V2_KEYS } from './config-contract.js';
// WU-1262: Import resolvePolicy for methodology-driven coverage defaults
// Note: resolvePolicy uses type-only import from lumenflow-config-schema, avoiding circular dependency
import {
  resolvePolicy,
  getDefaultPolicy,
  MethodologyConfigSchema,
  type CoverageMode,
} from './resolve-policy.js';

const SOFTWARE_DELIVERY_KEY = WORKSPACE_V2_KEYS.SOFTWARE_DELIVERY;
const SOFTWARE_DELIVERY_FIELDS = {
  GATES: 'gates',
  METHODOLOGY: 'methodology',
  PACKAGE_MANAGER: 'package_manager',
  PACKAGE_MANAGER_CAMEL: 'packageManager',
  TEST_RUNNER: 'test_runner',
  TEST_RUNNER_CAMEL: 'testRunner',
  BUILD_COMMAND: 'build_command',
  BUILD_COMMAND_CAMEL: 'buildCommand',
} as const;
const GATES_FIELDS = {
  EXECUTION: 'execution',
  LANE_HEALTH: 'lane_health',
  LANE_HEALTH_CAMEL: 'laneHealth',
  MIN_COVERAGE: 'minCoverage',
  MIN_COVERAGE_SNAKE: 'min_coverage',
  ENABLE_COVERAGE: 'enableCoverage',
  ENABLE_COVERAGE_SNAKE: 'enable_coverage',
  COMMANDS: 'commands',
} as const;
const GATES_COMMAND_FIELDS = {
  TEST_FULL: 'test_full',
  TEST_DOCS_ONLY: 'test_docs_only',
  TEST_INCREMENTAL: 'test_incremental',
  LINT: 'lint',
  TYPECHECK: 'typecheck',
  FORMAT: 'format',
} as const;

/**
 * Default timeout for gate commands (2 minutes)
 */
const DEFAULT_GATE_TIMEOUT = 120000;

/**
 * Schema for a gate command object with options
 */
const GateCommandObjectSchema = z.object({
  /** The shell command to execute */
  command: z.string(),
  /** Whether to continue if this gate fails (default: false) */
  continueOnError: z.boolean().optional(),
  /** Timeout in milliseconds (default: 120000) */
  timeout: z.number().int().positive().optional(),
});

/**
 * Schema for a gate command - either a string or an object with options
 */
export const GateCommandConfigSchema = z.union([z.string(), GateCommandObjectSchema]);

/**
 * Type for parsed gate command configuration
 */
export type GateCommandConfig = z.infer<typeof GateCommandConfigSchema>;

/**
 * Schema for the gates execution configuration section
 */
export const GatesExecutionConfigSchema = z.object({
  /** Preset to use for default commands (node, python, go, rust, dotnet) */
  preset: z.string().optional(),
  /** Setup command (e.g., install dependencies) */
  setup: GateCommandConfigSchema.optional(),
  /** Format check command */
  format: GateCommandConfigSchema.optional(),
  /** Lint command */
  lint: GateCommandConfigSchema.optional(),
  /** Type check command */
  typecheck: GateCommandConfigSchema.optional(),
  /** Test command */
  test: GateCommandConfigSchema.optional(),
  /** Coverage configuration */
  coverage: z
    .union([
      z.string(),
      z.object({
        command: z.string(),
        threshold: z.number().min(0).max(100).optional(),
      }),
    ])
    .optional(),
});

/**
 * Type for gates execution configuration
 */
export type GatesExecutionConfig = z.infer<typeof GatesExecutionConfigSchema>;

/**
 * Parsed gate command ready for execution
 */
export interface ParsedGateCommand {
  /** The shell command to execute */
  command: string;
  /** Whether to continue if this gate fails */
  continueOnError: boolean;
  /** Timeout in milliseconds */
  timeout: number;
}

/**
 * Gate preset definitions
 *
 * These provide sensible defaults for common language ecosystems.
 * Users can override fields via workspace.yaml software_delivery
 */
export const GATE_PRESETS: Record<string, Partial<GatesExecutionConfig>> = {
  node: {
    setup: 'npm ci || npm install',
    format: 'npx prettier --check .',
    lint: 'npx eslint .',
    typecheck: 'npx tsc --noEmit',
    test: 'npm test',
  },
  python: {
    setup: 'pip install -e ".[dev]" || pip install -r requirements.txt',
    format: 'ruff format --check .',
    lint: 'ruff check .',
    typecheck: 'mypy .',
    test: 'pytest',
  },
  go: {
    format: 'gofmt -l . | grep -v "^$" && exit 1 || exit 0',
    lint: 'golangci-lint run',
    typecheck: 'go vet ./...',
    test: 'go test ./...',
  },
  rust: {
    format: 'cargo fmt --check',
    lint: 'cargo clippy -- -D warnings',
    typecheck: 'cargo check',
    test: 'cargo test',
  },
  dotnet: {
    setup: 'dotnet restore',
    format: 'dotnet format --verify-no-changes',
    lint: 'dotnet build --no-restore -warnaserror',
    test: 'dotnet test --no-restore',
  },
  // WU-1118: Java/JVM, Ruby, and PHP presets
  java: {
    format: 'mvn spotless:check || ./gradlew spotlessCheck',
    lint: 'mvn checkstyle:check || ./gradlew checkstyleMain',
    typecheck: 'mvn compile -DskipTests || ./gradlew compileJava',
    test: 'mvn test || ./gradlew test',
  },
  ruby: {
    setup: 'bundle install',
    format: 'bundle exec rubocop --format simple --fail-level W',
    lint: 'bundle exec rubocop',
    test: 'bundle exec rspec',
  },
  php: {
    setup: 'composer install',
    format: 'vendor/bin/php-cs-fixer fix --dry-run --diff',
    lint: 'vendor/bin/phpstan analyse',
    test: 'vendor/bin/phpunit',
  },
};

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

  if (typeof config === 'string') {
    return {
      command: config,
      continueOnError: false,
      timeout: DEFAULT_GATE_TIMEOUT,
    };
  }

  return {
    command: config.command,
    continueOnError: config.continueOnError ?? false,
    timeout: config.timeout ?? DEFAULT_GATE_TIMEOUT,
  };
}

/**
 * Expand a preset name into its default gate commands
 *
 * @param preset - Preset name (node, python, go, rust, dotnet) or undefined
 * @returns Partial gates config with preset defaults, or empty object if unknown
 */
export function expandPreset(preset: string | undefined): Partial<GatesExecutionConfig> {
  if (!preset) {
    return {};
  }

  return GATE_PRESETS[preset] ?? {};
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function loadSoftwareDeliveryConfig(projectRoot: string): Record<string, unknown> | null {
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

function getGatesSection(projectRoot: string): Record<string, unknown> | null {
  const softwareDelivery = loadSoftwareDeliveryConfig(projectRoot);
  if (!softwareDelivery) {
    return null;
  }
  return asRecord(softwareDelivery[SOFTWARE_DELIVERY_FIELDS.GATES]);
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
 * WU-1191: Lane health gate mode
 * Controls how lane health check behaves during gates
 */
export type LaneHealthMode = 'warn' | 'error' | 'off';

/**
 * Schema for lane health mode validation
 */
const LaneHealthModeSchema = z.enum(['warn', 'error', 'off']);

/**
 * Default lane health mode (advisory by default)
 */
const DEFAULT_LANE_HEALTH_MODE: LaneHealthMode = 'warn';

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

/**
 * WU-1262: Resolved coverage configuration
 * Contains threshold and mode derived from methodology policy
 */
export interface CoverageConfig {
  /** Coverage threshold (0-100) */
  threshold: number;
  /** Coverage mode (block, warn, or off) */
  mode: CoverageMode;
}

function readNumberField(
  source: Record<string, unknown> | undefined,
  primaryKey: string,
  secondaryKey: string,
): number | undefined {
  const primary = source?.[primaryKey];
  if (typeof primary === 'number') {
    return primary;
  }
  const secondary = source?.[secondaryKey];
  return typeof secondary === 'number' ? secondary : undefined;
}

function readBooleanField(
  source: Record<string, unknown> | undefined,
  primaryKey: string,
  secondaryKey: string,
): boolean | undefined {
  const primary = source?.[primaryKey];
  if (typeof primary === 'boolean') {
    return primary;
  }
  const secondary = source?.[secondaryKey];
  return typeof secondary === 'boolean' ? secondary : undefined;
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

  // Parse methodology config manually to avoid circular dependency with lumenflow-config-schema.ts
  // (lumenflow-config-schema.ts imports GatesExecutionConfigSchema from this file)
  const methodologyRaw = asRecord(rawConfig[SOFTWARE_DELIVERY_FIELDS.METHODOLOGY]) ?? undefined;
  const gatesRaw = asRecord(rawConfig[SOFTWARE_DELIVERY_FIELDS.GATES]) ?? undefined;
  const minCoverage = readGateMinCoverage(gatesRaw);
  const enableCoverage = readGateEnableCoverage(gatesRaw);

  // Build a minimal config object with only what resolvePolicy needs
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
  const policy = resolvePolicy(
    {
      methodology,
      gates: {
        // Default gates values from schema
        maxEslintWarnings: 100,
        enableCoverage: enableCoverage ?? true,
        minCoverage: minCoverage ?? 90,
        enableSafetyCriticalTests: true,
        enableInvariants: true,
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Minimal type for config
    } as UnsafeAny,
    {
      rawConfig: minimalConfig,
    },
  );

  return {
    threshold: policy.coverage_threshold,
    mode: policy.coverage_mode,
  };
}

/**
 * WU-1280: Resolved test policy configuration
 * Extends CoverageConfig with tests_required from methodology policy
 */
export interface TestPolicy extends CoverageConfig {
  /** Whether tests are required for completion (from methodology.testing) */
  tests_required: boolean;
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

  // Parse methodology config manually to avoid circular dependency with lumenflow-config-schema.ts
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
  const policy = resolvePolicy(
    {
      methodology,
      gates: {
        // Default gates values from schema
        maxEslintWarnings: 100,
        enableCoverage: enableCoverage ?? true,
        minCoverage: minCoverage ?? 90,
        enableSafetyCriticalTests: true,
        enableInvariants: true,
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Minimal type for config
    } as UnsafeAny,
    {
      rawConfig: minimalConfig,
    },
  );

  return {
    threshold: policy.coverage_threshold,
    mode: policy.coverage_mode,
    tests_required: policy.tests_required,
  };
}

/**
 * WU-1356: Supported package managers type
 * Re-exported from lumenflow-config-schema to avoid circular import
 */
type PackageManager = 'pnpm' | 'npm' | 'yarn' | 'bun';

/**
 * WU-1356: Supported test runners type
 * Re-exported from lumenflow-config-schema to avoid circular import
 */
type TestRunner = 'vitest' | 'jest' | 'mocha';

/**
 * WU-1356: Gates commands configuration type
 */
export interface GatesCommands {
  test_full: string;
  test_docs_only: string;
  test_incremental: string;
  lint?: string;
  typecheck?: string;
  format?: string;
}

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
    return 'pnpm';
  }

  const pm =
    softwareDelivery[SOFTWARE_DELIVERY_FIELDS.PACKAGE_MANAGER] ??
    softwareDelivery[SOFTWARE_DELIVERY_FIELDS.PACKAGE_MANAGER_CAMEL];
  if (typeof pm === 'string' && ['pnpm', 'npm', 'yarn', 'bun'].includes(pm)) {
    return pm as PackageManager;
  }
  return 'pnpm';
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
    return 'vitest';
  }

  const runner =
    softwareDelivery[SOFTWARE_DELIVERY_FIELDS.TEST_RUNNER] ??
    softwareDelivery[SOFTWARE_DELIVERY_FIELDS.TEST_RUNNER_CAMEL];
  if (typeof runner === 'string' && ['vitest', 'jest', 'mocha'].includes(runner)) {
    return runner as TestRunner;
  }
  return 'vitest';
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
  if (typeof configuredBuildCommand === 'string' && configuredBuildCommand.length > 0) {
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
  return IGNORE_PATTERNS_BY_RUNNER[testRunner] ?? ['.turbo'];
}
