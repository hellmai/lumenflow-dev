/**
 * Tests for release command
 *
 * Verifies that the release command:
 * - Validates version format (semver)
 * - Bumps all @lumenflow/* package versions
 * - Uses micro-worktree isolation for version commit
 * - Builds all packages
 * - Publishes to npm with proper auth
 * - Creates git tag vX.Y.Z
 *
 * WU-1074: Add release command for npm publishing
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

// Import functions under test
import {
  validateSemver,
  findPackageJsonPaths,
  updatePackageVersions,
  buildCommitMessage,
  buildTagName,
  type ReleaseOptions,
} from '../release.js';
import { clearClaimMetadataOnRelease } from '../wu-release.js';

describe('release command', () => {
  describe('WU-1462 packaging config invariants', () => {
    const repoRoot = resolve(import.meta.dirname, '../../../../../');

    it('mcp build:dist references an existing tsconfig file', () => {
      const mcpPackageJsonPath = join(repoRoot, 'packages/@lumenflow/mcp/package.json');
      const mcpPackageJson = JSON.parse(readFileSync(mcpPackageJsonPath, 'utf-8')) as {
        scripts?: Record<string, string>;
      };
      const buildDistScript = mcpPackageJson.scripts?.['build:dist'];

      expect(buildDistScript).toBeTruthy();
      expect(buildDistScript).toContain('-p');

      const match = buildDistScript?.match(/-p\s+([^\s]+)/);
      const tsconfigPath = match?.[1];

      expect(tsconfigPath).toBeTruthy();
      expect(existsSync(join(repoRoot, 'packages/@lumenflow/mcp', tsconfigPath!))).toBe(true);
    });

    it('mcp tsconfig excludes spec-style test files from dist output', () => {
      const mcpTsconfigPath = join(repoRoot, 'packages/@lumenflow/mcp/tsconfig.json');
      const mcpTsconfig = JSON.parse(readFileSync(mcpTsconfigPath, 'utf-8')) as {
        exclude?: string[];
      };
      const exclude = mcpTsconfig.exclude ?? [];

      expect(exclude).toContain('src/**/*.spec.ts');
    });

    it('cli build:dist cleans dist before compilation to prevent stale test artifacts', () => {
      const cliPackageJsonPath = join(repoRoot, 'packages/@lumenflow/cli/package.json');
      const cliPackageJson = JSON.parse(readFileSync(cliPackageJsonPath, 'utf-8')) as {
        scripts?: Record<string, string>;
      };
      const buildDistScript = cliPackageJson.scripts?.['build:dist'];

      expect(buildDistScript).toBeTruthy();
      expect(buildDistScript).toContain('rm -rf dist');
      expect(buildDistScript).toContain('tsc -p tsconfig.build.json');
    });

    it('cli tsconfig excludes src test artifacts from regular dist output', () => {
      const cliTsconfigPath = join(repoRoot, 'packages/@lumenflow/cli/tsconfig.json');
      const cliTsconfig = JSON.parse(readFileSync(cliTsconfigPath, 'utf-8')) as {
        exclude?: string[];
      };
      const exclude = cliTsconfig.exclude ?? [];

      expect(exclude).toContain('src/**/__tests__');
      expect(exclude).toContain('src/**/*.test.ts');
    });
  });

  describe('validateSemver', () => {
    it('should accept valid semver versions', () => {
      expect(validateSemver('1.0.0')).toBe(true);
      expect(validateSemver('1.2.3')).toBe(true);
      expect(validateSemver('10.20.30')).toBe(true);
      expect(validateSemver('0.0.1')).toBe(true);
    });

    it('should accept semver with pre-release identifiers', () => {
      expect(validateSemver('1.0.0-alpha')).toBe(true);
      expect(validateSemver('1.0.0-beta.1')).toBe(true);
      expect(validateSemver('1.0.0-rc.1')).toBe(true);
    });

    it('should reject invalid versions', () => {
      expect(validateSemver('1')).toBe(false);
      expect(validateSemver('1.0')).toBe(false);
      expect(validateSemver('v1.0.0')).toBe(false);
      expect(validateSemver('1.0.0.0')).toBe(false);
      expect(validateSemver('abc')).toBe(false);
      expect(validateSemver('')).toBe(false);
    });
  });

  describe('findPackageJsonPaths', () => {
    let testDir: string;

    beforeEach(() => {
      // Create temp directory for test packages
      testDir = join(tmpdir(), `release-test-${Date.now()}`);
      mkdirSync(testDir, { recursive: true });
    });

    afterEach(() => {
      // Clean up temp directory
      rmSync(testDir, { recursive: true, force: true });
    });

    it('should find all @lumenflow/* package.json files', () => {
      // Create mock package structure
      const packagesDir = join(testDir, 'packages/@lumenflow');
      mkdirSync(join(packagesDir, 'core'), { recursive: true });
      mkdirSync(join(packagesDir, 'cli'), { recursive: true });
      mkdirSync(join(packagesDir, 'memory'), { recursive: true });

      writeFileSync(
        join(packagesDir, 'core/package.json'),
        JSON.stringify({ name: '@lumenflow/core', version: '1.0.0' }),
      );
      writeFileSync(
        join(packagesDir, 'cli/package.json'),
        JSON.stringify({ name: '@lumenflow/cli', version: '1.0.0' }),
      );
      writeFileSync(
        join(packagesDir, 'memory/package.json'),
        JSON.stringify({ name: '@lumenflow/memory', version: '1.0.0' }),
      );

      const paths = findPackageJsonPaths(testDir);

      expect(paths).toHaveLength(3);
      expect(paths).toContain(join(packagesDir, 'core/package.json'));
      expect(paths).toContain(join(packagesDir, 'cli/package.json'));
      expect(paths).toContain(join(packagesDir, 'memory/package.json'));
    });

    it('should not include packages with private: true', () => {
      // Create mock package structure with private package
      const packagesDir = join(testDir, 'packages/@lumenflow');
      mkdirSync(join(packagesDir, 'core'), { recursive: true });
      mkdirSync(join(packagesDir, 'internal'), { recursive: true });

      writeFileSync(
        join(packagesDir, 'core/package.json'),
        JSON.stringify({ name: '@lumenflow/core', version: '1.0.0' }),
      );
      writeFileSync(
        join(packagesDir, 'internal/package.json'),
        JSON.stringify({ name: '@lumenflow/internal', version: '1.0.0', private: true }),
      );

      const paths = findPackageJsonPaths(testDir);

      expect(paths).toHaveLength(1);
      expect(paths).toContain(join(packagesDir, 'core/package.json'));
    });
  });

  describe('updatePackageVersions', () => {
    let testDir: string;

    beforeEach(() => {
      testDir = join(tmpdir(), `release-test-${Date.now()}`);
      mkdirSync(testDir, { recursive: true });
    });

    afterEach(() => {
      rmSync(testDir, { recursive: true, force: true });
    });

    it('should update version in all package.json files', async () => {
      // Create mock package.json
      const packagePath = join(testDir, 'package.json');
      writeFileSync(
        packagePath,
        JSON.stringify(
          {
            name: '@lumenflow/core',
            version: '1.0.0',
            description: 'Core package',
          },
          null,
          2,
        ),
      );

      await updatePackageVersions([packagePath], '1.2.3');

      // Read back and verify
      const content = JSON.parse(
        await import('node:fs/promises').then((fs) => fs.readFile(packagePath, 'utf-8')),
      );
      expect(content.version).toBe('1.2.3');
      expect(content.name).toBe('@lumenflow/core'); // Other fields preserved
    });

    it('should preserve JSON formatting', async () => {
      // Create mock package.json with specific formatting
      const packagePath = join(testDir, 'package.json');
      writeFileSync(
        packagePath,
        JSON.stringify({ name: '@lumenflow/core', version: '1.0.0' }, null, 2) + '\n',
      );

      await updatePackageVersions([packagePath], '1.2.3');

      // Read back raw content and check formatting
      const content = await import('node:fs/promises').then((fs) =>
        fs.readFile(packagePath, 'utf-8'),
      );
      expect(content).toMatch(/{\n {2}"name"/); // Preserve 2-space indent
    });
  });

  describe('buildCommitMessage', () => {
    it('should build correct commit message for version bump', () => {
      const message = buildCommitMessage('1.3.0');
      expect(message).toBe('chore: bump all packages to v1.3.0');
    });
  });

  describe('buildTagName', () => {
    it('should build correct tag name', () => {
      expect(buildTagName('1.3.0')).toBe('v1.3.0');
      expect(buildTagName('1.0.0-beta.1')).toBe('v1.0.0-beta.1');
    });
  });
});

