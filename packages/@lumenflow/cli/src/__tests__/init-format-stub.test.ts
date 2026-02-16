/**
 * @file init-format-stub.test.ts
 * WU-1747: Stub format:check gate when prettier not installed at init time
 *
 * Tests that lumenflow init scaffolds format:check and format scripts as
 * intelligent stubs that exit 0 with guidance when prettier is not installed,
 * matching the pattern used by lint, typecheck, and spec:linter stubs.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { scaffoldProject, type ScaffoldOptions } from '../init.js';

/** Package.json file name constant */
const PACKAGE_JSON_FILE = 'package.json';
/** Format script name constant */
const FORMAT_SCRIPT = 'format';
/** Format check script name constant */
const FORMAT_CHECK_SCRIPT = 'format:check';

/** Type for package.json structure */
interface PackageJson {
  name?: string;
  version?: string;
  private?: boolean;
  scripts?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

describe('WU-1747: format:check stub when prettier not installed', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumenflow-init-format-stub-'));
  });

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  /** Helper to read and parse package.json from temp directory */
  function readPackageJson(): PackageJson {
    const packageJsonPath = path.join(tempDir, PACKAGE_JSON_FILE);
    return JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8')) as PackageJson;
  }

  describe('AC1: format:check exits 0 without prettier installed', () => {
    it('should set format:check to a stub that exits 0 when prettier is not available', async () => {
      const options: ScaffoldOptions = {
        force: true,
        full: true,
      };

      await scaffoldProject(tempDir, options);

      const packageJson = readPackageJson();
      const formatCheckScript = packageJson.scripts?.[FORMAT_CHECK_SCRIPT];

      expect(formatCheckScript).toBeDefined();
      // The script should handle the case where prettier is not installed
      // by checking for prettier availability before running it
      expect(formatCheckScript).toContain('prettier');
      // It should exit 0 gracefully when prettier is not found
      // (not just blindly call prettier --check which would fail)
      expect(formatCheckScript).not.toBe('prettier --check .');
    });

    it('should set format to a stub that exits 0 when prettier is not available', async () => {
      const options: ScaffoldOptions = {
        force: true,
        full: true,
      };

      await scaffoldProject(tempDir, options);

      const packageJson = readPackageJson();
      const formatScript = packageJson.scripts?.[FORMAT_SCRIPT];

      expect(formatScript).toBeDefined();
      // The format script should also handle missing prettier gracefully
      expect(formatScript).toContain('prettier');
      expect(formatScript).not.toBe('prettier --write .');
    });
  });

  describe('AC2: stub provides guidance message', () => {
    it('format:check stub should contain guidance to install prettier', async () => {
      const options: ScaffoldOptions = {
        force: true,
        full: true,
      };

      await scaffoldProject(tempDir, options);

      const packageJson = readPackageJson();
      const formatCheckScript = packageJson.scripts?.[FORMAT_CHECK_SCRIPT];

      expect(formatCheckScript).toBeDefined();
      // Stub should include a message guiding user to install prettier
      expect(formatCheckScript).toContain('install');
      expect(formatCheckScript).toContain('prettier');
    });

    it('format stub should contain guidance to install prettier', async () => {
      const options: ScaffoldOptions = {
        force: true,
        full: true,
      };

      await scaffoldProject(tempDir, options);

      const packageJson = readPackageJson();
      const formatScript = packageJson.scripts?.[FORMAT_SCRIPT];

      expect(formatScript).toBeDefined();
      // Stub should include a message guiding user to install prettier
      expect(formatScript).toContain('install');
      expect(formatScript).toContain('prettier');
    });
  });

  describe('AC3: format:check follows same pattern as other gate stubs', () => {
    it('format:check stub should use the lumenflow echo prefix like other stubs', async () => {
      const options: ScaffoldOptions = {
        force: true,
        full: true,
      };

      await scaffoldProject(tempDir, options);

      const packageJson = readPackageJson();
      const formatCheckScript = packageJson.scripts?.[FORMAT_CHECK_SCRIPT];

      // Should follow the [lumenflow] prefix pattern used by lint, typecheck stubs
      expect(formatCheckScript).toContain('[lumenflow]');
    });

    it('format stub should use the lumenflow echo prefix like other stubs', async () => {
      const options: ScaffoldOptions = {
        force: true,
        full: true,
      };

      await scaffoldProject(tempDir, options);

      const packageJson = readPackageJson();
      const formatScript = packageJson.scripts?.[FORMAT_SCRIPT];

      // Should follow the [lumenflow] prefix pattern used by lint, typecheck stubs
      expect(formatScript).toContain('[lumenflow]');
    });
  });

  describe('AC4: stubs still run prettier when it IS installed', () => {
    it('format:check script should attempt to run prettier --check when available', async () => {
      const options: ScaffoldOptions = {
        force: true,
        full: true,
      };

      await scaffoldProject(tempDir, options);

      const packageJson = readPackageJson();
      const formatCheckScript = packageJson.scripts?.[FORMAT_CHECK_SCRIPT];

      // The script should contain prettier --check for when prettier IS available
      expect(formatCheckScript).toContain('prettier --check');
    });

    it('format script should attempt to run prettier --write when available', async () => {
      const options: ScaffoldOptions = {
        force: true,
        full: true,
      };

      await scaffoldProject(tempDir, options);

      const packageJson = readPackageJson();
      const formatScript = packageJson.scripts?.[FORMAT_SCRIPT];

      // The script should contain prettier --write for when prettier IS available
      expect(formatScript).toContain('prettier --write');
    });
  });

  describe('preserves existing custom format scripts', () => {
    it('should not overwrite existing format:check script unless --force', async () => {
      const existingPackageJson = {
        name: 'test-project',
        scripts: {
          format: 'custom-formatter --write .',
          'format:check': 'custom-formatter --check .',
        },
      };
      fs.writeFileSync(
        path.join(tempDir, PACKAGE_JSON_FILE),
        JSON.stringify(existingPackageJson, null, 2),
      );

      const options: ScaffoldOptions = {
        force: false,
        full: true,
      };

      await scaffoldProject(tempDir, options);

      const packageJson = readPackageJson();
      expect(packageJson.scripts?.[FORMAT_SCRIPT]).toBe('custom-formatter --write .');
      expect(packageJson.scripts?.[FORMAT_CHECK_SCRIPT]).toBe('custom-formatter --check .');
    });
  });

  describe('prettier still in devDependencies for pnpm install', () => {
    it('should still add prettier to devDependencies', async () => {
      const options: ScaffoldOptions = {
        force: true,
        full: true,
      };

      await scaffoldProject(tempDir, options);

      const packageJson = readPackageJson();
      expect(packageJson.devDependencies?.prettier).toBeDefined();
    });
  });
});
