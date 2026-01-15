/**
 * @file incremental-lint.test.mjs
 * @description Tests for incremental lint logic
 * WU-1304: Optimise ESLint gates performance
 *
 * Tests the core logic for determining which files to lint based on
 * changes since branching from main.
 */

import { describe, it, mock, before } from 'node:test';
import assert from 'node:assert/strict';
import {
  getChangedLintableFiles,
  isLintableFile,
  LINTABLE_EXTENSIONS,
} from '../incremental-lint.mjs';

describe('isLintableFile', () => {
  it('should return true for TypeScript files', () => {
    assert.equal(isLintableFile('src/app.ts'), true);
    assert.equal(isLintableFile('src/component.tsx'), true);
  });

  it('should return true for JavaScript files', () => {
    assert.equal(isLintableFile('src/utils.js'), true);
    assert.equal(isLintableFile('src/helper.jsx'), true);
    assert.equal(isLintableFile('tools/script.mjs'), true);
  });

  it('should return false for non-lintable files', () => {
    assert.equal(isLintableFile('README.md'), false);
    assert.equal(isLintableFile('package.json'), false);
    assert.equal(isLintableFile('styles.css'), false);
    assert.equal(isLintableFile('image.png'), false);
  });

  it('should return false for files in ignored directories', () => {
    assert.equal(isLintableFile('node_modules/package/index.js'), false);
    assert.equal(isLintableFile('.next/build/page.js'), false);
    assert.equal(isLintableFile('dist/bundle.js'), false);
    assert.equal(isLintableFile('coverage/lcov-report/index.js'), false);
  });
});

describe('LINTABLE_EXTENSIONS', () => {
  it('should include standard JS/TS extensions', () => {
    assert.ok(LINTABLE_EXTENSIONS.includes('.ts'));
    assert.ok(LINTABLE_EXTENSIONS.includes('.tsx'));
    assert.ok(LINTABLE_EXTENSIONS.includes('.js'));
    assert.ok(LINTABLE_EXTENSIONS.includes('.jsx'));
    assert.ok(LINTABLE_EXTENSIONS.includes('.mjs'));
  });
});

