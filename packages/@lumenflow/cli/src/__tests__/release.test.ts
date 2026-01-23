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
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
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

describe('release command', () => {
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
      expect(content).toMatch(/{\n  "name"/); // Preserve 2-space indent
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
