/**
 * @fileoverview Tests for WU-1301 and WU-1310: CLI path centralization
 *
 * Tests that all CLI commands use config-based paths (WU_PATHS / getResolvedPaths())
 * instead of hardcoded paths like 'docs/04-operations/tasks/wu'.
 *
 * WU-1301 Acceptance Criteria:
 * - All wu-* commands use WU_PATHS / getResolvedPaths() instead of hardcoded paths
 * - state-doctor, flow-report, validate-* use config paths
 * - directories.* config section fully populated with simple/arc42 defaults
 * - state-doctor warns if configured paths don't exist
 * - Consumers can change paths in config and CLI respects them
 *
 * WU-1310 Acceptance Criteria:
 * - directories.* includes defaults for simple and arc42 structures
 *   (wuDir, backlogPath, statusPath, templatesDir, onboardingDir, plansDir, initiativesDir)
 * - WU_PATHS/getResolvedPaths use config values for all paths
 * - Config overrides are respected by core path helpers
 * - Unit tests cover core path defaults and overrides
 *
 * @module __tests__/path-centralization.test
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as yaml from 'yaml';
import {
  getConfig,
  getResolvedPaths,
  clearConfigCache,
  getDefaultConfig,
} from '../lumenflow-config.js';

/** Config file name constant for test assertions */
const CONFIG_FILE = '.lumenflow.config.yaml';

