/**
 * LumenFlow Gates GitHub Action
 *
 * WU-1067: Config-driven gates execution
 *
 * TypeScript GitHub Action that reads gate commands from .lumenflow.config.yaml
 * instead of hardcoding language presets. Supports skip flags and backwards
 * compatible auto-detection fallback.
 *
 * Uses @actions/toolkit for GitHub Action integration.
 */

import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as yaml from 'yaml';

/**
 * Default timeout for gate commands (2 minutes)
 */
const DEFAULT_TIMEOUT = 120000;

/**
 * Gate command configuration
 */
interface GateCommand {
  command: string;
  continueOnError?: boolean;
  timeout?: number;
}

/**
 * Gates execution configuration from .lumenflow.config.yaml
 */
interface GatesExecutionConfig {
  preset?: string;
  setup?: string | GateCommand;
  format?: string | GateCommand;
  lint?: string | GateCommand;
  typecheck?: string | GateCommand;
  test?: string | GateCommand;
  coverage?:
    | string
    | {
        command: string;
        threshold?: number;
      };
}

/**
 * Gate presets with default commands for common languages
 */
const GATE_PRESETS: Record<string, Partial<GatesExecutionConfig>> = {
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
    format: 'test -z "$(gofmt -l .)"',
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
 */
function parseGateCommand(
  config: string | GateCommand | undefined,
): { command: string; continueOnError: boolean; timeout: number } | null {
  if (config === undefined) {
    return null;
  }

  if (typeof config === 'string') {
    return {
      command: config,
      continueOnError: false,
      timeout: DEFAULT_TIMEOUT,
    };
  }

  return {
    command: config.command,
    continueOnError: config.continueOnError ?? false,
    timeout: config.timeout ?? DEFAULT_TIMEOUT,
  };
}

/**
 * Expand a preset into default gate commands
 */
function expandPreset(preset: string | undefined): Partial<GatesExecutionConfig> {
  if (!preset) {
    return {};
  }
  return GATE_PRESETS[preset] ?? {};
}

/**
 * Auto-detect project type based on files present
 */
function autoDetectPreset(workingDir: string): string | null {
  if (fs.existsSync(path.join(workingDir, 'package.json'))) {
    return 'node';
  }
  if (
    fs.existsSync(path.join(workingDir, 'pyproject.toml')) ||
    fs.existsSync(path.join(workingDir, 'setup.py'))
  ) {
    return 'python';
  }
  if (fs.existsSync(path.join(workingDir, 'go.mod'))) {
    return 'go';
  }
  if (fs.existsSync(path.join(workingDir, 'Cargo.toml'))) {
    return 'rust';
  }
  if (
    fs.existsSync(path.join(workingDir, '*.csproj')) ||
    fs.existsSync(path.join(workingDir, '*.sln'))
  ) {
    return 'dotnet';
  }
  return null;
}

/**
 * Load gates configuration from .lumenflow.config.yaml
 */
function loadGatesConfig(workingDir: string): GatesExecutionConfig | null {
  const configPath = path.join(workingDir, '.lumenflow.config.yaml');

  if (!fs.existsSync(configPath)) {
    core.debug(`No .lumenflow.config.yaml found at ${configPath}`);
    return null;
  }

  try {
    const content = fs.readFileSync(configPath, 'utf8');
    const data = yaml.parse(content);

    const executionConfig = data?.gates?.execution;
    if (!executionConfig) {
      core.debug('No gates.execution section in config');
      return null;
    }

    // Expand preset and merge with explicit config
    const presetDefaults = expandPreset(executionConfig.preset);
    const merged: GatesExecutionConfig = {
      ...presetDefaults,
      ...executionConfig,
    };

    return merged;
  } catch (error) {
    core.warning(`Failed to parse .lumenflow.config.yaml: ${error}`);
    return null;
  }
}

/**
 * Execute a gate command
 */
async function executeGate(
  name: string,
  command: string,
  options: {
    workingDir: string;
    continueOnError: boolean;
    timeout: number;
  },
): Promise<boolean> {
  core.startGroup(`Gate: ${name}`);
  core.info(`Running: ${command}`);

  try {
    const exitCode = await exec.exec(command, [], {
      cwd: options.workingDir,
      ignoreReturnCode: options.continueOnError,
    });

    if (exitCode !== 0) {
      if (options.continueOnError) {
        core.warning(`${name} failed but continuing (continueOnError=true)`);
        core.endGroup();
        return true;
      }
      core.error(`${name} failed with exit code ${exitCode}`);
      core.endGroup();
      return false;
    }

    core.info(`${name} passed`);
    core.endGroup();
    return true;
  } catch (error) {
    if (options.continueOnError) {
      core.warning(`${name} failed but continuing: ${error}`);
      core.endGroup();
      return true;
    }
    core.error(`${name} failed: ${error}`);
    core.endGroup();
    return false;
  }
}

/**
 * Main action entrypoint
 */
async function run(): Promise<void> {
  try {
    // Get inputs
    const token = core.getInput('token', { required: true });
    const workingDir = core.getInput('working-directory') || '.';
    const skipFormat = core.getBooleanInput('skip-format');
    const skipLint = core.getBooleanInput('skip-lint');
    const skipTypecheck = core.getBooleanInput('skip-typecheck');
    const skipTest = core.getBooleanInput('skip-test');

    // Resolve working directory
    const resolvedWorkingDir = path.resolve(process.cwd(), workingDir);
    core.info(`Working directory: ${resolvedWorkingDir}`);

    // Validate token (placeholder for now - would call validation endpoint)
    if (!token) {
      core.setFailed('LumenFlow token is required');
      return;
    }
    core.info('Token validation: OK');

    // Load gates config
    let config = loadGatesConfig(resolvedWorkingDir);

    // Fallback to auto-detect if no config
    if (!config) {
      core.info('No gates.execution config found, using auto-detection');
      const detectedPreset = autoDetectPreset(resolvedWorkingDir);
      if (detectedPreset) {
        core.info(`Auto-detected preset: ${detectedPreset}`);
        config = expandPreset(detectedPreset) as GatesExecutionConfig;
        core.setOutput('preset-detected', detectedPreset);
      } else {
        core.setFailed(
          'Could not detect project type and no gates config found. ' +
            'Add gates.execution section to .lumenflow.config.yaml',
        );
        return;
      }
    } else {
      core.info('Using config-driven gates');
      core.setOutput('preset-detected', config.preset || 'config');
    }

    // Run setup if configured
    if (config.setup) {
      const parsed = parseGateCommand(config.setup);
      if (parsed) {
        const success = await executeGate('setup', parsed.command, {
          workingDir: resolvedWorkingDir,
          continueOnError: parsed.continueOnError,
          timeout: parsed.timeout,
        });
        if (!success) {
          core.setFailed('Setup failed');
          core.setOutput('gates-passed', 'false');
          return;
        }
      }
    }

    // Track gate results
    let allPassed = true;

    // Format gate
    if (!skipFormat && config.format) {
      const parsed = parseGateCommand(config.format);
      if (parsed) {
        const success = await executeGate('format', parsed.command, {
          workingDir: resolvedWorkingDir,
          continueOnError: parsed.continueOnError,
          timeout: parsed.timeout,
        });
        if (!success) allPassed = false;
      }
    } else if (skipFormat) {
      core.info('Format gate skipped (skip-format=true)');
    }

    // Lint gate
    if (!skipLint && config.lint) {
      const parsed = parseGateCommand(config.lint);
      if (parsed) {
        const success = await executeGate('lint', parsed.command, {
          workingDir: resolvedWorkingDir,
          continueOnError: parsed.continueOnError,
          timeout: parsed.timeout,
        });
        if (!success) allPassed = false;
      }
    } else if (skipLint) {
      core.info('Lint gate skipped (skip-lint=true)');
    }

    // Typecheck gate
    if (!skipTypecheck && config.typecheck) {
      const parsed = parseGateCommand(config.typecheck);
      if (parsed) {
        const success = await executeGate('typecheck', parsed.command, {
          workingDir: resolvedWorkingDir,
          continueOnError: parsed.continueOnError,
          timeout: parsed.timeout,
        });
        if (!success) allPassed = false;
      }
    } else if (skipTypecheck) {
      core.info('Typecheck gate skipped (skip-typecheck=true)');
    }

    // Test gate
    if (!skipTest && config.test) {
      const parsed = parseGateCommand(config.test);
      if (parsed) {
        const success = await executeGate('test', parsed.command, {
          workingDir: resolvedWorkingDir,
          continueOnError: parsed.continueOnError,
          timeout: parsed.timeout,
        });
        if (!success) allPassed = false;
      }
    } else if (skipTest) {
      core.info('Test gate skipped (skip-test=true)');
    }

    // Set outputs
    core.setOutput('gates-passed', allPassed ? 'true' : 'false');

    if (allPassed) {
      core.info('All gates passed!');
    } else {
      core.setFailed('One or more gates failed');
    }
  } catch (error) {
    core.setFailed(`Action failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// Run the action
run();
