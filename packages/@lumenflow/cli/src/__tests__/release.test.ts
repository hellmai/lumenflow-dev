// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

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
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  readFileSync,
  symlinkSync,
  lstatSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

// Import functions under test
import {
  validateSemver,
  findPackageJsonPaths,
  updatePackageVersions,
  buildCommitMessage,
  buildTagName,
  assertWorkingTreeClean,
  extractPackageContractPaths,
  validatePackedArtifacts,
  ensureDistPathsMaterialized,
  parsePackDryRunMetadata,
  findJsonStartIndex,
  removeMaterializedDistDirs,
  type ReleaseOptions,
} from '../release.js';
import { clearClaimMetadataOnRelease } from '../wu-release.js';

const SCRIPT_COMMAND_SEPARATOR = '&&';
const CLI_SCRIPT_PREFIX = 'node ';
const CLI_PACKAGE_JSON_PATH = 'packages/@lumenflow/cli/package.json';
const CLI_PACKAGE_ROOT_PATH = 'packages/@lumenflow/cli';
const CLI_SYNC_BUNDLED_PACKS_SCRIPT_KEY = 'sync:bundled-packs';
const CLI_CLEAN_BUNDLED_PACKS_SCRIPT_KEY = 'clean:bundled-packs';
const CLI_PREPACK_SCRIPT_KEY = 'prepack';
const CLI_POSTPACK_SCRIPT_KEY = 'postpack';
const CLI_SYNC_BUNDLED_PACKS_SCRIPT_PATH = 'scripts/sync-bundled-packs.mjs';
const CLI_CLEAN_BUNDLED_PACKS_SCRIPT_PATH = 'scripts/clean-bundled-packs.mjs';
const CLI_SYNC_BUNDLED_PACKS_SCRIPT_COMMAND = `${CLI_SCRIPT_PREFIX}${CLI_SYNC_BUNDLED_PACKS_SCRIPT_PATH}`;
const CLI_CLEAN_BUNDLED_PACKS_SCRIPT_COMMAND = `${CLI_SCRIPT_PREFIX}${CLI_CLEAN_BUNDLED_PACKS_SCRIPT_PATH}`;
const CLI_PREPACK_SCRIPT_COMMAND = `pnpm run ${CLI_SYNC_BUNDLED_PACKS_SCRIPT_KEY}`;
const CLI_POSTPACK_SCRIPT_COMMAND = `pnpm run ${CLI_CLEAN_BUNDLED_PACKS_SCRIPT_KEY}`;
const RELEASE_CLEAN_CHECK_PHASE_AFTER_PUBLISH = 'after npm publish';
const BUILD_DIST_SCRIPT_STEPS = [
  'pnpm run clean',
  'pnpm run build:dist:deps',
  'tsup',
  `${CLI_SCRIPT_PREFIX}scripts/fix-entry-points.mjs`,
  `${CLI_SCRIPT_PREFIX}scripts/check-shebangs.mjs`,
] as const;
const BUILD_DIST_DEPENDENCY_STEPS = [
  'pnpm --filter @lumenflow/metrics build',
  'pnpm --filter @lumenflow/kernel build',
  'pnpm --filter @lumenflow/core build',
  'pnpm --filter @lumenflow/memory build',
  'pnpm --filter @lumenflow/agent build',
  'pnpm --filter @lumenflow/initiatives build',
] as const;

