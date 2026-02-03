/**
 * Gates Configuration
 *
 * WU-1067: Config-driven gates execution
 *
 * Provides a config-driven gates system that allows users to define
 * custom format, lint, test commands in .lumenflow.config.yaml instead
 * of relying on hardcoded language presets.
 *
 * @module gates-config
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as yaml from 'yaml';
import { z } from 'zod';
// WU-1262: Import resolvePolicy for methodology-driven coverage defaults
// Note: resolvePolicy uses type-only import from lumenflow-config-schema, avoiding circular dependency
import {
  resolvePolicy,
  getDefaultPolicy,
  MethodologyConfigSchema,
  type CoverageMode,
} from './resolve-policy.js';

/**
 * Config file name constant to avoid duplicate string literals
 */
const CONFIG_FILE_NAME = '.lumenflow.config.yaml';

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
 * Users can override any field via .lumenflow.config.yaml
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

/**
 * Load gates configuration from .lumenflow.config.yaml
 *
 * @param projectRoot - Project root directory
 * @returns Gates execution config, or null if not configured
 */
export function loadGatesConfig(projectRoot: string): GatesExecutionConfig | null {
  const configPath = path.join(projectRoot, CONFIG_FILE_NAME);

  if (!fs.existsSync(configPath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(configPath, 'utf8');
    const data = yaml.parse(content);

    // Check if gates.execution section exists
    const executionConfig = data?.gates?.execution;
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
      `Warning: Failed to parse ${CONFIG_FILE_NAME}:`,
      error instanceof Error ? error.message : String(error),
    );
    return null;
  }
}

/**
 * Get default gates configuration for auto-detection fallback
 *
 * Used when no gates config is present in .lumenflow.config.yaml.
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
 * 1. Explicit config from .lumenflow.config.yaml
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
 * WU-1191: Load lane health configuration from .lumenflow.config.yaml
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
  const configPath = path.join(projectRoot, CONFIG_FILE_NAME);

  if (!fs.existsSync(configPath)) {
    return DEFAULT_LANE_HEALTH_MODE;
  }

  try {
    const content = fs.readFileSync(configPath, 'utf8');
    const data = yaml.parse(content);

    // Check if gates.lane_health is configured
    const laneHealthConfig = data?.gates?.lane_health;
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
      `Warning: Failed to parse ${CONFIG_FILE_NAME} for lane_health config:`,
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
  const configPath = path.join(projectRoot, CONFIG_FILE_NAME);

  // Load raw config to detect explicit vs default values
  let rawConfig: Record<string, unknown> = {};

  if (fs.existsSync(configPath)) {
    try {
      const content = fs.readFileSync(configPath, 'utf8');
      rawConfig = yaml.parse(content) ?? {};
    } catch {
      // Fall through to use defaults
      rawConfig = {};
    }
  }

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
  const methodologyRaw = rawConfig.methodology as Record<string, unknown> | undefined;
  const gatesRaw = rawConfig.gates as Record<string, unknown> | undefined;

  // Build a minimal config object with only what resolvePolicy needs
  // Parse methodology with Zod to get defaults
  const methodology = MethodologyConfigSchema.parse(methodologyRaw ?? {});

  // Build the config structure that resolvePolicy expects
  const minimalConfig = {
    methodology: methodologyRaw, // Pass raw methodology for explicit detection
    gates: {
      minCoverage: gatesRaw?.minCoverage as number | undefined,
      enableCoverage: gatesRaw?.enableCoverage as boolean | undefined,
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
        enableCoverage:
          gatesRaw?.enableCoverage !== undefined ? Boolean(gatesRaw.enableCoverage) : true,
        minCoverage: typeof gatesRaw?.minCoverage === 'number' ? gatesRaw.minCoverage : 90,
        enableSafetyCriticalTests: true,
        enableInvariants: true,
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Minimal type for config
    } as any,
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
  const configPath = path.join(projectRoot, CONFIG_FILE_NAME);

  // Load raw config to detect explicit vs default values
  let rawConfig: Record<string, unknown> = {};

  if (fs.existsSync(configPath)) {
    try {
      const content = fs.readFileSync(configPath, 'utf8');
      rawConfig = yaml.parse(content) ?? {};
    } catch {
      // Fall through to use defaults
      rawConfig = {};
    }
  }

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
  const methodologyRaw = rawConfig.methodology as Record<string, unknown> | undefined;
  const gatesRaw = rawConfig.gates as Record<string, unknown> | undefined;

  // Parse methodology with Zod to get defaults
  const methodology = MethodologyConfigSchema.parse(methodologyRaw ?? {});

  // Build the config structure that resolvePolicy expects
  const minimalConfig = {
    methodology: methodologyRaw, // Pass raw methodology for explicit detection
    gates: {
      minCoverage: gatesRaw?.minCoverage as number | undefined,
      enableCoverage: gatesRaw?.enableCoverage as boolean | undefined,
    },
  };

  // Resolve policy using the methodology configuration
  const policy = resolvePolicy(
    {
      methodology,
      gates: {
        // Default gates values from schema
        maxEslintWarnings: 100,
        enableCoverage:
          gatesRaw?.enableCoverage !== undefined ? Boolean(gatesRaw.enableCoverage) : true,
        minCoverage: typeof gatesRaw?.minCoverage === 'number' ? gatesRaw.minCoverage : 90,
        enableSafetyCriticalTests: true,
        enableInvariants: true,
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Minimal type for config
    } as any,
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
 * Reads the package_manager field from .lumenflow.config.yaml.
 * Returns 'pnpm' as default if not configured.
 *
 * @param projectRoot - Project root directory
 * @returns Resolved package manager ('pnpm', 'npm', 'yarn', or 'bun')
 */
