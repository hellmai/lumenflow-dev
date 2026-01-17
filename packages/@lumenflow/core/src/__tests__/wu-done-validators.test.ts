#!/usr/bin/env node
/**
 * Tests for wu-done-validators.mjs and rollback functionality
 *
 * WU-1255: TDD for tooling path detection and rollback error handling
 * Uses Node's built-in test runner (node:test)
 *
 * Run: node --test tools/lib/__tests__/wu-done-validators.test.mjs
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

// Import the functions to test
import { isSkipWebTestsPath } from '../path-classifiers.js';
import { rollbackFiles, RollbackResult } from '../rollback-utils.js';

describe('isSkipWebTestsPath', () => {
  describe('documentation paths', () => {
    it('returns true for docs/ paths', () => {
      expect(isSkipWebTestsPath('docs/README.md')).toBe(true);
      expect(isSkipWebTestsPath('docs/04-operations/tasks/wu/WU-1255.yaml')).toBe(true);
    });

    it('returns true for ai/ paths', () => {
      expect(isSkipWebTestsPath('ai/onboarding/workspace-modes.md')).toBe(true);
    });

    it('returns true for .claude/ paths', () => {
      expect(isSkipWebTestsPath('.claude/commands/hello.md')).toBe(true);
    });

    it('returns true for README files (case insensitive)', () => {
      expect(isSkipWebTestsPath('README.md')).toBe(true);
      expect(isSkipWebTestsPath('readme.md')).toBe(true);
      expect(isSkipWebTestsPath('README')).toBe(true);
    });

    it('returns true for CLAUDE.md files', () => {
      expect(isSkipWebTestsPath('CLAUDE.md')).toBe(true);
      expect(isSkipWebTestsPath('CLAUDE-core.md')).toBe(true);
    });
  });

  describe('tooling paths (WU-1255)', () => {
    it('returns true for tools/ paths', () => {
      expect(isSkipWebTestsPath('tools/wu-done.js')).toBe(true);
      expect(isSkipWebTestsPath('tools/lib/wu-constants.js')).toBe(true);
      assert.strictEqual(
        isSkipWebTestsPath('tools/lib/__tests__/wu-done-validators.test.js'),
        true
      );
    });

    it('returns true for scripts/ paths', () => {
      expect(isSkipWebTestsPath('scripts/deploy.sh')).toBe(true);
      expect(isSkipWebTestsPath('scripts/setup/init.js')).toBe(true);
    });
  });

  describe('application paths (should NOT skip tests)', () => {
    it('returns false for apps/web/ paths', () => {
      expect(isSkipWebTestsPath('apps/web/src/app/page.tsx')).toBe(false);
      expect(isSkipWebTestsPath('apps/web/src/lib/llm/service.ts')).toBe(false);
    });

    it('returns false for packages/ paths', () => {
      assert.strictEqual(
        isSkipWebTestsPath('packages/@exampleapp/application/src/index.ts'),
        false
      );
    });

    it('returns false for root config files', () => {
      expect(isSkipWebTestsPath('package.json')).toBe(false);
      expect(isSkipWebTestsPath('tsconfig.json')).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('handles null/undefined gracefully', () => {
      expect(isSkipWebTestsPath(null)).toBe(false);
      expect(isSkipWebTestsPath(undefined)).toBe(false);
    });

    it('handles empty string', () => {
      expect(isSkipWebTestsPath('')).toBe(false);
    });

    it('does not match partial prefixes', () => {
      // "toolsmith" starts with "tool" but is not "tools/"
      expect(isSkipWebTestsPath('toolsmith/code.ts')).toBe(false);
      // "documents" starts with "doc" but is not "docs/"
      expect(isSkipWebTestsPath('documents/file.md')).toBe(false);
    });
  });
});

describe('shouldSkipWebTests', () => {
  // This is the aggregate function that checks ALL code_paths
  it('returns true when ALL paths are skip-tests paths', async () => {
    const { shouldSkipWebTests } = await import('../path-classifiers.js');

    const docsOnly = ['docs/README.md', 'ai/onboarding/guide.md'];
    expect(shouldSkipWebTests(docsOnly)).toBe(true);

    const toolsOnly = ['tools/wu-done.js', 'tools/lib/helpers.js'];
    expect(shouldSkipWebTests(toolsOnly)).toBe(true);

    const mixed = ['docs/README.md', 'tools/wu-done.js'];
    expect(shouldSkipWebTests(mixed)).toBe(true);
  });

  it('returns false when ANY path requires tests', async () => {
    const { shouldSkipWebTests } = await import('../path-classifiers.js');

    const mixedWithApp = ['docs/README.md', 'apps/web/src/page.tsx'];
    expect(shouldSkipWebTests(mixedWithApp)).toBe(false);
  });

  it('returns false for empty array', async () => {
    const { shouldSkipWebTests } = await import('../path-classifiers.js');
    expect(shouldSkipWebTests([])).toBe(false);
  });

  it('returns false for null/undefined', async () => {
    const { shouldSkipWebTests } = await import('../path-classifiers.js');
    expect(shouldSkipWebTests(null)).toBe(false);
    expect(shouldSkipWebTests(undefined)).toBe(false);
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
    expect(result.success).toBe(true);
    expect(result.errors.length).toBe(0);
    expect(result.restored.length).toBe(2);
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
    expect(result.success).toBe(false);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0].name).toBe('file1');
    expect(result.restored.length).toBe(1);
    expect(result.restored[0]).toBe('file2');
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
    expect(result.success).toBe(false);
    expect(result.errors.length).toBe(3);
    expect(result.restored.length).toBe(0);

    // Check error messages are informative
    expect(result.errors[0].error.length > 0).toBeTruthy();
    expect(result.errors[1].error.length > 0).toBeTruthy();
    expect(result.errors[2].error.length > 0).toBeTruthy();
  });

  it('handles empty file list gracefully', () => {
    const result = rollbackFiles([]);

    expect(result.success).toBe(true);
    expect(result.errors.length).toBe(0);
    expect(result.restored.length).toBe(0);
  });

  it('includes error messages with file info for manual intervention', () => {
    // Setup: File that will fail
    const filesToRestore = [
      { name: 'backlog.md', path: join(testDir, 'no-dir', 'backlog.md'), content: 'content' },
    ];

    // Execute rollback
    const result = rollbackFiles(filesToRestore);

    // Assert error has all needed info for manual intervention
    expect(result.errors.length).toBe(1);
    const error = result.errors[0];
    expect(error.name).toBe('backlog.md');
    expect(error.path.includes('backlog.md')).toBe(true);
    expect(typeof error.error === 'string').toBeTruthy();
  });
});

describe('RollbackResult', () => {
  it('correctly reports success when all files restored', () => {
    const result = new RollbackResult();
    result.addSuccess('file1');
    result.addSuccess('file2');

    expect(result.success).toBe(true);
    expect(result.restored.length).toBe(2);
  });

  it('correctly reports failure when any error', () => {
    const result = new RollbackResult();
    result.addSuccess('file1');
    result.addError('file2', '/path/file2', 'ENOENT');

    expect(result.success).toBe(false);
    expect(result.restored.length).toBe(1);
    expect(result.errors.length).toBe(1);
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
    const { validateCodePathsExist } = await import('../wu-done-validators.js');

    const doc = { id: 'WU-1351', code_paths: [] };
    const result = await validateCodePathsExist(doc, 'WU-1351');

    expect(result.valid).toBe(true);
    expect(result.errors.length).toBe(0);
    expect(result.missing.length).toBe(0);
  });

  it('should pass validation when code_paths is undefined', async () => {
    const { validateCodePathsExist } = await import('../wu-done-validators.js');

    const doc = { id: 'WU-1351' };
    const result = await validateCodePathsExist(doc, 'WU-1351');

    expect(result.valid).toBe(true);
  });

  it('should pass when all files exist in worktree', async () => {
    const { validateCodePathsExist } = await import('../wu-done-validators.js');

    // Create test files
    const file1 = join(testDir, 'file1.js');
    const file2 = join(testDir, 'file2.js');
    writeFileSync(file1, 'content1');
    writeFileSync(file2, 'content2');

    const doc = {
      id: 'WU-1351',
      code_paths: ['file1.js', 'file2.js'],
    };

    const result = await validateCodePathsExist(doc, 'WU-1351', {
      worktreePath: testDir,
    });

    expect(result.valid).toBe(true);
    expect(result.missing.length).toBe(0);
  });

  it('should fail when files are missing from worktree', async () => {
    const { validateCodePathsExist } = await import('../wu-done-validators.js');

    // Create only one file
    const file1 = join(testDir, 'existing-file.js');
    writeFileSync(file1, 'content');

    const doc = {
      id: 'WU-1351',
      code_paths: ['existing-file.js', 'missing-file.js'],
    };

    const result = await validateCodePathsExist(doc, 'WU-1351', {
      worktreePath: testDir,
    });

    expect(result.valid).toBe(false);
    expect(result.missing.includes('missing-file.js')).toBe(true);
    expect(result.errors[0].includes('code_paths validation failed')).toBe(true);
  });

  it('should report all missing files in error', async () => {
    const { validateCodePathsExist } = await import('../wu-done-validators.js');

    const doc = {
      id: 'WU-1351',
      code_paths: ['missing1.js', 'missing2.js', 'missing3.js'],
    };

    const result = await validateCodePathsExist(doc, 'WU-1351', {
      worktreePath: testDir,
    });

    expect(result.valid).toBe(false);
    expect(result.missing.length).toBe(3);
    expect(result.errors[0].includes('missing1.js')).toBe(true);
    expect(result.errors[0].includes('missing2.js')).toBe(true);
    expect(result.errors[0].includes('missing3.js')).toBe(true);
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
    const { validatePostMutation } = await import('../wu-done-validators.js');

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

    expect(result.valid).toBe(true);
    expect(result.errors.length).toBe(0);
  });

  it('should fail when completed_at is missing', async () => {
    const { validatePostMutation } = await import('../wu-done-validators.js');

    // Create WU YAML WITHOUT completed_at
    const yamlMissingCompletedAt = `id: WU-1617
title: Test WU
status: done
locked: true
`;
    writeFileSync(wuPath, yamlMissingCompletedAt);
    writeFileSync(stampPath, 'WU WU-1617 — Test WU\nCompleted: 2025-01-01\n');

    const result = validatePostMutation({ id: 'WU-1617', wuPath, stampPath });

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('completed_at'))).toBeTruthy();
  });

  it('should fail when locked is missing', async () => {
    const { validatePostMutation } = await import('../wu-done-validators.js');

    // Create WU YAML WITHOUT locked
    const yamlMissingLocked = `id: WU-1617
title: Test WU
status: done
completed_at: ${new Date().toISOString()}
`;
    writeFileSync(wuPath, yamlMissingLocked);
    writeFileSync(stampPath, 'WU WU-1617 — Test WU\nCompleted: 2025-01-01\n');

    const result = validatePostMutation({ id: 'WU-1617', wuPath, stampPath });

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('locked'))).toBeTruthy();
  });

  it('should fail when locked is false', async () => {
    const { validatePostMutation } = await import('../wu-done-validators.js');

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

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('locked'))).toBeTruthy();
  });

  it('should fail when stamp file is missing', async () => {
    const { validatePostMutation } = await import('../wu-done-validators.js');

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

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Stamp file'))).toBeTruthy();
  });

  it('should fail when WU YAML file is missing', async () => {
    const { validatePostMutation } = await import('../wu-done-validators.js');

    // Create stamp file but no WU YAML
    writeFileSync(stampPath, 'WU WU-1617 — Test WU\nCompleted: 2025-01-01\n');
    // Intentionally NOT creating WU YAML

    const result = validatePostMutation({ id: 'WU-1617', wuPath, stampPath });

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('not found'))).toBeTruthy();
  });

  it('should fail when status is not done', async () => {
    const { validatePostMutation } = await import('../wu-done-validators.js');

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

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('status'))).toBeTruthy();
  });

  it('should fail when completed_at is invalid datetime', async () => {
    const { validatePostMutation } = await import('../wu-done-validators.js');

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

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Invalid completed_at'))).toBeTruthy();
  });

  it('should report multiple validation errors at once', async () => {
    const { validatePostMutation } = await import('../wu-done-validators.js');

    // Create WU YAML missing multiple fields
    const yamlMultipleMissing = `id: WU-1617
title: Test WU
status: in_progress
`;
    writeFileSync(wuPath, yamlMultipleMissing);
    // No stamp file either

    const result = validatePostMutation({ id: 'WU-1617', wuPath, stampPath });

    expect(result.valid).toBe(false);
    // Should report at least 3 errors: stamp file, completed_at, locked, status
    expect(result.errors.length >= 3).toBeTruthy();
  });
});
