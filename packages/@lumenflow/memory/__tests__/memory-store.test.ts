/**
 * Memory Store Tests (WU-1463)
 *
 * TDD: Tests written first, implementation follows.
 * JSONL-based memory store with load, query, and append operations.
 *
 * @see {@link tools/lib/memory-store.mjs} - Implementation
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  loadMemory,
  appendNode,
  queryReady,
  queryByWu,
  MEMORY_FILE_NAME,
} from '../src/memory-store.js';

/**
 * Test fixtures for deterministic ordering validation
 */
const FIXTURES = {
  /** Base valid node structure */
  baseNode: {
    type: 'discovery',
    lifecycle: 'wu',
    content: 'Test content',
  },

  /** Creates a valid memory node with custom fields */
  createNode: (overrides = {}) => ({
    id: `mem-${Math.random().toString(36).slice(2, 6)}`,
    type: 'discovery',
    lifecycle: 'wu',
    content: 'Test content',
    created_at: new Date().toISOString(),
    ...overrides,
  }),

  /** Priority ordering fixture: P0 < P1 < P2 (P0 is highest priority) */
  priorityOrderingNodes: [
    {
      id: 'mem-pri2',
      type: 'checkpoint',
      lifecycle: 'wu',
      content: 'Low priority item',
      created_at: '2025-12-08T10:00:00Z',
      wu_id: 'WU-1463',
      metadata: { priority: 'P2' },
    },
    {
      id: 'mem-pri0',
      type: 'checkpoint',
      lifecycle: 'wu',
      content: 'High priority item',
      created_at: '2025-12-08T10:01:00Z',
      wu_id: 'WU-1463',
      metadata: { priority: 'P0' },
    },
    {
      id: 'mem-pri1',
      type: 'checkpoint',
      lifecycle: 'wu',
      content: 'Medium priority item',
      created_at: '2025-12-08T10:02:00Z',
      wu_id: 'WU-1463',
      metadata: { priority: 'P1' },
    },
  ],

  /** Created-at ordering fixture: same priority, different timestamps */
  createdAtOrderingNodes: [
    {
      id: 'mem-new1',
      type: 'checkpoint',
      lifecycle: 'wu',
      content: 'Newest item',
      created_at: '2025-12-08T12:00:00Z',
      wu_id: 'WU-1463',
      metadata: { priority: 'P1' },
    },
    {
      id: 'mem-old1',
      type: 'checkpoint',
      lifecycle: 'wu',
      content: 'Oldest item',
      created_at: '2025-12-08T10:00:00Z',
      wu_id: 'WU-1463',
      metadata: { priority: 'P1' },
    },
    {
      id: 'mem-mid1',
      type: 'checkpoint',
      lifecycle: 'wu',
      content: 'Middle item',
      created_at: '2025-12-08T11:00:00Z',
      wu_id: 'WU-1463',
      metadata: { priority: 'P1' },
    },
  ],

  /** Mixed WU nodes for queryByWu testing */
  mixedWuNodes: [
    {
      id: 'mem-wu01',
      type: 'discovery',
      lifecycle: 'wu',
      content: 'WU-1463 discovery 1',
      created_at: '2025-12-08T10:00:00Z',
      wu_id: 'WU-1463',
    },
    {
      id: 'mem-wu02',
      type: 'note',
      lifecycle: 'wu',
      content: 'WU-1464 note',
      created_at: '2025-12-08T10:01:00Z',
      wu_id: 'WU-1464',
    },
    {
      id: 'mem-wu03',
      type: 'checkpoint',
      lifecycle: 'wu',
      content: 'WU-1463 checkpoint',
      created_at: '2025-12-08T10:02:00Z',
      wu_id: 'WU-1463',
    },
    {
      id: 'mem-wu04',
      type: 'summary',
      lifecycle: 'project',
      content: 'Project-level summary (no WU)',
      created_at: '2025-12-08T10:03:00Z',
    },
  ],
};

/**
 * Helper to write JSONL content to a file
 * @param {string} filePath - Path to write to
 * @param {object[]} nodes - Array of nodes to write
 */
async function writeJsonlFile(filePath: string, nodes: object[]) {
  const content = nodes.map((node) => JSON.stringify(node)).join('\n');
  await fs.writeFile(filePath, content + '\n', 'utf-8');
}

