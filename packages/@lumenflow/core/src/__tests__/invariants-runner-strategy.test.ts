// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Unit tests for Invariants Runner strategy pattern (WU-2043)
 *
 * Tests all 7 InvariantChecker implementations individually:
 * - RequiredFileChecker
 * - ForbiddenFileChecker
 * - MutualExclusivityChecker
 * - ForbiddenPatternChecker
 * - RequiredPatternChecker
 * - ForbiddenImportChecker
 * - WUAutomatedTestsChecker
 *
 * Also tests:
 * - Registry mechanism (registerInvariantChecker, getInvariantChecker)
 * - Unknown type fallback
 * - validateInvariants dispatcher
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import {
  INVARIANT_TYPES,
  registerInvariantChecker,
  getInvariantChecker,
  validateInvariants,
  type InvariantChecker,
} from '../invariants-runner.js';

// Mock node:fs (synchronous)
vi.mock('node:fs', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
  };
});

// Mock glob
vi.mock('glob', () => ({
  globSync: vi.fn().mockReturnValue([]),
}));

// Mock check-automated-tests
vi.mock('../invariants/check-automated-tests.js', () => ({
  checkAutomatedTestsInvariant: vi.fn().mockReturnValue({
    valid: true,
    violations: [],
  }),
}));

// Mock wu-yaml
vi.mock('../wu-yaml.js', () => ({
  parseYAML: vi.fn(),
}));

// Mock error-handler
vi.mock('../error-handler.js', () => ({
  getErrorMessage: vi.fn((e: unknown) =>
    e instanceof Error ? e.message : String(e),
  ),
}));

import { globSync } from 'glob';
import { checkAutomatedTestsInvariant } from '../invariants/check-automated-tests.js';

describe('InvariantChecker Registry', () => {
  it('should return registered checker for known type', () => {
    const checker = getInvariantChecker(INVARIANT_TYPES.REQUIRED_FILE);
    expect(checker).toBeDefined();
  });

  it('should return undefined for unknown type', () => {
    const checker = getInvariantChecker('nonexistent-type');
    expect(checker).toBeUndefined();
  });

  it('should register all 7 built-in types', () => {
    const types = [
      INVARIANT_TYPES.REQUIRED_FILE,
      INVARIANT_TYPES.FORBIDDEN_FILE,
      INVARIANT_TYPES.MUTUAL_EXCLUSIVITY,
      INVARIANT_TYPES.FORBIDDEN_PATTERN,
      INVARIANT_TYPES.REQUIRED_PATTERN,
      INVARIANT_TYPES.FORBIDDEN_IMPORT,
      INVARIANT_TYPES.WU_AUTOMATED_TESTS,
    ];

    for (const type of types) {
      expect(
        getInvariantChecker(type),
        `Missing registered checker for type: ${type}`,
      ).toBeDefined();
    }
  });

  it('should allow registering a custom checker', () => {
    const customChecker: InvariantChecker = {
      validate: () => null,
    };

    registerInvariantChecker('custom-test-type', customChecker);
    expect(getInvariantChecker('custom-test-type')).toBe(customChecker);
  });
});

describe('RequiredFileChecker', () => {
  const baseDir = '/test/project';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return null (pass) when file exists', () => {
    vi.mocked(existsSync).mockReturnValue(true);

    const checker = getInvariantChecker(INVARIANT_TYPES.REQUIRED_FILE)!;
    const result = checker.validate(
      { id: 'INV-001', type: 'required-file', description: 'Test', path: 'README.md' },
      baseDir,
    );

    expect(result).toBeNull();
    expect(existsSync).toHaveBeenCalledWith(path.join(baseDir, 'README.md'));
  });

  it('should return violation when file does not exist', () => {
    vi.mocked(existsSync).mockReturnValue(false);

    const checker = getInvariantChecker(INVARIANT_TYPES.REQUIRED_FILE)!;
    const result = checker.validate(
      { id: 'INV-001', type: 'required-file', description: 'Test', path: 'README.md' },
      baseDir,
    );

    expect(result).not.toBeNull();
    expect(result!.valid).toBe(false);
  });

  it('should return violation when path is not a string', () => {
    const checker = getInvariantChecker(INVARIANT_TYPES.REQUIRED_FILE)!;
    const result = checker.validate(
      { id: 'INV-001', type: 'required-file', description: 'Test', path: undefined },
      baseDir,
    );

    expect(result).not.toBeNull();
    expect(result!.valid).toBe(false);
  });
});

