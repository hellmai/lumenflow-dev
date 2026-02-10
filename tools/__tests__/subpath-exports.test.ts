/**
 * @file subpath-exports.test.ts
 * Test suite for WU-1536 and WU-1545: Subpath exports, dist import migration, and enforcement
 *
 * Verifies:
 * 1. All 4 packages have explicit subpath exports (no reliance on wildcard)
 * 2. No consumer code uses @lumenflow/PKG/dist/PATH imports
 * 3. All subpath exports point to valid dist files
 * 4. (WU-1545) Wildcard dist and lib exports removed from all 4 packages
 * 5. (WU-1545) ESLint no-restricted-imports rule exists for dist paths
 * 6. (WU-1545) Zero dist-path imports across packages, apps, tools, actions
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join } from 'path';

// Resolve project root (from tools/__tests__/ -> ../../)
const ROOT = join(import.meta.dirname, '..', '..');

const TARGET_PACKAGES = ['core', 'memory', 'initiatives', 'agent'] as const;

/**
 * Recursively find all .ts files in a directory (excluding node_modules and dist)
 */
function findTsFiles(dir: string): string[] {
  const results: string[] = [];
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (
        entry.isDirectory() &&
        entry.name !== 'node_modules' &&
        entry.name !== 'dist' &&
        entry.name !== '.turbo'
      ) {
        results.push(...findTsFiles(fullPath));
      } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.js'))) {
        results.push(fullPath);
      }
    }
  } catch {
    // Directory doesn't exist
  }
  return results;
}

/**
 * Extract dist-path import specifiers from actual import/require/mock statements.
 * Ignores dist-path references in string templates for CLI invocations
 * and test assertion strings that reference filesystem paths (not module specifiers).
 */
