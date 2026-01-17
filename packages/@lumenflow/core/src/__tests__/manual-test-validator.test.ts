#!/usr/bin/env node
/**
 * Tests for manual test escape hatch restriction
 *
 * WU-1433: TDD for manual test escape restriction in wu:done validation
 * Uses Node's built-in test runner (node:test)
 *
 * Run: node --test tools/lib/__tests__/manual-test-validator.test.mjs
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

// Import the functions to test (will fail until implemented)
import {
  containsHexCoreCode,
  validateAutomatedTestRequirement,
  isExemptFromAutomatedTests,
  HEX_CORE_CODE_PATTERNS,
  isCodeFile,
} from '../manual-test-validator.js';

describe('manual-test-validator constants', () => {
  it('defines HEX_CORE_CODE_PATTERNS for application layer', () => {
    expect(Array.isArray(HEX_CORE_CODE_PATTERNS)).toBeTruthy();
    expect(HEX_CORE_CODE_PATTERNS.length > 0).toBeTruthy();
    // Should include application package pattern
    assert.ok(
      HEX_CORE_CODE_PATTERNS.some((p) => p.includes('application')),
      'Should include application package pattern'
    );
  });
});

describe('containsHexCoreCode', () => {
  it('returns true when code_paths contains application package files', () => {
    const codePaths = [
      'packages/@exampleapp/application/src/usecases/foo.ts',
      'apps/web/src/app/page.tsx',
    ];

    expect(containsHexCoreCode(codePaths)).toBe(true);
  });

  it('returns true for prompts package files', () => {
    const codePaths = ['packages/@exampleapp/prompts/src/templates/triage.ts'];

    expect(containsHexCoreCode(codePaths)).toBe(true);
  });

  it('returns false when only infrastructure files', () => {
    const codePaths = ['packages/@exampleapp/infrastructure/src/adapters/db.ts'];

    expect(containsHexCoreCode(codePaths)).toBe(false);
  });

  it('returns false when only web app files', () => {
    const codePaths = ['apps/web/src/app/page.tsx', 'apps/web/src/lib/utils.ts'];

    expect(containsHexCoreCode(codePaths)).toBe(false);
  });

  it('returns false when only tooling files', () => {
    const codePaths = ['tools/gates.js', 'tools/lib/wu-done-validators.js'];

    expect(containsHexCoreCode(codePaths)).toBe(false);
  });

  it('returns false when only docs files', () => {
    const codePaths = ['docs/README.md', 'docs/04-operations/tasks/wu/WU-1433.yaml'];

    expect(containsHexCoreCode(codePaths)).toBe(false);
  });

  it('returns false for empty array', () => {
    expect(containsHexCoreCode([])).toBe(false);
  });

  it('returns false for null/undefined', () => {
    expect(containsHexCoreCode(null)).toBe(false);
    expect(containsHexCoreCode(undefined)).toBe(false);
  });
});

describe('isCodeFile', () => {
  it('returns true for common code file extensions', () => {
    expect(isCodeFile('tools/wu-create.js')).toBe(true);
    expect(isCodeFile('packages/@exampleapp/application/src/usecase.ts')).toBe(true);
    expect(isCodeFile('apps/web/src/app/page.tsx')).toBe(true);
    expect(isCodeFile('scripts/release.js')).toBe(true);
  });

  it('returns false for documentation and data files', () => {
    expect(isCodeFile('docs/README.md')).toBe(false);
    expect(isCodeFile('docs/spec.yaml')).toBe(false);
    expect(isCodeFile('config/settings.json')).toBe(false);
  });

  it('returns false for config files with code extensions', () => {
    expect(isCodeFile('vitest.config.ts')).toBe(false);
    expect(isCodeFile('.eslintrc.js')).toBe(false);
  });
});

describe('isExemptFromAutomatedTests', () => {
  it('returns true for type: documentation', () => {
    expect(isExemptFromAutomatedTests({ type: 'documentation' })).toBe(true);
  });

  it('does not exempt based on lane alone', () => {
    expect(isExemptFromAutomatedTests({ lane: 'Documentation' })).toBe(false);
    expect(isExemptFromAutomatedTests({ lane: 'Operations: Tooling' })).toBe(false);
  });

  it('returns false for type: process', () => {
    expect(isExemptFromAutomatedTests({ type: 'process' })).toBe(false);
  });

  it('returns false for other types', () => {
    assert.strictEqual(
      isExemptFromAutomatedTests({ lane: 'Core Systems', type: 'feature' }),
      false
    );
    assert.strictEqual(isExemptFromAutomatedTests({ lane: 'Core Systems', type: 'bug' }), false);
  });

  it('handles missing lane/type gracefully', () => {
    expect(isExemptFromAutomatedTests({})).toBe(false);
    expect(isExemptFromAutomatedTests({ lane: null })).toBe(false);
  });
});

describe('validateAutomatedTestRequirement', () => {
  describe('WUs with hex core code', () => {
    it('passes when unit tests provided', () => {
      const doc = {
        id: 'WU-1433',
        lane: 'Core Systems',
        type: 'feature',
        code_paths: ['packages/@exampleapp/application/src/usecases/foo.ts'],
        tests: {
          unit: ['packages/@exampleapp/application/src/usecases/__tests__/foo.test.ts'],
          manual: [],
          e2e: [],
        },
      };

      const result = validateAutomatedTestRequirement(doc);

      expect(result.valid).toBe(true);
      expect(result.errors.length).toBe(0);
    });

    it('passes when e2e tests provided', () => {
      const doc = {
        id: 'WU-1433',
        lane: 'Core Systems',
        type: 'feature',
        code_paths: ['packages/@exampleapp/application/src/usecases/foo.ts'],
        tests: {
          unit: [],
          manual: [],
          e2e: ['apps/web/e2e/feature.spec.ts'],
        },
      };

      const result = validateAutomatedTestRequirement(doc);

      expect(result.valid).toBe(true);
      expect(result.errors.length).toBe(0);
    });

    it('passes when integration tests provided', () => {
      const doc = {
        id: 'WU-1433',
        lane: 'Core Systems',
        type: 'feature',
        code_paths: ['packages/@exampleapp/application/src/usecases/foo.ts'],
        tests: {
          unit: [],
          manual: [],
          integration: ['packages/@exampleapp/application/src/__tests__/integration/foo.test.ts'],
        },
      };

      const result = validateAutomatedTestRequirement(doc);

      expect(result.valid).toBe(true);
    });

    it('FAILS when ONLY manual tests provided', () => {
      const doc = {
        id: 'WU-1433',
        lane: 'Core Systems',
        type: 'feature',
        code_paths: ['packages/@exampleapp/application/src/usecases/foo.ts'],
        tests: {
          unit: [],
          manual: ['Manual verification: check UI renders correctly'],
          e2e: [],
        },
      };

      const result = validateAutomatedTestRequirement(doc);

      expect(result.valid).toBe(false);
      expect(result.errors.length > 0).toBeTruthy();
      assert.ok(
        result.errors[0].toLowerCase().includes('automated'),
        'Error should mention automated tests required'
      );
    });

    it('FAILS when no tests provided at all', () => {
      const doc = {
        id: 'WU-1433',
        lane: 'Core Systems',
        type: 'feature',
        code_paths: ['packages/@exampleapp/application/src/usecases/foo.ts'],
        tests: {
          unit: [],
          manual: [],
          e2e: [],
        },
      };

      const result = validateAutomatedTestRequirement(doc);

      expect(result.valid).toBe(false);
    });
  });

  describe('documentation and config-only changes', () => {
    it('passes with manual-only tests for type: documentation', () => {
      const doc = {
        id: 'WU-1433',
        lane: 'Core Systems',
        type: 'documentation',
        code_paths: ['docs/api/README.md'],
        tests: {
          unit: [],
          manual: ['Manual verification: check docs'],
          e2e: [],
        },
      };

      const result = validateAutomatedTestRequirement(doc);

      expect(result.valid).toBe(true);
    });

    it('passes with manual-only tests when code_paths are docs-only', () => {
      const doc = {
        id: 'WU-1433',
        lane: 'Operations',
        type: 'feature',
        code_paths: ['docs/README.md', 'ai/onboarding/guide.md'],
        tests: {
          unit: [],
          manual: ['Manual verification: check docs'],
          e2e: [],
        },
      };

      const result = validateAutomatedTestRequirement(doc);

      expect(result.valid).toBe(true);
    });

    it('passes with manual-only tests for config files', () => {
      const doc = {
        id: 'WU-1433',
        lane: 'Operations',
        type: 'feature',
        code_paths: ['vitest.config.ts', '.eslintrc.js'],
        tests: {
          unit: [],
          manual: ['Manual verification: update config'],
          e2e: [],
        },
      };

      const result = validateAutomatedTestRequirement(doc);

      expect(result.valid).toBe(true);
    });
  });

  describe('WUs with code files outside hex core', () => {
    it('fails with manual-only tests for web changes', () => {
      const doc = {
        id: 'WU-1433',
        lane: 'Core Systems',
        type: 'feature',
        code_paths: ['apps/web/src/app/page.tsx'],
        tests: {
          unit: [],
          manual: ['Manual verification: check UI'],
          e2e: [],
        },
      };

      const result = validateAutomatedTestRequirement(doc);

      expect(result.valid).toBe(false);
    });

    it('fails with manual-only tests for tooling changes', () => {
      const doc = {
        id: 'WU-1433',
        lane: 'Core Systems',
        type: 'feature',
        code_paths: ['tools/some-script.js'],
        tests: {
          unit: [],
          manual: ['Manual verification: run script'],
          e2e: [],
        },
      };

      const result = validateAutomatedTestRequirement(doc);

      expect(result.valid).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('handles missing tests object', () => {
      const doc = {
        id: 'WU-1433',
        lane: 'Documentation',
        type: 'documentation',
        code_paths: ['docs/README.md'],
      };

      const result = validateAutomatedTestRequirement(doc);

      // Should not crash, docs lane is exempt anyway
      expect(result.valid).toBe(true);
    });

    it('handles missing code_paths', () => {
      const doc = {
        id: 'WU-1433',
        lane: 'Core Systems',
        type: 'feature',
        tests: {
          manual: ['Manual test'],
        },
      };

      const result = validateAutomatedTestRequirement(doc);

      // No code_paths means no hex core code, so should pass
      expect(result.valid).toBe(true);
    });
  });
});