describe('ForbiddenFileChecker', () => {
  const baseDir = '/test/project';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return null (pass) when file does not exist', () => {
    vi.mocked(existsSync).mockReturnValue(false);

    const checker = getInvariantChecker(INVARIANT_TYPES.FORBIDDEN_FILE)!;
    const result = checker.validate(
      { id: 'INV-002', type: 'forbidden-file', description: 'Test', path: '.env' },
      baseDir,
    );

    expect(result).toBeNull();
  });

  it('should return violation when forbidden file exists', () => {
    vi.mocked(existsSync).mockReturnValue(true);

    const checker = getInvariantChecker(INVARIANT_TYPES.FORBIDDEN_FILE)!;
    const result = checker.validate(
      { id: 'INV-002', type: 'forbidden-file', description: 'Test', path: '.env' },
      baseDir,
    );

    expect(result).not.toBeNull();
    expect(result!.valid).toBe(false);
  });

  it('should return null when path is not a string', () => {
    const checker = getInvariantChecker(INVARIANT_TYPES.FORBIDDEN_FILE)!;
    const result = checker.validate(
      { id: 'INV-002', type: 'forbidden-file', description: 'Test', path: undefined },
      baseDir,
    );

    expect(result).toBeNull();
  });
});

describe('MutualExclusivityChecker', () => {
  const baseDir = '/test/project';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return null when zero files exist', () => {
    vi.mocked(existsSync).mockReturnValue(false);

    const checker = getInvariantChecker(INVARIANT_TYPES.MUTUAL_EXCLUSIVITY)!;
    const result = checker.validate(
      {
        id: 'INV-003',
        type: 'mutual-exclusivity',
        description: 'Test',
        paths: ['a.ts', 'b.ts'],
      },
      baseDir,
    );

    expect(result).toBeNull();
  });

  it('should return null when exactly one file exists', () => {
    vi.mocked(existsSync).mockImplementation((p: unknown) =>
      String(p).endsWith('a.ts'),
    );

    const checker = getInvariantChecker(INVARIANT_TYPES.MUTUAL_EXCLUSIVITY)!;
    const result = checker.validate(
      {
        id: 'INV-003',
        type: 'mutual-exclusivity',
        description: 'Test',
        paths: ['a.ts', 'b.ts'],
      },
      baseDir,
    );

    expect(result).toBeNull();
  });

  it('should return violation when more than one file exists', () => {
    vi.mocked(existsSync).mockReturnValue(true);

    const checker = getInvariantChecker(INVARIANT_TYPES.MUTUAL_EXCLUSIVITY)!;
    const result = checker.validate(
      {
        id: 'INV-003',
        type: 'mutual-exclusivity',
        description: 'Test',
        paths: ['a.ts', 'b.ts'],
      },
      baseDir,
    );

    expect(result).not.toBeNull();
    expect(result!.valid).toBe(false);
    expect(result!.existingPaths).toEqual(['a.ts', 'b.ts']);
  });

  it('should handle missing paths gracefully', () => {
    const checker = getInvariantChecker(INVARIANT_TYPES.MUTUAL_EXCLUSIVITY)!;
    const result = checker.validate(
      {
        id: 'INV-003',
        type: 'mutual-exclusivity',
        description: 'Test',
      },
      baseDir,
    );

    expect(result).toBeNull();
  });
});

