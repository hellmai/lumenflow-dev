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
};

/**
 * Parse a gate command configuration into executable form
 *
 * @param config - Gate command configuration (string or object)
 * @returns Parsed command with defaults applied, or null if undefined
 */
export function parseGateCommand(
  config: GateCommandConfig | undefined,
): ParsedGateCommand | null {
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
export function expandPreset(
  preset: string | undefined,
): Partial<GatesExecutionConfig> {
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
export function loadGatesConfig(
  projectRoot: string,
): GatesExecutionConfig | null {
  const configPath = path.join(projectRoot, '.lumenflow.config.yaml');

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
      'Warning: Failed to parse .lumenflow.config.yaml:',
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
    format: 'npm run format:check 2>/dev/null || npx prettier --check . 2>/dev/null || echo "No formatter configured"',
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
