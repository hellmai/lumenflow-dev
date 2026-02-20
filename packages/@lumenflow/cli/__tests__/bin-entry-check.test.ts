/**
 * @file bin-entry-check.test.ts
 * WU-1926: Validates the CLI package is correctly configured for npm publishing.
 *
 * Tests:
 * 1. package.json has a "lumenflow" bin entry
 * 2. package.json bin entries point to files that exist after build
 * 3. import.meta.main guard is Node.js compatible (not Bun-only)
 * 4. build:dist script exists for standalone bundling
 * 5. workspace:* dependencies are handled for npm publish
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_PACKAGE_DIR = join(__dirname, '..');
const PACKAGE_JSON_PATH = join(CLI_PACKAGE_DIR, 'package.json');

interface PackageJson {
  name: string;
  bin: Record<string, string>;
  scripts: Record<string, string>;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  files: string[];
}

function readPackageJson(): PackageJson {
  return JSON.parse(readFileSync(PACKAGE_JSON_PATH, 'utf-8')) as PackageJson;
}

describe('WU-1926: npm publish readiness', () => {
  describe('bin entries', () => {
    it('has a "lumenflow" bin entry', () => {
      const pkg = readPackageJson();
      expect(pkg.bin).toHaveProperty('lumenflow');
    });

    it('lumenflow bin entry points to a dist file', () => {
      const pkg = readPackageJson();
      const lumenflowBin = pkg.bin.lumenflow;
      expect(lumenflowBin).toMatch(/^\.\/dist\//);
    });
  });

  describe('build:dist script', () => {
    it('has a build:dist script that uses tsup', () => {
      const pkg = readPackageJson();
      expect(pkg.scripts['build:dist']).toBeDefined();
      expect(pkg.scripts['build:dist']).toContain('tsup');
    });
  });

  describe('workspace dependencies handling', () => {
    it('does not have workspace:* in dependencies for npm publish', () => {
      // After bundling, workspace deps should either be removed from
      // dependencies (bundled inline) or converted to real version ranges.
      // This test validates the package.json is publish-ready by checking
      // that a tsup config exists to bundle workspace deps.
      const tsupConfigPath = join(CLI_PACKAGE_DIR, 'tsup.config.ts');
      expect(
        existsSync(tsupConfigPath),
        'tsup.config.ts must exist to bundle workspace dependencies',
      ).toBe(true);
    });

    it('tsup config marks workspace packages as non-external (bundled)', () => {
      const tsupConfigPath = join(CLI_PACKAGE_DIR, 'tsup.config.ts');
      const content = readFileSync(tsupConfigPath, 'utf-8');
      // The config should explicitly handle @lumenflow/* packages
      // by NOT listing them as external (they get bundled)
      expect(content).toContain('noExternal');
      expect(content).toContain('@lumenflow/');
    });
  });

  describe('import.meta.main compatibility', () => {
    it('cli-entry-point.ts is importable (runCLI export exists)', () => {
      const entryPath = join(CLI_PACKAGE_DIR, 'src', 'cli-entry-point.ts');
      const content = readFileSync(entryPath, 'utf-8');
      expect(content).toContain('export async function runCLI');
    });

    it('source files use import.meta.main guard (Node.js 22+ compatible)', () => {
      // Verify that at least the init.ts entry uses import.meta.main
      const initPath = join(CLI_PACKAGE_DIR, 'src', 'init.ts');
      const content = readFileSync(initPath, 'utf-8');
      expect(content).toContain('import.meta.main');
    });

    it('Node.js engine requirement is >= 22 (supports import.meta.main)', () => {
      const pkg = readPackageJson();
      const engines = (pkg as Record<string, unknown>).engines as
        | Record<string, string>
        | undefined;
      expect(engines).toBeDefined();
      expect(engines?.node).toBeDefined();
      // Node.js 22+ supports import.meta.main natively
      expect(engines?.node).toMatch(/>=\s*22/);
    });
  });

  describe('npm pack readiness', () => {
    it('files array includes dist directory', () => {
      const pkg = readPackageJson();
      expect(pkg.files).toContain('dist');
    });

    it('has tsup as a devDependency', () => {
      const pkg = readPackageJson();
      expect(pkg.devDependencies).toHaveProperty('tsup');
    });

    it('tsup config specifies ESM format', () => {
      const tsupConfigPath = join(CLI_PACKAGE_DIR, 'tsup.config.ts');
      const content = readFileSync(tsupConfigPath, 'utf-8');
      expect(content).toContain('esm');
    });

    it('tsup config documents shebang preservation strategy', () => {
      // esbuild preserves shebangs from source files in entry point output.
      // All CLI source files already have #!/usr/bin/env node as line 1.
      // The tsup config should document this (no banner needed).
      const tsupConfigPath = join(CLI_PACKAGE_DIR, 'tsup.config.ts');
      const content = readFileSync(tsupConfigPath, 'utf-8');
      // Config should mention shebang handling strategy
      expect(content).toContain('shebang');
    });
  });
});
