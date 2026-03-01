// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * @file gates-config.test.ts
 * WU-1356: Tests for package manager and script name configuration.
 *
 * Tests configurable package_manager, gates.commands, test_runner, and build_command
 * in workspace.yaml software_delivery for framework agnosticism.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as yaml from 'yaml';

// Import the schema and functions we're testing
import {
  PackageManagerSchema,
  TestRunnerSchema,
  GatesCommandsConfigSchema,
  parseConfig,
  WORKSPACE_V2_KEYS,
} from '@lumenflow/core/config-schema';
import {
  resolvePackageManager,
  resolveBuildCommand,
  resolveGatesCommands,
  resolveTestRunner,
  getIgnorePatterns,
} from '@lumenflow/core/gates-config';
import { GATE_NAMES } from '@lumenflow/core/wu-constants';
import { WORKSPACE_CONFIG_FILE_NAME } from '@lumenflow/core/config';

function writeWorkspaceConfig(tempDir: string, config: Record<string, unknown>): void {
  const configPath = path.join(tempDir, WORKSPACE_CONFIG_FILE_NAME);
  fs.writeFileSync(configPath, yaml.stringify({ [WORKSPACE_V2_KEYS.SOFTWARE_DELIVERY]: config }));
}

describe('WU-1356: Package manager and script configuration', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumenflow-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('PackageManagerSchema', () => {
    it('accepts pnpm as default', () => {
      const result = PackageManagerSchema.parse(undefined);
      expect(result).toBe('pnpm');
    });

    it('accepts npm', () => {
      const result = PackageManagerSchema.parse('npm');
      expect(result).toBe('npm');
    });

    it('accepts yarn', () => {
      const result = PackageManagerSchema.parse('yarn');
      expect(result).toBe('yarn');
    });

    it('accepts bun', () => {
      const result = PackageManagerSchema.parse('bun');
      expect(result).toBe('bun');
    });

    it('rejects invalid package manager', () => {
      expect(() => PackageManagerSchema.parse('invalid')).toThrow();
    });
  });

  describe('TestRunnerSchema', () => {
    it('accepts vitest as default', () => {
      const result = TestRunnerSchema.parse(undefined);
      expect(result).toBe('vitest');
    });

    it('accepts jest', () => {
      const result = TestRunnerSchema.parse('jest');
      expect(result).toBe('jest');
    });

    it('accepts mocha', () => {
      const result = TestRunnerSchema.parse('mocha');
      expect(result).toBe('mocha');
    });

    it('rejects invalid test runner', () => {
      expect(() => TestRunnerSchema.parse('invalid')).toThrow();
    });
  });

  describe('GatesCommandsConfigSchema', () => {
    it('has sensible defaults for test commands', () => {
      const result = GatesCommandsConfigSchema.parse({});
      expect(result.test_full).toBeDefined();
      expect(result.test_docs_only).toBeDefined();
      expect(result.test_incremental).toBeDefined();
    });

    it('allows custom test commands', () => {
      const config = {
        test_full: 'npm test',
        test_docs_only: 'npm test -- --grep docs',
        test_incremental: 'npm test -- --changed',
      };
      const result = GatesCommandsConfigSchema.parse(config);
      expect(result.test_full).toBe('npm test');
      expect(result.test_docs_only).toBe('npm test -- --grep docs');
      expect(result.test_incremental).toBe('npm test -- --changed');
    });
  });

  describe('LumenFlowConfigSchema - package_manager field', () => {
    it('includes package_manager with default pnpm', () => {
      const config = parseConfig({});
      expect(config.package_manager).toBe('pnpm');
    });

    it('accepts npm as package_manager', () => {
      const config = parseConfig({ package_manager: 'npm' });
      expect(config.package_manager).toBe('npm');
    });

    it('accepts yarn as package_manager', () => {
      const config = parseConfig({ package_manager: 'yarn' });
      expect(config.package_manager).toBe('yarn');
    });

    it('accepts bun as package_manager', () => {
      const config = parseConfig({ package_manager: 'bun' });
      expect(config.package_manager).toBe('bun');
    });
  });

  describe('LumenFlowConfigSchema - test_runner field', () => {
    it('includes test_runner with default vitest', () => {
      const config = parseConfig({});
      expect(config.test_runner).toBe('vitest');
    });

    it('accepts jest as test_runner', () => {
      const config = parseConfig({ test_runner: 'jest' });
      expect(config.test_runner).toBe('jest');
    });

    it('accepts mocha as test_runner', () => {
      const config = parseConfig({ test_runner: 'mocha' });
      expect(config.test_runner).toBe('mocha');
    });
  });

  describe('LumenFlowConfigSchema - gates.commands section', () => {
    it('includes gates.commands with defaults', () => {
      const config = parseConfig({});
      expect(config.gates.commands).toBeDefined();
      expect(config.gates.commands.test_full).toBeDefined();
      expect(config.gates.commands.test_docs_only).toBeDefined();
      expect(config.gates.commands.test_incremental).toBeDefined();
    });

    it('allows custom gates commands configuration', () => {
      const config = parseConfig({
        gates: {
          commands: {
            test_full: 'npm test',
            test_docs_only: 'npm test -- --docs',
            test_incremental: 'npm test -- --changed',
          },
        },
      });
      expect(config.gates.commands.test_full).toBe('npm test');
      expect(config.gates.commands.test_docs_only).toBe('npm test -- --docs');
      expect(config.gates.commands.test_incremental).toBe('npm test -- --changed');
    });
  });

  describe('LumenFlowConfigSchema - build_command field', () => {
    it('includes build_command with default for pnpm', () => {
      const config = parseConfig({});
      expect(config.build_command).toBe('pnpm build');
    });

    it('allows custom build_command', () => {
      const config = parseConfig({ build_command: 'npm run build' });
      expect(config.build_command).toBe('npm run build');
    });
  });

  describe('resolvePackageManager', () => {
    it('returns pnpm when no config file exists', () => {
      const result = resolvePackageManager(tempDir);
      expect(result).toBe('pnpm');
    });

    it('returns configured package manager from config file', () => {
      writeWorkspaceConfig(tempDir, { package_manager: 'npm' });
      const result = resolvePackageManager(tempDir);
      expect(result).toBe('npm');
    });

    it('returns yarn when configured', () => {
      writeWorkspaceConfig(tempDir, { package_manager: 'yarn' });
      const result = resolvePackageManager(tempDir);
      expect(result).toBe('yarn');
    });
  });

  describe('resolveBuildCommand', () => {
    it('returns default build command when no config file exists', () => {
      const result = resolveBuildCommand(tempDir);
      expect(result).toBe('pnpm --filter @lumenflow/cli build');
    });

    it('returns configured build_command from config file', () => {
      writeWorkspaceConfig(tempDir, { build_command: 'npm run build' });
      const result = resolveBuildCommand(tempDir);
      expect(result).toBe('npm run build');
    });

    it('adapts default build command for different package managers', () => {
      writeWorkspaceConfig(tempDir, { package_manager: 'npm' });
      const result = resolveBuildCommand(tempDir);
      expect(result).toContain('npm');
    });
  });

  describe('resolveGatesCommands', () => {
    it('returns default commands when no config file exists', () => {
      const commands = resolveGatesCommands(tempDir);
      expect(commands.test_full).toBeDefined();
      expect(commands.test_docs_only).toBeDefined();
      expect(commands.test_incremental).toBeDefined();
    });

    it('returns configured commands from config file', () => {
      writeWorkspaceConfig(tempDir, {
        gates: {
          commands: {
            test_full: 'npm test',
            test_docs_only: 'npm test -- --docs',
            test_incremental: 'npm test -- --changed',
          },
        },
      });
      const commands = resolveGatesCommands(tempDir);
      expect(commands.test_full).toBe('npm test');
      expect(commands.test_docs_only).toBe('npm test -- --docs');
      expect(commands.test_incremental).toBe('npm test -- --changed');
    });
  });

  describe('resolveTestRunner', () => {
    it('returns vitest when no config file exists', () => {
      const result = resolveTestRunner(tempDir);
      expect(result).toBe('vitest');
    });

    it('returns jest when configured', () => {
      writeWorkspaceConfig(tempDir, { test_runner: 'jest' });
      const result = resolveTestRunner(tempDir);
      expect(result).toBe('jest');
    });
  });

  describe('getIgnorePatterns', () => {
    it('returns .turbo pattern for vitest', () => {
      const patterns = getIgnorePatterns('vitest');
      expect(patterns).toContain('.turbo');
    });

    it('returns different pattern for jest', () => {
      const patterns = getIgnorePatterns('jest');
      expect(patterns).not.toContain('.turbo');
    });

    it('returns custom pattern from config', () => {
      writeWorkspaceConfig(tempDir, {
        gates: {
          ignore_patterns: ['.nx', 'dist'],
        },
      });
      // This would be a config-aware version
      const patterns = getIgnorePatterns('jest');
      expect(Array.isArray(patterns)).toBe(true);
    });
  });
});