function extractDistImports(filePath: string): string[] {
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const specifiers: string[] = [];

  // Only match lines that are actual import statements, re-exports, or vi.mock calls
  const importLinePattern =
    /^\s*(import\s|export\s.*from\s|vi\.mock\(|vi\.doMock\(|await import\(|const .* = await import\()/;
  const specifierPattern =
    /@lumenflow\/(core|memory|initiatives|agent)\/dist\/[a-zA-Z0-9_/.-]+\.js/g;

  for (const line of lines) {
    if (importLinePattern.test(line)) {
      const found = line.match(specifierPattern);
      if (found) {
        specifiers.push(...found);
      }
    }
  }

  return [...new Set(specifiers)];
}

describe('WU-1536: Subpath exports and dist import migration', () => {
  describe('AC1: Explicit subpath exports exist', () => {
    for (const pkg of TARGET_PACKAGES) {
      it(`@lumenflow/${pkg} has explicit subpath exports (not just wildcards)`, () => {
        const pkgJsonPath = join(ROOT, 'packages/@lumenflow', pkg, 'package.json');
        const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
        const exports = pkgJson.exports || {};

        // Must have the root export
        expect(exports['.']).toBeDefined();

        // Count explicit exports (excluding wildcards)
        const explicitExports = Object.keys(exports).filter(
          (k) => k !== '.' && k !== './dist/*' && k !== './lib/*',
        );
        expect(explicitExports.length).toBeGreaterThan(0);
      });

      it(`@lumenflow/${pkg} subpath exports point to dist files`, () => {
        const pkgJsonPath = join(ROOT, 'packages/@lumenflow', pkg, 'package.json');
        const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
        const exports = pkgJson.exports || {};

        for (const [subpath, target] of Object.entries(exports)) {
          if (subpath === './dist/*' || subpath === './lib/*') continue;
          // All targets should point to ./dist/*.js
          expect(target).toMatch(/^\.\/dist\/.*\.js$/);
        }
      });
    }
  });

  describe('AC2: No consumer dist-path imports remain', () => {
    const scanDirs = [
      'packages/@lumenflow/cli/src',
      'packages/@lumenflow/cli/__tests__',
      'packages/@lumenflow/cli/e2e',
      'packages/@lumenflow/core/src',
      'packages/@lumenflow/memory/src',
      'packages/@lumenflow/initiatives/src',
      'packages/@lumenflow/initiatives/__tests__',
      'packages/@lumenflow/agent/src',
      'packages/@lumenflow/agent/__tests__',
    ];

    it('no files import from @lumenflow/{core,memory,initiatives,agent}/dist/', () => {
      const violations: Array<{ file: string; specifiers: string[] }> = [];

      for (const dir of scanDirs) {
        const fullDir = join(ROOT, dir);
        const files = findTsFiles(fullDir);

        for (const file of files) {
          const distImports = extractDistImports(file);
          if (distImports.length > 0) {
            const relFile = file.replace(ROOT + '/', '');
            violations.push({ file: relFile, specifiers: distImports });
          }
        }
      }

      if (violations.length > 0) {
        const summary = violations
          .slice(0, 10)
          .map((v) => `  ${v.file}: ${v.specifiers.join(', ')}`)
          .join('\n');
        expect.fail(
          `Found ${violations.length} files still importing from dist paths:\n${summary}${violations.length > 10 ? `\n  ... and ${violations.length - 10} more` : ''}`,
        );
      }
    });
  });
});

describe('WU-1545: Lock down dist imports and verify boundary', () => {
  describe('AC1: no-restricted-imports lint rule blocks dist/* imports', () => {
    it('eslint.config.mjs contains no-restricted-imports rule for @lumenflow/*/dist/*', () => {
      const eslintConfigPath = join(ROOT, 'eslint.config.mjs');
      const content = readFileSync(eslintConfigPath, 'utf-8');

      // The ESLint config must contain a no-restricted-imports rule
      expect(content).toContain('no-restricted-imports');

      // It must reference the dist path pattern for lumenflow packages
      expect(content).toContain('@lumenflow/');
      expect(content).toContain('dist/');

      // The rule must be at error level (not warn/off)
      expect(content).toMatch(/['"]no-restricted-imports['"]\s*:\s*\[\s*['"]error['"]/);
    });
  });

  describe('AC2: Wildcard dist and lib exports removed from all 4 packages', () => {
    for (const pkg of TARGET_PACKAGES) {
      it(`@lumenflow/${pkg} has no ./dist/* wildcard export`, () => {
        const pkgJsonPath = join(ROOT, 'packages/@lumenflow', pkg, 'package.json');
        const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
        const exportKeys = Object.keys(pkgJson.exports || {});

        expect(exportKeys).not.toContain('./dist/*');
      });

      it(`@lumenflow/${pkg} has no ./lib/* wildcard export`, () => {
        const pkgJsonPath = join(ROOT, 'packages/@lumenflow', pkg, 'package.json');
        const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
        const exportKeys = Object.keys(pkgJson.exports || {});

        expect(exportKeys).not.toContain('./lib/*');
      });
    }
  });

  describe('AC3: Zero dist-path imports across repo', () => {
    /**
     * Scans ALL source dirs (packages, apps, tools, actions) for dist-path imports.
     * This is broader than the WU-1536 test which only scanned select src dirs.
     */
    const broadScanDirs = [
      'packages/@lumenflow/cli/src',
      'packages/@lumenflow/cli/__tests__',
      'packages/@lumenflow/cli/e2e',
      'packages/@lumenflow/core/src',
      'packages/@lumenflow/core/__tests__',
      'packages/@lumenflow/memory/src',
      'packages/@lumenflow/memory/__tests__',
      'packages/@lumenflow/initiatives/src',
      'packages/@lumenflow/initiatives/__tests__',
      'packages/@lumenflow/agent/src',
      'packages/@lumenflow/agent/__tests__',
      'packages/@lumenflow/metrics/src',
      'packages/@lumenflow/shims/src',
      'packages/@lumenflow/mcp/src',
      'apps',
      'tools',
      'actions',
    ];

    it('no source files import from @lumenflow/{core,memory,initiatives,agent}/dist/', () => {
      const violations: Array<{ file: string; specifiers: string[] }> = [];

      for (const dir of broadScanDirs) {
        const fullDir = join(ROOT, dir);
        const files = findTsFiles(fullDir);

        for (const file of files) {
          const distImports = extractDistImports(file);
          if (distImports.length > 0) {
            const relFile = file.replace(ROOT + '/', '');
            violations.push({ file: relFile, specifiers: distImports });
          }
        }
      }

      if (violations.length > 0) {
        const summary = violations
          .map((v) => `  ${v.file}: ${v.specifiers.join(', ')}`)
          .join('\n');
        expect.fail(
          `Found ${violations.length} files still importing from dist paths:\n${summary}`,
        );
      }
    });
  });
});
