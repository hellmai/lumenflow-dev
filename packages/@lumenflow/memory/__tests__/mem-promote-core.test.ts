/**
 * Memory Promote Core Tests (WU-1237)
 *
 * Tests for the mem:promote command core logic that promotes session/WU
 * learnings into project-level knowledge nodes.
 *
 * Tests cover:
 * - Promoting single nodes to project-level
 * - Promoting all summaries from a WU
 * - Enforced taxonomy tags
 * - Relationship creation (discovered_from)
 * - Dry-run mode
 *
 * @see {@link packages/@lumenflow/memory/src/mem-promote-core.ts} - Implementation
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  promoteNode,
  promoteFromWu,
  ALLOWED_PROMOTION_TAGS,
  type PromoteNodeOptions,
  type PromoteFromWuOptions,
} from '../src/mem-promote-core.js';

/**
 * Predicate functions extracted to avoid nested function depth issues
 */
const isProjectLifecycle = (n: Record<string, unknown>): boolean => n.lifecycle === 'project';
const isDiscoveredFromRelation = (r: Record<string, unknown>): boolean =>
  r.type === 'discovered_from';
const hasInvariantTag = (n: { tags?: string[] }): boolean => n.tags?.includes('invariant') ?? false;

describe('mem-promote-core (WU-1237)', () => {
  let testDir: string;
  let memoryDir: string;

  beforeEach(async () => {
    // Create a temporary directory for tests
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mem-promote-test-'));
    memoryDir = path.join(testDir, '.lumenflow', 'memory');
    await fs.mkdir(memoryDir, { recursive: true });
  });

  afterEach(async () => {
    // Clean up temporary directory
    await fs.rm(testDir, { recursive: true, force: true });
  });

  /**
   * Helper to write a memory node to the memory.jsonl file
   */
  async function writeMemoryNode(node: Record<string, unknown>): Promise<void> {
    const filePath = path.join(memoryDir, 'memory.jsonl');
    const line = JSON.stringify(node) + '\n';
    await fs.appendFile(filePath, line, 'utf-8');
  }

  /**
   * Helper to read all memory nodes from the memory.jsonl file
   */
  async function readMemoryNodes(): Promise<Record<string, unknown>[]> {
    const filePath = path.join(memoryDir, 'memory.jsonl');
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return content
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line) as Record<string, unknown>);
    } catch {
      return [];
    }
  }

  /**
   * Helper to read all relationships from the relationships.jsonl file
   */
  async function readRelationships(): Promise<Record<string, unknown>[]> {
    const filePath = path.join(memoryDir, 'relationships.jsonl');
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return content
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line) as Record<string, unknown>);
    } catch {
      return [];
    }
  }

  /**
   * Helper to create a standard memory node
   */
  function createMemoryNode(
    overrides: Partial<Record<string, unknown>> = {},
  ): Record<string, unknown> {
    return {
      // eslint-disable-next-line sonarjs/pseudo-random -- Only used for test fixture IDs
      id: `mem-${Math.random().toString(36).substring(2, 6)}`,
      type: 'note',
      lifecycle: 'wu',
      content: 'Test content',
      created_at: new Date().toISOString(),
      ...overrides,
    };
  }

  describe('ALLOWED_PROMOTION_TAGS', () => {
    it('exports allowed tags taxonomy', () => {
      // Assert
      expect(ALLOWED_PROMOTION_TAGS).toBeDefined();
      expect(ALLOWED_PROMOTION_TAGS).toContain('decision');
      expect(ALLOWED_PROMOTION_TAGS).toContain('convention');
      expect(ALLOWED_PROMOTION_TAGS).toContain('pattern');
      expect(ALLOWED_PROMOTION_TAGS).toContain('pitfall');
      expect(ALLOWED_PROMOTION_TAGS).toContain('interface');
      expect(ALLOWED_PROMOTION_TAGS).toContain('invariant');
      expect(ALLOWED_PROMOTION_TAGS).toContain('faq');
    });
  });

  describe('promoteNode', () => {
    describe('basic functionality', () => {
      it('promotes a node to project lifecycle', async () => {
        // Arrange
        const sourceNode = createMemoryNode({
          id: 'mem-abc1',
          type: 'discovery',
          lifecycle: 'wu',
          content: 'Important pattern discovered',
          wu_id: 'WU-1234',
        });
        await writeMemoryNode(sourceNode);

        const options: PromoteNodeOptions = {
          nodeId: 'mem-abc1',
          tag: 'pattern',
        };

        // Act
        const result = await promoteNode(testDir, options);

        // Assert
        expect(result.success).toBe(true);
        expect(result.promotedNode).toBeDefined();
        expect(result.promotedNode.lifecycle).toBe('project');
      });

      it('creates a new node with project lifecycle', async () => {
        // Arrange
        const sourceNode = createMemoryNode({
          id: 'mem-abc1',
          type: 'note',
          lifecycle: 'session',
          content: 'Session learning to promote',
        });
        await writeMemoryNode(sourceNode);

        const options: PromoteNodeOptions = {
          nodeId: 'mem-abc1',
          tag: 'decision',
        };

        // Act
        await promoteNode(testDir, options);

        // Assert
        const nodes = await readMemoryNodes();
        const promotedNodes = nodes.filter(isProjectLifecycle);
        expect(promotedNodes.length).toBe(1);
        const firstPromoted = promotedNodes[0];
        expect(firstPromoted).toBeDefined();
        expect(firstPromoted?.content).toBe('Session learning to promote');
      });

      it('assigns a new memory ID to the promoted node', async () => {
        // Arrange
        const sourceNode = createMemoryNode({
          id: 'mem-orig',
          type: 'note',
          lifecycle: 'wu',
          content: 'Content to promote',
        });
        await writeMemoryNode(sourceNode);

        // Act
        const result = await promoteNode(testDir, { nodeId: 'mem-orig', tag: 'convention' });

        // Assert
        expect(result.promotedNode.id).not.toBe('mem-orig');
        expect(result.promotedNode.id).toMatch(/^mem-[a-z0-9]{4}$/);
      });
    });

    describe('relationship creation', () => {
      it('creates discovered_from relationship to source node', async () => {
        // Arrange
        const sourceNode = createMemoryNode({
          id: 'mem-src1',
          type: 'discovery',
          lifecycle: 'wu',
          content: 'Source content',
        });
        await writeMemoryNode(sourceNode);

        // Act
        const result = await promoteNode(testDir, { nodeId: 'mem-src1', tag: 'pattern' });

        // Assert
        const relationships = await readRelationships();
        expect(relationships.length).toBe(1);
        const rel = relationships[0];
        expect(rel).toBeDefined();
        expect(rel?.from_id).toBe(result.promotedNode.id);
        expect(rel?.to_id).toBe('mem-src1');
        expect(rel?.type).toBe('discovered_from');
      });
    });

    describe('tag enforcement', () => {
      it('requires a tag from the allowed taxonomy', async () => {
        // Arrange
        const sourceNode = createMemoryNode({ id: 'mem-test' });
        await writeMemoryNode(sourceNode);

        // Act & Assert
        await expect(
          promoteNode(testDir, { nodeId: 'mem-test', tag: 'invalid-tag' }),
        ).rejects.toThrow(/tag/i);
      });

      it.each(ALLOWED_PROMOTION_TAGS)('accepts taxonomy tag: %s', async (tag) => {
        // Arrange - create valid mem-xxxx ID (exactly 4 chars, pad short tags with zeros)
        const idSuffix = (tag.substring(0, 4) + '0000').substring(0, 4).toLowerCase();
        const nodeId = `mem-${idSuffix}`;
        const sourceNode = createMemoryNode({
          id: nodeId,
          content: `Content for ${tag}`,
        });
        await writeMemoryNode(sourceNode);

        // Act
        const result = await promoteNode(testDir, {
          nodeId,
          tag,
        });

        // Assert
        expect(result.success).toBe(true);
        expect(result.promotedNode.tags).toContain(tag);
      });

      it('adds the tag to the promoted node', async () => {
        // Arrange
        const sourceNode = createMemoryNode({
          id: 'mem-tagg',
          tags: ['existing-tag'],
        });
        await writeMemoryNode(sourceNode);

        // Act
        const result = await promoteNode(testDir, { nodeId: 'mem-tagg', tag: 'decision' });

        // Assert
        expect(result.promotedNode.tags).toContain('decision');
      });
    });

    describe('dry-run mode', () => {
      it('returns what would be promoted without writing', async () => {
        // Arrange
        const sourceNode = createMemoryNode({
          id: 'mem-dryn',
          content: 'Dry run content',
        });
        await writeMemoryNode(sourceNode);

        // Act
        const result = await promoteNode(testDir, {
          nodeId: 'mem-dryn',
          tag: 'pattern',
          dryRun: true,
        });

        // Assert
        expect(result.success).toBe(true);
        expect(result.promotedNode).toBeDefined();
        expect(result.dryRun).toBe(true);
      });

      it('does not write to memory.jsonl in dry-run mode', async () => {
        // Arrange
        const sourceNode = createMemoryNode({
          id: 'mem-dryw',
          content: 'Dry run no write',
        });
        await writeMemoryNode(sourceNode);
        const nodesBefore = await readMemoryNodes();

        // Act
        await promoteNode(testDir, {
          nodeId: 'mem-dryw',
          tag: 'pattern',
          dryRun: true,
        });

        // Assert
        const nodesAfter = await readMemoryNodes();
        expect(nodesAfter.length).toBe(nodesBefore.length);
      });

      it('does not write relationships in dry-run mode', async () => {
        // Arrange
        const sourceNode = createMemoryNode({
          id: 'mem-dryr',
          content: 'Dry run no relationship',
        });
        await writeMemoryNode(sourceNode);

        // Act
        await promoteNode(testDir, {
          nodeId: 'mem-dryr',
          tag: 'pattern',
          dryRun: true,
        });

        // Assert
        const relationships = await readRelationships();
        expect(relationships.length).toBe(0);
      });
    });

    describe('error handling', () => {
      it('throws if source node not found', async () => {
        // Act & Assert
        await expect(promoteNode(testDir, { nodeId: 'mem-miss', tag: 'pattern' })).rejects.toThrow(
          /not found/i,
        );
      });

      it('throws if source node is already project lifecycle', async () => {
        // Arrange
        const projectNode = createMemoryNode({
          id: 'mem-proj',
          lifecycle: 'project',
          content: 'Already project level',
        });
        await writeMemoryNode(projectNode);

        // Act & Assert
        await expect(promoteNode(testDir, { nodeId: 'mem-proj', tag: 'pattern' })).rejects.toThrow(
          /already.*project/i,
        );
      });
    });
  });

  describe('promoteFromWu', () => {
    describe('basic functionality', () => {
      it('promotes all summaries from a WU', async () => {
        // Arrange
        const summary1 = createMemoryNode({
          id: 'mem-sum1',
          type: 'summary',
          lifecycle: 'wu',
          content: 'First summary from WU',
          wu_id: 'WU-1234',
        });
        const summary2 = createMemoryNode({
          id: 'mem-sum2',
          type: 'summary',
          lifecycle: 'wu',
          content: 'Second summary from WU',
          wu_id: 'WU-1234',
        });
        const otherWuSummary = createMemoryNode({
          id: 'mem-sum3',
          type: 'summary',
          lifecycle: 'wu',
          content: 'Summary from different WU',
          wu_id: 'WU-9999',
        });
        await writeMemoryNode(summary1);
        await writeMemoryNode(summary2);
        await writeMemoryNode(otherWuSummary);

        const options: PromoteFromWuOptions = {
          wuId: 'WU-1234',
          tag: 'pattern',
        };

        // Act
        const result = await promoteFromWu(testDir, options);

        // Assert
        expect(result.success).toBe(true);
        expect(result.promotedNodes.length).toBe(2);
        expect(result.promotedNodes.every(isProjectLifecycle)).toBe(true);
      });

      it('creates relationships for all promoted nodes', async () => {
        // Arrange
        const summary1 = createMemoryNode({
          id: 'mem-ws01',
          type: 'summary',
          lifecycle: 'wu',
          content: 'Summary 1',
          wu_id: 'WU-5678',
        });
        const summary2 = createMemoryNode({
          id: 'mem-ws02',
          type: 'summary',
          lifecycle: 'wu',
          content: 'Summary 2',
          wu_id: 'WU-5678',
        });
        await writeMemoryNode(summary1);
        await writeMemoryNode(summary2);

        // Act
        await promoteFromWu(testDir, { wuId: 'WU-5678', tag: 'decision' });

        // Assert
        const relationships = await readRelationships();
        expect(relationships.length).toBe(2);
        expect(relationships.every(isDiscoveredFromRelation)).toBe(true);
      });

      it('returns empty result if no summaries found', async () => {
        // Arrange - no summaries for this WU
        const noteNode = createMemoryNode({
          id: 'mem-note',
          type: 'note',
          lifecycle: 'wu',
          content: 'Not a summary',
          wu_id: 'WU-1111',
        });
        await writeMemoryNode(noteNode);

        // Act
        const result = await promoteFromWu(testDir, { wuId: 'WU-1111', tag: 'pattern' });

        // Assert
        expect(result.success).toBe(true);
        expect(result.promotedNodes.length).toBe(0);
      });
    });

    describe('dry-run mode', () => {
      it('shows what would be promoted without writing', async () => {
        // Arrange
        const summary = createMemoryNode({
          id: 'mem-wdry',
          type: 'summary',
          lifecycle: 'wu',
          content: 'WU dry run summary',
          wu_id: 'WU-2222',
        });
        await writeMemoryNode(summary);
        const nodesBefore = await readMemoryNodes();

        // Act
        const result = await promoteFromWu(testDir, {
          wuId: 'WU-2222',
          tag: 'pattern',
          dryRun: true,
        });

        // Assert
        expect(result.success).toBe(true);
        expect(result.dryRun).toBe(true);
        expect(result.promotedNodes.length).toBe(1);

        const nodesAfter = await readMemoryNodes();
        expect(nodesAfter.length).toBe(nodesBefore.length);
      });
    });

    describe('tag enforcement', () => {
      it('applies the tag to all promoted nodes', async () => {
        // Arrange
        const summary = createMemoryNode({
          id: 'mem-wtag',
          type: 'summary',
          lifecycle: 'wu',
          content: 'Summary for tagging',
          wu_id: 'WU-3333',
        });
        await writeMemoryNode(summary);

        // Act
        const result = await promoteFromWu(testDir, { wuId: 'WU-3333', tag: 'invariant' });

        // Assert
        expect(result.promotedNodes.every(hasInvariantTag)).toBe(true);
      });

      it('rejects invalid tags', async () => {
        // Arrange
        const summary = createMemoryNode({
          id: 'mem-wbad',
          type: 'summary',
          lifecycle: 'wu',
          wu_id: 'WU-4444',
        });
        await writeMemoryNode(summary);

        // Act & Assert
        await expect(
          promoteFromWu(testDir, { wuId: 'WU-4444', tag: 'not-allowed' }),
        ).rejects.toThrow(/tag/i);
      });
    });

    describe('error handling', () => {
      it('throws for invalid WU ID format', async () => {
        // Act & Assert
        await expect(promoteFromWu(testDir, { wuId: 'invalid', tag: 'pattern' })).rejects.toThrow(
          /WU ID/i,
        );
      });
    });
  });
});