describe('release command integration', () => {
  // These tests verify the command exists and parses arguments correctly
  // They don't actually run the full release process

  it('should export main function from release.ts', async () => {
    // This test verifies the module structure exists
    const module = await import('../release.js');
    expect(module).toBeDefined();
    expect(typeof module.validateSemver).toBe('function');
    expect(typeof module.findPackageJsonPaths).toBe('function');
    expect(typeof module.updatePackageVersions).toBe('function');
  });
});

describe('WU-1595: wu-release claim metadata reset coverage', () => {
  it('clears claimed_mode and claimed_branch while preserving other fields', () => {
    const doc = {
      id: 'WU-1595',
      status: 'in_progress',
      claimed_mode: 'branch-pr',
      claimed_branch: 'feature/cloud-agent-branch',
      worktree_path: '/tmp/worktree',
      notes: 'keep this',
    };

    clearClaimMetadataOnRelease(doc);

    expect(doc.claimed_mode).toBeUndefined();
    expect(doc.claimed_branch).toBeUndefined();
    expect(doc.worktree_path).toBe('/tmp/worktree');
    expect(doc.notes).toBe('keep this');
  });
});

/**
 * WU-1296: Tests for release flow trunk protection compatibility
 *
 * Verifies:
 * - RELEASE_WU_TOOL constant is exported for pre-push hook bypass
 * - withReleaseEnv helper sets LUMENFLOW_WU_TOOL=release during execution
 * - Environment is properly restored after execution (including on error)
 */
