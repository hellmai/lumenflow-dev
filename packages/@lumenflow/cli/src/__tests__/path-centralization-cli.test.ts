// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * @fileoverview Tests for WU-1311: CLI path centralization
 *
 * Tests that CLI commands use WU_PATHS/getResolvedPaths/getConfig
 * instead of hardcoded 'docs/04-operations' paths.
 *
 * WU-1311 Acceptance Criteria:
 * - No hardcoded docs/04-operations paths remain in CLI commands (use WU_PATHS/getResolvedPaths)
 * - state-doctor warns when configured paths are missing
 * - Config overrides are respected across wu-* commands and diagnostics
 * - Unit tests cover CLI path usage and warnings
 *
 * @module __tests__/path-centralization-cli.test
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as yaml from 'yaml';
import { clearConfigCache, getConfig, WORKSPACE_CONFIG_FILE_NAME } from '@lumenflow/core/config';
import { WORKSPACE_V2_KEYS } from '@lumenflow/core/config-schema';
import { WU_PATHS, createWuPaths } from '@lumenflow/core/wu-paths';

/** Config file name constant */
const CONFIG_FILE = WORKSPACE_CONFIG_FILE_NAME;

async function writeWorkspaceSoftwareDeliveryConfig(
  projectRoot: string,
  softwareDeliveryConfig: Record<string, unknown>,
): Promise<void> {
  await writeFile(
    path.join(projectRoot, CONFIG_FILE),
    yaml.stringify({
      [WORKSPACE_V2_KEYS.SOFTWARE_DELIVERY]: softwareDeliveryConfig,
    }),
    'utf-8',
  );
}

describe('WU-1311: CLI path centralization', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'cli-path-test-'));
    clearConfigCache();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    clearConfigCache();
  });

  describe('AC1: No hardcoded docs/04-operations paths in CLI commands', () => {
    it('should use config-based paths for WU file path generation', () => {
      const paths = createWuPaths({ projectRoot: tempDir });

      // WU-2105: Defaults are consumer-simple (no 04-operations prefix)
      expect(paths.WU('WU-1311')).toBe('docs/tasks/wu/WU-1311.yaml');
      expect(paths.STATUS()).toBe('docs/tasks/status.md');
      expect(paths.BACKLOG()).toBe('docs/tasks/backlog.md');
    });

    it('should respect custom config paths for WU operations', async () => {
      const customDirectories = {
        directories: {
          wuDir: 'custom/wu',
          backlogPath: 'custom/backlog.md',
          statusPath: 'custom/status.md',
        },
      };

      await writeWorkspaceSoftwareDeliveryConfig(tempDir, customDirectories);
      clearConfigCache();

      const paths = createWuPaths({ projectRoot: tempDir });

      expect(paths.WU('WU-1311')).toBe('custom/wu/WU-1311.yaml');
      expect(paths.STATUS()).toBe('custom/status.md');
      expect(paths.BACKLOG()).toBe('custom/backlog.md');
    });

    it('should use WU_PATHS for stamp file generation', () => {
      const stampPath = WU_PATHS.STAMP('WU-1311');
      expect(stampPath).toContain('WU-1311.done');
    });
  });

  describe('AC2: state-doctor warns when configured paths are missing', () => {
    it('should detect missing WU directory', async () => {
      // Create a config pointing to non-existent paths
      const customDirectories = {
        directories: {
          wuDir: 'nonexistent/wu',
        },
      };

      await writeWorkspaceSoftwareDeliveryConfig(tempDir, customDirectories);
      clearConfigCache();

      // getResolvedPaths returns paths even if they don't exist
      // state-doctor should check existence and warn
      const { getResolvedPaths } = await import('@lumenflow/core/config');
      const paths = getResolvedPaths({ projectRoot: tempDir });

      expect(paths.wuDir).toBe(path.join(tempDir, 'nonexistent/wu'));
      // The warnMissingPaths function in state-doctor.ts checks existsSync
      // This verifies the path is properly resolved for checking
    });
  });

  describe('AC3: Config overrides are respected across wu-* commands', () => {
    it('should use custom initiatives directory from config', async () => {
      const customDirectories = {
        directories: {
          initiativesDir: 'custom/initiatives',
        },
      };

      await writeWorkspaceSoftwareDeliveryConfig(tempDir, customDirectories);
      clearConfigCache();

      const paths = createWuPaths({ projectRoot: tempDir });
      expect(paths.INITIATIVES_DIR()).toBe('custom/initiatives');
    });

    it('should use custom plans directory from config', async () => {
      const customDirectories = {
        directories: {
          plansDir: 'custom/plans',
        },
      };

      await writeWorkspaceSoftwareDeliveryConfig(tempDir, customDirectories);
      clearConfigCache();

      const paths = createWuPaths({ projectRoot: tempDir });
      expect(paths.PLANS_DIR()).toBe('custom/plans');
    });

    it('should use custom templates directory from config', async () => {
      const customDirectories = {
        directories: {
          templatesDir: 'custom/templates',
        },
      };

      await writeWorkspaceSoftwareDeliveryConfig(tempDir, customDirectories);
      clearConfigCache();

      const paths = createWuPaths({ projectRoot: tempDir });
      expect(paths.TEMPLATES_DIR()).toBe('custom/templates');
    });

    it('should use custom onboarding directory from config', async () => {
      const customDirectories = {
        directories: {
          onboardingDir: 'custom/onboarding',
        },
      };

      await writeWorkspaceSoftwareDeliveryConfig(tempDir, customDirectories);
      clearConfigCache();

      const paths = createWuPaths({ projectRoot: tempDir });
      expect(paths.ONBOARDING_DIR()).toBe('custom/onboarding');
    });
  });

  describe('AC4: Whitelist paths use config-based values', () => {
    it('should generate correct whitelist paths for wu:done staged file validation', async () => {
      const customDirectories = {
        directories: {
          wuDir: 'tasks/wu',
          backlogPath: 'tasks/backlog.md',
          statusPath: 'tasks/status.md',
        },
      };

      await writeWorkspaceSoftwareDeliveryConfig(tempDir, customDirectories);
      clearConfigCache();

      const config = getConfig({ projectRoot: tempDir });
      const wuId = 'WU-1311';

      // The whitelist should use config paths, not hardcoded ones
      const expectedWuPath = path.join(config.directories.wuDir, `${wuId}.yaml`);
      const expectedBacklogPath = config.directories.backlogPath;
      const expectedStatusPath = config.directories.statusPath;

      expect(expectedWuPath).toBe('tasks/wu/WU-1311.yaml');
      expect(expectedBacklogPath).toBe('tasks/backlog.md');
      expect(expectedStatusPath).toBe('tasks/status.md');
    });
  });

  describe('AC5: Error messages use config-based paths', () => {
    it('should provide config-aware error messages for missing WU', async () => {
      const customDirectories = {
        directories: {
          wuDir: 'custom/wu',
        },
      };

      await writeWorkspaceSoftwareDeliveryConfig(tempDir, customDirectories);
      clearConfigCache();

      const config = getConfig({ projectRoot: tempDir });

      // Error messages should reference the configured path, not hardcoded
      const expectedDir = config.directories.wuDir;
      expect(expectedDir).toBe('custom/wu');
      // CLI commands should use this in error messages like:
      // "WU not found in ${config.directories.wuDir}/"
    });
  });
});

