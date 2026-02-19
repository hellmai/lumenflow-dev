// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: Apache-2.0

import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileOrEmpty, statOrNull } from '../evidence/fs-helpers.js';

describe('fs-helpers', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'lumenflow-kernel-fs-helpers-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('readFileOrEmpty', () => {
    it('returns file content when file exists', async () => {
      const filePath = join(tempDir, 'existing.txt');
      await writeFile(filePath, 'hello world', 'utf8');

      const content = await readFileOrEmpty(filePath);
      expect(content).toBe('hello world');
    });

    it('returns empty string when file does not exist (ENOENT)', async () => {
      const filePath = join(tempDir, 'nonexistent.txt');

      const content = await readFileOrEmpty(filePath);
      expect(content).toBe('');
    });

    it('rethrows non-ENOENT errors', async () => {
      // Use an invalid path that would cause a different error
      const dirPath = join(tempDir, 'a-directory');
      await mkdir(dirPath, { recursive: true });

      // Reading a directory (not a file) should throw EISDIR, not ENOENT
      await expect(readFileOrEmpty(dirPath)).rejects.toThrow();
    });

    it('returns empty string for missing file in nonexistent directory', async () => {
      const filePath = join(tempDir, 'no-such-dir', 'no-such-file.txt');

      const content = await readFileOrEmpty(filePath);
      expect(content).toBe('');
    });
  });

  describe('statOrNull', () => {
    it('returns stat result when file exists', async () => {
      const filePath = join(tempDir, 'existing.txt');
      await writeFile(filePath, 'data', 'utf8');

      const result = await statOrNull(filePath);
      expect(result).not.toBeNull();
      expect(result!.size).toBeGreaterThan(0);
    });

    it('returns null when file does not exist (ENOENT)', async () => {
      const filePath = join(tempDir, 'nonexistent.txt');

      const result = await statOrNull(filePath);
      expect(result).toBeNull();
    });

    it('rethrows non-ENOENT errors', async () => {
      // Attempting to stat a path with a null byte should cause an error
      // that is not ENOENT
      const invalidPath = join(tempDir, 'valid-dir', '\0invalid');

      await expect(statOrNull(invalidPath)).rejects.toThrow();
    });

    it('returns stat for directories', async () => {
      const dirPath = join(tempDir, 'a-directory');
      await mkdir(dirPath, { recursive: true });

      const result = await statOrNull(dirPath);
      expect(result).not.toBeNull();
      expect(result!.isDirectory()).toBe(true);
    });

    it('returns null for missing path in nonexistent directory', async () => {
      const filePath = join(tempDir, 'no-such-dir', 'no-such-file.txt');

      const result = await statOrNull(filePath);
      expect(result).toBeNull();
    });
  });
});