describe('ForbiddenPatternChecker', () => {
  const baseDir = '/test/project';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return null when no files match the pattern', () => {
    vi.mocked(globSync).mockReturnValue(['file.ts'] as unknown as ReturnType<typeof globSync>);
    vi.mocked(readFileSync).mockReturnValue('clean content');

    const checker = getInvariantChecker(INVARIANT_TYPES.FORBIDDEN_PATTERN)!;
    const result = checker.validate(
      {
        id: 'INV-004',
        type: 'forbidden-pattern',
        description: 'Test',
        pattern: 'console\\.log',
        scope: ['src/**/*.ts'],
      },
      baseDir,
    );

    expect(result).toBeNull();
  });

  it('should return violation when pattern found in files', () => {
    vi.mocked(globSync).mockReturnValue(['file.ts'] as unknown as ReturnType<typeof globSync>);
    vi.mocked(readFileSync).mockReturnValue('console.log("debug")');

    const checker = getInvariantChecker(INVARIANT_TYPES.FORBIDDEN_PATTERN)!;
    const result = checker.validate(
      {
        id: 'INV-004',
        type: 'forbidden-pattern',
        description: 'Test',
        pattern: 'console\\.log',
        scope: ['src/**/*.ts'],
      },
      baseDir,
    );

    expect(result).not.toBeNull();
    expect(result!.valid).toBe(false);
    expect(result!.matchingFiles).toContain('file.ts');
  });

  it('should skip when pattern or scope is missing', () => {
    const checker = getInvariantChecker(INVARIANT_TYPES.FORBIDDEN_PATTERN)!;

    const result1 = checker.validate(
      { id: 'INV-004', type: 'forbidden-pattern', description: 'Test', scope: ['**'] },
      baseDir,
    );
    expect(result1).toBeNull();

    const result2 = checker.validate(
      { id: 'INV-004', type: 'forbidden-pattern', description: 'Test', pattern: 'test' },
      baseDir,
    );
    expect(result2).toBeNull();
  });
});

describe('RequiredPatternChecker', () => {
  const baseDir = '/test/project';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return null (pass) when pattern is found', () => {
    vi.mocked(globSync).mockReturnValue(['file.ts'] as unknown as ReturnType<typeof globSync>);
    vi.mocked(readFileSync).mockReturnValue('SPDX-License-Identifier: AGPL-3.0-only');

    const checker = getInvariantChecker(INVARIANT_TYPES.REQUIRED_PATTERN)!;
    const result = checker.validate(
      {
        id: 'INV-005',
        type: 'required-pattern',
        description: 'Test',
        pattern: 'SPDX-License-Identifier',
        scope: ['src/**/*.ts'],
      },
      baseDir,
    );

    expect(result).toBeNull();
  });

  it('should return violation when pattern is NOT found', () => {
    vi.mocked(globSync).mockReturnValue(['file.ts'] as unknown as ReturnType<typeof globSync>);
    vi.mocked(readFileSync).mockReturnValue('no license header');

    const checker = getInvariantChecker(INVARIANT_TYPES.REQUIRED_PATTERN)!;
    const result = checker.validate(
      {
        id: 'INV-005',
        type: 'required-pattern',
        description: 'Test',
        pattern: 'SPDX-License-Identifier',
        scope: ['src/**/*.ts'],
      },
      baseDir,
    );

    expect(result).not.toBeNull();
    expect(result!.valid).toBe(false);
    expect(result!.patternNotFound).toBe(true);
  });

  it('should skip when pattern or scope is missing', () => {
    const checker = getInvariantChecker(INVARIANT_TYPES.REQUIRED_PATTERN)!;
    const result = checker.validate(
      { id: 'INV-005', type: 'required-pattern', description: 'Test' },
      baseDir,
    );
    expect(result).toBeNull();
  });
});