export function resolvePackageManager(projectRoot: string): PackageManager {
  const configPath = path.join(projectRoot, CONFIG_FILE_NAME);

  if (!fs.existsSync(configPath)) {
    return 'pnpm';
  }

  try {
    const content = fs.readFileSync(configPath, 'utf8');
    const data = yaml.parse(content);

    const pm = data?.package_manager;
    if (pm && ['pnpm', 'npm', 'yarn', 'bun'].includes(pm)) {
      return pm as PackageManager;
    }

    return 'pnpm';
  } catch {
    return 'pnpm';
  }
}

/**
 * WU-1356: Resolve test runner from configuration
 *
 * Reads the test_runner field from .lumenflow.config.yaml.
 * Returns 'vitest' as default if not configured.
 *
 * @param projectRoot - Project root directory
 * @returns Resolved test runner ('vitest', 'jest', or 'mocha')
 */
export function resolveTestRunner(projectRoot: string): TestRunner {
  const configPath = path.join(projectRoot, CONFIG_FILE_NAME);

  if (!fs.existsSync(configPath)) {
    return 'vitest';
  }

  try {
    const content = fs.readFileSync(configPath, 'utf8');
    const data = yaml.parse(content);

    const runner = data?.test_runner;
    if (runner && ['vitest', 'jest', 'mocha'].includes(runner)) {
      return runner as TestRunner;
    }

    return 'vitest';
  } catch {
    return 'vitest';
  }
}

/**
 * WU-1356: Resolve build command from configuration
 *
 * Reads the build_command field from .lumenflow.config.yaml.
 * If not configured, uses default based on package_manager.
 *
 * @param projectRoot - Project root directory
 * @returns Resolved build command
 */
export function resolveBuildCommand(projectRoot: string): string {
  const configPath = path.join(projectRoot, CONFIG_FILE_NAME);
  const defaultPm = resolvePackageManager(projectRoot);

  if (!fs.existsSync(configPath)) {
    return DEFAULT_BUILD_COMMANDS[defaultPm];
  }

  try {
    const content = fs.readFileSync(configPath, 'utf8');
    const data = yaml.parse(content);

    // If explicit build_command is set, use it
    if (data?.build_command && typeof data.build_command === 'string') {
      return data.build_command;
    }

    // Otherwise, use default for the configured package manager
    return DEFAULT_BUILD_COMMANDS[defaultPm];
  } catch {
    return DEFAULT_BUILD_COMMANDS[defaultPm];
  }
}

/**
 * WU-1356: Resolve gates commands from configuration
 *
 * Reads gates.commands from .lumenflow.config.yaml.
 * Merges with defaults based on package_manager if not fully specified.
 *
 * @param projectRoot - Project root directory
 * @returns Resolved gates commands configuration
 */
export function resolveGatesCommands(projectRoot: string): GatesCommands {
  const configPath = path.join(projectRoot, CONFIG_FILE_NAME);
  const pm = resolvePackageManager(projectRoot);
  const defaults = DEFAULT_GATES_COMMANDS[pm];

  if (!fs.existsSync(configPath)) {
    return defaults;
  }

  try {
    const content = fs.readFileSync(configPath, 'utf8');
    const data = yaml.parse(content);

    const commands = data?.gates?.commands;
    if (!commands) {
      return defaults;
    }

    // Merge user config with defaults (user config wins)
    return {
      test_full: commands.test_full ?? defaults.test_full,
      test_docs_only: commands.test_docs_only ?? defaults.test_docs_only,
      test_incremental: commands.test_incremental ?? defaults.test_incremental,
      lint: commands.lint ?? defaults.lint,
      typecheck: commands.typecheck ?? defaults.typecheck,
      format: commands.format ?? defaults.format,
    };
  } catch {
    return defaults;
  }
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