describe('WU-1301: CLI path centralization', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'lumenflow-test-'));
    clearConfigCache();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    clearConfigCache();
  });

  describe('AC1: All wu-* commands use WU_PATHS / getResolvedPaths()', () => {
    it('should return paths from config via getResolvedPaths()', () => {
      const paths = getResolvedPaths({ projectRoot: tempDir });

      expect(paths.wuDir).toBeDefined();
      expect(paths.backlogPath).toBeDefined();
      expect(paths.statusPath).toBeDefined();
      expect(paths.initiativesDir).toBeDefined();
      expect(paths.stampsDir).toBeDefined();
      expect(paths.stateDir).toBeDefined();
    });

    it('should use default paths when no config file exists', () => {
      const config = getConfig({ projectRoot: tempDir });

      expect(config.directories.wuDir).toBe('docs/04-operations/tasks/wu');
      expect(config.directories.backlogPath).toBe('docs/04-operations/tasks/backlog.md');
      expect(config.directories.statusPath).toBe('docs/04-operations/tasks/status.md');
      expect(config.directories.initiativesDir).toBe('docs/04-operations/tasks/initiatives');
    });

    it('should respect custom paths from config file', async () => {
      // Create a custom config
      const customConfig = {
        version: '1.0.0',
        directories: {
          wuDir: 'custom/tasks/wu',
          backlogPath: 'custom/tasks/backlog.md',
          statusPath: 'custom/tasks/status.md',
          initiativesDir: 'custom/tasks/initiatives',
        },
      };

      await writeFile(path.join(tempDir, CONFIG_FILE), yaml.stringify(customConfig), 'utf-8');

      clearConfigCache();
      const config = getConfig({ projectRoot: tempDir });

      expect(config.directories.wuDir).toBe('custom/tasks/wu');
      expect(config.directories.backlogPath).toBe('custom/tasks/backlog.md');
      expect(config.directories.statusPath).toBe('custom/tasks/status.md');
      expect(config.directories.initiativesDir).toBe('custom/tasks/initiatives');
    });
  });

  describe('AC3: directories.* config section fully populated', () => {
    it('should have all directory paths in default config', () => {
      const defaultConfig = getDefaultConfig();

      // Core WU paths
      expect(defaultConfig.directories.wuDir).toBeDefined();
      expect(defaultConfig.directories.initiativesDir).toBeDefined();
      expect(defaultConfig.directories.backlogPath).toBeDefined();
      expect(defaultConfig.directories.statusPath).toBeDefined();

      // Worktree and state paths
      expect(defaultConfig.directories.worktrees).toBeDefined();
      expect(defaultConfig.state.stampsDir).toBeDefined();
      expect(defaultConfig.state.stateDir).toBeDefined();

      // Agent paths
      expect(defaultConfig.directories.skillsDir).toBeDefined();
      expect(defaultConfig.directories.agentsDir).toBeDefined();
    });

    it('should provide simple/arc42 compatible defaults', () => {
      const defaultConfig = getDefaultConfig();

      // The defaults should follow arc42 pattern: docs/04-operations/tasks/...
      expect(defaultConfig.directories.wuDir).toContain('docs');
      expect(defaultConfig.directories.backlogPath).toContain('docs');
      expect(defaultConfig.directories.statusPath).toContain('docs');
    });
  });

  describe('AC4: getResolvedPaths returns non-existent paths for validation', () => {
    it('should return paths even when directories do not exist', () => {
      // This enables CLI commands like state-doctor to check if paths exist
      // and warn if they don't
      const paths = getResolvedPaths({ projectRoot: tempDir });

      // Paths should be absolute and well-formed
      expect(path.isAbsolute(paths.wuDir)).toBe(true);
      expect(path.isAbsolute(paths.stampsDir)).toBe(true);
      expect(path.isAbsolute(paths.stateDir)).toBe(true);

      // None of these should exist in a fresh temp directory
      expect(existsSync(paths.wuDir)).toBe(false);
      expect(existsSync(paths.stampsDir)).toBe(false);
      expect(existsSync(paths.stateDir)).toBe(false);
    });
  });

  describe('AC5: Consumers can change paths in config and CLI respects them', () => {
    it('should allow consumers to set simple paths structure', async () => {
      const simpleConfig = {
        version: '1.0.0',
        directories: {
          wuDir: 'tasks/wu',
          backlogPath: 'tasks/backlog.md',
          statusPath: 'tasks/status.md',
          initiativesDir: 'tasks/initiatives',
        },
      };

      await writeFile(path.join(tempDir, CONFIG_FILE), yaml.stringify(simpleConfig), 'utf-8');

      clearConfigCache();
      const paths = getResolvedPaths({ projectRoot: tempDir });

      expect(paths.wuDir).toBe(path.join(tempDir, 'tasks/wu'));
      expect(paths.backlogPath).toBe(path.join(tempDir, 'tasks/backlog.md'));
      expect(paths.statusPath).toBe(path.join(tempDir, 'tasks/status.md'));
      expect(paths.initiativesDir).toBe(path.join(tempDir, 'tasks/initiatives'));
    });

    it('should allow flat structure for small projects', async () => {
      const flatConfig = {
        version: '1.0.0',
        directories: {
          wuDir: '.lumenflow/wu',
          backlogPath: '.lumenflow/backlog.md',
          statusPath: '.lumenflow/status.md',
          initiativesDir: '.lumenflow/initiatives',
        },
      };

      await writeFile(path.join(tempDir, CONFIG_FILE), yaml.stringify(flatConfig), 'utf-8');

      clearConfigCache();
      const paths = getResolvedPaths({ projectRoot: tempDir });

      expect(paths.wuDir).toBe(path.join(tempDir, '.lumenflow/wu'));
      expect(paths.backlogPath).toBe(path.join(tempDir, '.lumenflow/backlog.md'));
    });
  });
});

/**
 * WU-1310: Core path centralization tests
 *
 * Tests that directories.* includes defaults for simple and arc42 structures,
 * and that WU_PATHS/getResolvedPaths use config values for all paths.
 */
