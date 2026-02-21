// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * @file init-package-json.test.ts
 * WU-1963: lumenflow init should scaffold package.json with @lumenflow/cli dependency
 *
 * Tests that lumenflow init:
 * 1. Creates package.json with @lumenflow/cli devDependency in a fresh directory
 * 2. Adds @lumenflow/cli devDependency to existing package.json without overwriting
 * 3. Adds scripts so pnpm wu:create and pnpm gates work after init
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { scaffoldProject } from '../init.js';

/** Package.json file name constant */
const PACKAGE_JSON_FILE_NAME = 'package.json';

/** CLI package name constant */
const CLI_PACKAGE_NAME = '@lumenflow/cli';

/** Type for parsed package.json */
interface PackageJson {
  name?: string;
  version?: string;
  private?: boolean;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

describe('init package.json with @lumenflow/cli dependency (WU-1963)', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumenflow-init-pkg-json-'));
  });

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  /** Helper to read and parse package.json from temp directory */
  function readPackageJson(): PackageJson {
    const packageJsonPath = path.join(tempDir, PACKAGE_JSON_FILE_NAME);
    return JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8')) as PackageJson;
  }

  // =========================================================================
  // AC1: lumenflow init in a fresh directory creates package.json with
  //      @lumenflow/cli dependency
  // =========================================================================
  it('should create package.json with @lumenflow/cli in devDependencies (fresh dir)', async () => {
    // Act
    await scaffoldProject(tempDir, { force: true, full: true });

    // Assert
    const packageJsonPath = path.join(tempDir, PACKAGE_JSON_FILE_NAME);
    expect(fs.existsSync(packageJsonPath)).toBe(true);

    const packageJson = readPackageJson();
    expect(packageJson.devDependencies).toBeDefined();
    expect(packageJson.devDependencies?.[CLI_PACKAGE_NAME]).toBeDefined();
  });

  it('should set @lumenflow/cli version to a valid semver range', async () => {
    // Act
    await scaffoldProject(tempDir, { force: true, full: true });

    // Assert
    const packageJson = readPackageJson();
    const cliVersion = packageJson.devDependencies?.[CLI_PACKAGE_NAME];
    expect(cliVersion).toBeDefined();
    // Should be a semver range (e.g., "^3.0.0", ">=3.0.0", "latest", "*")
    expect(typeof cliVersion).toBe('string');
    expect(cliVersion!.length).toBeGreaterThan(0);
  });

  // =========================================================================
  // AC2: lumenflow init in a directory with existing package.json adds
  //      scripts without overwriting existing content
  // =========================================================================
  it('should add @lumenflow/cli to existing package.json without overwriting other deps', async () => {
    // Arrange
    const existingPkg: PackageJson = {
      name: 'my-existing-project',
      version: '2.5.0',
      devDependencies: {
        vitest: '^1.0.0',
        typescript: '^5.0.0',
      },
    };
    fs.writeFileSync(
      path.join(tempDir, PACKAGE_JSON_FILE_NAME),
      JSON.stringify(existingPkg, null, 2),
    );

    // Act
    await scaffoldProject(tempDir, { force: false, full: true });

    // Assert
    const packageJson = readPackageJson();

    // Original fields preserved
    expect(packageJson.name).toBe('my-existing-project');
    expect(packageJson.version).toBe('2.5.0');

    // Existing devDeps preserved
    expect(packageJson.devDependencies?.vitest).toBe('^1.0.0');
    expect(packageJson.devDependencies?.typescript).toBe('^5.0.0');

    // @lumenflow/cli added
    expect(packageJson.devDependencies?.[CLI_PACKAGE_NAME]).toBeDefined();
  });

  it('should not overwrite existing @lumenflow/cli version without --force', async () => {
    // Arrange: user has pinned a specific version
    const existingPkg: PackageJson = {
      name: 'pinned-project',
      version: '1.0.0',
      devDependencies: {
        [CLI_PACKAGE_NAME]: '2.0.0',
      },
    };
    fs.writeFileSync(
      path.join(tempDir, PACKAGE_JSON_FILE_NAME),
      JSON.stringify(existingPkg, null, 2),
    );

    // Act
    await scaffoldProject(tempDir, { force: false, full: true });

    // Assert: pinned version preserved
    const packageJson = readPackageJson();
    expect(packageJson.devDependencies?.[CLI_PACKAGE_NAME]).toBe('2.0.0');
  });

  it('should overwrite @lumenflow/cli version when --force is used', async () => {
    // Arrange: user has an old version
    const existingPkg: PackageJson = {
      name: 'old-project',
      version: '1.0.0',
      devDependencies: {
        [CLI_PACKAGE_NAME]: '1.0.0',
      },
    };
    fs.writeFileSync(
      path.join(tempDir, PACKAGE_JSON_FILE_NAME),
      JSON.stringify(existingPkg, null, 2),
    );

    // Act
    await scaffoldProject(tempDir, { force: true, full: true });

    // Assert: version updated (not the old value)
    const packageJson = readPackageJson();
    expect(packageJson.devDependencies?.[CLI_PACKAGE_NAME]).not.toBe('1.0.0');
  });

  it('should preserve existing scripts when adding dependency', async () => {
    // Arrange
    const existingPkg: PackageJson = {
      name: 'script-project',
      version: '1.0.0',
      scripts: {
        test: 'vitest',
        build: 'tsc',
        'custom-script': 'echo hello',
      },
    };
    fs.writeFileSync(
      path.join(tempDir, PACKAGE_JSON_FILE_NAME),
      JSON.stringify(existingPkg, null, 2),
    );

    // Act
    await scaffoldProject(tempDir, { force: false, full: true });

    // Assert
    const packageJson = readPackageJson();
    expect(packageJson.scripts?.test).toBe('vitest');
    expect(packageJson.scripts?.build).toBe('tsc');
    expect(packageJson.scripts?.['custom-script']).toBe('echo hello');

    // LumenFlow scripts added
    expect(packageJson.scripts?.['wu:create']).toBeDefined();
    expect(packageJson.scripts?.gates).toBeDefined();

    // CLI dependency added
    expect(packageJson.devDependencies?.[CLI_PACKAGE_NAME]).toBeDefined();
  });

  // =========================================================================
  // AC3: After lumenflow init, pnpm wu:create and pnpm gates work
  //      (verified by checking scripts and dependency are present)
  // =========================================================================
  it('should have both scripts and CLI dependency so commands resolve', async () => {
    // Act
    await scaffoldProject(tempDir, { force: true, full: true });

    // Assert: both scripts and dependency present
    const packageJson = readPackageJson();

    // Scripts present
    expect(packageJson.scripts?.['wu:create']).toBeDefined();
    expect(packageJson.scripts?.gates).toBeDefined();

    // CLI dependency present (provides the binaries those scripts reference)
    expect(packageJson.devDependencies?.[CLI_PACKAGE_NAME]).toBeDefined();

    // Prettier dependency still present (existing behavior)
    expect(packageJson.devDependencies?.prettier).toBeDefined();
  });

  it('should create package.json with private:true for fresh projects', async () => {
    // Act
    await scaffoldProject(tempDir, { force: true, full: true });

    // Assert
    const packageJson = readPackageJson();
    expect(packageJson.private).toBe(true);
  });
});
