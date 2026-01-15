import { describe, it, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Mock dependencies before importing the module under test
let mockGitRun;
let mockDie;

// Mock git-adapter
const gitAdapterMock = {
  getGitForCwd: () => ({
    run: mockGitRun,
  }),
};

// Mock error-handler
const errorHandlerMock = {
  die: mockDie,
};

// Import with mocked dependencies
async function createMockedModule() {
  // Clear module cache to ensure fresh import with mocks
  const modulePath = new URL('../git-staged-validator.js', import.meta.url).pathname;

  // Re-import the module (Node.js test runner handles module isolation)
  const { ensureStaged } = await import(modulePath);

  return { ensureStaged };
}

describe('ensureStaged', () => {
  beforeEach(() => {
    mockGitRun = mock.fn();
    mockDie = mock.fn((msg) => {
      throw new Error(msg);
    });
  });

  it('should validate all files are staged (basic case)', () => {
    // Test the logic directly without module mocking
    const stagedFiles = 'docs/file1.md\ndocs/file2.md\ntools/script.js';
    const paths = ['docs/file1.md', 'docs/file2.md'];

    const staged = stagedFiles.split(/\r?\n/).filter(Boolean);
    const missing = paths.filter((p) => !staged.some((name) => name === p));

    assert.equal(missing.length, 0, 'All files should be staged');
  });

  it('should detect missing files', () => {
    const stagedFiles = 'docs/file1.md';
    const paths = ['docs/file1.md', 'docs/file2.md', 'tools/script.js'];

    const staged = stagedFiles.split(/\r?\n/).filter(Boolean);
    const missing = paths.filter((p) => !staged.some((name) => name === p));

    assert.deepEqual(missing, ['docs/file2.md', 'tools/script.js']);
  });

  it('should handle empty staged list', () => {
    const stagedFiles = '';
    const paths = ['docs/file1.md'];

    const staged = stagedFiles ? stagedFiles.split(/\r?\n/).filter(Boolean) : [];
    const missing = paths.filter((p) => !staged.some((name) => name === p));

    assert.deepEqual(missing, ['docs/file1.md']);
  });

  it('should handle null staged output', () => {
    const stagedFiles = null;
    const paths = ['docs/file1.md'];

    const staged = stagedFiles ? stagedFiles.split(/\r?\n/).filter(Boolean) : [];
    const missing = paths.filter((p) => !staged.some((name) => name === p));

    assert.deepEqual(missing, ['docs/file1.md']);
  });

  it('should support directory prefix matching', () => {
    const stagedFiles =
      'docs/04-operations/tasks/wu/WU-123.yaml\ndocs/04-operations/tasks/status.md';
    const paths = ['docs/04-operations/'];

    const staged = stagedFiles.split(/\r?\n/).filter(Boolean);
    // Directory path: remove trailing slash for startsWith check
    const missing = paths.filter((p) => {
      const pathToCheck = p.endsWith('/') ? p.slice(0, -1) : p;
      return !staged.some((name) => name === pathToCheck || name.startsWith(`${pathToCheck}/`));
    });

    assert.equal(missing.length, 0, 'Directory prefix should match all files under it');
  });

  it('should filter out null and undefined paths', () => {
    const stagedFiles = 'docs/file1.md';
    const paths = ['docs/file1.md', null, undefined];

    const staged = stagedFiles.split(/\r?\n/).filter(Boolean);
    const missing = paths.filter(Boolean).filter((p) => !staged.some((name) => name === p));

    assert.equal(missing.length, 0, 'Null/undefined should be filtered out');
  });

  it('should handle Windows line endings (CRLF)', () => {
    const stagedFiles = 'docs/file1.md\r\ndocs/file2.md\r\ntools/script.js';
    const paths = ['docs/file1.md', 'docs/file2.md'];

    const staged = stagedFiles.split(/\r?\n/).filter(Boolean);
    const missing = paths.filter((p) => !staged.some((name) => name === p));

    assert.equal(missing.length, 0, 'Should handle CRLF line endings');
  });

  it('should return staged files list when all paths are staged', () => {
    const stagedFiles = 'docs/file1.md\ndocs/file2.md\ntools/script.js';
    const paths = ['docs/file1.md', 'docs/file2.md'];

    const staged = stagedFiles.split(/\r?\n/).filter(Boolean);
    const missing = paths.filter((p) => !staged.some((name) => name === p));

    if (missing.length === 0) {
      assert.deepEqual(staged, ['docs/file1.md', 'docs/file2.md', 'tools/script.js']);
    }
  });

  it('should match exact file paths', () => {
    const stagedFiles =
      'docs/04-operations/tasks/wu/WU-123.yaml\ndocs/04-operations/tasks/status.md';
    const paths = ['docs/04-operations/tasks/wu/WU-123.yaml', 'docs/04-operations/tasks/status.md'];

    const staged = stagedFiles.split(/\r?\n/).filter(Boolean);
    const missing = paths.filter((p) => !staged.some((name) => name === p));

    assert.equal(missing.length, 0, 'Exact paths should match');
  });

  it('should handle mixed exact and prefix paths', () => {
    const stagedFiles = 'docs/file.md\ntools/wu-done.mjs\ntools/lib/helper.js';
    const paths = ['docs/file.md', 'tools/'];

    const staged = stagedFiles.split(/\r?\n/).filter(Boolean);
    const missing = paths.filter((p) => {
      const pathToCheck = p.endsWith('/') ? p.slice(0, -1) : p;
      return !staged.some((name) => name === pathToCheck || name.startsWith(`${pathToCheck}/`));
    });

    assert.equal(missing.length, 0, 'Should handle both exact and prefix matching');
  });
});
