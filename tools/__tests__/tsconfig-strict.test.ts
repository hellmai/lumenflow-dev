/**
 * @file tsconfig-strict.test.ts
 * Test suite for WU-1535: Enable strict TypeScript build configuration
 *
 * Validates that tsconfig.build.json and per-package tsconfig files enforce
 * strict mode, eliminating the split-brain between IDE and build configs.
 *
 * Acceptance criteria:
 * - AC1: tsconfig.build.json enforces strict: true and noEmitOnError: true
 * - AC2: Per-package tsconfigs align with strict baseline or have explicit exceptions
 * - AC3: pnpm typecheck and pnpm build pass with strict mode enabled
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');

function readJson(relativePath: string): Record<string, unknown> {
  const content = readFileSync(resolve(ROOT, relativePath), 'utf-8');
  // Strip JSON comments (// style) before parsing
  const stripped = content.replace(/^\s*\/\/.*$/gm, '');
  return JSON.parse(stripped) as Record<string, unknown>;
}

interface TsConfigCompilerOptions {
  strict?: boolean;
  noEmitOnError?: boolean;
  strictNullChecks?: boolean;
  noUnusedLocals?: boolean;
  noUnusedParameters?: boolean;
  noImplicitReturns?: boolean;
  noFallthroughCasesInSwitch?: boolean;
  noUncheckedIndexedAccess?: boolean;
  [key: string]: unknown;
}

interface TsConfig {
  extends?: string;
  compilerOptions?: TsConfigCompilerOptions;
  [key: string]: unknown;
}

describe('WU-1535: Strict TypeScript build configuration', () => {
  describe('AC1: tsconfig.build.json enforces strict: true and noEmitOnError: true', () => {
    it('should have strict: true in tsconfig.build.json', () => {
      const config = readJson('tsconfig.build.json') as TsConfig;
      expect(config.compilerOptions?.strict).toBe(true);
    });

    it('should have noEmitOnError: true in tsconfig.build.json', () => {
      const config = readJson('tsconfig.build.json') as TsConfig;
      expect(config.compilerOptions?.noEmitOnError).toBe(true);
    });
  });

  describe('AC2: Per-package tsconfigs align with strict baseline', () => {
    // Packages that should fully inherit strict from root (no strict: false override)
    const strictPackages = [
      'packages/@lumenflow/metrics/tsconfig.json',
      'packages/@lumenflow/shims/tsconfig.json',
      'packages/@lumenflow/memory/tsconfig.json',
      'packages/@lumenflow/initiatives/tsconfig.json',
      'packages/@lumenflow/agent/tsconfig.json',
      'packages/@lumenflow/mcp/tsconfig.json',
    ];

    // Packages with explicit temporary exceptions (documented justification required)
    const exceptedPackages = [
      'packages/@lumenflow/core/tsconfig.json',
      'packages/@lumenflow/cli/tsconfig.json',
    ];

    for (const path of strictPackages) {
      const pkgName = path.split('/')[1] + '/' + path.split('/')[2];

      it(`${pkgName} should not override strict to false`, () => {
        const config = readJson(path) as TsConfig;
        // The package should either not set strict (inheriting true from root)
        // or explicitly set it to true
        expect(config.compilerOptions?.strict).not.toBe(false);
      });

      it(`${pkgName} should not override noEmitOnError to false`, () => {
        const config = readJson(path) as TsConfig;
        expect(config.compilerOptions?.noEmitOnError).not.toBe(false);
      });
    }

    for (const path of exceptedPackages) {
      const pkgName = path.split('/')[1] + '/' + path.split('/')[2];

      it(`${pkgName} has documented temporary exception for strict mode`, () => {
        const config = readJson(path) as TsConfig;
        // Excepted packages may have strict: false BUT must have a
        // _strictException top-level field documenting the justification.
        // (Cannot use compilerOptions because TypeScript rejects unknown keys there.)
        if (config.compilerOptions?.strict === false) {
          // Check for _strictException metadata at tsconfig root level
          expect(config._strictException).toBeTruthy();
        }
        // If strict is not false, that's even better (they've been fixed)
      });

      it(`${pkgName} should have noEmitOnError: true even with strict exception`, () => {
        const config = readJson(path) as TsConfig;
        expect(config.compilerOptions?.noEmitOnError).toBe(true);
      });
    }
  });

  describe('AC2: Root tsconfig.json remains strict baseline', () => {
    it('should have strict: true in root tsconfig.json (IDE config)', () => {
      const config = readJson('tsconfig.json') as TsConfig;
      expect(config.compilerOptions?.strict).toBe(true);
    });
  });
});