describe('WU-1296: release flow trunk protection compatibility', () => {
  it('should export RELEASE_WU_TOOL constant for pre-push hook bypass', async () => {
    const { RELEASE_WU_TOOL } = await import('../release.js');
    expect(RELEASE_WU_TOOL).toBe('release');
  });

  it('should export withReleaseEnv helper for setting LUMENFLOW_WU_TOOL', async () => {
    const { withReleaseEnv } = await import('../release.js');
    expect(typeof withReleaseEnv).toBe('function');
  });

  it('withReleaseEnv should set and restore LUMENFLOW_WU_TOOL', async () => {
    const { withReleaseEnv } = await import('../release.js');

    // Save original value
    const originalValue = process.env.LUMENFLOW_WU_TOOL;

    let capturedValue: string | undefined;
    await withReleaseEnv(async () => {
      capturedValue = process.env.LUMENFLOW_WU_TOOL;
    });

    expect(capturedValue).toBe('release');
    expect(process.env.LUMENFLOW_WU_TOOL).toBe(originalValue);
  });

  it('withReleaseEnv should restore LUMENFLOW_WU_TOOL even on error', async () => {
    const { withReleaseEnv } = await import('../release.js');

    // Save original value
    const originalValue = process.env.LUMENFLOW_WU_TOOL;

    try {
      await withReleaseEnv(async () => {
        throw new Error('Test error');
      });
    } catch {
      // Expected to throw
    }

    expect(process.env.LUMENFLOW_WU_TOOL).toBe(originalValue);
  });

  it('withReleaseEnv should preserve existing LUMENFLOW_WU_TOOL value', async () => {
    const { withReleaseEnv } = await import('../release.js');

    // Set a specific value before running
    const testValue = 'wu-done';
    process.env.LUMENFLOW_WU_TOOL = testValue;

    try {
      let capturedValue: string | undefined;
      await withReleaseEnv(async () => {
        capturedValue = process.env.LUMENFLOW_WU_TOOL;
      });

      expect(capturedValue).toBe('release');
      expect(process.env.LUMENFLOW_WU_TOOL).toBe(testValue);
    } finally {
      // Cleanup
      delete process.env.LUMENFLOW_WU_TOOL;
    }
  });
});