describe('ForbiddenImportChecker', () => {
  const baseDir = '/test/project';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return null when no forbidden imports found', () => {
    vi.mocked(globSync).mockReturnValue(['file.ts'] as unknown as ReturnType<typeof globSync>);
    vi.mocked(readFileSync).mockReturnValue("import { foo } from './bar.js';");

    const checker = getInvariantChecker(INVARIANT_TYPES.FORBIDDEN_IMPORT)!;
    const result = checker.validate(
      {
        id: 'INV-006',
        type: 'forbidden-import',
        description: 'Test',
        from: 'src/**/*.ts',
        cannot_import: ['lodash'],
      },
      baseDir,
    );

    expect(result).toBeNull();
  });

  it('should detect static imports of forbidden modules', () => {
    vi.mocked(globSync).mockReturnValue(['file.ts'] as unknown as ReturnType<typeof globSync>);
    vi.mocked(readFileSync).mockReturnValue("import { merge } from 'lodash';");

    const checker = getInvariantChecker(INVARIANT_TYPES.FORBIDDEN_IMPORT)!;
    const result = checker.validate(
      {
        id: 'INV-006',
        type: 'forbidden-import',
        description: 'Test',
        from: 'src/**/*.ts',
        cannot_import: ['lodash'],
      },
      baseDir,
    );

    expect(result).not.toBeNull();
    expect(result!.valid).toBe(false);
    expect(result!.violatingFiles).toContain('file.ts');
    expect(result!.violatingImports!['lodash']).toBe(1);
  });

  it('should detect require() of forbidden modules', () => {
    vi.mocked(globSync).mockReturnValue(['file.js'] as unknown as ReturnType<typeof globSync>);
    vi.mocked(readFileSync).mockReturnValue("const l = require('lodash');");

    const checker = getInvariantChecker(INVARIANT_TYPES.FORBIDDEN_IMPORT)!;
    const result = checker.validate(
      {
        id: 'INV-006',
        type: 'forbidden-import',
        description: 'Test',
        from: 'src/**/*.js',
        cannot_import: ['lodash'],
      },
      baseDir,
    );

    expect(result).not.toBeNull();
    expect(result!.violatingImports!['lodash']).toBe(1);
  });

  it('should detect re-exports from forbidden modules', () => {
    vi.mocked(globSync).mockReturnValue(['index.ts'] as unknown as ReturnType<typeof globSync>);
    vi.mocked(readFileSync).mockReturnValue("export { default } from 'lodash';");

    const checker = getInvariantChecker(INVARIANT_TYPES.FORBIDDEN_IMPORT)!;
    const result = checker.validate(
      {
        id: 'INV-006',
        type: 'forbidden-import',
        description: 'Test',
        from: 'src/**/*.ts',
        cannot_import: ['lodash'],
      },
      baseDir,
    );

    expect(result).not.toBeNull();
    expect(result!.violatingFiles).toContain('index.ts');
  });

  it('should detect dynamic imports of forbidden modules', () => {
    vi.mocked(globSync).mockReturnValue(['file.ts'] as unknown as ReturnType<typeof globSync>);
    vi.mocked(readFileSync).mockReturnValue("const l = await import('lodash');");

    const checker = getInvariantChecker(INVARIANT_TYPES.FORBIDDEN_IMPORT)!;
    const result = checker.validate(
      {
        id: 'INV-006',
        type: 'forbidden-import',
        description: 'Test',
        from: 'src/**/*.ts',
        cannot_import: ['lodash'],
      },
      baseDir,
    );

    expect(result).not.toBeNull();
    expect(result!.violatingImports!['lodash']).toBe(1);
  });

  it('should skip when from or cannot_import is missing', () => {
    const checker = getInvariantChecker(INVARIANT_TYPES.FORBIDDEN_IMPORT)!;

    const result1 = checker.validate(
      {
        id: 'INV-006',
        type: 'forbidden-import',
        description: 'Test',
        cannot_import: ['lodash'],
      },
      baseDir,
    );
    expect(result1).toBeNull();

    const result2 = checker.validate(
      {
        id: 'INV-006',
        type: 'forbidden-import',
        description: 'Test',
        from: 'src/**',
      },
      baseDir,
    );
    expect(result2).toBeNull();
  });
});

