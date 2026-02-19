/**
 * Memory FS Utils Tests (WU-1909)
 *
 * Tests for shared filesystem utility functions extracted from
 * duplicated code in mem-checkpoint-core, mem-create-core, and mem-start-core.
 *
 * @see {@link packages/@lumenflow/memory/src/fs-utils.ts} - Implementation
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ensureMemoryDir } from '../src/fs-utils.js';

describe('fs-utils (WU-1909)', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fs-utils-test-'));
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe('ensureMemoryDir', () => {
    it('should create the memory directory if it does not exist', async () => {
      const memoryDir = await ensureMemoryDir(testDir);
      const expectedPath = path.join(testDir, '.lumenflow', 'memory');

      expect(memoryDir).toBe(expectedPath);

      const stat = await fs.stat(expectedPath);
      expect(stat.isDirectory()).toBe(true);
    });

    it('should return existing memory directory path without error', async () => {
      const expectedPath = path.join(testDir, '.lumenflow', 'memory');
      await fs.mkdir(expectedPath, { recursive: true });

      const memoryDir = await ensureMemoryDir(testDir);
      expect(memoryDir).toBe(expectedPath);
    });

    it('should create nested parent directories', async () => {
      // Ensure .lumenflow does not exist
      const lumenflowDir = path.join(testDir, '.lumenflow');
      await expect(fs.access(lumenflowDir)).rejects.toThrow();

      const memoryDir = await ensureMemoryDir(testDir);
      expect(memoryDir).toBe(path.join(testDir, '.lumenflow', 'memory'));

      const stat = await fs.stat(memoryDir);
      expect(stat.isDirectory()).toBe(true);
    });
  });
});
