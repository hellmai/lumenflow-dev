/**
 * LumenFlow Configuration Tests
 *
 * @module lumenflow-config.test
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
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
      assert.strictEqual(result.wuDir, 'docs/04-operations/tasks/wu');
      assert.strictEqual(result.worktrees, 'worktrees/');
      assert.strictEqual(result.backlogPath, 'docs/04-operations/tasks/backlog.md');
    });

    it('should allow overriding paths', () => {
      const result = DirectoriesSchema.parse({
        wuDir: 'custom/wu',
        worktrees: 'custom-worktrees/',
      });
      assert.strictEqual(result.wuDir, 'custom/wu');
      assert.strictEqual(result.worktrees, 'custom-worktrees/');
      // Other defaults still apply
      assert.strictEqual(result.backlogPath, 'docs/04-operations/tasks/backlog.md');
    });
  });

  describe('BeaconPathsSchema', () => {
    it('should provide .beacon defaults', () => {
      const result = BeaconPathsSchema.parse({});
      assert.strictEqual(result.base, '.beacon');
      assert.strictEqual(result.stampsDir, '.beacon/stamps');
      assert.strictEqual(result.stateDir, '.beacon/state');
    });
  });

  describe('GitConfigSchema', () => {
    it('should provide git defaults', () => {
      const result = GitConfigSchema.parse({});
      assert.strictEqual(result.mainBranch, 'main');
      assert.strictEqual(result.defaultRemote, 'origin');
      assert.strictEqual(result.maxBranchDrift, 20);
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
      assert.strictEqual(result.defaultPriority, 'P2');
      assert.strictEqual(result.defaultStatus, 'ready');
      assert.strictEqual(result.minDescriptionLength, 50);
    });
  });

  describe('GatesConfigSchema', () => {
    it('should provide gates defaults', () => {
      const result = GatesConfigSchema.parse({});
      assert.strictEqual(result.enableCoverage, true);
      assert.strictEqual(result.minCoverage, 90);
      assert.strictEqual(result.maxEslintWarnings, 100);
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
      assert.strictEqual(result.version, '1.0.0');
      assert.ok(result.directories);
      assert.ok(result.beacon);
      assert.ok(result.git);
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
      assert.strictEqual(result.directories.wuDir, 'custom/wu');
      assert.strictEqual(result.git.mainBranch, 'master');
      // Defaults still apply to non-overridden
      assert.strictEqual(result.directories.worktrees, 'worktrees/');
    });
  });

  describe('parseConfig', () => {
    it('should return default config for empty input', () => {
      const config = parseConfig();
      assert.strictEqual(config.version, '1.0.0');
    });

    it('should merge partial config with defaults', () => {
      const config = parseConfig({
        directories: { wuDir: 'my-wu' },
      });
      assert.strictEqual(config.directories.wuDir, 'my-wu');
      assert.strictEqual(config.directories.worktrees, 'worktrees/');
    });
  });

  describe('getDefaultConfig', () => {
    it('should return complete default config', () => {
      const config = getDefaultConfig();
      assert.strictEqual(typeof config.version, 'string');
      assert.strictEqual(typeof config.directories.wuDir, 'string');
      assert.strictEqual(typeof config.git.mainBranch, 'string');
    });
  });

  describe('validateConfig', () => {
    it('should return success for valid config', () => {
      const result = validateConfig({ directories: { wuDir: 'custom' } });
      assert.strictEqual(result.success, true);
    });

    it('should return errors for invalid config', () => {
      const result = validateConfig({ git: { maxBranchDrift: 'invalid' } });
      assert.strictEqual(result.success, false);
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
      assert.strictEqual(root, tempDir);
    });

    it('should prefer .lumenflow.config.yaml over .git', () => {
      fs.mkdirSync(path.join(tempDir, '.git'));
      fs.writeFileSync(path.join(tempDir, '.lumenflow.config.yaml'), 'version: "1.0.0"');

      const root = findProjectRoot(tempDir);
      assert.strictEqual(root, tempDir);
    });
  });

  describe('getConfig', () => {
    it('should return defaults when no config file exists', () => {
      fs.mkdirSync(path.join(tempDir, '.git'));
      const config = getConfig({ projectRoot: tempDir });
      assert.strictEqual(config.directories.wuDir, 'docs/04-operations/tasks/wu');
    });

    it('should load config from file', () => {
      fs.mkdirSync(path.join(tempDir, '.git'));
      fs.writeFileSync(
        path.join(tempDir, '.lumenflow.config.yaml'),
        'directories:\n  wuDir: custom/wu\n'
      );

      const config = getConfig({ projectRoot: tempDir });
      assert.strictEqual(config.directories.wuDir, 'custom/wu');
    });

    it('should cache config', () => {
      fs.mkdirSync(path.join(tempDir, '.git'));
      const config1 = getConfig({ projectRoot: tempDir });
      const config2 = getConfig({ projectRoot: tempDir });
      assert.deepStrictEqual(config1, config2);
    });

    it('should reload when requested', () => {
      fs.mkdirSync(path.join(tempDir, '.git'));
      fs.writeFileSync(
        path.join(tempDir, '.lumenflow.config.yaml'),
        'directories:\n  wuDir: first\n'
      );

      const config1 = getConfig({ projectRoot: tempDir });
      assert.strictEqual(config1.directories.wuDir, 'first');

      fs.writeFileSync(
        path.join(tempDir, '.lumenflow.config.yaml'),
        'directories:\n  wuDir: second\n'
      );

      const config2 = getConfig({ projectRoot: tempDir, reload: true });
      assert.strictEqual(config2.directories.wuDir, 'second');
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

      assert.ok(path.isAbsolute(paths.wuDir));
      assert.ok(path.isAbsolute(paths.stampsDir));
      assert.ok(paths.wuDir.includes(tempDir));
    });
  });

  describe('validateConfigFile', () => {
    it('should validate existing config file', () => {
      const configPath = path.join(tempDir, '.lumenflow.config.yaml');
      fs.writeFileSync(configPath, 'version: "1.0.0"\n');

      const result = validateConfigFile(configPath);
      assert.strictEqual(result.valid, true);
      assert.ok(result.config);
    });

    it('should report missing file', () => {
      const result = validateConfigFile(path.join(tempDir, 'missing.yaml'));
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.length > 0);
    });

    it('should report invalid YAML', () => {
      const configPath = path.join(tempDir, 'invalid.yaml');
      fs.writeFileSync(configPath, 'git:\n  maxBranchDrift: invalid\n');

      const result = validateConfigFile(configPath);
      assert.strictEqual(result.valid, false);
    });
  });

  describe('createSampleConfig', () => {
    it('should create sample config file', () => {
      const configPath = path.join(tempDir, '.lumenflow.config.yaml');
      createSampleConfig(configPath);

      assert.ok(fs.existsSync(configPath));
      const content = fs.readFileSync(configPath, 'utf8');
      assert.ok(content.includes('version:'));
      assert.ok(content.includes('directories:'));
    });
  });
});
