/**
 * Memory Delete Tests (WU-1284)
 *
 * TDD: Tests written first, implementation follows.
 * Soft delete memory nodes via metadata.status=deleted.
 *
 * Acceptance Criteria:
 * - mem:delete <node-id> removes or archives a memory node
 * - Supports --dry-run to preview deletion
 * - Optionally supports bulk delete via --tag or --older-than filters
 * - Respects append-only pattern (soft delete via metadata.status=deleted)
 *
 * @see {@link packages/@lumenflow/memory/src/mem-delete-core.ts} - Implementation
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import type { MemoryNode } from '../src/memory-schema.js';

import { deleteMemoryNodes } from '../src/mem-delete-core.js';
import { loadMemory, MEMORY_FILE_NAME } from '../src/memory-store.js';

/**
 * Error message constants for assertions
 */
const ERROR_MESSAGES = {
  NODE_NOT_FOUND: (nodeId: string): string => `Node not found: ${nodeId}`,
};

/**
 * Test date constants to avoid magic strings
 */
const TEST_DATES = {
  REFERENCE_DATE: '2025-12-15T12:00:00Z',
};

/**
 * Test fixtures
 */
const FIXTURES = {
  /** Creates a valid memory node with custom fields */
  createNode: (overrides: Partial<MemoryNode> = {}): MemoryNode => ({
    id: `mem-${crypto.randomBytes(2).toString('hex')}`,
    type: 'discovery',
    lifecycle: 'wu',
    content: 'Test content',
    created_at: new Date().toISOString(),
    ...overrides,
  }),

  /** Creates multiple test nodes */
  createTestNodes: (): MemoryNode[] => [
    {
      id: 'mem-del1',
      type: 'discovery',
      lifecycle: 'wu',
      content: 'First node',
      created_at: '2025-12-01T10:00:00Z',
      wu_id: 'WU-1284',
      tags: ['tag-a', 'tag-b'],
    },
    {
      id: 'mem-del2',
      type: 'checkpoint',
      lifecycle: 'wu',
      content: 'Second node',
      created_at: '2025-12-05T10:00:00Z',
      wu_id: 'WU-1284',
      tags: ['tag-b', 'tag-c'],
    },
    {
      id: 'mem-del3',
      type: 'note',
      lifecycle: 'project',
      content: 'Third node',
      created_at: '2025-12-10T10:00:00Z',
      tags: ['tag-a'],
    },
    {
      id: 'mem-del4',
      type: 'summary',
      lifecycle: 'session',
      content: 'Fourth node',
      created_at: '2025-12-15T10:00:00Z',
      tags: ['tag-d'],
    },
  ],
};

/**
 * Helper to write JSONL content to a file
 */
async function writeJsonlFile(filePath: string, nodes: MemoryNode[]): Promise<void> {
  const content = nodes.map((node) => JSON.stringify(node)).join('\n');
  await fs.writeFile(filePath, content + '\n', 'utf-8');
}