describe('WUAutomatedTestsChecker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return null when all WUs have tests', () => {
    vi.mocked(checkAutomatedTestsInvariant).mockReturnValue({
      valid: true,
      violations: [],
    });

    const checker = getInvariantChecker(INVARIANT_TYPES.WU_AUTOMATED_TESTS)!;
    const result = checker.validate(
      {
        id: 'INV-007',
        type: 'wu-automated-tests',
        description: 'Test',
      },
      '/test/project',
    );

    expect(result).toBeNull();
  });

  it('should return violation when WUs lack tests', () => {
    vi.mocked(checkAutomatedTestsInvariant).mockReturnValue({
      valid: false,
      violations: [{ wuId: 'WU-100', codeFiles: ['src/foo.ts'] }],
    });

    const checker = getInvariantChecker(INVARIANT_TYPES.WU_AUTOMATED_TESTS)!;
    const result = checker.validate(
      {
        id: 'INV-007',
        type: 'wu-automated-tests',
        description: 'Test',
      },
      '/test/project',
    );

    expect(result).not.toBeNull();
    expect(result!.valid).toBe(false);
    expect(result!.wuViolations).toHaveLength(1);
  });

  it('should pass wuId context for scoped validation (WU-2425)', () => {
    vi.mocked(checkAutomatedTestsInvariant).mockReturnValue({
      valid: true,
      violations: [],
    });

    const checker = getInvariantChecker(INVARIANT_TYPES.WU_AUTOMATED_TESTS)!;
    checker.validate(
      {
        id: 'INV-007',
        type: 'wu-automated-tests',
        description: 'Test',
      },
      '/test/project',
      { wuId: 'WU-2043' },
    );

    expect(checkAutomatedTestsInvariant).toHaveBeenCalledWith({
      baseDir: '/test/project',
      wuId: 'WU-2043',
    });
  });
});

describe('validateInvariants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should dispatch to registered checkers', () => {
    vi.mocked(existsSync).mockReturnValue(true);

    const result = validateInvariants(
      [
        {
          id: 'INV-001',
          type: 'required-file',
          description: 'Check README',
          path: 'README.md',
        },
      ],
      { baseDir: '/test' },
    );

    expect(result.valid).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it('should collect violations from failing invariants', () => {
    vi.mocked(existsSync).mockReturnValue(false);

    const result = validateInvariants(
      [
        {
          id: 'INV-001',
          type: 'required-file',
          description: 'Check README',
          path: 'README.md',
        },
      ],
      { baseDir: '/test' },
    );

    expect(result.valid).toBe(false);
    expect(result.violations).toHaveLength(1);
  });

  it('should warn but not fail on unknown types', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = validateInvariants(
      [
        {
          id: 'INV-999',
          type: 'unknown-type',
          description: 'Unknown',
        },
      ],
      { baseDir: '/test' },
    );

    expect(result.valid).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Unknown invariant type: unknown-type'),
    );

    warnSpy.mockRestore();
  });

  it('should pass wuId context through to checkers', () => {
    vi.mocked(checkAutomatedTestsInvariant).mockReturnValue({
      valid: true,
      violations: [],
    });

    validateInvariants(
      [
        {
          id: 'INV-007',
          type: 'wu-automated-tests',
          description: 'Test',
        },
      ],
      { baseDir: '/test', wuId: 'WU-1234' },
    );

    expect(checkAutomatedTestsInvariant).toHaveBeenCalledWith({
      baseDir: '/test',
      wuId: 'WU-1234',
    });
  });
});
