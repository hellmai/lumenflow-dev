/**
 * @file merge-block.test.ts
 * Tests for merge block functionality (WU-1171)
 *
 * Tests the LUMENFLOW:START/END block insertion and update logic
 * that enables safe, idempotent merging of LumenFlow config into existing files.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// Import the functions we'll implement
import {
  detectLineEnding,
  extractMergeBlock,
  insertMergeBlock,
  updateMergeBlock,
  MergeBlockResult,
} from '../merge-block.js';

describe('merge-block', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-block-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('detectLineEnding', () => {
    it('should detect LF line endings', () => {
      const content = 'line1\nline2\nline3\n';
      expect(detectLineEnding(content)).toBe('\n');
    });

    it('should detect CRLF line endings', () => {
      const content = 'line1\r\nline2\r\nline3\r\n';
      expect(detectLineEnding(content)).toBe('\r\n');
    });

    it('should default to LF for empty content', () => {
      expect(detectLineEnding('')).toBe('\n');
    });

    it('should default to LF for content without line endings', () => {
      expect(detectLineEnding('single line')).toBe('\n');
    });

    it('should use majority line ending when mixed', () => {
      const content = 'line1\r\nline2\r\nline3\n';
      // 2 CRLF vs 1 LF, should detect CRLF
      expect(detectLineEnding(content)).toBe('\r\n');
    });
  });

  describe('extractMergeBlock', () => {
    it('should extract content between LUMENFLOW:START and LUMENFLOW:END markers', () => {
      const content = `# My Project

<!-- LUMENFLOW:START -->
This is LumenFlow content.
<!-- LUMENFLOW:END -->

Other content
`;
      const result = extractMergeBlock(content);
      expect(result.found).toBe(true);
      expect(result.content).toBe('This is LumenFlow content.');
      expect(result.startIndex).toBeGreaterThan(0);
      expect(result.endIndex).toBeGreaterThan(result.startIndex!);
    });

    it('should return not found when no markers exist', () => {
      const content = '# My Project\n\nNo LumenFlow content here.';
      const result = extractMergeBlock(content);
      expect(result.found).toBe(false);
      expect(result.content).toBeUndefined();
    });

    it('should handle malformed markers (only START)', () => {
      const content = `# My Project

<!-- LUMENFLOW:START -->
Incomplete block
`;
      const result = extractMergeBlock(content);
      expect(result.found).toBe(false);
      expect(result.malformed).toBe(true);
      expect(result.malformedReason).toBe('missing-end');
    });

    it('should handle malformed markers (only END)', () => {
      const content = `# My Project

Some content
<!-- LUMENFLOW:END -->
`;
      const result = extractMergeBlock(content);
      expect(result.found).toBe(false);
      expect(result.malformed).toBe(true);
      expect(result.malformedReason).toBe('missing-start');
    });

    it('should handle multiple START markers', () => {
      const content = `<!-- LUMENFLOW:START -->
First block
<!-- LUMENFLOW:START -->
Second start
<!-- LUMENFLOW:END -->
`;
      const result = extractMergeBlock(content);
      expect(result.malformed).toBe(true);
      expect(result.malformedReason).toBe('multiple-start');
    });
  });

  describe('insertMergeBlock', () => {
    it('should append block to end of file', () => {
      const originalContent = '# My Project\n\nExisting content.\n';
      const blockContent = 'LumenFlow configuration goes here.';

      const result = insertMergeBlock(originalContent, blockContent);

      expect(result).toContain('<!-- LUMENFLOW:START -->');
      expect(result).toContain(blockContent);
      expect(result).toContain('<!-- LUMENFLOW:END -->');
      expect(result.startsWith('# My Project')).toBe(true);
    });

    it('should preserve original line endings (LF)', () => {
      const originalContent = '# My Project\nExisting content.\n';
      const blockContent = 'New content';

      const result = insertMergeBlock(originalContent, blockContent);

      // Should not contain CRLF
      expect(result).not.toContain('\r\n');
      expect(result).toContain('\n');
    });

    it('should preserve original line endings (CRLF)', () => {
      const originalContent = '# My Project\r\nExisting content.\r\n';
      const blockContent = 'New content';

      const result = insertMergeBlock(originalContent, blockContent);

      // Should contain CRLF
      expect(result).toContain('\r\n');
    });

    it('should add blank line before block if not present', () => {
      const originalContent = '# My Project\nNo trailing newline';
      const blockContent = 'New content';

      const result = insertMergeBlock(originalContent, blockContent);

      // Should have separation between original and block
      expect(result).toMatch(/No trailing newline\n\n<!-- LUMENFLOW:START -->/);
    });
  });

  describe('updateMergeBlock', () => {
    it('should replace existing block content', () => {
      const originalContent = `# My Project

<!-- LUMENFLOW:START -->
Old LumenFlow content.
<!-- LUMENFLOW:END -->

Other content
`;
      const newBlockContent = 'New LumenFlow content.';

      const result = updateMergeBlock(originalContent, newBlockContent);

      expect(result.content).toContain('New LumenFlow content.');
      expect(result.content).not.toContain('Old LumenFlow content.');
      expect(result.content).toContain('Other content');
      expect(result.updated).toBe(true);
    });

    it('should preserve content before and after the block', () => {
      const originalContent = `# Header

Before the block.

<!-- LUMENFLOW:START -->
Old content
<!-- LUMENFLOW:END -->

After the block.
`;
      const newBlockContent = 'Updated content';

      const result = updateMergeBlock(originalContent, newBlockContent);

      expect(result.content).toContain('# Header');
      expect(result.content).toContain('Before the block.');
      expect(result.content).toContain('After the block.');
    });

    it('should preserve original line endings when updating', () => {
      const originalContent = `# Project\r\n\r\n<!-- LUMENFLOW:START -->\r\nOld\r\n<!-- LUMENFLOW:END -->\r\n`;
      const newBlockContent = 'New';

      const result = updateMergeBlock(originalContent, newBlockContent);

      // All line endings in result should be CRLF
      const lfCount = (result.content.match(/(?<!\r)\n/g) || []).length;
      expect(lfCount).toBe(0); // No standalone LF
    });

    it('should insert block when no existing block (append mode)', () => {
      const originalContent = '# Project\n\nNo block here.\n';
      const newBlockContent = 'New content';

      const result = updateMergeBlock(originalContent, newBlockContent);

      expect(result.content).toContain('<!-- LUMENFLOW:START -->');
      expect(result.content).toContain(newBlockContent);
      expect(result.updated).toBe(true);
      expect(result.wasInserted).toBe(true);
    });

    it('should warn and append fresh block on malformed markers', () => {
      const originalContent = `# Project

<!-- LUMENFLOW:START -->
Incomplete block without end marker
`;
      const newBlockContent = 'Fresh content';

      const result = updateMergeBlock(originalContent, newBlockContent);

      expect(result.warning).toContain('malformed');
      expect(result.content).toContain('<!-- LUMENFLOW:START -->');
      expect(result.content).toContain('Fresh content');
      expect(result.content).toContain('<!-- LUMENFLOW:END -->');
    });
  });

  describe('idempotency', () => {
    it('should produce identical output when run twice with same input', () => {
      const originalContent = '# My Project\n\nSome content.\n';
      const blockContent = 'LumenFlow configuration';

      // First merge
      const firstResult = updateMergeBlock(originalContent, blockContent);

      // Second merge with same block content
      const secondResult = updateMergeBlock(firstResult.content, blockContent);

      expect(firstResult.content).toBe(secondResult.content);
    });

    it('should not modify file when block content is unchanged', () => {
      const existingContent = `# Project

<!-- LUMENFLOW:START -->
Same content
<!-- LUMENFLOW:END -->
`;
      const blockContent = 'Same content';

      const result = updateMergeBlock(existingContent, blockContent);

      expect(result.unchanged).toBe(true);
      expect(result.content).toBe(existingContent);
    });
  });
});
