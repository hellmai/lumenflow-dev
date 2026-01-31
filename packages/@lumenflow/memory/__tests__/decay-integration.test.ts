/**
 * Decay Integration Tests (WU-1238)
 *
 * Integration tests verifying that decay affects mem:context ranking.
 * Tests the full flow from decay scoring through context generation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { generateContext } from '../src/mem-context-core.js';
import { loadMemoryAll, MEMORY_FILE_NAME } from '../src/memory-store.js';
import { DEFAULT_HALF_LIFE_MS } from '../src/decay/scoring.js';
import { LUMENFLOW_MEMORY_PATHS } from '../src/paths.js';
import type { MemoryNode } from '../src/memory-schema.js';

/**
 * Helper to create a memory node
 */
function createNode(overrides: Partial<MemoryNode> = {}): MemoryNode {
  return {
    id: `mem-${Math.random().toString(36).slice(2, 6)}`,
    type: 'checkpoint',
    lifecycle: 'wu',
    content: 'Test content',
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Helper to write JSONL content to memory file
 */
async function writeMemoryFile(baseDir: string, nodes: MemoryNode[]): Promise<void> {
  const memoryDir = path.join(baseDir, LUMENFLOW_MEMORY_PATHS.MEMORY_DIR);
  await fs.mkdir(memoryDir, { recursive: true });
  const filePath = path.join(memoryDir, MEMORY_FILE_NAME);
  const content = nodes.map((node) => JSON.stringify(node)).join('\n');
  await fs.writeFile(filePath, content + '\n', 'utf-8');
}

describe('decay integration', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'decay-integration-'));
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('context ranking by decay', () => {
    it('should rank nodes by decay score when sortByDecay is true', async () => {
      const now = Date.now();
      const wuId = 'WU-1238';

      // Create nodes with different decay characteristics
      // Node 1: Old but frequently accessed (high access score)
      const oldFrequent = createNode({
        id: 'mem-old1',
        wu_id: wuId,
        content: 'Old but frequently accessed',
        created_at: new Date(now - 5 * DEFAULT_HALF_LIFE_MS).toISOString(),
        metadata: { access: { count: 50 }, priority: 'P1' },
      });

      // Node 2: Recent but never accessed
      const recentUnused = createNode({
        id: 'mem-new1',
        wu_id: wuId,
        content: 'Recent but never accessed',
        created_at: new Date(now - 1000).toISOString(), // 1 second ago
        metadata: { priority: 'P2' },
      });

      // Node 3: P0 priority (high importance)
      const highPriority = createNode({
        id: 'mem-pri1',
        wu_id: wuId,
        content: 'High priority P0',
        created_at: new Date(now - DEFAULT_HALF_LIFE_MS).toISOString(),
        metadata: { priority: 'P0' },
      });

      await writeMemoryFile(tempDir, [oldFrequent, recentUnused, highPriority]);

      // Generate context with decay-based sorting
      const result = await generateContext(tempDir, {
        wuId,
        sortByDecay: true,
        now,
        halfLifeMs: DEFAULT_HALF_LIFE_MS,
      });

      expect(result.success).toBe(true);
      expect(result.stats.totalNodes).toBe(3);

      // The context block should include all nodes
      expect(result.contextBlock).toContain('mem-old1');
      expect(result.contextBlock).toContain('mem-new1');
      expect(result.contextBlock).toContain('mem-pri1');
    });

    it('should preserve recency sorting when sortByDecay is false', async () => {
      const now = Date.now();
      const wuId = 'WU-1238';

      // Create nodes with different ages
      const oldest = createNode({
        id: 'mem-old2',
        wu_id: wuId,
        content: 'Oldest node',
        created_at: new Date(now - 3 * DEFAULT_HALF_LIFE_MS).toISOString(),
      });

      const middle = createNode({
        id: 'mem-mid2',
        wu_id: wuId,
        content: 'Middle node',
        created_at: new Date(now - 1 * DEFAULT_HALF_LIFE_MS).toISOString(),
      });

      const newest = createNode({
        id: 'mem-new2',
        wu_id: wuId,
        content: 'Newest node',
        created_at: new Date(now - 1000).toISOString(),
      });

      await writeMemoryFile(tempDir, [oldest, middle, newest]);

      // Generate context with recency sorting (default)
      const result = await generateContext(tempDir, {
        wuId,
        sortByDecay: false,
        now,
      });

      expect(result.success).toBe(true);
      expect(result.stats.totalNodes).toBe(3);

      // In recency mode, newest should appear first
      const newestIndex = result.contextBlock.indexOf('mem-new2');
      const middleIndex = result.contextBlock.indexOf('mem-mid2');
      const oldestIndex = result.contextBlock.indexOf('mem-old2');

      expect(newestIndex).toBeLessThan(middleIndex);
      expect(middleIndex).toBeLessThan(oldestIndex);
    });
  });

  describe('access tracking', () => {
    it('should track access when trackAccess is true', async () => {
      const now = Date.now();
      const wuId = 'WU-1238';

      const node = createNode({
        id: 'mem-trk1',
        wu_id: wuId,
        content: 'Trackable node',
        created_at: new Date(now - 1000).toISOString(),
      });

      await writeMemoryFile(tempDir, [node]);

      // Generate context with access tracking
      const result = await generateContext(tempDir, {
        wuId,
        trackAccess: true,
        now,
      });

      expect(result.success).toBe(true);
      expect(result.stats.accessTracked).toBe(1);

      // Verify access was recorded in the file
      const memoryDir = path.join(tempDir, LUMENFLOW_MEMORY_PATHS.MEMORY_DIR);
      const memory = await loadMemoryAll(memoryDir);
      const updated = memory.byId.get('mem-trk1');

      expect(updated?.metadata?.access?.count).toBe(1);
      expect(updated?.metadata?.access?.last_accessed_at).toBeDefined();
    });

    it('should increment access count on repeated context generation', async () => {
      const now = Date.now();
      const wuId = 'WU-1238';

      const node = createNode({
        id: 'mem-trk2',
        wu_id: wuId,
        content: 'Multi-access node',
        created_at: new Date(now - 1000).toISOString(),
      });

      await writeMemoryFile(tempDir, [node]);

      // Generate context multiple times
      await generateContext(tempDir, { wuId, trackAccess: true, now });
      await generateContext(tempDir, { wuId, trackAccess: true, now: now + 1000 });
      await generateContext(tempDir, { wuId, trackAccess: true, now: now + 2000 });

      // Verify access count incremented
      const memoryDir = path.join(tempDir, LUMENFLOW_MEMORY_PATHS.MEMORY_DIR);
      const memory = await loadMemoryAll(memoryDir);
      const updated = memory.byId.get('mem-trk2');

      expect(updated?.metadata?.access?.count).toBe(3);
    });

    it('should not track access when trackAccess is false', async () => {
      const now = Date.now();
      const wuId = 'WU-1238';

      const node = createNode({
        id: 'mem-trk3',
        wu_id: wuId,
        content: 'Untracked node',
        created_at: new Date(now - 1000).toISOString(),
      });

      await writeMemoryFile(tempDir, [node]);

      // Generate context without access tracking
      const result = await generateContext(tempDir, {
        wuId,
        trackAccess: false,
        now,
      });

      expect(result.success).toBe(true);
      expect(result.stats.accessTracked).toBeUndefined();

      // Verify access was NOT recorded
      const memoryDir = path.join(tempDir, LUMENFLOW_MEMORY_PATHS.MEMORY_DIR);
      const memory = await loadMemoryAll(memoryDir);
      const unchanged = memory.byId.get('mem-trk3');

      expect(unchanged?.metadata?.access).toBeUndefined();
    });
  });

  describe('decay affects ranking over time', () => {
    it('should demote old nodes with low access over time', async () => {
      const now = Date.now();
      const wuId = 'WU-1238';

      // Create an old node with no access
      const oldUnused = createNode({
        id: 'mem-dmo1',
        wu_id: wuId,
        content: 'Old and unused',
        created_at: new Date(now - 3 * DEFAULT_HALF_LIFE_MS).toISOString(),
        metadata: { priority: 'P2' },
      });

      // Create a recent node with moderate access
      const recentAccessed = createNode({
        id: 'mem-dmo2',
        wu_id: wuId,
        content: 'Recent and accessed',
        created_at: new Date(now - DEFAULT_HALF_LIFE_MS / 10).toISOString(),
        metadata: { priority: 'P2', access: { count: 5 } },
      });

      await writeMemoryFile(tempDir, [oldUnused, recentAccessed]);

      // With decay sorting, recent accessed should rank higher
      const result = await generateContext(tempDir, {
        wuId,
        sortByDecay: true,
        now,
        halfLifeMs: DEFAULT_HALF_LIFE_MS,
      });

      expect(result.success).toBe(true);

      const recentIndex = result.contextBlock.indexOf('mem-dmo2');
      const oldIndex = result.contextBlock.indexOf('mem-dmo1');

      // Recent accessed node should appear first (earlier in the string)
      expect(recentIndex).toBeLessThan(oldIndex);
    });
  });
});
