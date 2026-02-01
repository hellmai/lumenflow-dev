/**
 * @file init-scripts.test.ts
 * Test: Generated package.json scripts use correct format (wu-create, wu-claim, wu-done, gates)
 *
 * WU-1307: Fix lumenflow-init scaffolding
 *
 * The init command should inject standalone binary scripts that work
 * in consumer projects without requiring the full @lumenflow/cli path.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { scaffoldProject } from '../init.js';

/** Package.json file name - extracted to avoid duplicate string lint errors */
const PACKAGE_JSON_FILE_NAME = 'package.json';

/** Type for package.json scripts */
interface PackageJson {
  name?: string;
  version?: string;
  scripts?: Record<string, string>;
}

describe('init scripts generation (WU-1307)', () => {
  let tempDir: string;

  beforeEach(() => {
    // Create a temporary directory for each test
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumenflow-init-scripts-'));
  });

  afterEach(() => {
    // Clean up temporary directory
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  /** Helper to read and parse package.json from temp directory */
  function readPackageJson(): PackageJson {
    const packageJsonPath = path.join(tempDir, PACKAGE_JSON_FILE_NAME);
    return JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8')) as PackageJson;
  }

  it('should generate package.json scripts using standalone binaries', async () => {
    // Arrange
    const packageJsonPath = path.join(tempDir, PACKAGE_JSON_FILE_NAME);

    // Act
    await scaffoldProject(tempDir, { force: true, full: true });

    // Assert
    expect(fs.existsSync(packageJsonPath)).toBe(true);

    const packageJson = readPackageJson();
    expect(packageJson.scripts).toBeDefined();

    // Scripts should use standalone binary format (wu-create, wu-claim, etc.)
    // NOT 'pnpm exec lumenflow' format
    expect(packageJson.scripts?.['wu:claim']).toBe('wu-claim');
    expect(packageJson.scripts?.['wu:done']).toBe('wu-done');
    expect(packageJson.scripts?.['wu:create']).toBe('wu-create');
    expect(packageJson.scripts?.gates).toBe('gates');
  });

  it('should NOT use pnpm exec lumenflow format', async () => {
    // Act
    await scaffoldProject(tempDir, { force: true, full: true });

    // Assert
    const packageJson = readPackageJson();

    // Ensure scripts do NOT use the old 'pnpm exec lumenflow' format
    const scriptValues = Object.values(packageJson.scripts ?? {});
    const hasOldFormat = scriptValues.some((script) => script.includes('pnpm exec lumenflow'));
    expect(hasOldFormat).toBe(false);
  });

  it('should include all essential WU lifecycle scripts', async () => {
    // Act
    await scaffoldProject(tempDir, { force: true, full: true });

    // Assert
    const packageJson = readPackageJson();

    // Essential scripts that must be present
    const essentialScripts = ['wu:claim', 'wu:done', 'wu:create', 'wu:status', 'gates'];
    for (const scriptName of essentialScripts) {
      expect(packageJson.scripts?.[scriptName]).toBeDefined();
    }
  });

  it('should preserve existing scripts when updating package.json', async () => {
    // Arrange
    const packageJsonPath = path.join(tempDir, PACKAGE_JSON_FILE_NAME);
    const existingPackageJson = {
      name: 'test-project',
      version: '1.0.0',
      scripts: {
        test: 'vitest',
        build: 'tsc',
        custom: 'echo hello',
      },
    };
    fs.writeFileSync(packageJsonPath, JSON.stringify(existingPackageJson, null, 2));

    // Act
    await scaffoldProject(tempDir, { force: false, full: true });

    // Assert
    const packageJson = readPackageJson();

    // Existing scripts should be preserved
    expect(packageJson.scripts?.test).toBe('vitest');
    expect(packageJson.scripts?.build).toBe('tsc');
    expect(packageJson.scripts?.custom).toBe('echo hello');

    // LumenFlow scripts should be added
    expect(packageJson.scripts?.['wu:claim']).toBeDefined();
    expect(packageJson.scripts?.gates).toBeDefined();
  });
});