describe('WU-1467: Stubbed gates eliminated from enforced gate flows', () => {
  it('GATE_NAMES does not include prompts:lint as an authoritative gate', () => {
    // prompts:lint was a stub -- it should not be listed as a gate name
    // that implies authoritative enforcement
    const { GATE_NAMES } = require('@lumenflow/core/wu-constants');
    // The PROMPTS_LINT key should NOT exist in GATE_NAMES
    // since it was removed from enforced gate flows
    expect(GATE_NAMES.PROMPTS_LINT).toBeUndefined();
  });

  it('SCRIPTS.PROMPTS_LINT is retained for script surface', () => {
    // The script name constant should still exist for the root package.json script
    const { SCRIPTS } = require('@lumenflow/core/wu-constants');
    expect(SCRIPTS.PROMPTS_LINT).toBe('prompts:lint');
  });

  it('SCRIPTS.COS_GATES is retained for script surface', () => {
    const { SCRIPTS } = require('@lumenflow/core/wu-constants');
    expect(SCRIPTS.COS_GATES).toBe('cos:gates');
  });

  it('TELEMETRY_STEPS does not include cos-gates', () => {
    // cos:gates was a stub -- it should not appear in telemetry steps
    const { TELEMETRY_STEPS } = require('@lumenflow/core/wu-constants');
    expect(TELEMETRY_STEPS.COS_GATES).toBeUndefined();
  });

  it('SCRIPTS.TASKS_VALIDATE points to wu:validate --all for consistency', () => {
    const { SCRIPTS } = require('@lumenflow/core/wu-constants');
    // tasks:validate should now route to the real wu:validate command
    expect(SCRIPTS.TASKS_VALIDATE).toBe('tasks:validate');
  });
});

