/**
 * @file gates-integration-tests.test.ts
 * @description Tests for gates infrastructure fixes (WU-1415)
 *
 * Bug 1: vitest --include is not a valid CLI option
 * Bug 2: docs-only turbo filter uses directory names instead of package names
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { extractPackagesFromCodePaths, resolveDocsOnlyTestPlan } from '../gates.js';

describe('WU-1415: Gates infrastructure fixes', () => {
  describe('Bug 1: vitest integration test command', () => {
    it('should NOT use --include flag (vitest does not support it)', async () => {
      // Import the module to inspect the command construction
      // We need to verify that runIntegrationTests uses valid vitest syntax
      //
      // vitest run accepts positional glob patterns, NOT --include flags:
      //   WRONG: vitest run --include='**/*.integration.*'
      //   RIGHT: vitest run '**/*.integration.*'
      //
      // This test ensures we're using the correct vitest CLI syntax
      const gatesModule = await import('../gates.js');

      // The command construction happens in runIntegrationTests
      // We can't directly test the internal function, but we can verify
      // via the module's exported constants or by checking the implementation
      // doesn't contain --include

      // Read the source to verify no --include in vitest commands
      const fs = await import('fs');
      const path = await import('path');
      const gatesPath = path.join(import.meta.dirname, '..', 'gates.ts');
      const source = fs.readFileSync(gatesPath, 'utf-8');

      // Find the runIntegrationTests function and check it doesn't use --include
      const integrationTestMatch = source.match(/function runIntegrationTests[\s\S]*?^}/m);

      if (integrationTestMatch) {
        const functionBody = integrationTestMatch[0];
        // vitest run should NOT have --include flags
        expect(functionBody).not.toMatch(/vitest.*--include/);
        // Instead, glob patterns should be positional args or via proper config
        // The fix should pass patterns directly: vitest run 'pattern1' 'pattern2'
      }
    });
  });

  describe('Bug 2: docs-only turbo filter', () => {
    describe('extractPackagesFromCodePaths', () => {
      it('should extract scoped package names from packages/ paths', () => {
        const codePaths = [
          'packages/@lumenflow/cli/src/gates.ts',
          'packages/@lumenflow/core/src/index.ts',
        ];
        const packages = extractPackagesFromCodePaths(codePaths);
        expect(packages).toContain('@lumenflow/cli');
        expect(packages).toContain('@lumenflow/core');
      });

      it('should return empty array for apps/ paths that are not real turbo packages', () => {
        // apps/docs/ directory name is 'docs' but the turbo package might be
        // named differently (e.g., '@lumenflow/docs' or not exist at all)
        //
        // The current implementation returns 'docs' which causes turbo to fail:
        //   "No package found with name 'docs' in workspace"
        //
        // Fix: Either lookup actual package.json name or skip apps
        const codePaths = ['apps/docs/src/content/docs/', 'apps/github-app/'];
        const packages = extractPackagesFromCodePaths(codePaths);

        // Current buggy behavior returns ['docs', 'github-app']
        // Fixed behavior should either:
        // - Return actual package names from package.json
        // - Or return empty array (apps don't have turbo test tasks)
        //
        // For now, the fix should skip apps that aren't valid turbo packages
        // because apps/docs has no test script and apps/github-app was deleted
        expect(packages).not.toContain('docs');
        expect(packages).not.toContain('github-app');
      });

      it('should handle mixed code_paths (packages + apps + docs)', () => {
        const codePaths = [
          'packages/@lumenflow/cli/src/file.ts',
          'apps/docs/astro.config.mjs',
          'docs/DISTRIBUTION.md',
        ];
        const packages = extractPackagesFromCodePaths(codePaths);

        // Should include the real package
        expect(packages).toContain('@lumenflow/cli');
        // Should NOT include apps (no valid turbo package)
        expect(packages).not.toContain('docs');
        // Should NOT include docs/ (not a package)
        expect(packages.length).toBe(1);
      });

      it('should return empty array for pure docs paths', () => {
        const codePaths = ['docs/01-product/product-lines.md', 'docs/DISTRIBUTION.md'];
        const packages = extractPackagesFromCodePaths(codePaths);
        expect(packages).toEqual([]);
      });
    });

    describe('resolveDocsOnlyTestPlan', () => {
      it('should return skip mode for pure documentation WUs', () => {
        const plan = resolveDocsOnlyTestPlan({
          codePaths: ['docs/README.md', 'apps/docs/content/'],
        });
        expect(plan.mode).toBe('skip');
        expect(plan.packages).toEqual([]);
      });

      it('should return filtered mode only for valid package paths', () => {
        const plan = resolveDocsOnlyTestPlan({
          codePaths: ['packages/@lumenflow/cli/src/gates.ts', 'apps/docs/content/'],
        });
        expect(plan.mode).toBe('filtered');
        expect(plan.packages).toContain('@lumenflow/cli');
        // apps/docs should not be included
        expect(plan.packages).not.toContain('docs');
      });
    });
  });
});
