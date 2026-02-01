/**
 * @fileoverview Tests for WU-1301: CLI path centralization
 *
 * Tests that all CLI commands use config-based paths (WU_PATHS / getResolvedPaths())
 * instead of hardcoded paths like 'docs/04-operations/tasks/wu'.
 *
 * Acceptance Criteria:
 * - All wu-* commands use WU_PATHS / getResolvedPaths() instead of hardcoded paths
 * - state-doctor, flow-report, validate-* use config paths
 * - directories.* config section fully populated with simple/arc42 defaults
 * - state-doctor warns if configured paths don't exist
 * - Consumers can change paths in config and CLI respects them
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

      // Worktree and beacon paths
      expect(defaultConfig.directories.worktrees).toBeDefined();
      expect(defaultConfig.beacon.stampsDir).toBeDefined();
      expect(defaultConfig.beacon.stateDir).toBeDefined();

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
