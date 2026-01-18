/**
 * LumenFlow Configuration Tests
 *
 * @module lumenflow-config.test
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  LumenFlowConfigSchema,
  DirectoriesSchema,
  BeaconPathsSchema,
  GitConfigSchema,
  WuConfigSchema,
  GatesConfigSchema,
  parseConfig,
  getDefaultConfig,
  validateConfig,
} from '../lumenflow-config-schema.js';
import {
  getConfig,
  clearConfigCache,
  findProjectRoot,
  resolvePath,
  getResolvedPaths,
  validateConfigFile,
  createSampleConfig,
} from '../lumenflow-config.js';

describe('LumenFlow Config Schema', () => {
  describe('DirectoriesSchema', () => {
    it('should provide sensible defaults', () => {
      const result = DirectoriesSchema.parse({});
      expect(result.wuDir).toBe('docs/04-operations/tasks/wu');
      expect(result.worktrees).toBe('worktrees/');
      expect(result.backlogPath).toBe('docs/04-operations/tasks/backlog.md');
    });

    it('should allow overriding paths', () => {
      const result = DirectoriesSchema.parse({
        wuDir: 'custom/wu',
        worktrees: 'custom-worktrees/',
      });
      expect(result.wuDir).toBe('custom/wu');
      expect(result.worktrees).toBe('custom-worktrees/');
      // Other defaults still apply
      expect(result.backlogPath).toBe('docs/04-operations/tasks/backlog.md');
    });
  });

  describe('BeaconPathsSchema', () => {
    it('should provide .beacon defaults', () => {
      const result = BeaconPathsSchema.parse({});
      expect(result.base).toBe('.beacon');
      expect(result.stampsDir).toBe('.beacon/stamps');
      expect(result.stateDir).toBe('.beacon/state');
    });
  });

  describe('GitConfigSchema', () => {
    it('should provide git defaults', () => {
      const result = GitConfigSchema.parse({});
      expect(result.mainBranch).toBe('main');
      expect(result.defaultRemote).toBe('origin');
      expect(result.maxBranchDrift).toBe(20);
    });

    it('should validate numeric constraints', () => {
      assert.throws(() => {
        GitConfigSchema.parse({ maxBranchDrift: -1 });
      });
    });
  });

  describe('WuConfigSchema', () => {
    it('should provide WU defaults', () => {
      const result = WuConfigSchema.parse({});
      expect(result.defaultPriority).toBe('P2');
      expect(result.defaultStatus).toBe('ready');
      expect(result.minDescriptionLength).toBe(50);
    });
  });

  describe('GatesConfigSchema', () => {
    it('should provide gates defaults', () => {
      const result = GatesConfigSchema.parse({});
      expect(result.enableCoverage).toBe(true);
      expect(result.minCoverage).toBe(90);
      expect(result.maxEslintWarnings).toBe(100);
    });

    it('should validate coverage range', () => {
      assert.throws(() => {
        GatesConfigSchema.parse({ minCoverage: 101 });
      });
    });
  });

  describe('LumenFlowConfigSchema', () => {
    it('should parse empty object with all defaults', () => {
      const result = LumenFlowConfigSchema.parse({});
      expect(result.version).toBe('1.0.0');
      expect(result.directories).toBeTruthy();
      expect(result.beacon).toBeTruthy();
      expect(result.git).toBeTruthy();
    });

    it('should allow partial overrides', () => {
      const result = LumenFlowConfigSchema.parse({
        directories: {
          wuDir: 'custom/wu',
        },
        git: {
          mainBranch: 'master',
        },
      });
      expect(result.directories.wuDir).toBe('custom/wu');
      expect(result.git.mainBranch).toBe('master');
      // Defaults still apply to non-overridden
      expect(result.directories.worktrees).toBe('worktrees/');
    });
  });

  describe('parseConfig', () => {
    it('should return default config for empty input', () => {
      const config = parseConfig();
      expect(config.version).toBe('1.0.0');
    });

    it('should merge partial config with defaults', () => {
      const config = parseConfig({
        directories: { wuDir: 'my-wu' },
      });
      expect(config.directories.wuDir).toBe('my-wu');
      expect(config.directories.worktrees).toBe('worktrees/');
    });
  });

  describe('getDefaultConfig', () => {
    it('should return complete default config', () => {
      const config = getDefaultConfig();
      expect(typeof config.version).toBe('string');
      expect(typeof config.directories.wuDir).toBe('string');
      expect(typeof config.git.mainBranch).toBe('string');
    });
  });

  describe('validateConfig', () => {
    it('should return success for valid config', () => {
      const result = validateConfig({ directories: { wuDir: 'custom' } });
      expect(result.success).toBe(true);
    });

    it('should return errors for invalid config', () => {
      const result = validateConfig({ git: { maxBranchDrift: 'invalid' } });
      expect(result.success).toBe(false);
    });
  });
});

describe('LumenFlow Config Loader', () => {
  let tempDir: string;

  beforeEach(() => {
    clearConfigCache();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumenflow-test-'));
  });

  afterEach(() => {
    clearConfigCache();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('findProjectRoot', () => {
    it('should find directory with .git', () => {
      const gitDir = path.join(tempDir, '.git');
      fs.mkdirSync(gitDir);
      const subDir = path.join(tempDir, 'a', 'b', 'c');
      fs.mkdirSync(subDir, { recursive: true });

      const root = findProjectRoot(subDir);
      expect(root).toBe(tempDir);
    });

    it('should prefer .lumenflow.config.yaml over .git', () => {
      fs.mkdirSync(path.join(tempDir, '.git'));
      fs.writeFileSync(path.join(tempDir, '.lumenflow.config.yaml'), 'version: "1.0.0"');

      const root = findProjectRoot(tempDir);
      expect(root).toBe(tempDir);
    });
  });

  describe('getConfig', () => {
    it('should return defaults when no config file exists', () => {
      fs.mkdirSync(path.join(tempDir, '.git'));
      const config = getConfig({ projectRoot: tempDir });
      expect(config.directories.wuDir).toBe('docs/04-operations/tasks/wu');
    });

    it('should load config from file', () => {
      fs.mkdirSync(path.join(tempDir, '.git'));
      fs.writeFileSync(
        path.join(tempDir, '.lumenflow.config.yaml'),
        'directories:\n  wuDir: custom/wu\n',
      );

      const config = getConfig({ projectRoot: tempDir });
      expect(config.directories.wuDir).toBe('custom/wu');
    });

    it('should cache config', () => {
      fs.mkdirSync(path.join(tempDir, '.git'));
      const config1 = getConfig({ projectRoot: tempDir });
      const config2 = getConfig({ projectRoot: tempDir });
      expect(config1).toEqual(config2);
    });

    it('should reload when requested', () => {
      fs.mkdirSync(path.join(tempDir, '.git'));
      fs.writeFileSync(
        path.join(tempDir, '.lumenflow.config.yaml'),
        'directories:\n  wuDir: first\n',
      );

      const config1 = getConfig({ projectRoot: tempDir });
      expect(config1.directories.wuDir).toBe('first');

      fs.writeFileSync(
        path.join(tempDir, '.lumenflow.config.yaml'),
        'directories:\n  wuDir: second\n',
      );

      const config2 = getConfig({ projectRoot: tempDir, reload: true });
      expect(config2.directories.wuDir).toBe('second');
    });
  });

  describe('resolvePath', () => {
    it('should resolve relative path to absolute', () => {
      const resolved = resolvePath('docs/wu', tempDir);
      assert.strictEqual(resolved, path.join(tempDir, 'docs/wu'));
    });
  });

  describe('getResolvedPaths', () => {
    it('should return absolute paths', () => {
      fs.mkdirSync(path.join(tempDir, '.git'));
      const paths = getResolvedPaths({ projectRoot: tempDir });

      expect(path.isAbsolute(paths.wuDir)).toBeTruthy();
      expect(path.isAbsolute(paths.stampsDir)).toBeTruthy();
      expect(paths.wuDir.includes(tempDir)).toBe(true);
    });
  });

  describe('validateConfigFile', () => {
    it('should validate existing config file', () => {
      const configPath = path.join(tempDir, '.lumenflow.config.yaml');
      fs.writeFileSync(configPath, 'version: "1.0.0"\n');

      const result = validateConfigFile(configPath);
      expect(result.valid).toBe(true);
      expect(result.config).toBeTruthy();
    });

    it('should report missing file', () => {
      const result = validateConfigFile(path.join(tempDir, 'missing.yaml'));
      expect(result.valid).toBe(false);
      expect(result.errors.length > 0).toBeTruthy();
    });

    it('should report invalid YAML', () => {
      const configPath = path.join(tempDir, 'invalid.yaml');
      fs.writeFileSync(configPath, 'git:\n  maxBranchDrift: invalid\n');

      const result = validateConfigFile(configPath);
      expect(result.valid).toBe(false);
    });
  });

  describe('createSampleConfig', () => {
    it('should create sample config file', () => {
      const configPath = path.join(tempDir, '.lumenflow.config.yaml');
      createSampleConfig(configPath);

      expect(fs.existsSync(configPath)).toBeTruthy();
      const content = fs.readFileSync(configPath, 'utf8');
      expect(content).toContain('version:');
      expect(content).toContain('directories:');
    });
  });
});
