/**
 * Archival Tests (WU-1238)
 *
 * TDD: Tests written first, implementation follows.
 * Tests for archiving nodes below decay threshold.
 *
 * Archival rules:
 * - Nodes below threshold get metadata.status = 'archived'
 * - Nothing is deleted (append-only pattern)
 * - Archived nodes excluded from default queries
 * - --include-archived flag includes them
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  archiveByDecay,
  isArchived,
  DEFAULT_DECAY_THRESHOLD,
  type DecayArchiveResult,
} from '../src/decay/archival.js';
import { loadMemory, loadMemoryAll, MEMORY_FILE_NAME } from '../src/memory-store.js';
import { DEFAULT_HALF_LIFE_MS } from '../src/decay/scoring.js';
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
 * Helper to write JSONL content to a file
 */
async function writeJsonlFile(filePath: string, nodes: object[]): Promise<void> {
  const content = nodes.map((node) => JSON.stringify(node)).join('\n');
  await fs.writeFile(filePath, content + '\n', 'utf-8');
}

describe('decay/archival', () => {
  let tempDir: string;
  let memoryFilePath: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'archival-test-'));
    memoryFilePath = path.join(tempDir, MEMORY_FILE_NAME);
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('DEFAULT_DECAY_THRESHOLD', () => {
    it('should be 0.1 by default', () => {
      expect(DEFAULT_DECAY_THRESHOLD).toBe(0.1);
    });
  });

  describe('isArchived()', () => {
    it('should return true for node with metadata.status = archived', () => {
      const node = createNode({
        metadata: { status: 'archived' },
      });

      expect(isArchived(node)).toBe(true);
    });

    it('should return false for node without metadata', () => {
      const node = createNode();

      expect(isArchived(node)).toBe(false);
    });

    it('should return false for node with different status', () => {
      const node = createNode({
        metadata: { status: 'active' },
      });

      expect(isArchived(node)).toBe(false);
    });

    it('should return false for node with no status', () => {
      const node = createNode({
        metadata: { priority: 'P1' },
      });

      expect(isArchived(node)).toBe(false);
    });
  });

  describe('archiveByDecay()', () => {
    it('should archive nodes with decay score below threshold', async () => {
      const now = Date.now();
      // Create a very old node (should be below threshold)
      const veryOld = now - 10 * DEFAULT_HALF_LIFE_MS;
      const nodes = [
        createNode({
          id: 'mem-old1',
          created_at: new Date(veryOld).toISOString(),
          metadata: { priority: 'P2' },
        }),
        createNode({
          id: 'mem-new1',
          created_at: new Date(now).toISOString(),
          metadata: { priority: 'P2' },
        }),
      ];
      await writeJsonlFile(memoryFilePath, nodes);

      const result = await archiveByDecay(tempDir, {
        threshold: DEFAULT_DECAY_THRESHOLD,
        now,
        halfLifeMs: DEFAULT_HALF_LIFE_MS,
      });

      expect(result.archivedIds).toContain('mem-old1');
      expect(result.archivedIds).not.toContain('mem-new1');
    });

    it('should set metadata.status = archived on archived nodes', async () => {
      const now = Date.now();
      const veryOld = now - 10 * DEFAULT_HALF_LIFE_MS;
      const nodes = [
        createNode({
          id: 'mem-arc1',
          created_at: new Date(veryOld).toISOString(),
        }),
      ];
      await writeJsonlFile(memoryFilePath, nodes);

      await archiveByDecay(tempDir, {
        threshold: DEFAULT_DECAY_THRESHOLD,
        now,
        halfLifeMs: DEFAULT_HALF_LIFE_MS,
      });

      const memory = await loadMemoryAll(tempDir);
      const node = memory.byId.get('mem-arc1');
      expect(node?.metadata?.status).toBe('archived');
    });

    it('should preserve archived_at timestamp', async () => {
      const now = Date.now();
      const veryOld = now - 10 * DEFAULT_HALF_LIFE_MS;
      const nodes = [
        createNode({
          id: 'mem-arc2',
          created_at: new Date(veryOld).toISOString(),
        }),
      ];
      await writeJsonlFile(memoryFilePath, nodes);

      // The archived_at timestamp is derived from the 'now' option passed to archiveByDecay
      const expectedTimestamp = new Date(now).toISOString();
      await archiveByDecay(tempDir, {
        threshold: DEFAULT_DECAY_THRESHOLD,
        now,
        halfLifeMs: DEFAULT_HALF_LIFE_MS,
      });

      const memory = await loadMemoryAll(tempDir);
      const node = memory.byId.get('mem-arc2');
      const archivedAt = node?.metadata?.archived_at as string;
      expect(archivedAt).toBeDefined();
      // archived_at should match the 'now' timestamp passed to archiveByDecay
      expect(archivedAt).toBe(expectedTimestamp);
    });

    it('should not delete any nodes (append-only)', async () => {
      const now = Date.now();
      const veryOld = now - 10 * DEFAULT_HALF_LIFE_MS;
      const nodes = [
        createNode({
          id: 'mem-del1',
          created_at: new Date(veryOld).toISOString(),
        }),
        createNode({
          id: 'mem-del2',
          created_at: new Date(now).toISOString(),
        }),
      ];
      await writeJsonlFile(memoryFilePath, nodes);

      await archiveByDecay(tempDir, {
        threshold: DEFAULT_DECAY_THRESHOLD,
        now,
        halfLifeMs: DEFAULT_HALF_LIFE_MS,
      });

      const memory = await loadMemoryAll(tempDir);
      expect(memory.nodes.length).toBe(2);
      expect(memory.byId.has('mem-del1')).toBe(true);
      expect(memory.byId.has('mem-del2')).toBe(true);
    });

    it('should skip already archived nodes', async () => {
      const now = Date.now();
      const veryOld = now - 10 * DEFAULT_HALF_LIFE_MS;
      const nodes = [
        createNode({
          id: 'mem-skp1',
          created_at: new Date(veryOld).toISOString(),
          metadata: { status: 'archived', archived_at: '2025-01-01T00:00:00Z' },
        }),
      ];
      await writeJsonlFile(memoryFilePath, nodes);

      const result = await archiveByDecay(tempDir, {
        threshold: DEFAULT_DECAY_THRESHOLD,
        now,
        halfLifeMs: DEFAULT_HALF_LIFE_MS,
      });

      expect(result.archivedIds).not.toContain('mem-skp1');
      expect(result.skippedIds).toContain('mem-skp1');
    });

    it('should never archive project lifecycle nodes', async () => {
      const now = Date.now();
      const veryOld = now - 10 * DEFAULT_HALF_LIFE_MS;
      const nodes = [
        createNode({
          id: 'mem-prj1',
          lifecycle: 'project',
          created_at: new Date(veryOld).toISOString(),
        }),
      ];
      await writeJsonlFile(memoryFilePath, nodes);

      const result = await archiveByDecay(tempDir, {
        threshold: DEFAULT_DECAY_THRESHOLD,
        now,
        halfLifeMs: DEFAULT_HALF_LIFE_MS,
      });

      expect(result.archivedIds).not.toContain('mem-prj1');
      const memory = await loadMemoryAll(tempDir);
      const node = memory.byId.get('mem-prj1');
      expect(node?.metadata?.status).not.toBe('archived');
    });

    it('should return detailed result', async () => {
      const now = Date.now();
      const veryOld = now - 10 * DEFAULT_HALF_LIFE_MS;
      const nodes = [
        createNode({
          id: 'mem-res1',
          created_at: new Date(veryOld).toISOString(),
        }),
        createNode({
          id: 'mem-res2',
          created_at: new Date(now).toISOString(),
        }),
        createNode({
          id: 'mem-res3',
          created_at: new Date(veryOld).toISOString(),
          metadata: { status: 'archived' },
        }),
      ];
      await writeJsonlFile(memoryFilePath, nodes);

      const result = await archiveByDecay(tempDir, {
        threshold: DEFAULT_DECAY_THRESHOLD,
        now,
        halfLifeMs: DEFAULT_HALF_LIFE_MS,
      });

      expect(result.archivedIds).toContain('mem-res1');
      expect(result.retainedIds).toContain('mem-res2');
      expect(result.skippedIds).toContain('mem-res3');
      expect(result.totalProcessed).toBe(3);
    });

    it('should support dry-run mode', async () => {
      const now = Date.now();
      const veryOld = now - 10 * DEFAULT_HALF_LIFE_MS;
      const nodes = [
        createNode({
          id: 'mem-dry1',
          created_at: new Date(veryOld).toISOString(),
        }),
      ];
      await writeJsonlFile(memoryFilePath, nodes);

      const result = await archiveByDecay(tempDir, {
        threshold: DEFAULT_DECAY_THRESHOLD,
        now,
        halfLifeMs: DEFAULT_HALF_LIFE_MS,
        dryRun: true,
      });

      expect(result.archivedIds).toContain('mem-dry1');
      expect(result.dryRun).toBe(true);

      // Verify file was NOT modified
      const memory = await loadMemoryAll(tempDir);
      const node = memory.byId.get('mem-dry1');
      expect(node?.metadata?.status).not.toBe('archived');
    });

    it('should use configurable threshold', async () => {
      const now = Date.now();
      // Node at 1 half-life has decay score ~0.368
      const oneHalfLife = now - DEFAULT_HALF_LIFE_MS;
      const nodes = [
        createNode({
          id: 'mem-thr1',
          created_at: new Date(oneHalfLife).toISOString(),
          metadata: { priority: 'P2' },
        }),
      ];
      await writeJsonlFile(memoryFilePath, nodes);

      // With threshold 0.1, should NOT be archived (0.368 > 0.1)
      const result1 = await archiveByDecay(tempDir, {
        threshold: 0.1,
        now,
        halfLifeMs: DEFAULT_HALF_LIFE_MS,
        dryRun: true,
      });
      expect(result1.archivedIds).not.toContain('mem-thr1');

      // With threshold 0.5, SHOULD be archived (0.368 < 0.5)
      const result2 = await archiveByDecay(tempDir, {
        threshold: 0.5,
        now,
        halfLifeMs: DEFAULT_HALF_LIFE_MS,
        dryRun: true,
      });
      expect(result2.archivedIds).toContain('mem-thr1');
    });

    it('should record decay.reason for debugging', async () => {
      const now = Date.now();
      const veryOld = now - 10 * DEFAULT_HALF_LIFE_MS;
      const nodes = [
        createNode({
          id: 'mem-rsn1',
          created_at: new Date(veryOld).toISOString(),
        }),
      ];
      await writeJsonlFile(memoryFilePath, nodes);

      await archiveByDecay(tempDir, {
        threshold: 0.1,
        now,
        halfLifeMs: DEFAULT_HALF_LIFE_MS,
      });

      const memory = await loadMemoryAll(tempDir);
      const node = memory.byId.get('mem-rsn1');
      expect(node?.metadata?.decay?.reason).toBeDefined();
      expect(typeof node?.metadata?.decay?.reason).toBe('string');
    });
  });
});
