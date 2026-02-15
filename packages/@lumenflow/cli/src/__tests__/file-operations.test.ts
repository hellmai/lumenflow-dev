/**
 * @file file-operations.test.ts
 * @description Tests for file operation CLI commands (WU-1108)
 *
 * File operations provide audited file access with:
 * - Scope checking against WU code_paths
 * - Worktree guard for write operations
 *
 * TDD: RED phase - these tests define expected behavior before implementation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync } from 'node:fs';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

// Test imports - these will fail until implementation exists (RED phase)
// We'll import them individually to test each module
import {
  readFileWithAudit,
  parseFileReadArgs,
  FILE_READ_DEFAULTS,
  type FileReadResult,
  type FileReadArgs,
} from '../file-read.js';

import {
  writeFileWithAudit,
  parseFileWriteArgs,
  FILE_WRITE_DEFAULTS,
  type FileWriteResult,
  type FileWriteArgs,
} from '../file-write.js';

import {
  editFileWithAudit,
  parseFileEditArgs,
  FILE_EDIT_DEFAULTS,
  type FileEditResult,
  type FileEditArgs,
} from '../file-edit.js';

import {
  deleteFileWithAudit,
  parseFileDeleteArgs,
  FILE_DELETE_DEFAULTS,
  type FileDeleteResult,
  type FileDeleteArgs,
} from '../file-delete.js';

// ============================================================================
// FILE-READ TESTS
// ============================================================================

describe('file-read CLI', () => {
  describe('source file existence', () => {
    it('should have the CLI source file', () => {
      const srcPath = join(__dirname, '../file-read.ts');
      expect(existsSync(srcPath)).toBe(true);
    });

    it('should be buildable (dist file exists after build)', () => {
      const distPath = join(__dirname, '../../dist/file-read.js');
      expect(existsSync(distPath)).toBe(true);
    });
  });

  describe('FILE_READ_DEFAULTS', () => {
    it('should have default max file size', () => {
      expect(FILE_READ_DEFAULTS.maxFileSizeBytes).toBeTypeOf('number');
      expect(FILE_READ_DEFAULTS.maxFileSizeBytes).toBeGreaterThan(0);
    });

    it('should have default encoding', () => {
      expect(FILE_READ_DEFAULTS.encoding).toBe('utf-8');
    });
  });

  describe('parseFileReadArgs', () => {
    it('should parse path argument', () => {
      const args = parseFileReadArgs(['node', 'file-read', 'src/index.ts']);
      expect(args.path).toBe('src/index.ts');
    });

    it('should parse --path option', () => {
      const args = parseFileReadArgs(['node', 'file-read', '--path', 'src/utils.ts']);
      expect(args.path).toBe('src/utils.ts');
    });

    it('should parse --encoding option', () => {
      const args = parseFileReadArgs([
        'node',
        'file-read',
        '--path',
        'file.txt',
        '--encoding',
        'latin1',
      ]);
      expect(args.encoding).toBe('latin1');
    });

    it('should parse --start-line option', () => {
      const args = parseFileReadArgs([
        'node',
        'file-read',
        '--path',
        'file.txt',
        '--start-line',
        '10',
      ]);
      expect(args.startLine).toBe(10);
    });

    it('should parse --end-line option', () => {
      const args = parseFileReadArgs([
        'node',
        'file-read',
        '--path',
        'file.txt',
        '--end-line',
        '50',
      ]);
      expect(args.endLine).toBe(50);
    });

    it('should parse --help flag', () => {
      const args = parseFileReadArgs(['node', 'file-read', '--help']);
      expect(args.help).toBe(true);
    });

    it('should require path argument', () => {
      const args = parseFileReadArgs(['node', 'file-read']);
      expect(args.path).toBeUndefined();
    });
  });

  describe('readFileWithAudit', () => {
    let tempDir: string;

    beforeEach(async () => {
      tempDir = join(tmpdir(), `file-read-test-${Date.now()}`);
      await mkdir(tempDir, { recursive: true });
    });

    afterEach(async () => {
      await rm(tempDir, { recursive: true, force: true });
    });

    it('should read file content successfully', async () => {
      const testFile = join(tempDir, 'test.txt');
      await writeFile(testFile, 'Hello, World!', 'utf-8');

      const result = await readFileWithAudit({ path: testFile });

      expect(result.success).toBe(true);
      expect(result.content).toBe('Hello, World!');
    });

    it('should return error for non-existent file', async () => {
      const result = await readFileWithAudit({ path: join(tempDir, 'nonexistent.txt') });

      expect(result.success).toBe(false);
      expect(result.error).toContain('ENOENT');
    });

    it('should support line range reading', async () => {
      const testFile = join(tempDir, 'multiline.txt');
      await writeFile(testFile, 'line1\nline2\nline3\nline4\nline5', 'utf-8');

      const result = await readFileWithAudit({ path: testFile, startLine: 2, endLine: 4 });

      expect(result.success).toBe(true);
      expect(result.content).toBe('line2\nline3\nline4');
    });

    it('should return file metadata', async () => {
      const testFile = join(tempDir, 'metadata.txt');
      await writeFile(testFile, 'Test content', 'utf-8');

      const result = await readFileWithAudit({ path: testFile });

      expect(result.success).toBe(true);
      expect(result.metadata).toBeDefined();
      expect(result.metadata?.sizeBytes).toBeGreaterThan(0);
      expect(result.metadata?.lineCount).toBeGreaterThan(0);
    });

    it('should respect max file size limit', async () => {
      const testFile = join(tempDir, 'large.txt');
      await writeFile(testFile, 'x'.repeat(1024 * 1024), 'utf-8'); // 1MB

      const result = await readFileWithAudit({
        path: testFile,
        maxFileSizeBytes: 1024, // 1KB limit
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('exceeds');
    });

    it('should include audit metadata in result', async () => {
      const testFile = join(tempDir, 'audit.txt');
      await writeFile(testFile, 'Audit test', 'utf-8');

      const result = await readFileWithAudit({ path: testFile });

      expect(result.success).toBe(true);
      expect(result.auditLog).toBeDefined();
      expect(result.auditLog?.operation).toBe('read');
      expect(result.auditLog?.path).toBe(testFile);
    });
  });
});

// ============================================================================
// FILE-WRITE TESTS
// ============================================================================

describe('file-write CLI', () => {
  describe('source file existence', () => {
    it('should have the CLI source file', () => {
      const srcPath = join(__dirname, '../file-write.ts');
      expect(existsSync(srcPath)).toBe(true);
    });

    it('should be buildable (dist file exists after build)', () => {
      const distPath = join(__dirname, '../../dist/file-write.js');
      expect(existsSync(distPath)).toBe(true);
    });
  });

  describe('FILE_WRITE_DEFAULTS', () => {
    it('should have default encoding', () => {
      expect(FILE_WRITE_DEFAULTS.encoding).toBe('utf-8');
    });

    it('should have default createDirectories option', () => {
      expect(FILE_WRITE_DEFAULTS.createDirectories).toBe(true);
    });
  });

  describe('parseFileWriteArgs', () => {
    it('should parse path argument', () => {
      const args = parseFileWriteArgs(['node', 'file-write', 'output.txt', '--content', 'Hello']);
      expect(args.path).toBe('output.txt');
    });

    it('should parse --path option', () => {
      const args = parseFileWriteArgs([
        'node',
        'file-write',
        '--path',
        'output.txt',
        '--content',
        'Hello',
      ]);
      expect(args.path).toBe('output.txt');
    });

    it('should parse --content option', () => {
      const args = parseFileWriteArgs([
        'node',
        'file-write',
        '--path',
        'file.txt',
        '--content',
        'Test content',
      ]);
      expect(args.content).toBe('Test content');
    });

    it('should parse --encoding option', () => {
      const args = parseFileWriteArgs([
        'node',
        'file-write',
        '--path',
        'file.txt',
        '--content',
        'x',
        '--encoding',
        'latin1',
      ]);
      expect(args.encoding).toBe('latin1');
    });

    it('should parse --no-create-dirs flag', () => {
      const args = parseFileWriteArgs([
        'node',
        'file-write',
        '--path',
        'file.txt',
        '--content',
        'x',
        '--no-create-dirs',
      ]);
      expect(args.createDirectories).toBe(false);
    });

    it('should parse --help flag', () => {
      const args = parseFileWriteArgs(['node', 'file-write', '--help']);
      expect(args.help).toBe(true);
    });

    it('should require path and content', () => {
      const args = parseFileWriteArgs(['node', 'file-write']);
      expect(args.path).toBeUndefined();
      expect(args.content).toBeUndefined();
    });
  });

  describe('writeFileWithAudit', () => {
    let tempDir: string;

    beforeEach(async () => {
      tempDir = join(tmpdir(), `file-write-test-${Date.now()}`);
      await mkdir(tempDir, { recursive: true });
    });

    afterEach(async () => {
      await rm(tempDir, { recursive: true, force: true });
    });

    it('should write file content successfully', async () => {
      const testFile = join(tempDir, 'output.txt');

      const result = await writeFileWithAudit({
        path: testFile,
        content: 'New content',
      });

      expect(result.success).toBe(true);
      expect(existsSync(testFile)).toBe(true);
    });

    it('should create parent directories', async () => {
      const testFile = join(tempDir, 'nested', 'deep', 'output.txt');

      const result = await writeFileWithAudit({
        path: testFile,
        content: 'Nested content',
        createDirectories: true,
      });

      expect(result.success).toBe(true);
      expect(existsSync(testFile)).toBe(true);
    });

    it('should fail when createDirectories is false and parent does not exist', async () => {
      const testFile = join(tempDir, 'nonexistent', 'output.txt');

      const result = await writeFileWithAudit({
        path: testFile,
        content: 'Content',
        createDirectories: false,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('ENOENT');
    });

    it('should return bytes written metadata', async () => {
      const testFile = join(tempDir, 'metadata.txt');
      const content = 'Test content for metadata';

      const result = await writeFileWithAudit({
        path: testFile,
        content,
      });

      expect(result.success).toBe(true);
      expect(result.metadata?.bytesWritten).toBe(Buffer.byteLength(content, 'utf-8'));
    });

    it('should include audit metadata in result', async () => {
      const testFile = join(tempDir, 'audit.txt');

      const result = await writeFileWithAudit({
        path: testFile,
        content: 'Audit test',
      });

      expect(result.success).toBe(true);
      expect(result.auditLog).toBeDefined();
      expect(result.auditLog?.operation).toBe('write');
      expect(result.auditLog?.path).toBe(testFile);
    });

  });
});

// ============================================================================
// FILE-EDIT TESTS
// ============================================================================

describe('file-edit CLI', () => {
  describe('source file existence', () => {
    it('should have the CLI source file', () => {
      const srcPath = join(__dirname, '../file-edit.ts');
      expect(existsSync(srcPath)).toBe(true);
    });

    it('should be buildable (dist file exists after build)', () => {
      const distPath = join(__dirname, '../../dist/file-edit.js');
      expect(existsSync(distPath)).toBe(true);
    });
  });

  describe('FILE_EDIT_DEFAULTS', () => {
    it('should have default encoding', () => {
      expect(FILE_EDIT_DEFAULTS.encoding).toBe('utf-8');
    });

    it('should have default replaceAll option', () => {
      expect(FILE_EDIT_DEFAULTS.replaceAll).toBe(false);
    });
  });

  describe('parseFileEditArgs', () => {
    it('should parse path argument', () => {
      const args = parseFileEditArgs([
        'node',
        'file-edit',
        'file.txt',
        '--old',
        'foo',
        '--new',
        'bar',
      ]);
      expect(args.path).toBe('file.txt');
    });

    it('should parse --path option', () => {
      const args = parseFileEditArgs([
        'node',
        'file-edit',
        '--path',
        'file.txt',
        '--old',
        'foo',
        '--new',
        'bar',
      ]);
      expect(args.path).toBe('file.txt');
    });

    it('should parse --old-string option', () => {
      const args = parseFileEditArgs([
        'node',
        'file-edit',
        '--path',
        'file.txt',
        '--old-string',
        'old text',
        '--new-string',
        'new text',
      ]);
      expect(args.oldString).toBe('old text');
    });

    it('should parse --new-string option', () => {
      const args = parseFileEditArgs([
        'node',
        'file-edit',
        '--path',
        'file.txt',
        '--old-string',
        'old',
        '--new-string',
        'new value',
      ]);
      expect(args.newString).toBe('new value');
    });

    it('should parse --replace-all flag', () => {
      const args = parseFileEditArgs([
        'node',
        'file-edit',
        '--path',
        'file.txt',
        '--old',
        'x',
        '--new',
        'y',
        '--replace-all',
      ]);
      expect(args.replaceAll).toBe(true);
    });

    it('should parse --help flag', () => {
      const args = parseFileEditArgs(['node', 'file-edit', '--help']);
      expect(args.help).toBe(true);
    });

    it('should require path, old-string, and new-string', () => {
      const args = parseFileEditArgs(['node', 'file-edit']);
      expect(args.path).toBeUndefined();
      expect(args.oldString).toBeUndefined();
      expect(args.newString).toBeUndefined();
    });
  });

  describe('editFileWithAudit', () => {
    let tempDir: string;

    beforeEach(async () => {
      tempDir = join(tmpdir(), `file-edit-test-${Date.now()}`);
      await mkdir(tempDir, { recursive: true });
    });

    afterEach(async () => {
      await rm(tempDir, { recursive: true, force: true });
    });

    it('should replace string in file successfully', async () => {
      const testFile = join(tempDir, 'edit.txt');
      await writeFile(testFile, 'Hello, World!', 'utf-8');

      const result = await editFileWithAudit({
        path: testFile,
        oldString: 'World',
        newString: 'Universe',
      });

      expect(result.success).toBe(true);
      expect(result.replacements).toBe(1);
    });

    it('should return error for non-existent file', async () => {
      const result = await editFileWithAudit({
        path: join(tempDir, 'nonexistent.txt'),
        oldString: 'foo',
        newString: 'bar',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('ENOENT');
    });

    it('should return error when old string not found', async () => {
      const testFile = join(tempDir, 'nofind.txt');
      await writeFile(testFile, 'Hello, World!', 'utf-8');

      const result = await editFileWithAudit({
        path: testFile,
        oldString: 'NotFound',
        newString: 'Replacement',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should return error when old string is not unique (without replaceAll)', async () => {
      const testFile = join(tempDir, 'multiple.txt');
      await writeFile(testFile, 'foo bar foo baz foo', 'utf-8');

      const result = await editFileWithAudit({
        path: testFile,
        oldString: 'foo',
        newString: 'qux',
        replaceAll: false,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not unique');
    });

    it('should replace all occurrences when replaceAll is true', async () => {
      const testFile = join(tempDir, 'replaceall.txt');
      await writeFile(testFile, 'foo bar foo baz foo', 'utf-8');

      const result = await editFileWithAudit({
        path: testFile,
        oldString: 'foo',
        newString: 'qux',
        replaceAll: true,
      });

      expect(result.success).toBe(true);
      expect(result.replacements).toBe(3);
    });

    it('should include audit metadata in result', async () => {
      const testFile = join(tempDir, 'audit.txt');
      await writeFile(testFile, 'Original content', 'utf-8');

      const result = await editFileWithAudit({
        path: testFile,
        oldString: 'Original',
        newString: 'Modified',
      });

      expect(result.success).toBe(true);
      expect(result.auditLog).toBeDefined();
      expect(result.auditLog?.operation).toBe('edit');
      expect(result.auditLog?.path).toBe(testFile);
    });

    it('should return diff preview', async () => {
      const testFile = join(tempDir, 'diff.txt');
      await writeFile(testFile, 'Hello, World!', 'utf-8');

      const result = await editFileWithAudit({
        path: testFile,
        oldString: 'World',
        newString: 'Universe',
      });

      expect(result.success).toBe(true);
      expect(result.diff).toBeDefined();
    });
  });
});

// ============================================================================
// FILE-DELETE TESTS
// ============================================================================

describe('file-delete CLI', () => {
  describe('source file existence', () => {
    it('should have the CLI source file', () => {
      const srcPath = join(__dirname, '../file-delete.ts');
      expect(existsSync(srcPath)).toBe(true);
    });

    it('should be buildable (dist file exists after build)', () => {
      const distPath = join(__dirname, '../../dist/file-delete.js');
      expect(existsSync(distPath)).toBe(true);
    });
  });

  describe('FILE_DELETE_DEFAULTS', () => {
    it('should have default recursive option', () => {
      expect(FILE_DELETE_DEFAULTS.recursive).toBe(false);
    });

    it('should have default force option', () => {
      expect(FILE_DELETE_DEFAULTS.force).toBe(false);
    });
  });

  describe('parseFileDeleteArgs', () => {
    it('should parse path argument', () => {
      const args = parseFileDeleteArgs(['node', 'file-delete', 'file.txt']);
      expect(args.path).toBe('file.txt');
    });

    it('should parse --path option', () => {
      const args = parseFileDeleteArgs(['node', 'file-delete', '--path', 'file.txt']);
      expect(args.path).toBe('file.txt');
    });

    it('should parse --recursive flag', () => {
      const args = parseFileDeleteArgs(['node', 'file-delete', '--path', 'dir/', '--recursive']);
      expect(args.recursive).toBe(true);
    });

    it('should parse -r shorthand for recursive', () => {
      const args = parseFileDeleteArgs(['node', 'file-delete', '--path', 'dir/', '-r']);
      expect(args.recursive).toBe(true);
    });

    it('should parse --force flag', () => {
      const args = parseFileDeleteArgs(['node', 'file-delete', '--path', 'file.txt', '--force']);
      expect(args.force).toBe(true);
    });

    it('should parse -f shorthand for force', () => {
      const args = parseFileDeleteArgs(['node', 'file-delete', '--path', 'file.txt', '-f']);
      expect(args.force).toBe(true);
    });

    it('should parse --help flag', () => {
      const args = parseFileDeleteArgs(['node', 'file-delete', '--help']);
      expect(args.help).toBe(true);
    });

    it('should require path argument', () => {
      const args = parseFileDeleteArgs(['node', 'file-delete']);
      expect(args.path).toBeUndefined();
    });
  });

  describe('deleteFileWithAudit', () => {
    let tempDir: string;

    beforeEach(async () => {
      tempDir = join(tmpdir(), `file-delete-test-${Date.now()}`);
      await mkdir(tempDir, { recursive: true });
    });

    afterEach(async () => {
      await rm(tempDir, { recursive: true, force: true });
    });

    it('should delete file successfully', async () => {
      const testFile = join(tempDir, 'delete.txt');
      await writeFile(testFile, 'Content to delete', 'utf-8');

      const result = await deleteFileWithAudit({ path: testFile });

      expect(result.success).toBe(true);
      expect(existsSync(testFile)).toBe(false);
    });

    it('should return error for non-existent file (without force)', async () => {
      const result = await deleteFileWithAudit({
        path: join(tempDir, 'nonexistent.txt'),
        force: false,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('ENOENT');
    });

    it('should succeed for non-existent file with force option', async () => {
      const result = await deleteFileWithAudit({
        path: join(tempDir, 'nonexistent.txt'),
        force: true,
      });

      expect(result.success).toBe(true);
    });

    it('should delete directory recursively', async () => {
      const nestedDir = join(tempDir, 'nested');
      await mkdir(nestedDir, { recursive: true });
      await writeFile(join(nestedDir, 'file1.txt'), 'Content 1', 'utf-8');
      await writeFile(join(nestedDir, 'file2.txt'), 'Content 2', 'utf-8');

      const result = await deleteFileWithAudit({
        path: nestedDir,
        recursive: true,
      });

      expect(result.success).toBe(true);
      expect(existsSync(nestedDir)).toBe(false);
    });

    it('should fail to delete non-empty directory without recursive', async () => {
      const nestedDir = join(tempDir, 'nonempty');
      await mkdir(nestedDir, { recursive: true });
      await writeFile(join(nestedDir, 'file.txt'), 'Content', 'utf-8');

      const result = await deleteFileWithAudit({
        path: nestedDir,
        recursive: false,
      });

      expect(result.success).toBe(false);
    });

    it('should include audit metadata in result', async () => {
      const testFile = join(tempDir, 'audit.txt');
      await writeFile(testFile, 'Audit content', 'utf-8');

      const result = await deleteFileWithAudit({ path: testFile });

      expect(result.success).toBe(true);
      expect(result.auditLog).toBeDefined();
      expect(result.auditLog?.operation).toBe('delete');
      expect(result.auditLog?.path).toBe(testFile);
    });

    it('should return deleted item count for directories', async () => {
      const nestedDir = join(tempDir, 'count');
      await mkdir(join(nestedDir, 'subdir'), { recursive: true });
      await writeFile(join(nestedDir, 'file1.txt'), 'Content 1', 'utf-8');
      await writeFile(join(nestedDir, 'subdir', 'file2.txt'), 'Content 2', 'utf-8');

      const result = await deleteFileWithAudit({
        path: nestedDir,
        recursive: true,
      });

      expect(result.success).toBe(true);
      expect(result.metadata?.deletedCount).toBeGreaterThan(0);
    });
  });
});

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe('file operations integration', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `file-ops-integration-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('should support read-edit-write workflow', async () => {
    const testFile = join(tempDir, 'workflow.txt');

    // Write initial content
    const writeResult = await writeFileWithAudit({
      path: testFile,
      content: 'Hello, World!',
    });
    expect(writeResult.success).toBe(true);

    // Read content
    const readResult = await readFileWithAudit({ path: testFile });
    expect(readResult.success).toBe(true);
    expect(readResult.content).toBe('Hello, World!');

    // Edit content
    const editResult = await editFileWithAudit({
      path: testFile,
      oldString: 'World',
      newString: 'Universe',
    });
    expect(editResult.success).toBe(true);

    // Verify edit
    const verifyResult = await readFileWithAudit({ path: testFile });
    expect(verifyResult.success).toBe(true);
    expect(verifyResult.content).toBe('Hello, Universe!');

    // Delete file
    const deleteResult = await deleteFileWithAudit({ path: testFile });
    expect(deleteResult.success).toBe(true);
    expect(existsSync(testFile)).toBe(false);
  });

  it('should handle unicode content correctly', async () => {
    const testFile = join(tempDir, 'unicode.txt');
    const unicodeContent = 'Hello, \u4e16\u754c! \u{1F600}'; // Hello, World in Chinese + emoji

    const writeResult = await writeFileWithAudit({
      path: testFile,
      content: unicodeContent,
    });
    expect(writeResult.success).toBe(true);

    const readResult = await readFileWithAudit({ path: testFile });
    expect(readResult.success).toBe(true);
    expect(readResult.content).toBe(unicodeContent);
  });

  it('should handle binary-like content', async () => {
    const testFile = join(tempDir, 'binary.dat');
    // Create content with null bytes and special characters
    const binaryContent = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe]).toString('latin1');

    const writeResult = await writeFileWithAudit({
      path: testFile,
      content: binaryContent,
      encoding: 'latin1',
    });
    expect(writeResult.success).toBe(true);

    const readResult = await readFileWithAudit({
      path: testFile,
      encoding: 'latin1',
    });
    expect(readResult.success).toBe(true);
  });
});

// ============================================================================
// ADDITIONAL EDGE CASE TESTS FOR COVERAGE
// ============================================================================

describe('file operations edge cases', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `file-ops-edge-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('readFileWithAudit edge cases', () => {
    it('should return error when path is empty', async () => {
      const result = await readFileWithAudit({ path: '' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('required');
    });

    it('should return error when path is undefined', async () => {
      const result = await readFileWithAudit({});
      expect(result.success).toBe(false);
      expect(result.error).toContain('required');
    });

    it('should handle only startLine specified', async () => {
      const testFile = join(tempDir, 'startonly.txt');
      await writeFile(testFile, 'line1\nline2\nline3\nline4', 'utf-8');

      const result = await readFileWithAudit({ path: testFile, startLine: 3 });

      expect(result.success).toBe(true);
      expect(result.content).toBe('line3\nline4');
    });

    it('should handle only endLine specified', async () => {
      const testFile = join(tempDir, 'endonly.txt');
      await writeFile(testFile, 'line1\nline2\nline3\nline4', 'utf-8');

      const result = await readFileWithAudit({ path: testFile, endLine: 2 });

      expect(result.success).toBe(true);
      expect(result.content).toBe('line1\nline2');
    });

    it('should use default max file size when not specified', async () => {
      const testFile = join(tempDir, 'default.txt');
      await writeFile(testFile, 'small content', 'utf-8');

      const result = await readFileWithAudit({ path: testFile });

      expect(result.success).toBe(true);
    });
  });

  describe('writeFileWithAudit edge cases', () => {
    it('should return error when path is empty', async () => {
      const result = await writeFileWithAudit({ path: '', content: 'test' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('required');
    });

    it('should write empty content successfully', async () => {
      const testFile = join(tempDir, 'empty.txt');

      const result = await writeFileWithAudit({ path: testFile, content: '' });

      expect(result.success).toBe(true);
      expect(result.metadata?.bytesWritten).toBe(0);
    });

    it('should write when content is undefined (defaults to empty)', async () => {
      const testFile = join(tempDir, 'undefined-content.txt');

      const result = await writeFileWithAudit({ path: testFile });

      expect(result.success).toBe(true);
      expect(result.metadata?.bytesWritten).toBe(0);
    });

    it('should use default encoding when not specified', async () => {
      const testFile = join(tempDir, 'default-enc.txt');

      const result = await writeFileWithAudit({
        path: testFile,
        content: 'test content',
      });

      expect(result.success).toBe(true);
    });
  });

  describe('editFileWithAudit edge cases', () => {
    it('should return error when path is empty', async () => {
      const result = await editFileWithAudit({
        path: '',
        oldString: 'old',
        newString: 'new',
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('required');
    });

    it('should return error when oldString is empty', async () => {
      const testFile = join(tempDir, 'noolstr.txt');
      await writeFile(testFile, 'content', 'utf-8');

      const result = await editFileWithAudit({
        path: testFile,
        oldString: '',
        newString: 'new',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('required');
    });

    it('should allow empty newString (deletion)', async () => {
      const testFile = join(tempDir, 'deletion.txt');
      await writeFile(testFile, 'Hello, World!', 'utf-8');

      const result = await editFileWithAudit({
        path: testFile,
        oldString: 'World',
        newString: '',
      });

      expect(result.success).toBe(true);
    });

    it('should handle very long strings in diff', async () => {
      const testFile = join(tempDir, 'longdiff.txt');
      const longContent = 'x'.repeat(200) + 'FIND_ME' + 'y'.repeat(200);
      await writeFile(testFile, longContent, 'utf-8');

      const result = await editFileWithAudit({
        path: testFile,
        oldString: 'FIND_ME',
        newString: 'REPLACED',
      });

      expect(result.success).toBe(true);
      expect(result.diff).toBeDefined();
    });
  });

  describe('deleteFileWithAudit edge cases', () => {
    it('should return error when path is empty', async () => {
      const result = await deleteFileWithAudit({ path: '' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('required');
    });

    it('should delete empty directory with recursive flag', async () => {
      const emptyDir = join(tempDir, 'emptydir');
      await mkdir(emptyDir, { recursive: true });

      const result = await deleteFileWithAudit({
        path: emptyDir,
        recursive: true,
      });

      expect(result.success).toBe(true);
      expect(result.metadata?.wasDirectory).toBe(true);
    });
  });

  describe('parseArgs edge cases', () => {
    it('parseFileReadArgs should handle --max-size option', () => {
      const args = parseFileReadArgs([
        'node',
        'file-read',
        '--path',
        'f.txt',
        '--max-size',
        '1024',
      ]);
      expect(args.maxFileSizeBytes).toBe(1024);
    });

    it('parseFileEditArgs should handle short options', () => {
      const args = parseFileEditArgs(['node', 'file-edit', 'f.txt', '--old', 'a', '--new', 'b']);
      expect(args.oldString).toBe('a');
      expect(args.newString).toBe('b');
    });

    it('parseFileDeleteArgs should handle combined short flags', () => {
      const args = parseFileDeleteArgs(['node', 'file-delete', '-r', '-f', 'dir/']);
      expect(args.recursive).toBe(true);
      expect(args.force).toBe(true);
    });

    it('parseFileEditArgs should handle --encoding option', () => {
      const args = parseFileEditArgs([
        'node',
        'file-edit',
        '--path',
        'f.txt',
        '--old',
        'a',
        '--new',
        'b',
        '--encoding',
        'latin1',
      ]);
      expect(args.encoding).toBe('latin1');
    });

    it('parseFileReadArgs should handle -h short help', () => {
      const args = parseFileReadArgs(['node', 'file-read', '-h']);
      expect(args.help).toBe(true);
    });

    it('parseFileWriteArgs should handle -h short help', () => {
      const args = parseFileWriteArgs(['node', 'file-write', '-h']);
      expect(args.help).toBe(true);
    });

    it('parseFileEditArgs should handle -h short help', () => {
      const args = parseFileEditArgs(['node', 'file-edit', '-h']);
      expect(args.help).toBe(true);
    });

    it('parseFileDeleteArgs should handle -h short help', () => {
      const args = parseFileDeleteArgs(['node', 'file-delete', '-h']);
      expect(args.help).toBe(true);
    });
  });
});
