/**
 * Memory Context Core Tests (WU-1234, WU-1281)
 *
 * Tests for the mem:context command core logic that produces deterministic,
 * formatted context injection blocks for wu:spawn prompts.
 *
 * Tests cover:
 * - Selection logic (lifecycle=project, wu_id match, recency)
 * - Output formatting (structured markdown with clear sections)
 * - Max context size configuration (default 4KB)
 * - Graceful degradation (empty block if no memories match)
 * - WU-1281: Lane filtering, recency limits, context prioritization
 *
 * @see {@link packages/@lumenflow/memory/src/mem-context-core.ts} - Implementation
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { generateContext } from '../src/mem-context-core.js';

/**
 * Test constants to avoid duplicate string literals (sonarjs/no-duplicate-string)
 */
const TEST_WU_ID = 'WU-1234';
const TEST_TIMESTAMP_EARLY = '2025-01-01T10:00:00.000Z';
const TEST_TIMESTAMP_MID = '2025-01-15T10:00:00.000Z';
const TEST_TIMESTAMP_LATE = '2025-01-30T10:00:00.000Z';
const LANE_FRAMEWORK_MEMORY = 'Framework: Memory';
const LANE_FRAMEWORK_CORE = 'Framework: Core';

describe('mem-context-core (WU-1234)', () => {
  let testDir: string;
  let memoryDir: string;

  beforeEach(async () => {
    // Create a temporary directory for tests
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mem-context-test-'));
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
      lifecycle: 'wu',
      content: 'Test content',
      created_at: new Date().toISOString(),
      ...overrides,
    };
  }

  describe('generateContext', () => {
    describe('basic functionality', () => {
      it('outputs formatted context block with --wu flag', async () => {
        // Arrange
        const wuNode = createMemoryNode({
          type: 'checkpoint',
          lifecycle: 'wu',
          content: 'WU checkpoint content',
          wu_id: 'WU-1234',
        });
        await writeMemoryNode(wuNode);

        // Act
        const result = await generateContext(testDir, { wuId: 'WU-1234' });

        // Assert
        expect(result.success).toBe(true);
        expect(result.contextBlock).toBeDefined();
        expect(typeof result.contextBlock).toBe('string');
        expect(result.contextBlock.length).toBeGreaterThan(0);
      });

      it('returns empty block if no memories match (graceful degradation)', async () => {
        // Arrange - no memories in store

        // Act
        const result = await generateContext(testDir, { wuId: 'WU-9999' });

        // Assert
        expect(result.success).toBe(true);
        expect(result.contextBlock).toBe('');
        expect(result.stats.totalNodes).toBe(0);
      });

      it('handles missing memory directory gracefully', async () => {
        // Arrange - delete the memory directory
        await fs.rm(memoryDir, { recursive: true, force: true });

        // Act
        const result = await generateContext(testDir, { wuId: 'WU-1234' });

        // Assert
        expect(result.success).toBe(true);
        expect(result.contextBlock).toBe('');
        expect(result.stats.totalNodes).toBe(0);
      });
    });

    describe('context block sections', () => {
      it('includes project profile section for lifecycle=project memories', async () => {
        // Arrange
        const projectNode = createMemoryNode({
          type: 'note',
          lifecycle: 'project',
          content: 'Project architecture decision: Use hexagonal pattern',
        });
        await writeMemoryNode(projectNode);

        // Act
        const result = await generateContext(testDir, { wuId: 'WU-1234' });

        // Assert
        expect(result.contextBlock).toContain('## Project Profile');
        expect(result.contextBlock).toContain('hexagonal pattern');
      });

      it('includes relevant summaries section for summary type nodes', async () => {
        // Arrange
        const summaryNode = createMemoryNode({
          type: 'summary',
          lifecycle: 'wu',
          content: 'Summary of WU-1234 progress: completed TDD tests',
          wu_id: 'WU-1234',
        });
        await writeMemoryNode(summaryNode);

        // Act
        const result = await generateContext(testDir, { wuId: 'WU-1234' });

        // Assert
        expect(result.contextBlock).toContain('## Summaries');
        expect(result.contextBlock).toContain('completed TDD tests');
      });

      it('includes WU context section for wu_id matching nodes', async () => {
        // Arrange
        const wuNode = createMemoryNode({
          type: 'checkpoint',
          lifecycle: 'wu',
          content: 'Checkpoint: implemented port definitions',
          wu_id: 'WU-1234',
        });
        await writeMemoryNode(wuNode);

        // Act
        const result = await generateContext(testDir, { wuId: 'WU-1234' });

        // Assert
        expect(result.contextBlock).toContain('## WU Context');
        expect(result.contextBlock).toContain('implemented port definitions');
      });

      it('includes discoveries section for discovery type nodes', async () => {
        // Arrange
        const discoveryNode = createMemoryNode({
          type: 'discovery',
          lifecycle: 'wu',
          content: 'Found: memory schema defined in memory-schema.ts',
          wu_id: 'WU-1234',
        });
        await writeMemoryNode(discoveryNode);

        // Act
        const result = await generateContext(testDir, { wuId: 'WU-1234' });

        // Assert
        expect(result.contextBlock).toContain('## Discoveries');
        expect(result.contextBlock).toContain('memory-schema.ts');
      });
    });

    describe('selection logic', () => {
      it('filters by lifecycle=project for project profile items', async () => {
        // Arrange
        const projectNode = createMemoryNode({
          type: 'note',
          lifecycle: 'project',
          content: 'Project-level knowledge',
        });
        const sessionNode = createMemoryNode({
          type: 'note',
          lifecycle: 'session',
          content: 'Session-level note (should not appear in profile)',
        });
        await writeMemoryNode(projectNode);
        await writeMemoryNode(sessionNode);

        // Act
        const result = await generateContext(testDir, { wuId: 'WU-1234' });

        // Assert
        expect(result.contextBlock).toContain('Project-level knowledge');
        // Project profile should only include project lifecycle nodes
        const profileSection = result.contextBlock.split('## Summaries')[0] || result.contextBlock;
        expect(profileSection).not.toContain('Session-level note');
      });

      it('filters by wu_id match for WU-specific context', async () => {
        // Arrange
        const matchingNode = createMemoryNode({
          type: 'checkpoint',
          lifecycle: 'wu',
          content: 'Relevant to WU-1234',
          wu_id: 'WU-1234',
        });
        const nonMatchingNode = createMemoryNode({
          type: 'checkpoint',
          lifecycle: 'wu',
          content: 'Belongs to WU-9999',
          wu_id: 'WU-9999',
        });
        await writeMemoryNode(matchingNode);
        await writeMemoryNode(nonMatchingNode);

        // Act
        const result = await generateContext(testDir, { wuId: 'WU-1234' });

        // Assert
        expect(result.contextBlock).toContain('Relevant to WU-1234');
        expect(result.contextBlock).not.toContain('Belongs to WU-9999');
      });

      it('orders by recency (most recent first)', async () => {
        // Arrange
        const oldNode = createMemoryNode({
          type: 'checkpoint',
          lifecycle: 'wu',
          content: 'Old checkpoint',
          wu_id: TEST_WU_ID,
          created_at: TEST_TIMESTAMP_EARLY,
        });
        const newNode = createMemoryNode({
          type: 'checkpoint',
          lifecycle: 'wu',
          content: 'New checkpoint',
          wu_id: TEST_WU_ID,
          created_at: TEST_TIMESTAMP_LATE,
        });
        await writeMemoryNode(oldNode);
        await writeMemoryNode(newNode);

        // Act
        const result = await generateContext(testDir, { wuId: 'WU-1234' });

        // Assert - newer should appear before older
        const newIndex = result.contextBlock.indexOf('New checkpoint');
        const oldIndex = result.contextBlock.indexOf('Old checkpoint');
        expect(newIndex).toBeLessThan(oldIndex);
      });

      it('selection is deterministic (same input produces same output)', async () => {
        // Arrange
        const node1 = createMemoryNode({
          id: 'mem-aaaa',
          type: 'checkpoint',
          lifecycle: 'wu',
          content: 'Checkpoint A',
          wu_id: TEST_WU_ID,
          created_at: TEST_TIMESTAMP_MID,
        });
        const node2 = createMemoryNode({
          id: 'mem-bbbb',
          type: 'checkpoint',
          lifecycle: 'wu',
          content: 'Checkpoint B',
          wu_id: TEST_WU_ID,
          created_at: TEST_TIMESTAMP_MID,
        });
        await writeMemoryNode(node1);
        await writeMemoryNode(node2);

        // Act - run multiple times
        const result1 = await generateContext(testDir, { wuId: 'WU-1234' });
        const result2 = await generateContext(testDir, { wuId: 'WU-1234' });
        const result3 = await generateContext(testDir, { wuId: 'WU-1234' });

        // Assert - all results should be identical
        expect(result1.contextBlock).toBe(result2.contextBlock);
        expect(result2.contextBlock).toBe(result3.contextBlock);
      });
    });

    describe('output format', () => {
      it('produces structured markdown with clear sections', async () => {
        // Arrange
        const projectNode = createMemoryNode({
          type: 'note',
          lifecycle: 'project',
          content: 'Project context',
        });
        const summaryNode = createMemoryNode({
          type: 'summary',
          lifecycle: 'wu',
          content: 'WU summary',
          wu_id: 'WU-1234',
        });
        const checkpointNode = createMemoryNode({
          type: 'checkpoint',
          lifecycle: 'wu',
          content: 'Progress checkpoint',
          wu_id: 'WU-1234',
        });
        await writeMemoryNode(projectNode);
        await writeMemoryNode(summaryNode);
        await writeMemoryNode(checkpointNode);

        // Act
        const result = await generateContext(testDir, { wuId: 'WU-1234' });

        // Assert - check markdown structure
        expect(result.contextBlock).toMatch(/^## /m); // Has markdown headers
        expect(result.contextBlock.split('\n').length).toBeGreaterThan(1); // Multi-line
      });

      it('includes header comment for wu:spawn embedding', async () => {
        // Arrange
        const node = createMemoryNode({
          type: 'checkpoint',
          lifecycle: 'wu',
          content: 'Test checkpoint',
          wu_id: 'WU-1234',
        });
        await writeMemoryNode(node);

        // Act
        const result = await generateContext(testDir, { wuId: 'WU-1234' });

        // Assert
        expect(result.contextBlock).toContain('<!-- mem:context');
        expect(result.contextBlock).toContain('WU-1234');
      });
    });

    describe('max context size configuration', () => {
      it('respects default max size of 4KB', async () => {
        // Arrange - create many large nodes that would exceed 4KB
        for (let i = 0; i < 20; i++) {
          const node = createMemoryNode({
            id: `mem-${i.toString().padStart(4, '0')}`,
            type: 'checkpoint',
            lifecycle: 'wu',
            content: `Checkpoint ${i}: ${'x'.repeat(500)}`, // ~500 bytes each
            wu_id: 'WU-1234',
            created_at: new Date(Date.now() - i * 1000).toISOString(),
          });
          await writeMemoryNode(node);
        }

        // Act
        const result = await generateContext(testDir, { wuId: 'WU-1234' });

        // Assert - should be under 4KB (4096 bytes)
        const DEFAULT_MAX_SIZE = 4096;
        expect(result.contextBlock.length).toBeLessThanOrEqual(DEFAULT_MAX_SIZE);
        expect(result.stats.truncated).toBe(true);
      });

      it('allows configuring max size via option', async () => {
        // Arrange
        const node = createMemoryNode({
          type: 'checkpoint',
          lifecycle: 'wu',
          content: `Checkpoint with content: ${'x'.repeat(100)}`,
          wu_id: 'WU-1234',
        });
        await writeMemoryNode(node);

        // Act - set a small max size
        const result = await generateContext(testDir, {
          wuId: 'WU-1234',
          maxSize: 200,
        });

        // Assert
        expect(result.contextBlock.length).toBeLessThanOrEqual(200);
      });

      it('returns full content when under max size', async () => {
        // Arrange
        const node = createMemoryNode({
          type: 'checkpoint',
          lifecycle: 'wu',
          content: 'Short content',
          wu_id: 'WU-1234',
        });
        await writeMemoryNode(node);

        // Act
        const result = await generateContext(testDir, { wuId: 'WU-1234' });

        // Assert
        expect(result.stats.truncated).toBe(false);
        expect(result.contextBlock).toContain('Short content');
      });
    });

    describe('statistics', () => {
      it('returns stats about nodes selected', async () => {
        // Arrange
        const node1 = createMemoryNode({
          type: 'checkpoint',
          lifecycle: 'wu',
          content: 'Checkpoint 1',
          wu_id: 'WU-1234',
        });
        const node2 = createMemoryNode({
          type: 'discovery',
          lifecycle: 'wu',
          content: 'Discovery 1',
          wu_id: 'WU-1234',
        });
        await writeMemoryNode(node1);
        await writeMemoryNode(node2);

        // Act
        const result = await generateContext(testDir, { wuId: 'WU-1234' });

        // Assert
        expect(result.stats).toBeDefined();
        expect(result.stats.totalNodes).toBe(2);
        expect(result.stats.byType).toBeDefined();
        expect(result.stats.byType.checkpoint).toBe(1);
        expect(result.stats.byType.discovery).toBe(1);
      });
    });

    describe('edge cases', () => {
      it('handles empty WU ID', async () => {
        // Act & Assert
        await expect(generateContext(testDir, { wuId: '' })).rejects.toThrow(/wuId/i);
      });

      it('handles invalid WU ID format', async () => {
        // Act & Assert
        await expect(generateContext(testDir, { wuId: 'invalid-id' })).rejects.toThrow(/WU ID/i);
      });

      it('handles malformed memory.jsonl gracefully', async () => {
        // Arrange - write invalid JSON
        const filePath = path.join(memoryDir, 'memory.jsonl');
        await fs.writeFile(filePath, 'invalid json\n{"valid": true}\n', 'utf-8');

        // Act & Assert - should throw with line info
        await expect(generateContext(testDir, { wuId: 'WU-1234' })).rejects.toThrow(/line/i);
      });
    });
  });

  /**
   * WU-1281: Bug fixes for lane filtering, recency, and context prioritization
   * These tests are at top level to avoid deep nesting (sonarjs/no-nested-functions)
   */
  describe('WU-1281: lane filtering', () => {
    it('filters project memories by lane when lane option is provided', async () => {
      // Arrange - create project memories with different lanes
      const frameworkNode = createMemoryNode({
        id: 'mem-fw01',
        type: 'note',
        lifecycle: 'project',
        content: 'Framework: Memory architectural decision',
        metadata: { lane: LANE_FRAMEWORK_MEMORY },
      });
      const coreNode = createMemoryNode({
        id: 'mem-co01',
        type: 'note',
        lifecycle: 'project',
        content: 'Framework: Core architectural decision',
        metadata: { lane: LANE_FRAMEWORK_CORE },
      });
      const noLaneNode = createMemoryNode({
        id: 'mem-nl01',
        type: 'note',
        lifecycle: 'project',
        content: 'Project memory without lane',
      });
      await writeMemoryNode(frameworkNode);
      await writeMemoryNode(coreNode);
      await writeMemoryNode(noLaneNode);

      // Act - filter by Framework: Memory lane
      const result = await generateContext(testDir, {
        wuId: TEST_WU_ID,
        lane: LANE_FRAMEWORK_MEMORY,
      });

      // Assert
      expect(result.contextBlock).toContain('Framework: Memory architectural decision');
      expect(result.contextBlock).not.toContain('Framework: Core architectural decision');
      // Nodes without lane should still be included (they're general project knowledge)
      expect(result.contextBlock).toContain('Project memory without lane');
    });

    it('includes all project memories when no lane filter is specified', async () => {
      // Arrange
      const frameworkNode = createMemoryNode({
        id: 'mem-fw02',
        type: 'note',
        lifecycle: 'project',
        content: 'Framework: Memory decision',
        metadata: { lane: LANE_FRAMEWORK_MEMORY },
      });
      const coreNode = createMemoryNode({
        id: 'mem-co02',
        type: 'note',
        lifecycle: 'project',
        content: 'Framework: Core decision',
        metadata: { lane: LANE_FRAMEWORK_CORE },
      });
      await writeMemoryNode(frameworkNode);
      await writeMemoryNode(coreNode);

      // Act - no lane filter
      const result = await generateContext(testDir, { wuId: TEST_WU_ID });

      // Assert - both should be included
      expect(result.contextBlock).toContain('Framework: Memory decision');
      expect(result.contextBlock).toContain('Framework: Core decision');
    });
  });

  describe('WU-1281: recency sorting', () => {
    it('sorts summaries by recency within the summaries section', async () => {
      // Arrange - create summaries with specific timestamps
      const oldSummary = createMemoryNode({
        id: 'mem-sum1',
        type: 'summary',
        lifecycle: 'wu',
        content: 'Old summary from January',
        wu_id: TEST_WU_ID,
        created_at: '2025-01-10T10:00:00.000Z',
      });
      const recentSummary = createMemoryNode({
        id: 'mem-sum2',
        type: 'summary',
        lifecycle: 'wu',
        content: 'Recent summary from January 25th',
        wu_id: TEST_WU_ID,
        created_at: '2025-01-25T10:00:00.000Z',
      });
      const midSummary = createMemoryNode({
        id: 'mem-sum3',
        type: 'summary',
        lifecycle: 'wu',
        content: 'Mid summary from January 15th',
        wu_id: TEST_WU_ID,
        created_at: TEST_TIMESTAMP_MID,
      });
      // Write in non-chronological order to test sorting
      await writeMemoryNode(oldSummary);
      await writeMemoryNode(recentSummary);
      await writeMemoryNode(midSummary);

      // Act
      const result = await generateContext(testDir, { wuId: TEST_WU_ID });

      // Assert - most recent should appear first
      const recentIdx = result.contextBlock.indexOf('Recent summary from January 25th');
      const midIdx = result.contextBlock.indexOf('Mid summary from January 15th');
      const oldIdx = result.contextBlock.indexOf('Old summary from January');
      expect(recentIdx).toBeLessThan(midIdx);
      expect(midIdx).toBeLessThan(oldIdx);
    });

    it('applies recency limit to summaries (keeps N most recent)', async () => {
      // Arrange - create many summaries
      for (let i = 0; i < 10; i++) {
        const summary = createMemoryNode({
          id: `mem-s${i.toString().padStart(3, '0')}`,
          type: 'summary',
          lifecycle: 'wu',
          content: `Summary number ${i}`,
          wu_id: TEST_WU_ID,
          created_at: new Date(Date.UTC(2025, 0, i + 1)).toISOString(),
        });
        await writeMemoryNode(summary);
      }

      // Act - request with max recent summaries
      const result = await generateContext(testDir, {
        wuId: TEST_WU_ID,
        maxRecentSummaries: 3,
      });

      // Assert - only 3 most recent summaries (Summary 7, 8, 9 - days 8, 9, 10)
      expect(result.contextBlock).toContain('Summary number 9');
      expect(result.contextBlock).toContain('Summary number 8');
      expect(result.contextBlock).toContain('Summary number 7');
      expect(result.contextBlock).not.toContain('Summary number 0');
      expect(result.contextBlock).not.toContain('Summary number 6');
    });
  });

  describe('WU-1281: context prioritization', () => {
    it('includes WU-specific content before project content when space is limited', async () => {
      // Arrange - create content that would exceed max size if all included
      // WU-specific content (high priority)
      const wuCheckpoint = createMemoryNode({
        id: 'mem-wc01',
        type: 'checkpoint',
        lifecycle: 'wu',
        content: 'Critical WU checkpoint that must be included',
        wu_id: TEST_WU_ID,
        created_at: TEST_TIMESTAMP_LATE,
      });
      const wuDiscovery = createMemoryNode({
        id: 'mem-wd01',
        type: 'discovery',
        lifecycle: 'wu',
        content: 'Important WU discovery that must be included',
        wu_id: TEST_WU_ID,
        created_at: TEST_TIMESTAMP_LATE,
      });

      // Project-level content (lower priority)
      const projectNote1 = createMemoryNode({
        id: 'mem-pn01',
        type: 'note',
        lifecycle: 'project',
        content: `Large project note A: ${'x'.repeat(500)}`,
        created_at: TEST_TIMESTAMP_EARLY,
      });
      const projectNote2 = createMemoryNode({
        id: 'mem-pn02',
        type: 'note',
        lifecycle: 'project',
        content: `Large project note B: ${'y'.repeat(500)}`,
        created_at: '2025-01-02T10:00:00.000Z',
      });
      const projectNote3 = createMemoryNode({
        id: 'mem-pn03',
        type: 'note',
        lifecycle: 'project',
        content: `Large project note C: ${'z'.repeat(500)}`,
        created_at: '2025-01-03T10:00:00.000Z',
      });

      await writeMemoryNode(wuCheckpoint);
      await writeMemoryNode(wuDiscovery);
      await writeMemoryNode(projectNote1);
      await writeMemoryNode(projectNote2);
      await writeMemoryNode(projectNote3);

      // Act - use a small max size that can't fit everything
      const result = await generateContext(testDir, {
        wuId: TEST_WU_ID,
        maxSize: 800, // Small enough that not everything fits
      });

      // Assert - WU-specific content must be included
      expect(result.contextBlock).toContain('Critical WU checkpoint');
      expect(result.contextBlock).toContain('Important WU discovery');
      // Project content may be truncated
      expect(result.stats.truncated).toBe(true);
    });

    it('limits project-level memories to prevent unbounded growth', async () => {
      // Arrange - create many project memories
      for (let i = 0; i < 20; i++) {
        const projectNode = createMemoryNode({
          id: `mem-p${i.toString().padStart(3, '0')}`,
          type: 'note',
          lifecycle: 'project',
          content: `Project memory ${i}: ${'x'.repeat(200)}`,
          created_at: new Date(Date.UTC(2025, 0, i + 1)).toISOString(),
        });
        await writeMemoryNode(projectNode);
      }

      // Create some WU-specific content
      const wuNode = createMemoryNode({
        id: 'mem-wu01',
        type: 'checkpoint',
        lifecycle: 'wu',
        content: 'WU specific checkpoint that must appear',
        wu_id: TEST_WU_ID,
        created_at: TEST_TIMESTAMP_LATE,
      });
      await writeMemoryNode(wuNode);

      // Act - with default max size (4KB)
      const result = await generateContext(testDir, {
        wuId: TEST_WU_ID,
        maxProjectNodes: 5, // Limit project nodes
      });

      // Assert - WU content is included
      expect(result.contextBlock).toContain('WU specific checkpoint');
      // Project memories are limited (stats should show bounded count)
      const projectCount = result.stats.byType.note || 0;
      expect(projectCount).toBeLessThanOrEqual(5);
    });

    it('reports prioritization in stats', async () => {
      // Arrange
      const projectNode = createMemoryNode({
        id: 'mem-pj01',
        type: 'note',
        lifecycle: 'project',
        content: 'Project note',
      });
      const wuNode = createMemoryNode({
        id: 'mem-wu02',
        type: 'checkpoint',
        lifecycle: 'wu',
        content: 'WU checkpoint',
        wu_id: TEST_WU_ID,
      });
      await writeMemoryNode(projectNode);
      await writeMemoryNode(wuNode);

      // Act
      const result = await generateContext(testDir, { wuId: TEST_WU_ID });

      // Assert - stats should include priority information
      expect(result.stats).toBeDefined();
      expect(result.stats.byType).toBeDefined();
      expect(result.stats.byType.checkpoint).toBe(1);
      expect(result.stats.byType.note).toBe(1);
    });
  });
});