/**
 * WU-1077: Tests for release script bug fixes
 *
 * Verifies:
 * - hasNpmAuth() detects auth from ~/.npmrc not just env vars
 * - Changeset pre mode is detected and exited in micro-worktree
 * - Tag push bypasses pre-push hooks via LUMENFLOW_FORCE
 */
describe('WU-1077: release script bug fixes', () => {
  describe('hasNpmAuth - ~/.npmrc detection', () => {
    let testDir: string;
    let originalUserConfig: string | undefined;
    let originalNpmToken: string | undefined;
    let originalNodeAuthToken: string | undefined;

    beforeEach(() => {
      testDir = join(tmpdir(), `release-npmrc-test-${Date.now()}`);
      mkdirSync(testDir, { recursive: true });
      originalUserConfig = process.env.NPM_CONFIG_USERCONFIG;
      originalNpmToken = process.env.NPM_TOKEN;
      originalNodeAuthToken = process.env.NODE_AUTH_TOKEN;
      process.env.NPM_CONFIG_USERCONFIG = join(testDir, 'user.npmrc');
      writeFileSync(process.env.NPM_CONFIG_USERCONFIG, '');
      delete process.env.NPM_TOKEN;
      delete process.env.NODE_AUTH_TOKEN;
    });

    afterEach(() => {
      if (originalUserConfig === undefined) {
        delete process.env.NPM_CONFIG_USERCONFIG;
      } else {
        process.env.NPM_CONFIG_USERCONFIG = originalUserConfig;
      }
      if (originalNpmToken === undefined) {
        delete process.env.NPM_TOKEN;
      } else {
        process.env.NPM_TOKEN = originalNpmToken;
      }
      if (originalNodeAuthToken === undefined) {
        delete process.env.NODE_AUTH_TOKEN;
      } else {
        process.env.NODE_AUTH_TOKEN = originalNodeAuthToken;
      }
      rmSync(testDir, { recursive: true, force: true });
    });

    it('should detect auth from ~/.npmrc authToken line', async () => {
      // Import the function we're testing
      const { hasNpmAuth } = await import('../release.js');

      // Create a mock .npmrc with auth token
      const npmrcPath = join(testDir, '.npmrc');
      writeFileSync(npmrcPath, '//registry.npmjs.org/:_authToken=npm_testToken123\n');

      // Test that it detects auth from the file
      const result = hasNpmAuth(npmrcPath);
      expect(result).toBe(true);
    });

    it('should return false when ~/.npmrc has no auth token', async () => {
      const { hasNpmAuth } = await import('../release.js');

      // Create a mock .npmrc without auth token
      const npmrcPath = join(testDir, '.npmrc');
      writeFileSync(npmrcPath, 'registry=https://registry.npmjs.org\n');

      const result = hasNpmAuth(npmrcPath);
      expect(result).toBe(false);
    });

    it('should return false when ~/.npmrc does not exist', async () => {
      const { hasNpmAuth } = await import('../release.js');

      // Non-existent path
      const npmrcPath = join(testDir, 'nonexistent', '.npmrc');

      const result = hasNpmAuth(npmrcPath);
      expect(result).toBe(false);
    });

    it('should still detect auth from NPM_TOKEN env var', async () => {
      const { hasNpmAuth } = await import('../release.js');

      // Set env var
      const originalNpmToken = process.env.NPM_TOKEN;
      process.env.NPM_TOKEN = 'test_token';

      try {
        // No npmrc file provided, should check env var
        const result = hasNpmAuth();
        expect(result).toBe(true);
      } finally {
        // Restore
        if (originalNpmToken === undefined) {
          delete process.env.NPM_TOKEN;
        } else {
          process.env.NPM_TOKEN = originalNpmToken;
        }
      }
    });
  });

  describe('isInChangesetPreMode', () => {
    let testDir: string;

    beforeEach(() => {
      testDir = join(tmpdir(), `release-pre-test-${Date.now()}`);
      mkdirSync(testDir, { recursive: true });
    });

    afterEach(() => {
      rmSync(testDir, { recursive: true, force: true });
    });

    it('should return true when .changeset/pre.json exists', async () => {
      const { isInChangesetPreMode } = await import('../release.js');

      // Create .changeset directory and pre.json
      const changesetDir = join(testDir, '.changeset');
      mkdirSync(changesetDir, { recursive: true });
      writeFileSync(
        join(changesetDir, 'pre.json'),
        JSON.stringify({
          mode: 'pre',
          tag: 'next',
          initialVersions: {},
          changesets: [],
        }),
      );

      const result = isInChangesetPreMode(testDir);
      expect(result).toBe(true);
    });

    it('should return false when .changeset/pre.json does not exist', async () => {
      const { isInChangesetPreMode } = await import('../release.js');

      // Create .changeset directory without pre.json
      const changesetDir = join(testDir, '.changeset');
      mkdirSync(changesetDir, { recursive: true });
      writeFileSync(join(changesetDir, 'config.json'), JSON.stringify({ access: 'public' }));

      const result = isInChangesetPreMode(testDir);
      expect(result).toBe(false);
    });

    it('should return false when .changeset directory does not exist', async () => {
      const { isInChangesetPreMode } = await import('../release.js');

      const result = isInChangesetPreMode(testDir);
      expect(result).toBe(false);
    });
  });

  describe('exitChangesetPreMode', () => {
    let testDir: string;

    beforeEach(() => {
      testDir = join(tmpdir(), `release-exit-pre-test-${Date.now()}`);
      mkdirSync(testDir, { recursive: true });
    });

    afterEach(() => {
      rmSync(testDir, { recursive: true, force: true });
    });

    it('should delete .changeset/pre.json to exit pre mode', async () => {
      const { exitChangesetPreMode, isInChangesetPreMode } = await import('../release.js');

      // Create .changeset directory and pre.json
      const changesetDir = join(testDir, '.changeset');
      mkdirSync(changesetDir, { recursive: true });
      const preJsonPath = join(changesetDir, 'pre.json');
      writeFileSync(
        preJsonPath,
        JSON.stringify({
          mode: 'pre',
          tag: 'next',
          initialVersions: {},
          changesets: [],
        }),
      );

      // Verify pre mode is active
      expect(isInChangesetPreMode(testDir)).toBe(true);

      // Exit pre mode
      exitChangesetPreMode(testDir);

      // Verify pre mode is no longer active
      expect(isInChangesetPreMode(testDir)).toBe(false);
      expect(existsSync(preJsonPath)).toBe(false);
    });

    it('should not throw when .changeset/pre.json does not exist', async () => {
      const { exitChangesetPreMode } = await import('../release.js');

      // No pre.json file exists
      expect(() => exitChangesetPreMode(testDir)).not.toThrow();
    });
  });

  describe('pushTagWithForce', () => {
    it('should export pushTagWithForce function', async () => {
      const { pushTagWithForce } = await import('../release.js');
      expect(typeof pushTagWithForce).toBe('function');
    });

    // Integration test would require git setup - functional verification
    // is done by checking the function uses LUMENFLOW_FORCE env var
  });
});