describe('memory-store', () => {
  let tempDir: string;
  let memoryFilePath: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memory-store-test-'));
    memoryFilePath = path.join(tempDir, MEMORY_FILE_NAME);
  });

  afterEach(async () => {
    // Cleanup temp directory
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('MEMORY_FILE_NAME constant', () => {
    it('should export the memory file name', () => {
      assert.equal(MEMORY_FILE_NAME, 'memory.jsonl');
    });
  });

  describe('loadMemory()', () => {
    it('should return empty indexed result for missing file', async () => {
      const result = await loadMemory(tempDir);

      assert.ok(result, 'Should return result object');
      assert.ok(Array.isArray(result.nodes), 'Should have nodes array');
      assert.equal(result.nodes.length, 0, 'Should have no nodes');
      assert.ok(result.byId instanceof Map, 'Should have byId Map');
      assert.equal(result.byId.size, 0, 'byId should be empty');
      assert.ok(result.byWu instanceof Map, 'Should have byWu Map');
      assert.equal(result.byWu.size, 0, 'byWu should be empty');
    });

    it('should return empty indexed result for empty file', async () => {
      await fs.writeFile(memoryFilePath, '', 'utf-8');

      const result = await loadMemory(tempDir);

      assert.equal(result.nodes.length, 0, 'Should have no nodes');
      assert.equal(result.byId.size, 0, 'byId should be empty');
    });

    it('should load and index nodes from JSONL file', async () => {
      const nodes = [FIXTURES.createNode({ id: 'mem-abc1' }), FIXTURES.createNode({ id: 'mem-def2' })];
      await writeJsonlFile(memoryFilePath, nodes);

      const result = await loadMemory(tempDir);

      assert.equal(result.nodes.length, 2, 'Should load 2 nodes');
      assert.ok(result.byId.has('mem-abc1'), 'Should index by id');
      assert.ok(result.byId.has('mem-def2'), 'Should index by id');
    });

    it('should index nodes by wu_id', async () => {
      const nodes = [
        FIXTURES.createNode({ id: 'mem-abc1', wu_id: 'WU-1463' }),
        FIXTURES.createNode({ id: 'mem-def2', wu_id: 'WU-1463' }),
        FIXTURES.createNode({ id: 'mem-ghi3', wu_id: 'WU-1464' }),
      ];
      await writeJsonlFile(memoryFilePath, nodes);

      const result = await loadMemory(tempDir);

      assert.ok(result.byWu.has('WU-1463'), 'Should index WU-1463');
      assert.ok(result.byWu.has('WU-1464'), 'Should index WU-1464');
      assert.equal(result.byWu.get('WU-1463')!.length, 2, 'WU-1463 should have 2 nodes');
      assert.equal(result.byWu.get('WU-1464')!.length, 1, 'WU-1464 should have 1 node');
    });

    it('should skip empty lines gracefully', async () => {
      const content = `${JSON.stringify(FIXTURES.createNode({ id: 'mem-abc1' }))}\n\n${JSON.stringify(FIXTURES.createNode({ id: 'mem-def2' }))}\n`;
      await fs.writeFile(memoryFilePath, content, 'utf-8');

      const result = await loadMemory(tempDir);

      assert.equal(result.nodes.length, 2, 'Should load 2 nodes, skipping empty line');
    });

    it('should throw on malformed JSON lines', async () => {
      const content = `${JSON.stringify(FIXTURES.createNode({ id: 'mem-abc1' }))}\n{invalid json}\n`;
      await fs.writeFile(memoryFilePath, content, 'utf-8');

      await assert.rejects(async () => loadMemory(tempDir), /JSON/i, 'Should throw on malformed JSON');
    });

    it('should validate nodes against schema', async () => {
      const invalidNode = { id: 'invalid-id', type: 'unknown' };
      await writeJsonlFile(memoryFilePath, [invalidNode]);

      await assert.rejects(async () => loadMemory(tempDir), /validation/i, 'Should throw on invalid node');
    });
  });

  describe('appendNode()', () => {
    it('should append a node to an empty file (creating file)', async () => {
      const node = FIXTURES.createNode({ id: 'mem-new1' });

      await appendNode(tempDir, node);

      const content = await fs.readFile(memoryFilePath, 'utf-8');
      const lines = content.trim().split('\n');
      assert.equal(lines.length, 1, 'Should have 1 line');
      assert.deepEqual(JSON.parse(lines[0]), node, 'Should match appended node');
    });

    it('should append a node to existing file without rewriting', async () => {
      const existingNode = FIXTURES.createNode({ id: 'mem-old1' });
      await writeJsonlFile(memoryFilePath, [existingNode]);

      const newNode = FIXTURES.createNode({ id: 'mem-new1' });
      await appendNode(tempDir, newNode);

      const content = await fs.readFile(memoryFilePath, 'utf-8');
      const lines = content.trim().split('\n');
      assert.equal(lines.length, 2, 'Should have 2 lines');
      assert.deepEqual(JSON.parse(lines[0]), existingNode, 'First line should be original');
      assert.deepEqual(JSON.parse(lines[1]), newNode, 'Second line should be new node');
    });

    it('should validate node before appending', async () => {
      const invalidNode = { id: 'invalid', type: 'bad' };

      await assert.rejects(
        async () => appendNode(tempDir, invalidNode as any),
        /validation/i,
        'Should throw on invalid node'
      );

      // File should not exist if append failed
      await assert.rejects(async () => fs.access(memoryFilePath), 'File should not exist after failed append');
    });

    it('should use append mode (not rewrite file)', async () => {
      // Create a large existing file to verify append-only behavior
      const existingNodes = Array.from({ length: 100 }, (_, i) =>
        FIXTURES.createNode({ id: `mem-${String(i).padStart(4, '0')}` })
      );
      await writeJsonlFile(memoryFilePath, existingNodes);

      const beforeStats = await fs.stat(memoryFilePath);
      const newNode = FIXTURES.createNode({ id: 'mem-9999' });

      await appendNode(tempDir, newNode);

      const afterStats = await fs.stat(memoryFilePath);
      // File should grow, not be rewritten (would have similar size if rewritten)
      assert.ok(afterStats.size > beforeStats.size, 'File should grow by append');
    });

    it('should return the appended node', async () => {
      const node = FIXTURES.createNode({ id: 'mem-ret1' });

      const result = await appendNode(tempDir, node);

      assert.deepEqual(result, node, 'Should return the appended node');
    });
  });

  describe('queryReady()', () => {
    it('should return empty array for missing file', async () => {
      const result = await queryReady(tempDir, 'WU-1463');

      assert.ok(Array.isArray(result), 'Should return array');
      assert.equal(result.length, 0, 'Should be empty');
    });

    it('should return empty array for WU with no matching nodes', async () => {
      await writeJsonlFile(memoryFilePath, FIXTURES.mixedWuNodes);

      const result = await queryReady(tempDir, 'WU-9999');

      assert.equal(result.length, 0, 'Should return no nodes for unknown WU');
    });

    it('should return nodes for specific WU only', async () => {
      await writeJsonlFile(memoryFilePath, FIXTURES.mixedWuNodes);

      const result = await queryReady(tempDir, 'WU-1463');

      assert.equal(result.length, 2, 'Should return only WU-1463 nodes');
      assert.ok(
        result.every((n) => n.wu_id === 'WU-1463'),
        'All nodes should belong to WU-1463'
      );
    });

    describe('deterministic ordering', () => {
      it('should order by priority first (P0 before P1 before P2)', async () => {
        await writeJsonlFile(memoryFilePath, FIXTURES.priorityOrderingNodes);

        const result = await queryReady(tempDir, 'WU-1463');

        assert.equal(result.length, 3, 'Should return all 3 nodes');
        assert.equal(result[0].id, 'mem-pri0', 'First should be P0');
        assert.equal(result[1].id, 'mem-pri1', 'Second should be P1');
        assert.equal(result[2].id, 'mem-pri2', 'Third should be P2');
      });

      it('should order by created_at within same priority (oldest first)', async () => {
        await writeJsonlFile(memoryFilePath, FIXTURES.createdAtOrderingNodes);

        const result = await queryReady(tempDir, 'WU-1463');

        assert.equal(result.length, 3, 'Should return all 3 nodes');
        assert.equal(result[0].id, 'mem-old1', 'First should be oldest');
        assert.equal(result[1].id, 'mem-mid1', 'Second should be middle');
        assert.equal(result[2].id, 'mem-new1', 'Third should be newest');
      });

      it('should produce consistent ordering on repeated calls', async () => {
        const nodes = [...FIXTURES.priorityOrderingNodes, ...FIXTURES.createdAtOrderingNodes];
        await writeJsonlFile(memoryFilePath, nodes);

        const result1 = await queryReady(tempDir, 'WU-1463');
        const result2 = await queryReady(tempDir, 'WU-1463');
        const result3 = await queryReady(tempDir, 'WU-1463');

        const ids1 = result1.map((n) => n.id);
        const ids2 = result2.map((n) => n.id);
        const ids3 = result3.map((n) => n.id);

        assert.deepEqual(ids1, ids2, 'Results should be consistent (1 vs 2)');
        assert.deepEqual(ids2, ids3, 'Results should be consistent (2 vs 3)');
      });

      it('should handle nodes without priority (treated as lowest)', async () => {
        const nodes = [
          ...FIXTURES.priorityOrderingNodes,
          {
            id: 'mem-nop1',
            type: 'note',
            lifecycle: 'wu',
            content: 'No priority node',
            created_at: '2025-12-08T09:00:00Z',
            wu_id: 'WU-1463',
          },
        ];
        await writeJsonlFile(memoryFilePath, nodes);

        const result = await queryReady(tempDir, 'WU-1463');

        // Nodes without priority should come last
        assert.equal(result[result.length - 1].id, 'mem-nop1', 'No-priority node should be last');
      });

      it('should use stable sort for equal priority and created_at', async () => {
        const nodes = [
          {
            id: 'mem-equ1',
            type: 'note',
            lifecycle: 'wu',
            content: 'Equal 1',
            created_at: '2025-12-08T10:00:00Z',
            wu_id: 'WU-1463',
            metadata: { priority: 'P1' },
          },
          {
            id: 'mem-equ2',
            type: 'note',
            lifecycle: 'wu',
            content: 'Equal 2',
            created_at: '2025-12-08T10:00:00Z',
            wu_id: 'WU-1463',
            metadata: { priority: 'P1' },
          },
        ];
        await writeJsonlFile(memoryFilePath, nodes);

        // Run multiple times to ensure stability
        const results = await Promise.all([
          queryReady(tempDir, 'WU-1463'),
          queryReady(tempDir, 'WU-1463'),
          queryReady(tempDir, 'WU-1463'),
        ]);

        const orderings = results.map((r) => r.map((n) => n.id).join(','));
        assert.ok(
          orderings.every((o) => o === orderings[0]),
          'All orderings should be identical'
        );
      });
    });
  });

  describe('queryByWu()', () => {
    it('should return empty array for missing file', async () => {
      const result = await queryByWu(tempDir, 'WU-1463');

      assert.ok(Array.isArray(result), 'Should return array');
      assert.equal(result.length, 0, 'Should be empty');
    });

    it('should return empty array for WU with no matching nodes', async () => {
      await writeJsonlFile(memoryFilePath, FIXTURES.mixedWuNodes);

      const result = await queryByWu(tempDir, 'WU-9999');

      assert.equal(result.length, 0, 'Should return no nodes for unknown WU');
    });

    it('should return all nodes for specific WU', async () => {
      await writeJsonlFile(memoryFilePath, FIXTURES.mixedWuNodes);

      const result = await queryByWu(tempDir, 'WU-1463');

      assert.equal(result.length, 2, 'Should return 2 nodes for WU-1463');
      const ids = result.map((n) => n.id).sort();
      assert.deepEqual(ids, ['mem-wu01', 'mem-wu03'], 'Should return correct node IDs');
    });

    it('should not include nodes without wu_id', async () => {
      await writeJsonlFile(memoryFilePath, FIXTURES.mixedWuNodes);

      const result = await queryByWu(tempDir, 'WU-1463');

      assert.ok(
        result.every((n) => n.wu_id !== undefined),
        'All nodes should have wu_id'
      );
    });

    it('should return nodes in insertion order (file order)', async () => {
      await writeJsonlFile(memoryFilePath, FIXTURES.mixedWuNodes);

      const result = await queryByWu(tempDir, 'WU-1463');

      // WU-1463 nodes appear at positions 0 and 2 in the file
      assert.equal(result[0].id, 'mem-wu01', 'First should be first in file');
      assert.equal(result[1].id, 'mem-wu03', 'Second should be second occurrence in file');
    });
  });
});
