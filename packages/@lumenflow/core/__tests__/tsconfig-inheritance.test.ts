import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * WU-1468: Validate that all package tsconfigs extend root tsconfig
 * and have strictNullChecks enabled (either via inheritance or explicit).
 *
 * Packages that cannot yet enable strictNullChecks must be listed in
 * STRICT_NULL_DEFERRED with a follow-up WU reference.
 */
describe('tsconfig inheritance policy', () => {
  // __dirname = packages/@lumenflow/core/__tests__
  // Go up 4 levels to reach the repo root
  const REPO_ROOT = resolve(__dirname, '../../../..');
  const PACKAGES_DIR = resolve(REPO_ROOT, 'packages/@lumenflow');
  const ROOT_TSCONFIG = resolve(REPO_ROOT, 'tsconfig.json');

  const PACKAGES_REQUIRING_INHERITANCE = [
    'core',
    'cli',
    'mcp',
    'memory',
    'agent',
    'initiatives',
  ] as const;

  /**
   * Packages that have strictNullChecks deferred with tracked follow-ups.
   * Each entry must have a WU reference for the follow-up work.
   * Remove entries as packages are migrated to strictNullChecks: true.
   */
  const STRICT_NULL_DEFERRED: Record<string, { reason: string; followUp: string }> = {
    core: {
      reason: '726 strictNullChecks errors require dedicated type-hardening WU',
      followUp: 'INIT-014 phase follow-up',
    },
    cli: {
      reason: '203 strictNullChecks errors require dedicated type-hardening WU',
      followUp: 'INIT-014 phase follow-up',
    },
    memory: {
      reason: '4 strictNullChecks errors in mem-summarize-core.ts (array type inference)',
      followUp: 'INIT-014 phase follow-up',
    },
    initiatives: {
      reason: '89 strictNullChecks errors require dedicated type-hardening WU',
      followUp: 'INIT-014 phase follow-up',
    },
  };

  function readTsconfig(path: string): Record<string, unknown> {
    const content = readFileSync(path, 'utf-8');
    return JSON.parse(content) as Record<string, unknown>;
  }

  it('root tsconfig has strict: true', () => {
    const root = readTsconfig(ROOT_TSCONFIG);
    const compilerOptions = root['compilerOptions'] as Record<string, unknown>;
    expect(compilerOptions['strict']).toBe(true);
  });

  for (const pkg of PACKAGES_REQUIRING_INHERITANCE) {
    describe(`@lumenflow/${pkg}`, () => {
      const tsconfigPath = resolve(PACKAGES_DIR, `${pkg}/tsconfig.json`);

      it('extends root tsconfig.json', () => {
        const config = readTsconfig(tsconfigPath);
        expect(config['extends']).toBe('../../../tsconfig.json');
      });

      it('has strictNullChecks enabled or is in deferred list with follow-up', () => {
        const config = readTsconfig(tsconfigPath);
        const compilerOptions = (config['compilerOptions'] ?? {}) as Record<string, unknown>;

        const isDeferred = pkg in STRICT_NULL_DEFERRED;
        const hasStrictNullChecksDisabled = compilerOptions['strictNullChecks'] === false;

        if (hasStrictNullChecksDisabled) {
          // If strictNullChecks is explicitly false, it must be in the deferred list
          expect(isDeferred).toBe(true);
          // And the deferred entry must have a follow-up reference
          const deferral = STRICT_NULL_DEFERRED[pkg];
          expect(deferral).toBeDefined();
          expect(deferral?.followUp).toBeTruthy();
        }

        if (!isDeferred) {
          // Non-deferred packages must NOT have strictNullChecks: false
          expect(hasStrictNullChecksDisabled).toBe(false);
        }
      });

      it('does not silently disable strictness without explicit override', () => {
        const config = readTsconfig(tsconfigPath);
        const compilerOptions = (config['compilerOptions'] ?? {}) as Record<string, unknown>;

        // If strict is explicitly false, strictNullChecks must be explicitly set
        // (either true or false with deferred justification) -- not left undefined
        if (compilerOptions['strict'] === false) {
          expect(compilerOptions['strictNullChecks']).toBeDefined();
        }
      });
    });
  }
});