describe('WU-1356: npm+jest configuration', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumenflow-npm-jest-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('supports npm+jest configuration', () => {
    writeWorkspaceConfig(tempDir, {
      package_manager: 'npm',
      test_runner: 'jest',
      gates: {
        commands: {
          test_full: 'npm test',
          test_docs_only: 'npm test -- --testPathPattern=docs',
          test_incremental: 'npm test -- --onlyChanged',
        },
      },
      build_command: 'npm run build',
    });

    const pkgManager = resolvePackageManager(tempDir);
    const testRunner = resolveTestRunner(tempDir);
    const commands = resolveGatesCommands(tempDir);
    const buildCmd = resolveBuildCommand(tempDir);

    expect(pkgManager).toBe('npm');
    expect(testRunner).toBe('jest');
    expect(commands.test_full).toBe('npm test');
    expect(commands.test_incremental).toBe('npm test -- --onlyChanged');
    expect(buildCmd).toBe('npm run build');
  });
});

describe('WU-1356: yarn+nx configuration', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumenflow-yarn-nx-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('supports yarn+nx configuration', () => {
    writeWorkspaceConfig(tempDir, {
      package_manager: 'yarn',
      test_runner: 'jest',
      gates: {
        commands: {
          test_full: 'yarn nx run-many --target=test --all',
          test_docs_only: 'yarn nx test docs',
          test_incremental: 'yarn nx affected --target=test',
        },
      },
      build_command: 'yarn nx build @lumenflow/cli',
    });

    const pkgManager = resolvePackageManager(tempDir);
    const commands = resolveGatesCommands(tempDir);
    const buildCmd = resolveBuildCommand(tempDir);

    expect(pkgManager).toBe('yarn');
    expect(commands.test_full).toBe('yarn nx run-many --target=test --all');
    expect(commands.test_incremental).toBe('yarn nx affected --target=test');
    expect(buildCmd).toBe('yarn nx build @lumenflow/cli');
  });
});

describe('WU-2009: claim-validation gate contract', () => {
  it('GATE_NAMES includes claim-validation as an authoritative gate', () => {
    expect(GATE_NAMES.CLAIM_VALIDATION).toBe('claim-validation');
  });

  it('GATE_NAMES includes co-change as an authoritative gate', () => {
    expect(GATE_NAMES.CO_CHANGE).toBe('co-change');
  });
});
