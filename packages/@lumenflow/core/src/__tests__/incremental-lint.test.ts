/**
 * @file incremental-lint.test.mjs
 * @description Tests for incremental lint logic
 * WU-1304: Optimise ESLint gates performance
 *
 * Tests the core logic for determining which files to lint based on
 * changes since branching from main.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getChangedLintableFiles,
  isLintableFile,
  LINTABLE_EXTENSIONS,
} from '../incremental-lint.js';

describe('isLintableFile', () => {
  it('should return true for TypeScript files', () => {
    expect(isLintableFile('src/app.ts')).toBe(true);
    expect(isLintableFile('src/component.tsx')).toBe(true);
  });

  it('should return true for JavaScript files', () => {
    expect(isLintableFile('src/utils.js')).toBe(true);
    expect(isLintableFile('src/helper.jsx')).toBe(true);
    expect(isLintableFile('tools/script.js')).toBe(true);
  });

  it('should return false for non-lintable files', () => {
    expect(isLintableFile('README.md')).toBe(false);
    expect(isLintableFile('package.json')).toBe(false);
    expect(isLintableFile('styles.css')).toBe(false);
    expect(isLintableFile('image.png')).toBe(false);
  });

  it('should return false for files in ignored directories', () => {
    expect(isLintableFile('node_modules/package/index.js')).toBe(false);
    expect(isLintableFile('.next/build/page.js')).toBe(false);
    expect(isLintableFile('dist/bundle.js')).toBe(false);
    expect(isLintableFile('coverage/lcov-report/index.js')).toBe(false);
  });
});

describe('LINTABLE_EXTENSIONS', () => {
  it('should include standard JS/TS extensions', () => {
    expect(LINTABLE_EXTENSIONS).toContain('.ts');
    expect(LINTABLE_EXTENSIONS).toContain('.tsx');
    expect(LINTABLE_EXTENSIONS).toContain('.js');
    expect(LINTABLE_EXTENSIONS).toContain('.jsx');
    expect(LINTABLE_EXTENSIONS).toContain('.js');
  });
});

describe('getChangedLintableFiles', () => {
  it('should return empty array when no files changed', async () => {
    const mockGit = {
      mergeBase: vi.fn(async () => 'abc123'),
      raw: vi.fn(async () => ''),
    };

    const result = await getChangedLintableFiles({ git: mockGit });
    expect(result).toEqual([]);
  });

  it('should filter to only lintable files', async () => {
    const mockGit = {
      mergeBase: vi.fn(async () => 'abc123'),
      raw: vi.fn(async () => 'src/app.ts\nREADME.md\nsrc/utils.js\npackage.json'),
    };

    const result = await getChangedLintableFiles({ git: mockGit });
    expect(result).toEqual(['src/app.ts', 'src/utils.js']);
  });

  it('should exclude files in ignored directories', async () => {
    const mockGit = {
      mergeBase: vi.fn(async () => 'abc123'),
      raw: vi.fn(async () => 'src/app.ts\nnode_modules/dep/index.js\n.next/page.js\nsrc/lib.tsx'),
    };

    const result = await getChangedLintableFiles({ git: mockGit });
    expect(result).toEqual(['src/app.ts', 'src/lib.tsx']);
  });

  it('should use HEAD and origin/main for merge-base by default', async () => {
    const mockGit = {
      mergeBase: vi.fn(async () => 'abc123'),
      raw: vi.fn(async () => ''),
    };

    await getChangedLintableFiles({ git: mockGit });
    expect(mockGit.mergeBase.mock.calls.length).toBe(1);
    expect(mockGit.mergeBase.mock.calls[0]).toEqual(['HEAD', 'origin/main']);
  });

  it('should call git diff with correct arguments for committed changes', async () => {
    const mockGit = {
      mergeBase: vi.fn(async () => 'abc123'),
      raw: vi.fn(async () => 'src/app.ts'),
    };

    await getChangedLintableFiles({ git: mockGit });
    // First call should be for committed changes
    expect(mockGit.raw.mock.calls[0]).toEqual([['diff', '--name-only', 'abc123...HEAD']]);
  });

  it('should allow custom base branch', async () => {
    const mockGit = {
      mergeBase: vi.fn(async () => 'def456'),
      raw: vi.fn(async () => ''),
    };

    await getChangedLintableFiles({ git: mockGit, baseBranch: 'origin/develop' });
    expect(mockGit.mergeBase.mock.calls[0]).toEqual(['HEAD', 'origin/develop']);
  });

  it('should allow filtering to specific directory', async () => {
    const mockGit = {
      mergeBase: vi.fn(async () => 'abc123'),
      raw: vi.fn(async () => 'apps/web/src/app.ts\ntools/script.mjs\napps/web/src/lib.tsx'),
    };

    const result = await getChangedLintableFiles({
      git: mockGit,
      filterPath: 'apps/web/',
    });
    expect(result).toEqual(['apps/web/src/app.ts', 'apps/web/src/lib.tsx']);
  });

  // WU-1784: Tests for untracked and unstaged file inclusion
  it('should include modified but unstaged files', async () => {
    // Mock git that returns:
    // - No committed changes (diff from merge-base)
    // - One modified unstaged file (diff with no args)
    // - No untracked files
    const mockGit = {
      mergeBase: vi.fn(async () => 'abc123'),
      raw: vi.fn(async (args) => {
        if (args[0] === 'diff' && args.length === 2 && args[1] === '--name-only') {
          // git diff --name-only (unstaged changes)
          return 'src/modified-unstaged.ts';
        }
        if (args[0] === 'ls-files') {
          // git ls-files --others --exclude-standard (untracked)
          return '';
        }
        // git diff --name-only <merge-base>...HEAD (committed changes)
        return '';
      }),
    };

    const result = await getChangedLintableFiles({ git: mockGit });
    expect(result.includes('src/modified-unstaged.ts')).toBe(true);
  });

  it('should include untracked files', async () => {
    // Mock git that returns:
    // - No committed changes
    // - No unstaged changes
    // - One untracked file
    const mockGit = {
      mergeBase: vi.fn(async () => 'abc123'),
      raw: vi.fn(async (args) => {
        if (args[0] === 'diff' && args.length === 2 && args[1] === '--name-only') {
          // git diff --name-only (unstaged changes)
          return '';
        }
        if (args[0] === 'ls-files') {
          // git ls-files --others --exclude-standard (untracked)
          return 'src/new-untracked.ts';
        }
        // git diff --name-only <merge-base>...HEAD (committed changes)
        return '';
      }),
    };

    const result = await getChangedLintableFiles({ git: mockGit });
    expect(result.includes('src/new-untracked.ts')).toBe(true);
  });

  it('should combine committed, unstaged, and untracked files without duplicates', async () => {
    // Mock git that returns overlapping files across all three sources
    const mockGit = {
      mergeBase: vi.fn(async () => 'abc123'),
      raw: vi.fn(async (args) => {
        if (args[0] === 'diff' && args.length === 2 && args[1] === '--name-only') {
          // git diff --name-only (unstaged changes)
          return 'src/both-committed-and-unstaged.ts\nsrc/unstaged-only.ts';
        }
        if (args[0] === 'ls-files') {
          // git ls-files --others --exclude-standard (untracked)
          return 'src/untracked.tsx';
        }
        // git diff --name-only <merge-base>...HEAD (committed changes)
        return 'src/both-committed-and-unstaged.ts\nsrc/committed-only.ts';
      }),
    };

    const result = await getChangedLintableFiles({ git: mockGit });

    // Should have all 4 unique files
    expect(result.length).toBe(4);
    expect(result.includes('src/both-committed-and-unstaged.ts')).toBe(true);
    expect(result.includes('src/committed-only.ts')).toBe(true);
    expect(result.includes('src/unstaged-only.ts')).toBe(true);
    expect(result.includes('src/untracked.tsx')).toBe(true);
  });

  it('should filter untracked and unstaged files to specified directory', async () => {
    const mockGit = {
      mergeBase: vi.fn(async () => 'abc123'),
      raw: vi.fn(async (args) => {
        if (args[0] === 'diff' && args.length === 2 && args[1] === '--name-only') {
          // git diff --name-only (unstaged changes)
          return 'apps/web/src/unstaged.ts\ntools/unstaged.js';
        }
        if (args[0] === 'ls-files') {
          // git ls-files --others --exclude-standard (untracked)
          return 'apps/web/src/untracked.ts\ntools/untracked.js';
        }
        // git diff --name-only <merge-base>...HEAD (committed changes)
        return 'apps/web/src/committed.ts\ntools/committed.js';
      }),
    };

    const result = await getChangedLintableFiles({
      git: mockGit,
      filterPath: 'apps/web/',
    });

    // Should only include apps/web/ files
    expect(result.length).toBe(3);
    expect(result).toContain('apps/web/src/committed.ts');
    expect(result).toContain('apps/web/src/unstaged.ts');
    expect(result).toContain('apps/web/src/untracked.ts');
    expect(result.includes('tools/unstaged.js')).toBe(false);
    expect(result.includes('tools/untracked.js')).toBe(false);
  });

  it('should call git commands for unstaged and untracked files', async () => {
    const mockGit = {
      mergeBase: vi.fn(async () => 'abc123'),
      raw: vi.fn(async () => ''),
    };

    await getChangedLintableFiles({ git: mockGit });

    // Should have 3 calls to raw():
    // 1. git diff --name-only abc123...HEAD (committed changes)
    // 2. git diff --name-only (unstaged changes)
    // 3. git ls-files --others --exclude-standard (untracked files)
    expect(mockGit.raw.mock.calls.length).toBe(3);

    // Verify the arguments for each call
    const calls = mockGit.raw.mock.calls.map((c) => c[0]);

    // First call: committed changes
    expect(calls[0]).toEqual(['diff', '--name-only', 'abc123...HEAD']);

    // Second call: unstaged changes
    expect(calls[1]).toEqual(['diff', '--name-only']);

    // Third call: untracked files
    expect(calls[2]).toEqual(['ls-files', '--others', '--exclude-standard']);
  });
});

// WU-2571: Tests for path conversion to package-relative
describe('convertToPackageRelativePaths', () => {
  // Dynamically import since we need to add the function
  let convertToPackageRelativePaths;

  beforeEach(async () => {
    const module = await import('../incremental-lint.js');
    convertToPackageRelativePaths = module.convertToPackageRelativePaths;
  });

  it('should convert repo-relative paths to package-relative paths', () => {
    const repoRelativePaths = ['apps/web/src/app.ts', 'apps/web/src/lib/utils.ts'];
    const packagePrefix = 'apps/web/';

    const result = convertToPackageRelativePaths(repoRelativePaths, packagePrefix);

    expect(result).toEqual(['src/app.ts', 'src/lib/utils.ts']);
  });

  it('should handle paths that do not start with the package prefix', () => {
    const repoRelativePaths = ['apps/web/src/app.ts', 'tools/script.js'];
    const packagePrefix = 'apps/web/';

    const result = convertToPackageRelativePaths(repoRelativePaths, packagePrefix);

    // Paths not starting with prefix should be filtered out
    expect(result).toEqual(['src/app.ts']);
  });

  it('should handle empty array', () => {
    const result = convertToPackageRelativePaths([], 'apps/web/');
    expect(result).toEqual([]);
  });

  it('should handle paths with trailing slash in prefix consistently', () => {
    const repoRelativePaths = ['apps/web/src/app.ts'];

    // Both with and without trailing slash should work
    const result1 = convertToPackageRelativePaths(repoRelativePaths, 'apps/web/');
    const result2 = convertToPackageRelativePaths(repoRelativePaths, 'apps/web');

    expect(result1).toEqual(['src/app.ts']);
    expect(result2).toEqual(['src/app.ts']);
  });
});
