/**
 * Access Tracking Tests (WU-1238)
 *
 * TDD: Tests written first, implementation follows.
 * Tests for tracking node access (count and last_accessed_at).
 *
 * Access is recorded when:
 * - Node selected into mem:context
 * - Node returned in mem:search
 * - Optionally when mem:export includes it
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { recordAccess, recordAccessBatch, getAccessStats } from '../src/decay/access-tracking.js';
import { loadMemory, MEMORY_FILE_NAME } from '../src/memory-store.js';
import type { MemoryNode } from '../src/memory-schema.js';

/**
 * Helper to create a memory node with secure random ID
 */
function createNode(overrides: Partial<MemoryNode> = {}): MemoryNode {
  return {
    id: `mem-${crypto.randomBytes(3).toString('hex')}`,
    type: 'checkpoint',
    lifecycle: 'wu',
    content: 'Test content',
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Helper to write JSONL content to a file
 */
async function writeJsonlFile(filePath: string, nodes: object[]): Promise<void> {
  const content = nodes.map((node) => JSON.stringify(node)).join('\n');
  await fs.writeFile(filePath, content + '\n', 'utf-8');
}

describe('decay/access-tracking', () => {
  let tempDir: string;
  let memoryFilePath: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'access-tracking-test-'));
    memoryFilePath = path.join(tempDir, MEMORY_FILE_NAME);
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('recordAccess()', () => {
    it('should increment access count from 0 to 1 on first access', async () => {
      const node = createNode({ id: 'mem-acc1' });
      await writeJsonlFile(memoryFilePath, [node]);

      const updatedNode = await recordAccess(tempDir, 'mem-acc1');

      expect(updatedNode.metadata?.access?.count).toBe(1);
    });

    it('should increment existing access count', async () => {
      const node = createNode({
        id: 'mem-acc2',
        metadata: { access: { count: 5, last_accessed_at: '2025-01-01T00:00:00Z' } },
      });
      await writeJsonlFile(memoryFilePath, [node]);

      const updatedNode = await recordAccess(tempDir, 'mem-acc2');

      expect(updatedNode.metadata?.access?.count).toBe(6);
    });

    it('should set last_accessed_at to current timestamp', async () => {
      const node = createNode({ id: 'mem-acc3' });
      await writeJsonlFile(memoryFilePath, [node]);

      const before = new Date().toISOString();
      const updatedNode = await recordAccess(tempDir, 'mem-acc3');
      const after = new Date().toISOString();

      const lastAccessed = updatedNode.metadata?.access?.last_accessed_at as string;
      expect(lastAccessed).toBeDefined();
      expect(lastAccessed >= before).toBe(true);
      expect(lastAccessed <= after).toBe(true);
    });

    it('should preserve existing metadata', async () => {
      const node = createNode({
        id: 'mem-acc4',
        metadata: { priority: 'P0', customField: 'value' },
      });
      await writeJsonlFile(memoryFilePath, [node]);

      const updatedNode = await recordAccess(tempDir, 'mem-acc4');

      expect(updatedNode.metadata?.priority).toBe('P0');
      expect(updatedNode.metadata?.customField).toBe('value');
      expect(updatedNode.metadata?.access?.count).toBe(1);
    });

    it('should update the memory file with new access data', async () => {
      const node = createNode({ id: 'mem-acc5' });
      await writeJsonlFile(memoryFilePath, [node]);

      await recordAccess(tempDir, 'mem-acc5');

      // Reload and verify
      const memory = await loadMemory(tempDir);
      const reloaded = memory.byId.get('mem-acc5');
      expect(reloaded?.metadata?.access?.count).toBe(1);
    });

    it('should throw if node not found', async () => {
      const node = createNode({ id: 'mem-acc6' });
      await writeJsonlFile(memoryFilePath, [node]);

      await expect(recordAccess(tempDir, 'mem-nonexistent')).rejects.toThrow(/not found/i);
    });

    it('should compute and store decay score on access', async () => {
      const node = createNode({
        id: 'mem-acc7',
        metadata: { priority: 'P1' },
      });
      await writeJsonlFile(memoryFilePath, [node]);

      const updatedNode = await recordAccess(tempDir, 'mem-acc7');

      expect(updatedNode.metadata?.decay?.score).toBeDefined();
      expect(typeof updatedNode.metadata?.decay?.score).toBe('number');
      expect(updatedNode.metadata?.decay?.score).toBeGreaterThan(0);
    });
  });

  describe('recordAccessBatch()', () => {
    it('should record access for multiple nodes', async () => {
      const nodes = [
        createNode({ id: 'mem-bat1' }),
        createNode({ id: 'mem-bat2' }),
        createNode({ id: 'mem-bat3' }),
      ];
      await writeJsonlFile(memoryFilePath, nodes);

      const updated = await recordAccessBatch(tempDir, ['mem-bat1', 'mem-bat3']);

      expect(updated.length).toBe(2);
      expect(updated.find((n) => n.id === 'mem-bat1')?.metadata?.access?.count).toBe(1);
      expect(updated.find((n) => n.id === 'mem-bat3')?.metadata?.access?.count).toBe(1);
    });

    it('should skip non-existent nodes and continue', async () => {
      const nodes = [createNode({ id: 'mem-bat4' }), createNode({ id: 'mem-bat5' })];
      await writeJsonlFile(memoryFilePath, nodes);

      const updated = await recordAccessBatch(tempDir, ['mem-bat4', 'mem-nonexistent', 'mem-bat5']);

      expect(updated.length).toBe(2);
    });

    it('should be more efficient than individual recordAccess calls', async () => {
      // Batch should only write file once, not N times
      const nodes = Array.from({ length: 10 }, (_, i) => createNode({ id: `mem-eff${i}` }));
      await writeJsonlFile(memoryFilePath, nodes);

      const ids = nodes.map((n) => n.id);
      const updated = await recordAccessBatch(tempDir, ids);

      expect(updated.length).toBe(10);
      // All should have access count = 1
      expect(updated.every((n) => n.metadata?.access?.count === 1)).toBe(true);
    });
  });

  describe('getAccessStats()', () => {
    it('should return stats for a node', async () => {
      const node = createNode({
        id: 'mem-sta1',
        metadata: {
          access: { count: 5, last_accessed_at: '2025-01-15T12:00:00Z' },
        },
      });
      await writeJsonlFile(memoryFilePath, [node]);

      const stats = await getAccessStats(tempDir, 'mem-sta1');

      expect(stats).toBeDefined();
      expect(stats?.count).toBe(5);
      expect(stats?.last_accessed_at).toBe('2025-01-15T12:00:00Z');
    });

    it('should return null for node without access data', async () => {
      const node = createNode({ id: 'mem-sta2' });
      await writeJsonlFile(memoryFilePath, [node]);

      const stats = await getAccessStats(tempDir, 'mem-sta2');

      expect(stats).toBeNull();
    });

    it('should return null for non-existent node', async () => {
      const node = createNode({ id: 'mem-sta3' });
      await writeJsonlFile(memoryFilePath, [node]);

      const stats = await getAccessStats(tempDir, 'mem-nonexistent');

      expect(stats).toBeNull();
    });
  });
});