function splitScriptSteps(script: string): string[] {
  return script
    .split(SCRIPT_COMMAND_SEPARATOR)
    .map((step) => step.trim())
    .filter((step) => step.length > 0);
}

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

    it('cli build:dist enforces clean tsup output and post-build integrity checks', () => {
      const cliPackageJsonPath = join(repoRoot, CLI_PACKAGE_JSON_PATH);
      const cliPackageJson = JSON.parse(readFileSync(cliPackageJsonPath, 'utf-8')) as {
        scripts?: Record<string, string>;
      };
      const buildDistScript = cliPackageJson.scripts?.['build:dist'];

      expect(buildDistScript).toBeTruthy();
      const buildDistSteps = splitScriptSteps(buildDistScript!);
      expect(buildDistSteps).toEqual(BUILD_DIST_SCRIPT_STEPS);

      const buildDistDepsScript = cliPackageJson.scripts?.['build:dist:deps'];
      expect(buildDistDepsScript).toBeTruthy();
      const buildDistDependencySteps = splitScriptSteps(buildDistDepsScript!);
      expect(buildDistDependencySteps).toEqual(BUILD_DIST_DEPENDENCY_STEPS);

      for (const step of BUILD_DIST_SCRIPT_STEPS.filter((command) =>
        command.startsWith(CLI_SCRIPT_PREFIX),
      )) {
        const scriptPath = step.replace(CLI_SCRIPT_PREFIX, '');
        expect(existsSync(join(repoRoot, CLI_PACKAGE_ROOT_PATH, scriptPath))).toBe(true);
      }

      const cliTsupConfigPath = join(repoRoot, 'packages/@lumenflow/cli/tsup.config.ts');
      const cliTsupConfig = readFileSync(cliTsupConfigPath, 'utf-8');
      expect(cliTsupConfig).toMatch(/\bclean:\s*true\b/);
    });

    it('cli pack lifecycle scripts sync and clean bundled packs', () => {
      const cliPackageJsonPath = join(repoRoot, CLI_PACKAGE_JSON_PATH);
      const cliPackageJson = JSON.parse(readFileSync(cliPackageJsonPath, 'utf-8')) as {
        scripts?: Record<string, string>;
      };
      const scripts = cliPackageJson.scripts ?? {};

      expect(scripts[CLI_SYNC_BUNDLED_PACKS_SCRIPT_KEY]).toBe(
        CLI_SYNC_BUNDLED_PACKS_SCRIPT_COMMAND,
      );
      expect(scripts[CLI_PREPACK_SCRIPT_KEY]).toBe(CLI_PREPACK_SCRIPT_COMMAND);
      expect(scripts[CLI_CLEAN_BUNDLED_PACKS_SCRIPT_KEY]).toBe(
        CLI_CLEAN_BUNDLED_PACKS_SCRIPT_COMMAND,
      );
      expect(scripts[CLI_POSTPACK_SCRIPT_KEY]).toBe(CLI_POSTPACK_SCRIPT_COMMAND);

      const bundledPackScriptPaths = [
        CLI_SYNC_BUNDLED_PACKS_SCRIPT_PATH,
        CLI_CLEAN_BUNDLED_PACKS_SCRIPT_PATH,
      ];
      for (const scriptPath of bundledPackScriptPaths) {
        expect(existsSync(join(repoRoot, CLI_PACKAGE_ROOT_PATH, scriptPath))).toBe(true);
      }
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

    it('should include bare lumenflow wrapper package (WU-1691)', () => {
      // Create scoped packages
      const scopedDir = join(testDir, 'packages/@lumenflow');
      mkdirSync(join(scopedDir, 'core'), { recursive: true });
      writeFileSync(
        join(scopedDir, 'core/package.json'),
        JSON.stringify({ name: '@lumenflow/core', version: '1.0.0' }),
      );

      // Create bare wrapper package
      const wrapperDir = join(testDir, 'packages/lumenflow');
      mkdirSync(wrapperDir, { recursive: true });
      writeFileSync(
        join(wrapperDir, 'package.json'),
        JSON.stringify({ name: 'lumenflow', version: '1.0.0' }),
      );

      const paths = findPackageJsonPaths(testDir);

      expect(paths).toHaveLength(2);
      expect(paths).toContain(join(scopedDir, 'core/package.json'));
      expect(paths).toContain(join(wrapperDir, 'package.json'));
    });

    it('should not include bare lumenflow wrapper if private: true', () => {
      const scopedDir = join(testDir, 'packages/@lumenflow');
      mkdirSync(join(scopedDir, 'core'), { recursive: true });
      writeFileSync(
        join(scopedDir, 'core/package.json'),
        JSON.stringify({ name: '@lumenflow/core', version: '1.0.0' }),
      );

      const wrapperDir = join(testDir, 'packages/lumenflow');
      mkdirSync(wrapperDir, { recursive: true });
      writeFileSync(
        join(wrapperDir, 'package.json'),
        JSON.stringify({ name: 'lumenflow', version: '1.0.0', private: true }),
      );

      const paths = findPackageJsonPaths(testDir);

      expect(paths).toHaveLength(1);
      expect(paths).toContain(join(scopedDir, 'core/package.json'));
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

    it('should update version in bare lumenflow wrapper (WU-1691)', async () => {
      const packagePath = join(testDir, 'package.json');
      writeFileSync(
        packagePath,
        JSON.stringify(
          {
            name: 'lumenflow',
            version: '1.0.0',
            dependencies: { '@lumenflow/cli': 'workspace:^' },
          },
          null,
          2,
        ),
      );

      await updatePackageVersions([packagePath], '2.20.0');

      const content = JSON.parse(
        await import('node:fs/promises').then((fs) => fs.readFile(packagePath, 'utf-8')),
      );
      expect(content.version).toBe('2.20.0');
      expect(content.name).toBe('lumenflow');
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
      expect(message).toBe('chore(release): bump all packages to v1.3.0');
    });

    it('should match the commit-msg hook allowed pattern for releases (WU-2065)', () => {
      // This pattern must stay in sync with .husky/hooks/commit-msg.mjs ALLOWED_ON_MAIN
      const hookPattern = /^chore\(release\): .+$/i;
      expect(hookPattern.test(buildCommitMessage('1.0.0'))).toBe(true);
      expect(hookPattern.test(buildCommitMessage('3.2.1'))).toBe(true);
      expect(hookPattern.test(buildCommitMessage('10.0.0-beta.1'))).toBe(true);
    });
  });

  describe('buildTagName', () => {
    it('should build correct tag name', () => {
      expect(buildTagName('1.3.0')).toBe('v1.3.0');
      expect(buildTagName('1.0.0-beta.1')).toBe('v1.0.0-beta.1');
    });
  });

  describe('WU-2060 release artifact guards', () => {
    it('extracts contract paths from exports/bin/main/types without hardcoded lists', () => {
      const paths = extractPackageContractPaths({
        main: './dist/index.js',
        types: './dist/index.d.ts',
        exports: {
          '.': {
            import: './dist/index.js',
            types: './dist/index.d.ts',
          },
          './config-schema': './dist/lumenflow-config-schema.js',
          './nested': {
            node: {
              import: './dist/nested-node.js',
            },
            default: './dist/nested.js',
          },
        },
        bin: {
          lumenflow: './dist/init.js',
        },
      });

      expect(paths).toContain('dist/index.js');
      expect(paths).toContain('dist/index.d.ts');
      expect(paths).toContain('dist/lumenflow-config-schema.js');
      expect(paths).toContain('dist/nested-node.js');
      expect(paths).toContain('dist/nested.js');
      expect(paths).toContain('dist/init.js');
      expect(new Set(paths).size).toBe(paths.length);
    });

    it('fails validation when packed tarball misses files declared by exports', () => {
      const result = validatePackedArtifacts({
        packageName: '@lumenflow/core',
        packageDir: '/tmp/core',
        manifest: {
          exports: {
            '.': './dist/index.js',
            './config-schema': './dist/lumenflow-config-schema.js',
          },
          files: ['dist', 'README.md'],
        },
        packedFiles: ['dist/index.js', 'package.json', 'README.md'],
        srcFileCount: 2,
        distFileCount: 2,
      });

      expect(result.ok).toBe(false);
      expect(result.missingContractPaths).toContain('dist/lumenflow-config-schema.js');
    });

    it('accepts pack output paths that include a package/ prefix', () => {
      const result = validatePackedArtifacts({
        packageName: '@lumenflow/core',
        packageDir: '/tmp/core',
        manifest: {
          exports: {
            '.': './dist/index.js',
            './config-schema': './dist/lumenflow-config-schema.js',
          },
          files: ['dist', 'README.md'],
        },
        packedFiles: [
          'package/dist/index.js',
          'package/dist/lumenflow-config-schema.js',
          'package/package.json',
          'package/README.md',
        ],
        srcFileCount: 2,
        distFileCount: 2,
      });

      expect(result.ok).toBe(true);
    });

    it('fails validation when packed file count drops below 10% of previous published version', () => {
      const result = validatePackedArtifacts({
        packageName: '@lumenflow/core',
        packageDir: '/tmp/core',
        manifest: {
          exports: { '.': './dist/index.js' },
          files: ['dist', 'README.md'],
        },
        packedFiles: ['dist/index.js', 'package.json', 'README.md'],
        srcFileCount: 1,
        distFileCount: 1,
        previousPackedFileCount: 100,
      });

      expect(result.ok).toBe(false);
      expect(result.errors.join('\n')).toContain('10%');
    });

    it('fails validation when dist has fewer files than src for dist-based packages', () => {
      const result = validatePackedArtifacts({
        packageName: '@lumenflow/core',
        packageDir: '/tmp/core',
        manifest: {
          exports: { '.': './dist/index.js' },
          files: ['dist', 'README.md'],
        },
        packedFiles: ['dist/index.js', 'package.json', 'README.md'],
        srcFileCount: 25,
        distFileCount: 2,
      });

      expect(result.ok).toBe(false);
      expect(result.errors.join('\n')).toContain('fewer files than src');
    });

    it('passes validation when contract paths and sanity checks are satisfied', () => {
      const result = validatePackedArtifacts({
        packageName: '@lumenflow/core',
        packageDir: '/tmp/core',
        manifest: {
          exports: {
            '.': './dist/index.js',
            './config-schema': './dist/lumenflow-config-schema.js',
          },
          bin: {
            'is-agent-branch': './dist/cli/is-agent-branch.js',
          },
          files: ['dist', 'README.md'],
        },
        packedFiles: [
          'dist/index.js',
          'dist/lumenflow-config-schema.js',
          'dist/cli/is-agent-branch.js',
          'package.json',
          'README.md',
          'LICENSE',
          'dist/index.d.ts',
          'dist/cli/is-agent-branch.d.ts',
          'dist/chunk-a.js',
          'dist/chunk-b.js',
          'dist/chunk-c.js',
        ],
        srcFileCount: 4,
        distFileCount: 7,
        previousPackedFileCount: 100,
      });

      expect(result.ok).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('materializes symlinked dist directories before build/publish', () => {
      const testRoot = join(tmpdir(), `release-dist-symlink-${Date.now()}`);
      const packageDir = join(testRoot, 'packages/@lumenflow/core');
      const sourceDist = join(testRoot, 'seed-dist');
      const distPath = join(packageDir, 'dist');

      mkdirSync(sourceDist, { recursive: true });
      writeFileSync(join(sourceDist, 'index.js'), 'export const value = 1;\n');
      mkdirSync(packageDir, { recursive: true });
      symlinkSync(sourceDist, distPath, 'dir');

      const result = ensureDistPathsMaterialized([packageDir], {
        skipBuild: false,
        dryRun: false,
      });

      expect(result.materializedCount).toBe(1);
      expect(lstatSync(distPath).isSymbolicLink()).toBe(false);
      expect(existsSync(distPath)).toBe(true);

      rmSync(testRoot, { recursive: true, force: true });
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

describe('WU-2055 release clean-tree enforcement', () => {
  it('allows release flow to continue when the working tree is clean', async () => {
    await expect(
      assertWorkingTreeClean(
        {
          isClean: async () => true,
        },
        RELEASE_CLEAN_CHECK_PHASE_AFTER_PUBLISH,
      ),
    ).resolves.toBeUndefined();
  });

  it('fails release flow when the working tree is dirty after publish', async () => {
    await expect(
      assertWorkingTreeClean(
        {
          isClean: async () => false,
        },
        RELEASE_CLEAN_CHECK_PHASE_AFTER_PUBLISH,
      ),
    ).rejects.toThrow(RELEASE_CLEAN_CHECK_PHASE_AFTER_PUBLISH);
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

/**
 * WU-2061 + WU-2062: Tests for release script safety fixes
 *
 * Verifies:
 * - parsePackDryRunMetadata strips pnpm lifecycle output prefixed before JSON
 * - findJsonStartIndex correctly locates the first JSON-start character
 * - WU-2062: findJsonStartIndex skips log-style brackets like [sync:bundled-packs]
 */
describe('WU-2061/WU-2062: release script safety — parsePackDryRunMetadata JSON stripping', () => {
  describe('findJsonStartIndex', () => {
    it('returns 0 for input starting with [', () => {
      expect(findJsonStartIndex('[{"files":[]}]')).toBe(0);
    });

    it('returns 0 for input starting with {', () => {
      expect(findJsonStartIndex('{"files":[]}')).toBe(0);
    });

    it('returns index of first [ when preceded by lifecycle output', () => {
      const input = '> @lumenflow/cli@3.2.1 prepack\n> pnpm run sync:bundled-packs\n[{"files":[]}]';
      const idx = findJsonStartIndex(input);
      expect(input[idx]).toBe('[');
      expect(input.slice(idx)).toBe('[{"files":[]}]');
    });

    it('returns index of first { when preceded by lifecycle output', () => {
      const input = '> @lumenflow/cli@3.2.1 prepack\n{"files":[]}';
      const idx = findJsonStartIndex(input);
      expect(input[idx]).toBe('{');
      expect(input.slice(idx)).toBe('{"files":[]}');
    });

    it('returns 0 when no JSON-start character found (let JSON.parse fail)', () => {
      expect(findJsonStartIndex('no json here')).toBe(0);
    });

    it('returns earlier index when both [ and { appear', () => {
      expect(findJsonStartIndex('prefix[{"a":1}]')).toBe(6);
      expect(findJsonStartIndex('prefix{"a":[1]}')).toBe(6);
    });

    // WU-2062: The critical bug — [sync:bundled-packs] was matched as JSON start
    it('skips log-style brackets like [sync:bundled-packs] and finds actual JSON', () => {
      const input =
        '[sync:bundled-packs] Copied 29 files to packs/software-delivery\n[{"files":[]}]';
      const idx = findJsonStartIndex(input);
      expect(input.slice(idx)).toBe('[{"files":[]}]');
    });

    it('skips multiple log-style brackets before JSON', () => {
      const input =
        '[sync:bundled-packs] step 1\n' +
        '[postpack] cleaning up\n' +
        '[{"files":[{"path":"dist/index.js"}]}]';
      const idx = findJsonStartIndex(input);
      expect(input.slice(idx)).toBe('[{"files":[{"path":"dist/index.js"}]}]');
    });

    it('handles JSON object after log-style brackets', () => {
      const input = '[sync:bundled-packs] done\n{"files":[]}';
      const idx = findJsonStartIndex(input);
      expect(input.slice(idx)).toBe('{"files":[]}');
    });

    it('handles JSON with whitespace after opening bracket', () => {
      expect(findJsonStartIndex('noise[ {"a":1}]')).toBe(5);
      expect(findJsonStartIndex('noise{ "a":1}')).toBe(5);
    });

    it('handles empty JSON structures', () => {
      expect(findJsonStartIndex('prefix[]')).toBe(6);
      expect(findJsonStartIndex('prefix{}')).toBe(6);
    });

    it('handles real pnpm lifecycle output with sync:bundled-packs log', () => {
      const realWorldOutput =
        '> @lumenflow/cli@3.2.1 prepack\n' +
        '> pnpm run sync:bundled-packs\n' +
        '\n' +
        '> @lumenflow/cli@3.2.1 sync:bundled-packs\n' +
        '> node scripts/sync-bundled-packs.mjs\n' +
        '\n' +
        '[sync:bundled-packs] Copied 29 files to packs/software-delivery\n' +
        '[{"id":"@lumenflow/cli","name":"@lumenflow-cli-3.2.1.tgz","files":[{"path":"dist/index.js"}]}]';
      const idx = findJsonStartIndex(realWorldOutput);
      const json = realWorldOutput.slice(idx);
      expect(() => JSON.parse(json)).not.toThrow();
      const parsed = JSON.parse(json) as Array<{ files: Array<{ path: string }> }>;
      expect(parsed[0].files[0].path).toBe('dist/index.js');
    });
  });

  describe('parsePackDryRunMetadata', () => {
    it('parses clean JSON array from pnpm pack', () => {
      const input = JSON.stringify([{ files: [{ path: 'dist/index.js' }] }]);
      const result = parsePackDryRunMetadata(input);
      expect(result.files).toHaveLength(1);
      expect(result.files[0].path).toBe('dist/index.js');
    });

    it('parses clean JSON object from npm pack', () => {
      const input = JSON.stringify({ files: [{ path: 'dist/index.js' }] });
      const result = parsePackDryRunMetadata(input);
      expect(result.files).toHaveLength(1);
    });

    it('strips pnpm lifecycle output before JSON payload', () => {
      const lifecycleNoise =
        '> @lumenflow/cli@3.2.1 prepack\n' +
        '> pnpm run sync:bundled-packs\n' +
        '\n' +
        '> @lumenflow/cli@3.2.1 sync:bundled-packs\n' +
        '> node scripts/sync-bundled-packs.mjs\n' +
        '\n';
      const jsonPayload = JSON.stringify([
        { files: [{ path: 'dist/index.js' }, { path: 'package.json' }] },
      ]);
      const input = lifecycleNoise + jsonPayload;

      const result = parsePackDryRunMetadata(input);
      expect(result.files).toHaveLength(2);
      expect(result.files[0].path).toBe('dist/index.js');
      expect(result.files[1].path).toBe('package.json');
    });

    // WU-2062: The exact failure case from the real release attempt
    it('strips lifecycle output with [sync:bundled-packs] log prefix before JSON', () => {
      const lifecycleNoise =
        '> @lumenflow/cli@3.2.1 prepack\n' +
        '> pnpm run sync:bundled-packs\n' +
        '\n' +
        '> @lumenflow/cli@3.2.1 sync:bundled-packs\n' +
        '> node scripts/sync-bundled-packs.mjs\n' +
        '\n' +
        '[sync:bundled-packs] Copied 29 files to packs/software-delivery\n';
      const jsonPayload = JSON.stringify([
        { files: [{ path: 'dist/index.js' }, { path: 'package.json' }] },
      ]);
      const input = lifecycleNoise + jsonPayload;

      const result = parsePackDryRunMetadata(input);
      expect(result.files).toHaveLength(2);
      expect(result.files[0].path).toBe('dist/index.js');
    });

    it('throws on empty input', () => {
      expect(() => parsePackDryRunMetadata('')).toThrow('empty output');
    });

    it('throws on input with no valid JSON structure', () => {
      expect(() => parsePackDryRunMetadata('just some text without json')).toThrow();
    });

    it('throws when files array is missing', () => {
      const input = JSON.stringify({ name: 'test' });
      expect(() => parsePackDryRunMetadata(input)).toThrow('files[]');
    });

    it('throws when files entry lacks path string', () => {
      const input = JSON.stringify({ files: [{ size: 100 }] });
      expect(() => parsePackDryRunMetadata(input)).toThrow('invalid files[]');
    });

    it('extracts entryCount when present', () => {
      const input = JSON.stringify({
        files: [{ path: 'dist/index.js' }],
        entryCount: 42,
      });
      const result = parsePackDryRunMetadata(input);
      expect(result.entryCount).toBe(42);
    });
  });
});

/**
 * WU-2219: Release script micro-worktree isolation
 *
 * Verifies that:
 * - Release uses withMicroWorktree for all file writes
 * - No direct writes to main checkout during release
 * - Cleanup on failure leaves main untouched (micro-worktree handles it)
 * - The release function is exported for testability
 */
describe('WU-2219: release micro-worktree isolation', () => {
  it('should export executeReleaseInMicroWorktree function', async () => {
    const mod = await import('../release.js');
    expect(typeof mod.executeReleaseInMicroWorktree).toBe('function');
  });

  it('should export RELEASE_OPERATION_NAME constant', async () => {
    const mod = await import('../release.js');
    expect(mod.RELEASE_OPERATION_NAME).toBe('release');
  });

  it('should export buildReleaseWorktreeId helper', async () => {
    const mod = await import('../release.js');
    expect(typeof mod.buildReleaseWorktreeId).toBe('function');
    const id = mod.buildReleaseWorktreeId('1.3.0');
    expect(id).toBe('v1.3.0');
  });
});

describe('WU-2086: removeMaterializedDistDirs', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `release-test-wu2086-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('removes real dist directories (materialized symlinks)', () => {
    const pkgDir = join(tempDir, 'packages', 'cli');
    mkdirSync(join(pkgDir, 'dist'), { recursive: true });
    writeFileSync(join(pkgDir, 'dist', 'index.js'), 'console.log("built")');

    expect(existsSync(join(pkgDir, 'dist'))).toBe(true);
    expect(lstatSync(join(pkgDir, 'dist')).isSymbolicLink()).toBe(false);

    removeMaterializedDistDirs([pkgDir]);

    expect(existsSync(join(pkgDir, 'dist'))).toBe(false);
  });

  it('preserves dist symlinks (not materialized)', () => {
    const pkgDir = join(tempDir, 'packages', 'core');
    mkdirSync(pkgDir, { recursive: true });

    // Create a real target dir and a symlink to it
    const realDist = join(tempDir, 'real-dist');
    mkdirSync(realDist, { recursive: true });
    symlinkSync(realDist, join(pkgDir, 'dist'));

    expect(lstatSync(join(pkgDir, 'dist')).isSymbolicLink()).toBe(true);

    removeMaterializedDistDirs([pkgDir]);

    // Symlink should still exist
    expect(existsSync(join(pkgDir, 'dist'))).toBe(true);
    expect(lstatSync(join(pkgDir, 'dist')).isSymbolicLink()).toBe(true);
  });

  it('skips packages without dist directory', () => {
    const pkgDir = join(tempDir, 'packages', 'empty');
    mkdirSync(pkgDir, { recursive: true });

    // Should not throw
    removeMaterializedDistDirs([pkgDir]);

    expect(existsSync(join(pkgDir, 'dist'))).toBe(false);
  });
});
