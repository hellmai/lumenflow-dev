/**
 * Memory Profile Core Tests (WU-1237)
 *
 * Tests for the mem:profile command core logic that renders top N
 * project-level memories for injection into agent context.
 *
 * Tests cover:
 * - Filtering by lifecycle=project
 * - Limit configuration (default N=20)
 * - Tag filtering (--tag decision)
 * - Output format compatible with mem:context
 * - Deterministic ordering
 *
 * @see {@link packages/@lumenflow/memory/src/mem-profile-core.ts} - Implementation
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  generateProfile,
  DEFAULT_PROFILE_LIMIT,
  type GenerateProfileOptions,
} from '../src/mem-profile-core.js';

/**
 * Test fixture constants
 */
const TEST_TIMESTAMP = '2025-01-15T10:00:00.000Z';
const TEST_TIMESTAMP_OLD = '2025-01-01T10:00:00.000Z';
const TEST_TIMESTAMP_NEW = '2025-01-30T10:00:00.000Z';

describe('mem-profile-core (WU-1237)', () => {
  let testDir: string;
  let memoryDir: string;

  beforeEach(async () => {
    // Create a temporary directory for tests
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mem-profile-test-'));
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
   * Helper to create a standard memory node
   */
  function createMemoryNode(
    overrides: Partial<Record<string, unknown>> = {},
  ): Record<string, unknown> {
    return {
      // eslint-disable-next-line sonarjs/pseudo-random -- Only used for test fixture IDs
      id: `mem-${Math.random().toString(36).substring(2, 6)}`,
      type: 'note',
      lifecycle: 'project',
      content: 'Test content',
      created_at: new Date().toISOString(),
      ...overrides,
    };
  }

  describe('DEFAULT_PROFILE_LIMIT', () => {
    it('exports default limit of 20', () => {
      expect(DEFAULT_PROFILE_LIMIT).toBe(20);
    });
  });

  describe('generateProfile', () => {
    describe('basic functionality', () => {
      it('returns project-level memories', async () => {
        // Arrange
        const projectNode = createMemoryNode({
          id: 'mem-proj',
          lifecycle: 'project',
          content: 'Project knowledge',
          tags: ['pattern'],
        });
        await writeMemoryNode(projectNode);

        // Act
        const result = await generateProfile(testDir);

        // Assert
        expect(result.success).toBe(true);
        expect(result.nodes.length).toBe(1);
        const firstNode = result.nodes[0];
        expect(firstNode).toBeDefined();
        expect(firstNode?.lifecycle).toBe('project');
      });

      it('filters out non-project lifecycle nodes', async () => {
        // Arrange
        const projectNode = createMemoryNode({
          id: 'mem-prjn',
          lifecycle: 'project',
          content: 'Project content',
        });
        const sessionNode = createMemoryNode({
          id: 'mem-sess',
          lifecycle: 'session',
          content: 'Session content',
        });
        const wuNode = createMemoryNode({
          id: 'mem-wuuu',
          lifecycle: 'wu',
          content: 'WU content',
        });
        await writeMemoryNode(projectNode);
        await writeMemoryNode(sessionNode);
        await writeMemoryNode(wuNode);

        // Act
        const result = await generateProfile(testDir);

        // Assert
        expect(result.nodes.length).toBe(1);
        const projectOnly = result.nodes[0];
        expect(projectOnly).toBeDefined();
        expect(projectOnly?.id).toBe('mem-prjn');
      });

      it('returns empty result when no project nodes exist', async () => {
        // Arrange
        const sessionNode = createMemoryNode({
          id: 'mem-only',
          lifecycle: 'session',
          content: 'Only session node',
        });
        await writeMemoryNode(sessionNode);

        // Act
        const result = await generateProfile(testDir);

        // Assert
        expect(result.success).toBe(true);
        expect(result.nodes.length).toBe(0);
        expect(result.profileBlock).toBe('');
      });
    });

    describe('limit configuration', () => {
      it('limits to default N=20 nodes', async () => {
        // Arrange - create 25 project nodes
        for (let i = 0; i < 25; i++) {
          const node = createMemoryNode({
            id: `mem-n${i.toString().padStart(3, '0')}`,
            lifecycle: 'project',
            content: `Project node ${i}`,
            created_at: new Date(Date.now() - i * 1000).toISOString(),
          });
          await writeMemoryNode(node);
        }

        // Act
        const result = await generateProfile(testDir);

        // Assert
        expect(result.nodes.length).toBe(20);
      });

      it('allows configuring limit via option', async () => {
        // Arrange - create 15 project nodes
        for (let i = 0; i < 15; i++) {
          const node = createMemoryNode({
            id: `mem-l${i.toString().padStart(3, '0')}`,
            lifecycle: 'project',
            content: `Node ${i}`,
          });
          await writeMemoryNode(node);
        }

        const options: GenerateProfileOptions = {
          limit: 5,
        };

        // Act
        const result = await generateProfile(testDir, options);

        // Assert
        expect(result.nodes.length).toBe(5);
      });

      it('returns all nodes when fewer than limit exist', async () => {
        // Arrange - create 3 project nodes
        for (let i = 0; i < 3; i++) {
          const node = createMemoryNode({
            id: `mem-f${i.toString().padStart(3, '0')}`,
            lifecycle: 'project',
            content: `Few node ${i}`,
          });
          await writeMemoryNode(node);
        }

        // Act
        const result = await generateProfile(testDir, { limit: 10 });

        // Assert
        expect(result.nodes.length).toBe(3);
      });
    });

    describe('tag filtering', () => {
      it('filters by tag category when specified', async () => {
        // Arrange
        const decisionNode = createMemoryNode({
          id: 'mem-dec1',
          lifecycle: 'project',
          content: 'A decision',
          tags: ['decision'],
        });
        const patternNode = createMemoryNode({
          id: 'mem-pat1',
          lifecycle: 'project',
          content: 'A pattern',
          tags: ['pattern'],
        });
        const conventionNode = createMemoryNode({
          id: 'mem-con1',
          lifecycle: 'project',
          content: 'A convention',
          tags: ['convention'],
        });
        await writeMemoryNode(decisionNode);
        await writeMemoryNode(patternNode);
        await writeMemoryNode(conventionNode);

        // Act
        const result = await generateProfile(testDir, { tag: 'decision' });

        // Assert
        expect(result.nodes.length).toBe(1);
        const decisionFiltered = result.nodes[0];
        expect(decisionFiltered).toBeDefined();
        expect(decisionFiltered?.id).toBe('mem-dec1');
      });

      it('returns empty when no nodes match tag filter', async () => {
        // Arrange
        const patternNode = createMemoryNode({
          id: 'mem-pmis',
          lifecycle: 'project',
          content: 'A pattern',
          tags: ['pattern'],
        });
        await writeMemoryNode(patternNode);

        // Act
        const result = await generateProfile(testDir, { tag: 'decision' });

        // Assert
        expect(result.nodes.length).toBe(0);
      });

      it('handles nodes with multiple tags', async () => {
        // Arrange
        const multiTagNode = createMemoryNode({
          id: 'mem-mult',
          lifecycle: 'project',
          content: 'Multi-tag node',
          tags: ['decision', 'pattern'],
        });
        await writeMemoryNode(multiTagNode);

        // Act - filter by either tag should match
        const decisionResult = await generateProfile(testDir, { tag: 'decision' });
        const patternResult = await generateProfile(testDir, { tag: 'pattern' });

        // Assert
        expect(decisionResult.nodes.length).toBe(1);
        expect(patternResult.nodes.length).toBe(1);
      });
    });

    describe('output format', () => {
      it('produces formatted profile block compatible with mem:context', async () => {
        // Arrange
        const node = createMemoryNode({
          id: 'mem-fmt1',
          lifecycle: 'project',
          content: 'Formatted content',
          tags: ['pattern'],
        });
        await writeMemoryNode(node);

        // Act
        const result = await generateProfile(testDir);

        // Assert
        expect(result.profileBlock).toBeDefined();
        expect(typeof result.profileBlock).toBe('string');
        expect(result.profileBlock.length).toBeGreaterThan(0);
      });

      it('includes section header for integration', async () => {
        // Arrange
        const node = createMemoryNode({
          id: 'mem-hdr1',
          lifecycle: 'project',
          content: 'Header test',
        });
        await writeMemoryNode(node);

        // Act
        const result = await generateProfile(testDir);

        // Assert
        expect(result.profileBlock).toContain('## Project Profile');
      });

      it('formats each node with ID, date, and content', async () => {
        // Arrange
        const node = createMemoryNode({
          id: 'mem-fmtn',
          lifecycle: 'project',
          content: 'Node content for format check',
          created_at: TEST_TIMESTAMP,
        });
        await writeMemoryNode(node);

        // Act
        const result = await generateProfile(testDir);

        // Assert
        expect(result.profileBlock).toContain('[mem-fmtn]');
        expect(result.profileBlock).toContain('2025-01-15');
        expect(result.profileBlock).toContain('Node content for format check');
      });

      it('outputs empty string when no nodes found', async () => {
        // Act
        const result = await generateProfile(testDir);

        // Assert
        expect(result.profileBlock).toBe('');
      });
    });

    describe('ordering', () => {
      it('orders by recency (most recent first)', async () => {
        // Arrange
        const oldNode = createMemoryNode({
          id: 'mem-old1',
          lifecycle: 'project',
          content: 'Old content',
          created_at: TEST_TIMESTAMP_OLD,
        });
        const newNode = createMemoryNode({
          id: 'mem-new1',
          lifecycle: 'project',
          content: 'New content',
          created_at: TEST_TIMESTAMP_NEW,
        });
        await writeMemoryNode(oldNode);
        await writeMemoryNode(newNode);

        // Act
        const result = await generateProfile(testDir);

        // Assert
        const first = result.nodes[0];
        const second = result.nodes[1];
        expect(first).toBeDefined();
        expect(second).toBeDefined();
        expect(first?.id).toBe('mem-new1');
        expect(second?.id).toBe('mem-old1');
      });

      it('is deterministic for same input', async () => {
        // Arrange
        const node1 = createMemoryNode({
          id: 'mem-det1',
          lifecycle: 'project',
          content: 'Deterministic 1',
          created_at: TEST_TIMESTAMP,
        });
        const node2 = createMemoryNode({
          id: 'mem-det2',
          lifecycle: 'project',
          content: 'Deterministic 2',
          created_at: TEST_TIMESTAMP,
        });
        await writeMemoryNode(node1);
        await writeMemoryNode(node2);

        // Act
        const result1 = await generateProfile(testDir);
        const result2 = await generateProfile(testDir);
        const result3 = await generateProfile(testDir);

        // Assert
        expect(result1.profileBlock).toBe(result2.profileBlock);
        expect(result2.profileBlock).toBe(result3.profileBlock);
      });
    });

    describe('statistics', () => {
      it('returns stats about profile generation', async () => {
        // Arrange
        for (let i = 0; i < 5; i++) {
          const node = createMemoryNode({
            id: `mem-st${i.toString().padStart(2, '0')}`,
            lifecycle: 'project',
            content: `Stats node ${i}`,
            tags: i % 2 === 0 ? ['decision'] : ['pattern'],
          });
          await writeMemoryNode(node);
        }

        // Act
        const result = await generateProfile(testDir);

        // Assert
        expect(result.stats).toBeDefined();
        expect(result.stats.totalProjectNodes).toBe(5);
        expect(result.stats.includedNodes).toBe(5);
        expect(result.stats.byTag).toBeDefined();
      });

      it('includes tag breakdown in stats', async () => {
        // Arrange
        const decisionNode = createMemoryNode({
          id: 'mem-std1',
          lifecycle: 'project',
          tags: ['decision'],
        });
        const patternNode1 = createMemoryNode({
          id: 'mem-stp1',
          lifecycle: 'project',
          tags: ['pattern'],
        });
        const patternNode2 = createMemoryNode({
          id: 'mem-stp2',
          lifecycle: 'project',
          tags: ['pattern'],
        });
        await writeMemoryNode(decisionNode);
        await writeMemoryNode(patternNode1);
        await writeMemoryNode(patternNode2);

        // Act
        const result = await generateProfile(testDir);

        // Assert
        expect(result.stats.byTag.decision).toBe(1);
        expect(result.stats.byTag.pattern).toBe(2);
      });
    });

    describe('error handling', () => {
      it('handles missing memory directory gracefully', async () => {
        // Arrange - delete the memory directory
        await fs.rm(memoryDir, { recursive: true, force: true });

        // Act
        const result = await generateProfile(testDir);

        // Assert
        expect(result.success).toBe(true);
        expect(result.nodes.length).toBe(0);
      });

      it('handles empty memory file gracefully', async () => {
        // Arrange - create empty file
        const filePath = path.join(memoryDir, 'memory.jsonl');
        await fs.writeFile(filePath, '', 'utf-8');

        // Act
        const result = await generateProfile(testDir);

        // Assert
        expect(result.success).toBe(true);
        expect(result.nodes.length).toBe(0);
      });
    });
  });
});
