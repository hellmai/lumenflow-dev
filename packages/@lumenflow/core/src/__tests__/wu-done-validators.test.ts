#!/usr/bin/env node
/**
 * Tests for wu-done-validators.mjs and rollback functionality
 *
 * WU-1255: TDD for tooling path detection and rollback error handling
 * Uses Node's built-in test runner (node:test)
 *
 * Run: node --test tools/lib/__tests__/wu-done-validators.test.mjs
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

// Import the functions to test
import { isSkipWebTestsPath } from '../path-classifiers.mjs';
import { rollbackFiles, RollbackResult } from '../rollback-utils.mjs';

describe('isSkipWebTestsPath', () => {
  describe('documentation paths', () => {
    it('returns true for docs/ paths', () => {
      assert.strictEqual(isSkipWebTestsPath('docs/README.md'), true);
      assert.strictEqual(isSkipWebTestsPath('docs/04-operations/tasks/wu/WU-1255.yaml'), true);
    });

    it('returns true for ai/ paths', () => {
      assert.strictEqual(isSkipWebTestsPath('ai/onboarding/workspace-modes.md'), true);
    });

    it('returns true for .claude/ paths', () => {
      assert.strictEqual(isSkipWebTestsPath('.claude/commands/hello.md'), true);
    });

    it('returns true for README files (case insensitive)', () => {
      assert.strictEqual(isSkipWebTestsPath('README.md'), true);
      assert.strictEqual(isSkipWebTestsPath('readme.md'), true);
      assert.strictEqual(isSkipWebTestsPath('README'), true);
    });

    it('returns true for CLAUDE.md files', () => {
      assert.strictEqual(isSkipWebTestsPath('CLAUDE.md'), true);
      assert.strictEqual(isSkipWebTestsPath('CLAUDE-core.md'), true);
    });
  });

  describe('tooling paths (WU-1255)', () => {
    it('returns true for tools/ paths', () => {
      assert.strictEqual(isSkipWebTestsPath('tools/wu-done.mjs'), true);
      assert.strictEqual(isSkipWebTestsPath('tools/lib/wu-constants.mjs'), true);
      assert.strictEqual(
        isSkipWebTestsPath('tools/lib/__tests__/wu-done-validators.test.mjs'),
        true
      );
    });

    it('returns true for scripts/ paths', () => {
      assert.strictEqual(isSkipWebTestsPath('scripts/deploy.sh'), true);
      assert.strictEqual(isSkipWebTestsPath('scripts/setup/init.mjs'), true);
    });
  });

  describe('application paths (should NOT skip tests)', () => {
    it('returns false for apps/web/ paths', () => {
      assert.strictEqual(isSkipWebTestsPath('apps/web/src/app/page.tsx'), false);
      assert.strictEqual(isSkipWebTestsPath('apps/web/src/lib/llm/service.ts'), false);
    });

    it('returns false for packages/ paths', () => {
      assert.strictEqual(
        isSkipWebTestsPath('packages/@exampleapp/application/src/index.ts'),
        false
      );
    });

    it('returns false for root config files', () => {
      assert.strictEqual(isSkipWebTestsPath('package.json'), false);
      assert.strictEqual(isSkipWebTestsPath('tsconfig.json'), false);
    });
  });

  describe('edge cases', () => {
    it('handles null/undefined gracefully', () => {
      assert.strictEqual(isSkipWebTestsPath(null), false);
      assert.strictEqual(isSkipWebTestsPath(undefined), false);
    });

    it('handles empty string', () => {
      assert.strictEqual(isSkipWebTestsPath(''), false);
    });

    it('does not match partial prefixes', () => {
      // "toolsmith" starts with "tool" but is not "tools/"
      assert.strictEqual(isSkipWebTestsPath('toolsmith/code.ts'), false);
      // "documents" starts with "doc" but is not "docs/"
      assert.strictEqual(isSkipWebTestsPath('documents/file.md'), false);
    });
  });
});

describe('shouldSkipWebTests', () => {
  // This is the aggregate function that checks ALL code_paths
  it('returns true when ALL paths are skip-tests paths', async () => {
    const { shouldSkipWebTests } = await import('../path-classifiers.mjs');

    const docsOnly = ['docs/README.md', 'ai/onboarding/guide.md'];
    assert.strictEqual(shouldSkipWebTests(docsOnly), true);

    const toolsOnly = ['tools/wu-done.mjs', 'tools/lib/helpers.mjs'];
    assert.strictEqual(shouldSkipWebTests(toolsOnly), true);

    const mixed = ['docs/README.md', 'tools/wu-done.mjs'];
    assert.strictEqual(shouldSkipWebTests(mixed), true);
  });

  it('returns false when ANY path requires tests', async () => {
    const { shouldSkipWebTests } = await import('../path-classifiers.mjs');

    const mixedWithApp = ['docs/README.md', 'apps/web/src/page.tsx'];
    assert.strictEqual(shouldSkipWebTests(mixedWithApp), false);
  });

  it('returns false for empty array', async () => {
    const { shouldSkipWebTests } = await import('../path-classifiers.mjs');
    assert.strictEqual(shouldSkipWebTests([]), false);
  });

  it('returns false for null/undefined', async () => {
    const { shouldSkipWebTests } = await import('../path-classifiers.mjs');
    assert.strictEqual(shouldSkipWebTests(null), false);
    assert.strictEqual(shouldSkipWebTests(undefined), false);
  });
});

// === ROLLBACK ERROR HANDLING TESTS (WU-1255) ===

describe('rollbackFiles', () => {
  const testDir = '/tmp/wu-1255-rollback-test';

  beforeEach(() => {
    // Create test directory
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    // Cleanup test directory
    rmSync(testDir, { recursive: true, force: true });
  });

  it('restores all files successfully when no errors', () => {
    // Setup: Create original files
    const file1 = join(testDir, 'file1.txt');
    const file2 = join(testDir, 'file2.txt');
    writeFileSync(file1, 'modified1');
    writeFileSync(file2, 'modified2');

    // Define files to restore
    const filesToRestore = [
      { name: 'file1', path: file1, content: 'original1' },
      { name: 'file2', path: file2, content: 'original2' },
    ];

    // Execute rollback
    const result = rollbackFiles(filesToRestore);

    // Assert all succeeded
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.errors.length, 0);
    assert.strictEqual(result.restored.length, 2);
  });

  it('continues restoring subsequent files when one fails', () => {
    // Setup: Create only the second file (first will fail)
    const file1 = join(testDir, 'nonexistent-dir', 'file1.txt'); // Will fail
    const file2 = join(testDir, 'file2.txt');
    writeFileSync(file2, 'modified2');

    // Define files to restore
    const filesToRestore = [
      { name: 'file1', path: file1, content: 'original1' },
      { name: 'file2', path: file2, content: 'original2' },
    ];

    // Execute rollback
    const result = rollbackFiles(filesToRestore);

    // Assert partial success - first failed but second succeeded
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.errors.length, 1);
    assert.strictEqual(result.errors[0].name, 'file1');
    assert.strictEqual(result.restored.length, 1);
    assert.strictEqual(result.restored[0], 'file2');
  });

  it('reports all errors when multiple files fail', () => {
    // Define files that will all fail (nonexistent parent directories)
    const filesToRestore = [
      { name: 'file1', path: join(testDir, 'bad1', 'file1.txt'), content: 'c1' },
      { name: 'file2', path: join(testDir, 'bad2', 'file2.txt'), content: 'c2' },
      { name: 'file3', path: join(testDir, 'bad3', 'file3.txt'), content: 'c3' },
    ];

    // Execute rollback
    const result = rollbackFiles(filesToRestore);

    // Assert all failed but all were attempted
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.errors.length, 3);
    assert.strictEqual(result.restored.length, 0);

    // Check error messages are informative
    assert.ok(result.errors[0].error.length > 0);
    assert.ok(result.errors[1].error.length > 0);
    assert.ok(result.errors[2].error.length > 0);
  });

  it('handles empty file list gracefully', () => {
    const result = rollbackFiles([]);

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.errors.length, 0);
    assert.strictEqual(result.restored.length, 0);
  });

  it('includes error messages with file info for manual intervention', () => {
    // Setup: File that will fail
    const filesToRestore = [
      { name: 'backlog.md', path: join(testDir, 'no-dir', 'backlog.md'), content: 'content' },
    ];

    // Execute rollback
    const result = rollbackFiles(filesToRestore);

    // Assert error has all needed info for manual intervention
    assert.strictEqual(result.errors.length, 1);
    const error = result.errors[0];
    assert.strictEqual(error.name, 'backlog.md');
    assert.ok(error.path.includes('backlog.md'));
    assert.ok(typeof error.error === 'string');
  });
});

describe('RollbackResult', () => {
  it('correctly reports success when all files restored', () => {
    const result = new RollbackResult();
    result.addSuccess('file1');
    result.addSuccess('file2');

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.restored.length, 2);
  });

  it('correctly reports failure when any error', () => {
    const result = new RollbackResult();
    result.addSuccess('file1');
    result.addError('file2', '/path/file2', 'ENOENT');

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.restored.length, 1);
    assert.strictEqual(result.errors.length, 1);
  });
});

// === VALIDATE CODE PATHS EXIST TESTS (WU-1351) ===

describe('validateCodePathsExist (WU-1351)', () => {
  const testDir = '/tmp/wu-1351-code-paths-test';

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('should pass validation when code_paths is empty', async () => {
    const { validateCodePathsExist } = await import('../wu-done-validators.mjs');

    const doc = { id: 'WU-1351', code_paths: [] };
    const result = await validateCodePathsExist(doc, 'WU-1351');

    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.errors.length, 0);
    assert.strictEqual(result.missing.length, 0);
  });

  it('should pass validation when code_paths is undefined', async () => {
    const { validateCodePathsExist } = await import('../wu-done-validators.mjs');

    const doc = { id: 'WU-1351' };
    const result = await validateCodePathsExist(doc, 'WU-1351');

    assert.strictEqual(result.valid, true);
  });

  it('should pass when all files exist in worktree', async () => {
    const { validateCodePathsExist } = await import('../wu-done-validators.mjs');

    // Create test files
    const file1 = join(testDir, 'file1.mjs');
    const file2 = join(testDir, 'file2.mjs');
    writeFileSync(file1, 'content1');
    writeFileSync(file2, 'content2');

    const doc = {
      id: 'WU-1351',
      code_paths: ['file1.mjs', 'file2.mjs'],
    };

    const result = await validateCodePathsExist(doc, 'WU-1351', {
      worktreePath: testDir,
    });

    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.missing.length, 0);
  });

  it('should fail when files are missing from worktree', async () => {
    const { validateCodePathsExist } = await import('../wu-done-validators.mjs');

    // Create only one file
    const file1 = join(testDir, 'existing-file.mjs');
    writeFileSync(file1, 'content');

    const doc = {
      id: 'WU-1351',
      code_paths: ['existing-file.mjs', 'missing-file.mjs'],
    };

    const result = await validateCodePathsExist(doc, 'WU-1351', {
      worktreePath: testDir,
    });

    assert.strictEqual(result.valid, false);
    assert.ok(result.missing.includes('missing-file.mjs'));
    assert.ok(result.errors[0].includes('code_paths validation failed'));
  });

  it('should report all missing files in error', async () => {
    const { validateCodePathsExist } = await import('../wu-done-validators.mjs');

    const doc = {
      id: 'WU-1351',
      code_paths: ['missing1.mjs', 'missing2.mjs', 'missing3.mjs'],
    };

    const result = await validateCodePathsExist(doc, 'WU-1351', {
      worktreePath: testDir,
    });

    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.missing.length, 3);
    assert.ok(result.errors[0].includes('missing1.mjs'));
    assert.ok(result.errors[0].includes('missing2.mjs'));
    assert.ok(result.errors[0].includes('missing3.mjs'));
  });
});

// === POST-MUTATION VALIDATION TESTS (WU-1617) ===

describe('validatePostMutation (WU-1617)', () => {
  const testDir = '/tmp/wu-1617-post-mutation-test';
  let wuPath;
  let stampPath;

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
    mkdirSync(join(testDir, '.beacon', 'stamps'), { recursive: true });
    wuPath = join(testDir, 'WU-1617.yaml');
    stampPath = join(testDir, '.beacon', 'stamps', 'WU-1617.done');
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('should pass validation when all required fields are present', async () => {
    const { validatePostMutation } = await import('../wu-done-validators.mjs');

    // Create valid WU YAML with all required done fields
    const validYAML = `id: WU-1617
title: Test WU
status: done
locked: true
completed_at: ${new Date().toISOString()}
`;
    writeFileSync(wuPath, validYAML);

    // Create stamp file
    writeFileSync(stampPath, 'WU WU-1617 — Test WU\nCompleted: 2025-01-01\n');

    const result = validatePostMutation({ id: 'WU-1617', wuPath, stampPath });

    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.errors.length, 0);
  });

  it('should fail when completed_at is missing', async () => {
    const { validatePostMutation } = await import('../wu-done-validators.mjs');

    // Create WU YAML WITHOUT completed_at
    const yamlMissingCompletedAt = `id: WU-1617
title: Test WU
status: done
locked: true
`;
    writeFileSync(wuPath, yamlMissingCompletedAt);
    writeFileSync(stampPath, 'WU WU-1617 — Test WU\nCompleted: 2025-01-01\n');

    const result = validatePostMutation({ id: 'WU-1617', wuPath, stampPath });

    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('completed_at')));
  });

  it('should fail when locked is missing', async () => {
    const { validatePostMutation } = await import('../wu-done-validators.mjs');

    // Create WU YAML WITHOUT locked
    const yamlMissingLocked = `id: WU-1617
title: Test WU
status: done
completed_at: ${new Date().toISOString()}
`;
    writeFileSync(wuPath, yamlMissingLocked);
    writeFileSync(stampPath, 'WU WU-1617 — Test WU\nCompleted: 2025-01-01\n');

    const result = validatePostMutation({ id: 'WU-1617', wuPath, stampPath });

    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('locked')));
  });

  it('should fail when locked is false', async () => {
    const { validatePostMutation } = await import('../wu-done-validators.mjs');

    // Create WU YAML with locked: false
    const yamlLockedFalse = `id: WU-1617
title: Test WU
status: done
locked: false
completed_at: ${new Date().toISOString()}
`;
    writeFileSync(wuPath, yamlLockedFalse);
    writeFileSync(stampPath, 'WU WU-1617 — Test WU\nCompleted: 2025-01-01\n');

    const result = validatePostMutation({ id: 'WU-1617', wuPath, stampPath });

    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('locked')));
  });

  it('should fail when stamp file is missing', async () => {
    const { validatePostMutation } = await import('../wu-done-validators.mjs');

    // Create valid WU YAML but no stamp file
    const validYAML = `id: WU-1617
title: Test WU
status: done
locked: true
completed_at: ${new Date().toISOString()}
`;
    writeFileSync(wuPath, validYAML);
    // Intentionally NOT creating stamp file

    const result = validatePostMutation({ id: 'WU-1617', wuPath, stampPath });

    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('Stamp file')));
  });

  it('should fail when WU YAML file is missing', async () => {
    const { validatePostMutation } = await import('../wu-done-validators.mjs');

    // Create stamp file but no WU YAML
    writeFileSync(stampPath, 'WU WU-1617 — Test WU\nCompleted: 2025-01-01\n');
    // Intentionally NOT creating WU YAML

    const result = validatePostMutation({ id: 'WU-1617', wuPath, stampPath });

    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('not found')));
  });

  it('should fail when status is not done', async () => {
    const { validatePostMutation } = await import('../wu-done-validators.mjs');

    // Create WU YAML with status: in_progress (wrong status after tx.commit)
    const yamlWrongStatus = `id: WU-1617
title: Test WU
status: in_progress
locked: true
completed_at: ${new Date().toISOString()}
`;
    writeFileSync(wuPath, yamlWrongStatus);
    writeFileSync(stampPath, 'WU WU-1617 — Test WU\nCompleted: 2025-01-01\n');

    const result = validatePostMutation({ id: 'WU-1617', wuPath, stampPath });

    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('status')));
  });

  it('should fail when completed_at is invalid datetime', async () => {
    const { validatePostMutation } = await import('../wu-done-validators.mjs');

    // Create WU YAML with invalid completed_at
    const yamlInvalidDate = `id: WU-1617
title: Test WU
status: done
locked: true
completed_at: "not-a-date"
`;
    writeFileSync(wuPath, yamlInvalidDate);
    writeFileSync(stampPath, 'WU WU-1617 — Test WU\nCompleted: 2025-01-01\n');

    const result = validatePostMutation({ id: 'WU-1617', wuPath, stampPath });

    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('Invalid completed_at')));
  });

  it('should report multiple validation errors at once', async () => {
    const { validatePostMutation } = await import('../wu-done-validators.mjs');

    // Create WU YAML missing multiple fields
    const yamlMultipleMissing = `id: WU-1617
title: Test WU
status: in_progress
`;
    writeFileSync(wuPath, yamlMultipleMissing);
    // No stamp file either

    const result = validatePostMutation({ id: 'WU-1617', wuPath, stampPath });

    assert.strictEqual(result.valid, false);
    // Should report at least 3 errors: stamp file, completed_at, locked, status
    assert.ok(result.errors.length >= 3);
  });
});