describe('mem-delete-core', () => {
  let tempDir: string;
  let memoryFilePath: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mem-delete-test-'));
    memoryFilePath = path.join(tempDir, MEMORY_FILE_NAME);
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('deleteMemoryNodes()', () => {
    describe('single node deletion by ID', () => {
      it('should soft-delete a single node by ID', async () => {
        const nodes = FIXTURES.createTestNodes();
        await writeJsonlFile(memoryFilePath, nodes);

        const result = await deleteMemoryNodes(tempDir, {
          nodeIds: ['mem-del1'],
        });

        expect(result.success).toBe(true);
        expect(result.deletedCount).toBe(1);
        expect(result.deletedIds).toEqual(['mem-del1']);
        expect(result.dryRun).toBe(false);

        // Verify node is marked as deleted (soft delete via metadata.status)
        const memory = await loadMemory(tempDir, { includeArchived: true });
        const deletedNode = memory.byId.get('mem-del1');
        expect(deletedNode?.metadata?.status).toBe('deleted');
      });

      it('should soft-delete multiple nodes by IDs', async () => {
        const nodes = FIXTURES.createTestNodes();
        await writeJsonlFile(memoryFilePath, nodes);

        const result = await deleteMemoryNodes(tempDir, {
          nodeIds: ['mem-del1', 'mem-del3'],
        });

        expect(result.success).toBe(true);
        expect(result.deletedCount).toBe(2);
        expect(result.deletedIds).toContain('mem-del1');
        expect(result.deletedIds).toContain('mem-del3');
      });

      it('should return error for non-existent node ID', async () => {
        const nodes = FIXTURES.createTestNodes();
        await writeJsonlFile(memoryFilePath, nodes);

        const result = await deleteMemoryNodes(tempDir, {
          nodeIds: ['mem-xxxx'],
        });

        expect(result.success).toBe(false);
        expect(result.deletedCount).toBe(0);
        expect(result.errors).toContain(ERROR_MESSAGES.NODE_NOT_FOUND('mem-xxxx'));
      });

      it('should handle mixed valid and invalid node IDs', async () => {
        const nodes = FIXTURES.createTestNodes();
        await writeJsonlFile(memoryFilePath, nodes);

        const result = await deleteMemoryNodes(tempDir, {
          nodeIds: ['mem-del1', 'mem-xxxx'],
        });

        // Partial success - deleted valid node, reported error for invalid
        expect(result.deletedCount).toBe(1);
        expect(result.deletedIds).toEqual(['mem-del1']);
        expect(result.errors).toContain(ERROR_MESSAGES.NODE_NOT_FOUND('mem-xxxx'));
      });

      it('should skip already-deleted nodes', async () => {
        const nodes = FIXTURES.createTestNodes();
        // Pre-mark one as deleted
        const firstNode = nodes[0];
        if (firstNode) {
          firstNode.metadata = { status: 'deleted' };
        }
        await writeJsonlFile(memoryFilePath, nodes);

        const result = await deleteMemoryNodes(tempDir, {
          nodeIds: ['mem-del1'],
        });

        expect(result.success).toBe(true);
        expect(result.deletedCount).toBe(0);
        expect(result.skippedIds).toContain('mem-del1');
        expect(result.errors).toContain('Node already deleted: mem-del1');
      });
    });

    describe('dry-run mode', () => {
      it('should preview deletion without making changes', async () => {
        const nodes = FIXTURES.createTestNodes();
        await writeJsonlFile(memoryFilePath, nodes);

        const result = await deleteMemoryNodes(tempDir, {
          nodeIds: ['mem-del1'],
          dryRun: true,
        });

        expect(result.success).toBe(true);
        expect(result.deletedCount).toBe(1);
        expect(result.deletedIds).toEqual(['mem-del1']);
        expect(result.dryRun).toBe(true);

        // Verify node is NOT modified
        const memory = await loadMemory(tempDir);
        const node = memory.byId.get('mem-del1');
        expect(node?.metadata?.status).not.toBe('deleted');
      });

      it('should preview bulk deletion via tag filter', async () => {
        const nodes = FIXTURES.createTestNodes();
        await writeJsonlFile(memoryFilePath, nodes);

        const result = await deleteMemoryNodes(tempDir, {
          tag: 'tag-a',
          dryRun: true,
        });

        expect(result.success).toBe(true);
        expect(result.deletedCount).toBe(2); // mem-del1 and mem-del3 have tag-a
        expect(result.deletedIds).toContain('mem-del1');
        expect(result.deletedIds).toContain('mem-del3');
        expect(result.dryRun).toBe(true);

        // Verify nodes are NOT modified
        const memory = await loadMemory(tempDir);
        expect(memory.byId.get('mem-del1')?.metadata?.status).not.toBe('deleted');
        expect(memory.byId.get('mem-del3')?.metadata?.status).not.toBe('deleted');
      });
    });

    describe('bulk delete via --tag filter', () => {
      it('should delete all nodes matching a tag', async () => {
        const nodes = FIXTURES.createTestNodes();
        await writeJsonlFile(memoryFilePath, nodes);

        const result = await deleteMemoryNodes(tempDir, {
          tag: 'tag-b',
        });

        expect(result.success).toBe(true);
        expect(result.deletedCount).toBe(2); // mem-del1 and mem-del2 have tag-b
        expect(result.deletedIds).toContain('mem-del1');
        expect(result.deletedIds).toContain('mem-del2');

        // Verify nodes are marked as deleted
        const memory = await loadMemory(tempDir, { includeArchived: true });
        expect(memory.byId.get('mem-del1')?.metadata?.status).toBe('deleted');
        expect(memory.byId.get('mem-del2')?.metadata?.status).toBe('deleted');
        // Non-matching nodes should be unchanged
        expect(memory.byId.get('mem-del3')?.metadata?.status).not.toBe('deleted');
      });

      it('should return empty result when tag matches no nodes', async () => {
        const nodes = FIXTURES.createTestNodes();
        await writeJsonlFile(memoryFilePath, nodes);

        const result = await deleteMemoryNodes(tempDir, {
          tag: 'nonexistent-tag',
        });

        expect(result.success).toBe(true);
        expect(result.deletedCount).toBe(0);
        expect(result.deletedIds).toEqual([]);
      });
    });

    describe('bulk delete via --older-than filter', () => {
      it('should delete nodes older than specified duration', async () => {
        const nodes = FIXTURES.createTestNodes();
        await writeJsonlFile(memoryFilePath, nodes);

        // Delete nodes older than 10 days (from 2025-12-15)
        // Nodes created on 2025-12-01 and 2025-12-05 should be deleted
        const result = await deleteMemoryNodes(tempDir, {
          olderThan: '10d',
          referenceDate: new Date(TEST_DATES.REFERENCE_DATE),
        });

        expect(result.success).toBe(true);
        expect(result.deletedCount).toBe(2);
        expect(result.deletedIds).toContain('mem-del1'); // Dec 1
        expect(result.deletedIds).toContain('mem-del2'); // Dec 5
        expect(result.deletedIds).not.toContain('mem-del3'); // Dec 10
        expect(result.deletedIds).not.toContain('mem-del4'); // Dec 15
      });

      it('should parse duration strings correctly (days)', async () => {
        const nodes = [FIXTURES.createNode({ id: 'mem-old1', created_at: '2025-12-01T10:00:00Z' })];
        await writeJsonlFile(memoryFilePath, nodes);

        const result = await deleteMemoryNodes(tempDir, {
          olderThan: '7d',
          referenceDate: new Date('2025-12-10T12:00:00Z'),
        });

        expect(result.deletedCount).toBe(1);
      });

      it('should parse duration strings correctly (hours)', async () => {
        const nodes = [FIXTURES.createNode({ id: 'mem-old1', created_at: '2025-12-15T06:00:00Z' })];
        await writeJsonlFile(memoryFilePath, nodes);

        const result = await deleteMemoryNodes(tempDir, {
          olderThan: '12h',
          referenceDate: new Date('2025-12-15T20:00:00Z'),
        });

        expect(result.deletedCount).toBe(1);
      });

      it('should return empty result when no nodes match age filter', async () => {
        const nodes = [FIXTURES.createNode({ id: 'mem-new1', created_at: '2025-12-15T10:00:00Z' })];
        await writeJsonlFile(memoryFilePath, nodes);

        const result = await deleteMemoryNodes(tempDir, {
          olderThan: '30d',
          referenceDate: new Date(TEST_DATES.REFERENCE_DATE),
        });

        expect(result.deletedCount).toBe(0);
      });
    });

    describe('combined filters', () => {
      it('should combine nodeIds with tag filter', async () => {
        const nodes = FIXTURES.createTestNodes();
        await writeJsonlFile(memoryFilePath, nodes);

        // Delete specific node AND all nodes with tag-d
        const result = await deleteMemoryNodes(tempDir, {
          nodeIds: ['mem-del1'],
          tag: 'tag-d',
        });

        expect(result.deletedCount).toBe(2);
        expect(result.deletedIds).toContain('mem-del1');
        expect(result.deletedIds).toContain('mem-del4'); // has tag-d
      });

      it('should combine tag and older-than filters (intersection)', async () => {
        const nodes = FIXTURES.createTestNodes();
        await writeJsonlFile(memoryFilePath, nodes);

        // Delete nodes with tag-a that are also older than 10 days
        const result = await deleteMemoryNodes(tempDir, {
          tag: 'tag-a',
          olderThan: '10d',
          referenceDate: new Date(TEST_DATES.REFERENCE_DATE),
        });

        // Only mem-del1 has tag-a AND is older than 10 days (Dec 1)
        // mem-del3 has tag-a but is Dec 10 (not older than 10 days)
        expect(result.deletedCount).toBe(1);
        expect(result.deletedIds).toEqual(['mem-del1']);
      });
    });

    describe('append-only pattern compliance', () => {
      it('should not physically remove nodes from file', async () => {
        const nodes = FIXTURES.createTestNodes();
        await writeJsonlFile(memoryFilePath, nodes);

        const beforeContent = await fs.readFile(memoryFilePath, 'utf-8');
        const beforeLineCount = beforeContent.trim().split('\n').length;

        await deleteMemoryNodes(tempDir, {
          nodeIds: ['mem-del1', 'mem-del2'],
        });

        // File should have same line count (soft delete, not physical removal)
        const afterContent = await fs.readFile(memoryFilePath, 'utf-8');
        const afterLineCount = afterContent.trim().split('\n').length;
        expect(afterLineCount).toBe(beforeLineCount);
      });

      it('should update node in-place with deleted status', async () => {
        const nodes = FIXTURES.createTestNodes();
        await writeJsonlFile(memoryFilePath, nodes);

        await deleteMemoryNodes(tempDir, {
          nodeIds: ['mem-del1'],
        });

        // Read raw file and verify the node was updated
        const content = await fs.readFile(memoryFilePath, 'utf-8');
        const lines = content.trim().split('\n');
        const firstLine = lines[0];
        expect(firstLine).toBeDefined();
        const updatedNode = JSON.parse(firstLine ?? '{}') as MemoryNode;
        expect(updatedNode.id).toBe('mem-del1');
        expect(updatedNode.metadata?.status).toBe('deleted');
        expect(updatedNode.metadata?.deleted_at).toBeDefined();
      });

      it('should preserve all original node fields when marking as deleted', async () => {
        const nodes = FIXTURES.createTestNodes();
        await writeJsonlFile(memoryFilePath, nodes);

        await deleteMemoryNodes(tempDir, {
          nodeIds: ['mem-del1'],
        });

        const memory = await loadMemory(tempDir, { includeArchived: true });
        const deletedNode = memory.byId.get('mem-del1');

        // Original fields should be preserved
        expect(deletedNode?.content).toBe('First node');
        expect(deletedNode?.type).toBe('discovery');
        expect(deletedNode?.lifecycle).toBe('wu');
        expect(deletedNode?.wu_id).toBe('WU-1284');
        expect(deletedNode?.tags).toEqual(['tag-a', 'tag-b']);
        // Plus deletion metadata
        expect(deletedNode?.metadata?.status).toBe('deleted');
      });
    });

    describe('edge cases', () => {
      it('should handle empty memory file', async () => {
        await fs.writeFile(memoryFilePath, '', 'utf-8');

        const result = await deleteMemoryNodes(tempDir, {
          nodeIds: ['mem-del1'],
        });

        expect(result.success).toBe(false);
        expect(result.deletedCount).toBe(0);
        expect(result.errors).toContain(ERROR_MESSAGES.NODE_NOT_FOUND('mem-del1'));
      });

      it('should handle missing memory file', async () => {
        const result = await deleteMemoryNodes(tempDir, {
          nodeIds: ['mem-del1'],
        });

        expect(result.success).toBe(false);
        expect(result.errors).toBeDefined();
      });

      it('should require at least one filter option', async () => {
        const nodes = FIXTURES.createTestNodes();
        await writeJsonlFile(memoryFilePath, nodes);

        const result = await deleteMemoryNodes(tempDir, {});

        expect(result.success).toBe(false);
        expect(result.errors).toContain(
          'At least one filter (nodeIds, tag, or olderThan) is required',
        );
      });
    });
  });
});