describe('getChangedLintableFiles', () => {
  it('should return empty array when no files changed', async () => {
    const mockGit = {
      mergeBase: mock.fn(async () => 'abc123'),
      raw: mock.fn(async () => ''),
    };

    const result = await getChangedLintableFiles({ git: mockGit });
    assert.deepEqual(result, []);
  });

  it('should filter to only lintable files', async () => {
    const mockGit = {
      mergeBase: mock.fn(async () => 'abc123'),
      raw: mock.fn(async () => 'src/app.ts\nREADME.md\nsrc/utils.js\npackage.json'),
    };

    const result = await getChangedLintableFiles({ git: mockGit });
    assert.deepEqual(result, ['src/app.ts', 'src/utils.js']);
  });

  it('should exclude files in ignored directories', async () => {
    const mockGit = {
      mergeBase: mock.fn(async () => 'abc123'),
      raw: mock.fn(async () => 'src/app.ts\nnode_modules/dep/index.js\n.next/page.js\nsrc/lib.tsx'),
    };

    const result = await getChangedLintableFiles({ git: mockGit });
    assert.deepEqual(result, ['src/app.ts', 'src/lib.tsx']);
  });

  it('should use HEAD and origin/main for merge-base by default', async () => {
    const mockGit = {
      mergeBase: mock.fn(async () => 'abc123'),
      raw: mock.fn(async () => ''),
    };

    await getChangedLintableFiles({ git: mockGit });
    assert.equal(mockGit.mergeBase.mock.calls.length, 1);
    assert.deepEqual(mockGit.mergeBase.mock.calls[0].arguments, ['HEAD', 'origin/main']);
  });

  it('should call git diff with correct arguments for committed changes', async () => {
    const mockGit = {
      mergeBase: mock.fn(async () => 'abc123'),
      raw: mock.fn(async () => 'src/app.ts'),
    };

    await getChangedLintableFiles({ git: mockGit });
    // First call should be for committed changes
    assert.deepEqual(mockGit.raw.mock.calls[0].arguments, [
      ['diff', '--name-only', 'abc123...HEAD'],
    ]);
  });

  it('should allow custom base branch', async () => {
    const mockGit = {
      mergeBase: mock.fn(async () => 'def456'),
      raw: mock.fn(async () => ''),
    };

    await getChangedLintableFiles({ git: mockGit, baseBranch: 'origin/develop' });
    assert.deepEqual(mockGit.mergeBase.mock.calls[0].arguments, ['HEAD', 'origin/develop']);
  });

  it('should allow filtering to specific directory', async () => {
    const mockGit = {
      mergeBase: mock.fn(async () => 'abc123'),
      raw: mock.fn(async () => 'apps/web/src/app.ts\ntools/script.mjs\napps/web/src/lib.tsx'),
    };

    const result = await getChangedLintableFiles({
      git: mockGit,
      filterPath: 'apps/web/',
    });
    assert.deepEqual(result, ['apps/web/src/app.ts', 'apps/web/src/lib.tsx']);
  });

  // WU-1784: Tests for untracked and unstaged file inclusion
  it('should include modified but unstaged files', async () => {
    // Mock git that returns:
    // - No committed changes (diff from merge-base)
    // - One modified unstaged file (diff with no args)
    // - No untracked files
    const mockGit = {
      mergeBase: mock.fn(async () => 'abc123'),
      raw: mock.fn(async (args) => {
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
    assert.ok(result.includes('src/modified-unstaged.ts'), 'Should include unstaged modified file');
  });

  it('should include untracked files', async () => {
    // Mock git that returns:
    // - No committed changes
    // - No unstaged changes
    // - One untracked file
    const mockGit = {
      mergeBase: mock.fn(async () => 'abc123'),
      raw: mock.fn(async (args) => {
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
    assert.ok(result.includes('src/new-untracked.ts'), 'Should include untracked file');
  });

  it('should combine committed, unstaged, and untracked files without duplicates', async () => {
    // Mock git that returns overlapping files across all three sources
    const mockGit = {
      mergeBase: mock.fn(async () => 'abc123'),
      raw: mock.fn(async (args) => {
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
    assert.equal(result.length, 4, 'Should have 4 unique files');
    assert.ok(result.includes('src/both-committed-and-unstaged.ts'), 'Should include file in both');
    assert.ok(result.includes('src/committed-only.ts'), 'Should include committed-only file');
    assert.ok(result.includes('src/unstaged-only.ts'), 'Should include unstaged-only file');
    assert.ok(result.includes('src/untracked.tsx'), 'Should include untracked file');
  });

  it('should filter untracked and unstaged files to specified directory', async () => {
    const mockGit = {
      mergeBase: mock.fn(async () => 'abc123'),
      raw: mock.fn(async (args) => {
        if (args[0] === 'diff' && args.length === 2 && args[1] === '--name-only') {
          // git diff --name-only (unstaged changes)
          return 'apps/web/src/unstaged.ts\ntools/unstaged.mjs';
        }
        if (args[0] === 'ls-files') {
          // git ls-files --others --exclude-standard (untracked)
          return 'apps/web/src/untracked.ts\ntools/untracked.mjs';
        }
        // git diff --name-only <merge-base>...HEAD (committed changes)
        return 'apps/web/src/committed.ts\ntools/committed.mjs';
      }),
    };

    const result = await getChangedLintableFiles({
      git: mockGit,
      filterPath: 'apps/web/',
    });

    // Should only include apps/web/ files
    assert.equal(result.length, 3, 'Should have 3 files in apps/web/');
    assert.ok(result.includes('apps/web/src/committed.ts'));
    assert.ok(result.includes('apps/web/src/unstaged.ts'));
    assert.ok(result.includes('apps/web/src/untracked.ts'));
    assert.ok(!result.includes('tools/unstaged.mjs'), 'Should not include tools/ files');
    assert.ok(!result.includes('tools/untracked.mjs'), 'Should not include tools/ files');
  });

  it('should call git commands for unstaged and untracked files', async () => {
    const mockGit = {
      mergeBase: mock.fn(async () => 'abc123'),
      raw: mock.fn(async () => ''),
    };

    await getChangedLintableFiles({ git: mockGit });

    // Should have 3 calls to raw():
    // 1. git diff --name-only abc123...HEAD (committed changes)
    // 2. git diff --name-only (unstaged changes)
    // 3. git ls-files --others --exclude-standard (untracked files)
    assert.equal(mockGit.raw.mock.calls.length, 3, 'Should call git.raw() 3 times');

    // Verify the arguments for each call
    const calls = mockGit.raw.mock.calls.map((c) => c.arguments[0]);

    // First call: committed changes
    assert.deepEqual(calls[0], ['diff', '--name-only', 'abc123...HEAD']);

    // Second call: unstaged changes
    assert.deepEqual(calls[1], ['diff', '--name-only']);

    // Third call: untracked files
    assert.deepEqual(calls[2], ['ls-files', '--others', '--exclude-standard']);
  });
});

// WU-2571: Tests for path conversion to package-relative
describe('convertToPackageRelativePaths', () => {
  // Dynamically import since we need to add the function
  let convertToPackageRelativePaths;

  before(async () => {
    const module = await import('../incremental-lint.mjs');
    convertToPackageRelativePaths = module.convertToPackageRelativePaths;
  });

  it('should convert repo-relative paths to package-relative paths', () => {
    const repoRelativePaths = ['apps/web/src/app.ts', 'apps/web/src/lib/utils.ts'];
    const packagePrefix = 'apps/web/';

    const result = convertToPackageRelativePaths(repoRelativePaths, packagePrefix);

    assert.deepEqual(result, ['src/app.ts', 'src/lib/utils.ts']);
  });

  it('should handle paths that do not start with the package prefix', () => {
    const repoRelativePaths = ['apps/web/src/app.ts', 'tools/script.mjs'];
    const packagePrefix = 'apps/web/';

    const result = convertToPackageRelativePaths(repoRelativePaths, packagePrefix);

    // Paths not starting with prefix should be filtered out
    assert.deepEqual(result, ['src/app.ts']);
  });

  it('should handle empty array', () => {
    const result = convertToPackageRelativePaths([], 'apps/web/');
    assert.deepEqual(result, []);
  });

  it('should handle paths with trailing slash in prefix consistently', () => {
    const repoRelativePaths = ['apps/web/src/app.ts'];

    // Both with and without trailing slash should work
    const result1 = convertToPackageRelativePaths(repoRelativePaths, 'apps/web/');
    const result2 = convertToPackageRelativePaths(repoRelativePaths, 'apps/web');

    assert.deepEqual(result1, ['src/app.ts']);
    assert.deepEqual(result2, ['src/app.ts']);
  });
});