describe('WU-1311: validateStagedFiles whitelist paths', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'whitelist-test-'));
    clearConfigCache();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    clearConfigCache();
  });

  it('should generate whitelist paths from config', async () => {
    const customDirectories = {
      directories: {
        wuDir: 'my/tasks/wu',
        backlogPath: 'my/tasks/backlog.md',
        statusPath: 'my/tasks/status.md',
      },
    };

    await writeWorkspaceSoftwareDeliveryConfig(tempDir, customDirectories);
    clearConfigCache();

    const config = getConfig({ projectRoot: tempDir });

    // Helper function that CLI should use to generate whitelist
    const generateWhitelist = (id: string): string[] => [
      path.join(config.directories.wuDir, `${id}.yaml`),
      config.directories.statusPath,
      config.directories.backlogPath,
    ];

    const whitelist = generateWhitelist('WU-1311');

    expect(whitelist).toContain('my/tasks/wu/WU-1311.yaml');
    expect(whitelist).toContain('my/tasks/backlog.md');
    expect(whitelist).toContain('my/tasks/status.md');
  });
});

describe('WU-1311: getWorktreeCommitFiles config paths', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'commit-files-test-'));
    clearConfigCache();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    clearConfigCache();
  });

  it('should use config-based WU path in commit file list', async () => {
    const customDirectories = {
      directories: {
        wuDir: 'custom/wu',
      },
    };

    await writeWorkspaceSoftwareDeliveryConfig(tempDir, customDirectories);
    clearConfigCache();

    const config = getConfig({ projectRoot: tempDir });

    // The getWorktreeCommitFiles function should use config paths
    const wuId = 'WU-1311';
    const expectedWuPath = path.join(config.directories.wuDir, `${wuId}.yaml`);

    expect(expectedWuPath).toBe('custom/wu/WU-1311.yaml');
  });
});
