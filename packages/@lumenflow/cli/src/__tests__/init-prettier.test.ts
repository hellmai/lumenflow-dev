/**
 * @file init-prettier.test.ts
 * WU-1517: Scaffold prettier + format infrastructure in lumenflow init
 *
 * Tests that lumenflow init creates a project that passes format:check immediately
 * by scaffolding prettier devDependency, .prettierignore, and format scripts.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { scaffoldProject, type ScaffoldOptions } from '../init.js';

/** Package.json file name constant */
const PACKAGE_JSON_FILE = 'package.json';
/** Prettierignore file name constant */
const PRETTIERIGNORE_FILE = '.prettierignore';
/** Prettier package name constant */
const PRETTIER_PACKAGE = 'prettier';
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

describe('WU-1517: prettier + format infrastructure scaffolding', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumenflow-init-prettier-'));
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

  describe('AC1: prettier added to devDependencies', () => {
    it('should add prettier to devDependencies when creating new package.json', async () => {
      const options: ScaffoldOptions = {
        force: true,
        full: true,
      };

      await scaffoldProject(tempDir, options);

      const packageJson = readPackageJson();
      expect(packageJson.devDependencies).toBeDefined();
      expect(packageJson.devDependencies?.[PRETTIER_PACKAGE]).toBeDefined();
    });

    it('should add prettier to devDependencies in existing package.json', async () => {
      // Create existing package.json without prettier
      const existingPackageJson = {
        name: 'test-project',
        version: '1.0.0',
        scripts: { test: 'vitest' },
        devDependencies: { typescript: '^5.0.0' },
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
      expect(packageJson.devDependencies?.[PRETTIER_PACKAGE]).toBeDefined();
      // Should preserve existing devDependencies
      expect(packageJson.devDependencies?.typescript).toBe('^5.0.0');
    });

    it('should not overwrite existing prettier version unless --force', async () => {
      const existingPackageJson = {
        name: 'test-project',
        devDependencies: { prettier: '^2.0.0' },
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
      // Should preserve existing version
      expect(packageJson.devDependencies?.[PRETTIER_PACKAGE]).toBe('^2.0.0');
    });

    it('should use a semver range for prettier version', async () => {
      const options: ScaffoldOptions = {
        force: true,
        full: true,
      };

      await scaffoldProject(tempDir, options);

      const packageJson = readPackageJson();
      const prettierVersion = packageJson.devDependencies?.[PRETTIER_PACKAGE];
      expect(prettierVersion).toBeDefined();
      // Should be a semver range (starts with ^ or ~)
      expect(prettierVersion).toMatch(/^[\^~]/);
    });
  });

  describe('AC2: .prettierignore scaffolded with sane defaults', () => {
    it('should create .prettierignore file', async () => {
      const options: ScaffoldOptions = {
        force: false,
        full: true,
      };

      await scaffoldProject(tempDir, options);

      const prettierignorePath = path.join(tempDir, PRETTIERIGNORE_FILE);
      expect(fs.existsSync(prettierignorePath)).toBe(true);
    });

    it('should include node_modules in .prettierignore', async () => {
      const options: ScaffoldOptions = {
        force: false,
        full: true,
      };

      await scaffoldProject(tempDir, options);

      const content = fs.readFileSync(path.join(tempDir, PRETTIERIGNORE_FILE), 'utf-8');
      expect(content).toContain('node_modules');
    });

    it('should include dist in .prettierignore', async () => {
      const options: ScaffoldOptions = {
        force: false,
        full: true,
      };

      await scaffoldProject(tempDir, options);

      const content = fs.readFileSync(path.join(tempDir, PRETTIERIGNORE_FILE), 'utf-8');
      expect(content).toContain('dist');
    });

    it('should include coverage in .prettierignore', async () => {
      const options: ScaffoldOptions = {
        force: false,
        full: true,
      };

      await scaffoldProject(tempDir, options);

      const content = fs.readFileSync(path.join(tempDir, PRETTIERIGNORE_FILE), 'utf-8');
      expect(content).toContain('coverage');
    });

    it('should include .lumenflow/state in .prettierignore', async () => {
      const options: ScaffoldOptions = {
        force: false,
        full: true,
      };

      await scaffoldProject(tempDir, options);

      const content = fs.readFileSync(path.join(tempDir, PRETTIERIGNORE_FILE), 'utf-8');
      expect(content).toContain('.lumenflow/state');
    });

    it('should scaffold .prettierignore even in minimal mode', async () => {
      const options: ScaffoldOptions = {
        force: false,
        full: false, // minimal mode
      };

      await scaffoldProject(tempDir, options);

      const prettierignorePath = path.join(tempDir, PRETTIERIGNORE_FILE);
      expect(fs.existsSync(prettierignorePath)).toBe(true);
    });

    it('should skip .prettierignore if it already exists (skip mode)', async () => {
      const existingContent = '# Custom ignores\nmy-custom-dir/\n';
      fs.writeFileSync(path.join(tempDir, PRETTIERIGNORE_FILE), existingContent);

      const options: ScaffoldOptions = {
        force: false,
        full: true,
      };

      await scaffoldProject(tempDir, options);

      const content = fs.readFileSync(path.join(tempDir, PRETTIERIGNORE_FILE), 'utf-8');
      expect(content).toBe(existingContent);
    });

    it('should overwrite .prettierignore in force mode', async () => {
      fs.writeFileSync(path.join(tempDir, PRETTIERIGNORE_FILE), '# Old content\n');

      const options: ScaffoldOptions = {
        force: true,
        full: true,
      };

      await scaffoldProject(tempDir, options);

      const content = fs.readFileSync(path.join(tempDir, PRETTIERIGNORE_FILE), 'utf-8');
      expect(content).toContain('node_modules');
    });
  });

  describe('AC3: format and format:check scripts added to package.json', () => {
    it('should add format script to package.json', async () => {
      const options: ScaffoldOptions = {
        force: true,
        full: true,
      };

      await scaffoldProject(tempDir, options);

      const packageJson = readPackageJson();
      expect(packageJson.scripts?.[FORMAT_SCRIPT]).toBeDefined();
    });

    it('should add format:check script to package.json', async () => {
      const options: ScaffoldOptions = {
        force: true,
        full: true,
      };

      await scaffoldProject(tempDir, options);

      const packageJson = readPackageJson();
      expect(packageJson.scripts?.[FORMAT_CHECK_SCRIPT]).toBeDefined();
    });

    it('should use prettier --write for format script', async () => {
      const options: ScaffoldOptions = {
        force: true,
        full: true,
      };

      await scaffoldProject(tempDir, options);

      const packageJson = readPackageJson();
      const formatScript = packageJson.scripts?.[FORMAT_SCRIPT];
      expect(formatScript).toContain(PRETTIER_PACKAGE);
      expect(formatScript).toContain('--write');
    });

    it('should use prettier --check for format:check script', async () => {
      const options: ScaffoldOptions = {
        force: true,
        full: true,
      };

      await scaffoldProject(tempDir, options);

      const packageJson = readPackageJson();
      const formatCheckScript = packageJson.scripts?.[FORMAT_CHECK_SCRIPT];
      expect(formatCheckScript).toContain(PRETTIER_PACKAGE);
      expect(formatCheckScript).toContain('--check');
    });

    it('should not overwrite existing format scripts unless --force', async () => {
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

  describe('AC4: format:check passes immediately after init', () => {
    it('should generate format and format:check scripts that target all files', async () => {
      const options: ScaffoldOptions = {
        force: true,
        full: true,
      };

      await scaffoldProject(tempDir, options);

      const packageJson = readPackageJson();
      // Scripts should target all files (using . or **)
      const formatScript = packageJson.scripts?.[FORMAT_SCRIPT] ?? '';
      const formatCheckScript = packageJson.scripts?.[FORMAT_CHECK_SCRIPT] ?? '';

      // Both scripts should have a file glob or . target
      expect(formatScript).toMatch(/\.|--write/);
      expect(formatCheckScript).toMatch(/\.|--check/);
    });

    it('should create .prettierignore that excludes generated/binary files', async () => {
      const options: ScaffoldOptions = {
        force: true,
        full: true,
      };

      await scaffoldProject(tempDir, options);

      const content = fs.readFileSync(path.join(tempDir, PRETTIERIGNORE_FILE), 'utf-8');

      // These directories would cause format:check to fail or waste time
      expect(content).toContain('node_modules');
      expect(content).toContain('dist');
      expect(content).toContain('*.tsbuildinfo');
    });

    it('should include pnpm-lock.yaml in .prettierignore', async () => {
      const options: ScaffoldOptions = {
        force: true,
        full: true,
      };

      await scaffoldProject(tempDir, options);

      const content = fs.readFileSync(path.join(tempDir, PRETTIERIGNORE_FILE), 'utf-8');
      expect(content).toContain('pnpm-lock.yaml');
    });
  });
});