describe('WU-1310: Core path centralization', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'lumenflow-test-'));
    clearConfigCache();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    clearConfigCache();
  });

  describe('AC1: directories.* includes defaults for simple and arc42 structures', () => {
    it('should have templatesDir in default config', () => {
      const defaultConfig = getDefaultConfig();
      expect(defaultConfig.directories.templatesDir).toBeDefined();
      expect(defaultConfig.directories.templatesDir).toBe('.lumenflow/templates');
    });

    it('should have onboardingDir in default config', () => {
      const defaultConfig = getDefaultConfig();
      expect(defaultConfig.directories.onboardingDir).toBeDefined();
      expect(defaultConfig.directories.onboardingDir).toBe(
        'docs/04-operations/_frameworks/lumenflow/agent/onboarding',
      );
    });

    it('should have plansDir in default config', () => {
      const defaultConfig = getDefaultConfig();
      expect(defaultConfig.directories.plansDir).toBeDefined();
      expect(defaultConfig.directories.plansDir).toBe('docs/04-operations/plans');
    });

    it('should have all required directory paths for simple structure support', () => {
      const defaultConfig = getDefaultConfig();

      // Core WU paths required by acceptance criteria
      expect(defaultConfig.directories.wuDir).toBeDefined();
      expect(defaultConfig.directories.backlogPath).toBeDefined();
      expect(defaultConfig.directories.statusPath).toBeDefined();
      expect(defaultConfig.directories.templatesDir).toBeDefined();
      expect(defaultConfig.directories.onboardingDir).toBeDefined();
      expect(defaultConfig.directories.plansDir).toBeDefined();
      expect(defaultConfig.directories.initiativesDir).toBeDefined();
    });

    it('should support simple structure config (no nested docs/)', async () => {
      const simpleConfig = {
        version: '1.0.0',
        directories: {
          wuDir: 'tasks/wu',
          backlogPath: 'tasks/backlog.md',
          statusPath: 'tasks/status.md',
          templatesDir: 'templates',
          onboardingDir: 'onboarding',
          plansDir: 'plans',
          initiativesDir: 'tasks/initiatives',
        },
      };

      await writeFile(path.join(tempDir, CONFIG_FILE), yaml.stringify(simpleConfig), 'utf-8');

      clearConfigCache();
      const config = getConfig({ projectRoot: tempDir });

      expect(config.directories.wuDir).toBe('tasks/wu');
      expect(config.directories.templatesDir).toBe('templates');
      expect(config.directories.onboardingDir).toBe('onboarding');
      expect(config.directories.plansDir).toBe('plans');
    });

    it('should support arc42 structure config (nested docs/04-operations)', () => {
      const defaultConfig = getDefaultConfig();

      // Default arc42 pattern: docs/04-operations/...
      expect(defaultConfig.directories.wuDir).toContain('docs');
      expect(defaultConfig.directories.backlogPath).toContain('docs');
      expect(defaultConfig.directories.statusPath).toContain('docs');
      expect(defaultConfig.directories.plansDir).toContain('docs');
      expect(defaultConfig.directories.initiativesDir).toContain('docs');
      expect(defaultConfig.directories.onboardingDir).toContain('docs');
    });
  });

  describe('AC2: WU_PATHS/getResolvedPaths use config values for all paths', () => {
    it('should include templatesDir in getResolvedPaths', () => {
      const paths = getResolvedPaths({ projectRoot: tempDir });
      expect(paths.templatesDir).toBeDefined();
      expect(path.isAbsolute(paths.templatesDir)).toBe(true);
    });

    it('should include onboardingDir in getResolvedPaths', () => {
      const paths = getResolvedPaths({ projectRoot: tempDir });
      expect(paths.onboardingDir).toBeDefined();
      expect(path.isAbsolute(paths.onboardingDir)).toBe(true);
    });

    it('should include all required paths in getResolvedPaths', () => {
      const paths = getResolvedPaths({ projectRoot: tempDir });

      // All paths from acceptance criteria
      expect(paths.wuDir).toBeDefined();
      expect(paths.backlogPath).toBeDefined();
      expect(paths.statusPath).toBeDefined();
      expect(paths.templatesDir).toBeDefined();
      expect(paths.onboardingDir).toBeDefined();
      expect(paths.plansDir).toBeDefined();
      expect(paths.initiativesDir).toBeDefined();

      // Verify all are absolute paths
      expect(path.isAbsolute(paths.wuDir)).toBe(true);
      expect(path.isAbsolute(paths.backlogPath)).toBe(true);
      expect(path.isAbsolute(paths.statusPath)).toBe(true);
      expect(path.isAbsolute(paths.templatesDir)).toBe(true);
      expect(path.isAbsolute(paths.onboardingDir)).toBe(true);
      expect(path.isAbsolute(paths.plansDir)).toBe(true);
      expect(path.isAbsolute(paths.initiativesDir)).toBe(true);
    });
  });

  describe('AC3: Config overrides are respected by core path helpers', () => {
    it('should respect custom templatesDir from config', async () => {
      const customConfig = {
        version: '1.0.0',
        directories: {
          templatesDir: 'custom/templates',
        },
      };

      await writeFile(path.join(tempDir, CONFIG_FILE), yaml.stringify(customConfig), 'utf-8');

      clearConfigCache();
      const paths = getResolvedPaths({ projectRoot: tempDir });

      expect(paths.templatesDir).toBe(path.join(tempDir, 'custom/templates'));
    });

    it('should respect custom onboardingDir from config', async () => {
      const customConfig = {
        version: '1.0.0',
        directories: {
          onboardingDir: 'docs/onboarding',
        },
      };

      await writeFile(path.join(tempDir, CONFIG_FILE), yaml.stringify(customConfig), 'utf-8');

      clearConfigCache();
      const paths = getResolvedPaths({ projectRoot: tempDir });

      expect(paths.onboardingDir).toBe(path.join(tempDir, 'docs/onboarding'));
    });

    it('should respect all custom directory paths from config', async () => {
      const customConfig = {
        version: '1.0.0',
        directories: {
          wuDir: 'my/wu',
          backlogPath: 'my/backlog.md',
          statusPath: 'my/status.md',
          templatesDir: 'my/templates',
          onboardingDir: 'my/onboarding',
          plansDir: 'my/plans',
          initiativesDir: 'my/initiatives',
        },
      };

      await writeFile(path.join(tempDir, CONFIG_FILE), yaml.stringify(customConfig), 'utf-8');

      clearConfigCache();
      const paths = getResolvedPaths({ projectRoot: tempDir });

      expect(paths.wuDir).toBe(path.join(tempDir, 'my/wu'));
      expect(paths.backlogPath).toBe(path.join(tempDir, 'my/backlog.md'));
      expect(paths.statusPath).toBe(path.join(tempDir, 'my/status.md'));
      expect(paths.templatesDir).toBe(path.join(tempDir, 'my/templates'));
      expect(paths.onboardingDir).toBe(path.join(tempDir, 'my/onboarding'));
      expect(paths.plansDir).toBe(path.join(tempDir, 'my/plans'));
      expect(paths.initiativesDir).toBe(path.join(tempDir, 'my/initiatives'));
    });

    it('should merge partial config with defaults', async () => {
      // Only override one path, rest should use defaults
      const partialConfig = {
        version: '1.0.0',
        directories: {
          templatesDir: 'custom/templates',
        },
      };

      await writeFile(path.join(tempDir, CONFIG_FILE), yaml.stringify(partialConfig), 'utf-8');

      clearConfigCache();
      const config = getConfig({ projectRoot: tempDir });

      // Custom override
      expect(config.directories.templatesDir).toBe('custom/templates');

      // Defaults preserved
      expect(config.directories.wuDir).toBe('docs/04-operations/tasks/wu');
      expect(config.directories.onboardingDir).toBe(
        'docs/04-operations/_frameworks/lumenflow/agent/onboarding',
      );
    });
  });
});
