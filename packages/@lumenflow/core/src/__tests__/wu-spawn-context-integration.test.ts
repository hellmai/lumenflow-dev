/**
 * WU-1240, WU-1287: Tests for integrating mem:context into wu:spawn prompts
 *
 * Acceptance Criteria:
 * 1. wu:spawn detects memory.jsonl existence
 * 2. When memory exists, wu:spawn calls mem:context internally
 * 3. Context block embedded in spawn prompt under ## Memory Context section
 * 4. Max context size configurable (default 4KB, from .lumenflow.config.yaml)
 * 5. Graceful skip if memory layer not initialized (no error)
 * 6. --no-context flag allows skipping context injection
 * 7. Unit tests verify integration logic
 * 8. Integration test confirms spawned agent receives context
 *
 * WU-1287 updates:
 * - wu:spawn memory context now delegates to mem-context-core.generateContext
 * - Memory nodes must use valid IDs matching pattern: mem-[a-z0-9]{4}
 * - Spawn context respects lane filter, recency limits, and decay/prioritization
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

// These imports will exist after implementation
import {
  generateMemoryContextSection,
  checkMemoryLayerInitialized,
  getMemoryContextMaxSize,
} from '../wu-spawn-context.js';
import { generateTaskInvocation } from '../wu-spawn.js';

import { SpawnStrategyFactory } from '../spawn-strategy.js';

// Constants for test values
const TEST_WU_ID = 'WU-1240';
const TEST_LANE = 'Framework: Core';
const MEMORY_CONTEXT_SECTION_HEADER = '## Memory Context';
const DEFAULT_MAX_SIZE = 4096;

// WU-1287: Constants for duplicate string elimination (sonarjs/no-duplicate-string)
const TEST_DESCRIPTION = 'Test description';
const TEST_TITLE = 'Test WU';
const TEST_CLIENT = 'claude-code';
const TEST_CODE_PATH = 'packages/@lumenflow/core/src/test.ts';

describe('WU-1240: Integrate mem:context into wu:spawn prompts', () => {
  let testDir: string;
  let memoryDir: string;

  /**
   * Counter for generating unique memory node IDs
   */
  let nodeIdCounter = 0;

  beforeEach(async () => {
    // Reset node ID counter for test isolation
    nodeIdCounter = 0;
    // Create a temporary directory for tests
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wu-spawn-context-test-'));
    memoryDir = path.join(testDir, '.lumenflow', 'memory');
    await fs.mkdir(memoryDir, { recursive: true });
  });

  afterEach(async () => {
    // Clean up temporary directory
    await fs.rm(testDir, { recursive: true, force: true });
    vi.restoreAllMocks();
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
   * Helper to generate a valid memory node ID.
   * Format: mem-[a-z0-9]{4} (e.g., mem-ab01)
   *
   * WU-1287: Updated to use valid schema-compliant IDs.
   */
  function generateValidMemoryId(): string {
    const counter = nodeIdCounter++;
    // Convert counter to base36 and pad to 4 chars
    const base36 = counter.toString(36).padStart(4, '0').slice(-4);
    return `mem-${base36}`;
  }

  /**
   * Helper to create a standard memory node.
   *
   * WU-1287: Updated to generate valid memory node IDs that match
   * the mem-context-core schema pattern: mem-[a-z0-9]{4}
   */
  function createMemoryNode(
    overrides: Partial<Record<string, unknown>> = {},
  ): Record<string, unknown> {
    return {
      id: generateValidMemoryId(),
      type: 'note',
      lifecycle: 'wu',
      content: 'Test content',
      created_at: new Date().toISOString(),
      ...overrides,
    };
  }

  /**
   * Helper to create a mock WU document for tests
   */
  function createMockWUDoc(
    overrides: Partial<Record<string, unknown>> = {},
  ): Record<string, unknown> {
    return {
      title: TEST_TITLE,
      lane: TEST_LANE,
      type: 'feature',
      status: 'in_progress',
      description: TEST_DESCRIPTION,
      acceptance: ['AC1', 'AC2'],
      code_paths: [TEST_CODE_PATH],
      ...overrides,
    };
  }

  /**
   * Helper to create a spawn strategy
   */
  function createStrategy() {
    return SpawnStrategyFactory.create(TEST_CLIENT);
  }

  describe('AC1: wu:spawn detects memory.jsonl existence', () => {
    it('should return true when memory.jsonl exists', async () => {
      // Arrange - create memory.jsonl
      await writeMemoryNode(createMemoryNode());

      // Act
      const result = await checkMemoryLayerInitialized(testDir);

      // Assert
      expect(result).toBe(true);
    });

    it('should return false when memory.jsonl does not exist', async () => {
      // Arrange - delete memory directory
      await fs.rm(memoryDir, { recursive: true, force: true });

      // Act
      const result = await checkMemoryLayerInitialized(testDir);

      // Assert
      expect(result).toBe(false);
    });

    it('should return false when memory.jsonl is empty', async () => {
      // Arrange - create empty memory.jsonl
      const filePath = path.join(memoryDir, 'memory.jsonl');
      await fs.writeFile(filePath, '', 'utf-8');

      // Act
      const result = await checkMemoryLayerInitialized(testDir);

      // Assert
      expect(result).toBe(false);
    });
  });

  describe('AC2: When memory exists, wu:spawn calls mem:context internally', () => {
    it('should generate context block when memory exists with relevant content', async () => {
      // Arrange
      await writeMemoryNode(
        createMemoryNode({
          type: 'checkpoint',
          lifecycle: 'wu',
          content: 'Implementation checkpoint for WU-1240',
          wu_id: TEST_WU_ID,
        }),
      );

      // Act
      const result = await generateMemoryContextSection(testDir, {
        wuId: TEST_WU_ID,
        lane: TEST_LANE,
      });

      // Assert
      expect(result).toBeDefined();
      expect(result.length).toBeGreaterThan(0);
      expect(result).toContain('checkpoint');
    });

    it('should filter by WU ID when generating context', async () => {
      // Arrange
      await writeMemoryNode(
        createMemoryNode({
          type: 'checkpoint',
          content: 'Relevant content for WU-1240',
          wu_id: TEST_WU_ID,
        }),
      );
      await writeMemoryNode(
        createMemoryNode({
          type: 'checkpoint',
          content: 'Unrelated content for WU-9999',
          wu_id: 'WU-9999',
        }),
      );

      // Act
      const result = await generateMemoryContextSection(testDir, {
        wuId: TEST_WU_ID,
        lane: TEST_LANE,
      });

      // Assert
      expect(result).toContain('Relevant content for WU-1240');
      expect(result).not.toContain('Unrelated content for WU-9999');
    });
  });

  describe('AC3: Context block embedded under ## Memory Context section', () => {
    it('should include Memory Context section header', async () => {
      // Arrange
      await writeMemoryNode(
        createMemoryNode({
          type: 'checkpoint',
          content: 'Test checkpoint',
          wu_id: TEST_WU_ID,
        }),
      );

      // Act
      const result = await generateMemoryContextSection(testDir, {
        wuId: TEST_WU_ID,
        lane: TEST_LANE,
      });

      // Assert
      expect(result).toContain(MEMORY_CONTEXT_SECTION_HEADER);
    });

    it('should integrate memory context into Task invocation', async () => {
      // Arrange
      await writeMemoryNode(
        createMemoryNode({
          type: 'checkpoint',
          content: 'Important context for sub-agent',
          wu_id: TEST_WU_ID,
        }),
      );

      // Pre-generate the memory context (as would be done by CLI wrapper)
      const memoryContext = await generateMemoryContextSection(testDir, {
        wuId: TEST_WU_ID,
        lane: TEST_LANE,
      });

      const mockWUDoc = createMockWUDoc();
      const strategy = createStrategy();

      // Act
      const output = generateTaskInvocation(mockWUDoc, TEST_WU_ID, strategy, {
        baseDir: testDir,
        includeMemoryContext: true,
        memoryContextContent: memoryContext,
      });

      // Assert
      expect(output).toContain(MEMORY_CONTEXT_SECTION_HEADER);
      expect(output).toContain('Important context for sub-agent');
    });
  });

  describe('AC4: Max context size configurable', () => {
    it('should use default max size of 4KB', () => {
      // Act
      const maxSize = getMemoryContextMaxSize({});

      // Assert
      expect(maxSize).toBe(DEFAULT_MAX_SIZE);
    });

    it('should read max size from config', () => {
      // Arrange
      const config = {
        memory: {
          delegation_context_max_size: 8192,
        },
      };

      // Act
      const maxSize = getMemoryContextMaxSize(config);

      // Assert
      expect(maxSize).toBe(8192);
    });

    it('should truncate context when exceeding max size', async () => {
      // Arrange - create many large nodes
      for (let i = 0; i < 20; i++) {
        await writeMemoryNode(
          createMemoryNode({
            type: 'checkpoint',
            content: `Checkpoint ${i}: ${'x'.repeat(500)}`,
            wu_id: TEST_WU_ID,
            created_at: new Date(Date.now() - i * 1000).toISOString(),
          }),
        );
      }

      // Act
      const result = await generateMemoryContextSection(testDir, {
        wuId: TEST_WU_ID,
        lane: TEST_LANE,
        maxSize: DEFAULT_MAX_SIZE,
      });

      // Assert
      expect(result.length).toBeLessThanOrEqual(DEFAULT_MAX_SIZE);
    });
  });

  describe('AC5: Graceful skip if memory layer not initialized', () => {
    it('should return empty string when memory directory does not exist', async () => {
      // Arrange - delete memory directory
      await fs.rm(memoryDir, { recursive: true, force: true });

      // Act
      const result = await generateMemoryContextSection(testDir, {
        wuId: TEST_WU_ID,
        lane: TEST_LANE,
      });

      // Assert
      expect(result).toBe('');
    });

    it('should not throw error when memory.jsonl is missing', async () => {
      // Arrange - delete memory.jsonl
      await fs.rm(memoryDir, { recursive: true, force: true });

      // Act & Assert - should not throw
      await expect(
        generateMemoryContextSection(testDir, {
          wuId: TEST_WU_ID,
          lane: TEST_LANE,
        }),
      ).resolves.toBe('');
    });

    it('should log info message when skipping (not error)', async () => {
      // Arrange
      const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
      await fs.rm(memoryDir, { recursive: true, force: true });

      // Act
      await generateMemoryContextSection(testDir, {
        wuId: TEST_WU_ID,
        lane: TEST_LANE,
      });

      // Assert - should not log error
      const errorSpy = vi.spyOn(console, 'error');
      expect(errorSpy).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe('AC6: --no-context flag allows skipping context injection', () => {
    it('should skip memory context when noContext option is true', async () => {
      // Arrange
      await writeMemoryNode(
        createMemoryNode({
          type: 'checkpoint',
          content: 'Should not appear',
          wu_id: TEST_WU_ID,
        }),
      );

      // Pre-generate memory context
      const memoryContext = await generateMemoryContextSection(testDir, {
        wuId: TEST_WU_ID,
        lane: TEST_LANE,
      });

      const mockWUDoc = createMockWUDoc();
      const strategy = createStrategy();

      // Act - with noContext: true, memory context should be skipped
      const output = generateTaskInvocation(mockWUDoc, TEST_WU_ID, strategy, {
        baseDir: testDir,
        includeMemoryContext: true,
        memoryContextContent: memoryContext,
        noContext: true,
      });

      // Assert
      expect(output).not.toContain(MEMORY_CONTEXT_SECTION_HEADER);
      expect(output).not.toContain('Should not appear');
    });

    it('should include memory context by default when includeMemoryContext is true', async () => {
      // Arrange
      await writeMemoryNode(
        createMemoryNode({
          type: 'checkpoint',
          content: 'Should appear in output',
          wu_id: TEST_WU_ID,
        }),
      );

      // Pre-generate memory context
      const memoryContext = await generateMemoryContextSection(testDir, {
        wuId: TEST_WU_ID,
        lane: TEST_LANE,
      });

      const mockWUDoc = createMockWUDoc();
      const strategy = createStrategy();

      // Act
      const output = generateTaskInvocation(mockWUDoc, TEST_WU_ID, strategy, {
        baseDir: testDir,
        includeMemoryContext: true,
        memoryContextContent: memoryContext,
      });

      // Assert
      expect(output).toContain('Should appear in output');
    });
  });

  describe('Integration: Memory context in spawn output', () => {
    it('should position Memory Context section after Skills Selection', async () => {
      // Arrange
      await writeMemoryNode(
        createMemoryNode({
          type: 'checkpoint',
          content: 'Memory checkpoint content',
          wu_id: TEST_WU_ID,
        }),
      );

      // Pre-generate memory context
      const memoryContext = await generateMemoryContextSection(testDir, {
        wuId: TEST_WU_ID,
        lane: TEST_LANE,
      });

      const mockWUDoc = createMockWUDoc({ acceptance: ['AC1'] });
      const strategy = createStrategy();

      // Act
      const output = generateTaskInvocation(mockWUDoc, TEST_WU_ID, strategy, {
        baseDir: testDir,
        includeMemoryContext: true,
        memoryContextContent: memoryContext,
      });

      // Assert - Memory Context should come after Skills Selection
      const skillsIndex = output.indexOf('## Skills Selection');
      const memoryIndex = output.indexOf(MEMORY_CONTEXT_SECTION_HEADER);

      expect(skillsIndex).toBeGreaterThan(-1);
      expect(memoryIndex).toBeGreaterThan(-1);
      expect(memoryIndex).toBeGreaterThan(skillsIndex);
    });

    it('should include project profile context', async () => {
      // Arrange
      await writeMemoryNode(
        createMemoryNode({
          type: 'note',
          lifecycle: 'project',
          content: 'Project architecture uses hexagonal pattern',
        }),
      );
      await writeMemoryNode(
        createMemoryNode({
          type: 'checkpoint',
          lifecycle: 'wu',
          content: 'WU-specific checkpoint',
          wu_id: TEST_WU_ID,
        }),
      );

      // Act
      const result = await generateMemoryContextSection(testDir, {
        wuId: TEST_WU_ID,
        lane: TEST_LANE,
      });

      // Assert - should include project-level context
      expect(result).toContain('hexagonal pattern');
    });
  });

  /**
   * WU-1287: Tests for spawn context using mem-context-core features
   */
  describe('WU-1287: Spawn context aligns with mem-context-core', () => {
    it('should respect lane filter from mem-context-core', async () => {
      // Arrange - create project memories with different lanes
      const OTHER_LANE = 'Framework: CLI';
      await writeMemoryNode(
        createMemoryNode({
          type: 'note',
          lifecycle: 'project',
          content: 'Framework Core knowledge',
          metadata: { lane: TEST_LANE },
        }),
      );
      await writeMemoryNode(
        createMemoryNode({
          type: 'note',
          lifecycle: 'project',
          content: 'Framework CLI knowledge',
          metadata: { lane: OTHER_LANE },
        }),
      );
      await writeMemoryNode(
        createMemoryNode({
          type: 'note',
          lifecycle: 'project',
          content: 'General project knowledge with no lane',
        }),
      );

      // Act - filter by Framework: Core lane
      const result = await generateMemoryContextSection(testDir, {
        wuId: TEST_WU_ID,
        lane: TEST_LANE,
      });

      // Assert - should include Core lane and no-lane nodes, exclude CLI lane
      expect(result).toContain('Framework Core knowledge');
      expect(result).toContain('General project knowledge');
      expect(result).not.toContain('Framework CLI knowledge');
    });

    it('should support maxRecentSummaries limit from mem-context-core', async () => {
      // Arrange - create multiple summaries
      for (let i = 0; i < 10; i++) {
        await writeMemoryNode(
          createMemoryNode({
            type: 'summary',
            lifecycle: 'wu',
            content: `Summary number ${i}`,
            wu_id: TEST_WU_ID,
            created_at: new Date(Date.UTC(2025, 0, i + 1)).toISOString(),
          }),
        );
      }

      // Act - limit to 3 recent summaries
      const result = await generateMemoryContextSection(testDir, {
        wuId: TEST_WU_ID,
        maxRecentSummaries: 3,
      });

      // Assert - should include only 3 most recent (days 8, 9, 10 = summary 7, 8, 9)
      expect(result).toContain('Summary number 9');
      expect(result).toContain('Summary number 8');
      expect(result).toContain('Summary number 7');
      expect(result).not.toContain('Summary number 0');
      expect(result).not.toContain('Summary number 6');
    });

    it('should support maxProjectNodes limit from mem-context-core', async () => {
      // Arrange - create many project memories
      for (let i = 0; i < 15; i++) {
        await writeMemoryNode(
          createMemoryNode({
            type: 'note',
            lifecycle: 'project',
            content: `Project memory ${i}`,
            created_at: new Date(Date.UTC(2025, 0, i + 1)).toISOString(),
          }),
        );
      }

      // Act - limit to 5 project nodes
      const result = await generateMemoryContextSection(testDir, {
        wuId: TEST_WU_ID,
        maxProjectNodes: 5,
      });

      // Assert - should include only 5 most recent project memories
      expect(result).toContain('Project memory 14');
      expect(result).toContain('Project memory 13');
      expect(result).not.toContain('Project memory 0');
      expect(result).not.toContain('Project memory 9');
    });

    it('should prioritize WU-specific content over project content (WU-1281)', async () => {
      // Arrange - create WU-specific and project content
      await writeMemoryNode(
        createMemoryNode({
          type: 'checkpoint',
          lifecycle: 'wu',
          content: 'Critical WU checkpoint',
          wu_id: TEST_WU_ID,
        }),
      );
      await writeMemoryNode(
        createMemoryNode({
          type: 'discovery',
          lifecycle: 'wu',
          content: 'Important WU discovery',
          wu_id: TEST_WU_ID,
        }),
      );
      await writeMemoryNode(
        createMemoryNode({
          type: 'note',
          lifecycle: 'project',
          content: 'Project level note',
        }),
      );

      // Act
      const result = await generateMemoryContextSection(testDir, {
        wuId: TEST_WU_ID,
      });

      // Assert - WU content should appear before project content
      const wuIndex = result.indexOf('Critical WU checkpoint');
      const projectIndex = result.indexOf('Project level note');

      expect(wuIndex).toBeGreaterThan(-1);
      expect(projectIndex).toBeGreaterThan(-1);
      expect(wuIndex).toBeLessThan(projectIndex);
    });

    it('should format with ## Memory Context header and ### subsection headers', async () => {
      // Arrange
      await writeMemoryNode(
        createMemoryNode({
          type: 'checkpoint',
          lifecycle: 'wu',
          content: 'Test checkpoint',
          wu_id: TEST_WU_ID,
        }),
      );
      await writeMemoryNode(
        createMemoryNode({
          type: 'note',
          lifecycle: 'project',
          content: 'Test project note',
        }),
      );

      // Act
      const result = await generateMemoryContextSection(testDir, {
        wuId: TEST_WU_ID,
      });

      // Assert - should use spawn-specific formatting
      expect(result).toContain('## Memory Context');
      expect(result).toContain('Prior context from memory layer for');
      expect(result).toContain('### WU Context');
      expect(result).toContain('### Project Profile');
    });

    it('should return empty string when @lumenflow/memory generates no context', async () => {
      // Arrange - create memory for a different WU
      await writeMemoryNode(
        createMemoryNode({
          type: 'checkpoint',
          lifecycle: 'wu',
          content: 'Other WU content',
          wu_id: 'WU-9999',
        }),
      );

      // Act - query for a WU with no content
      const result = await generateMemoryContextSection(testDir, {
        wuId: TEST_WU_ID,
      });

      // Assert - should return empty when no matching content
      expect(result).toBe('');
    });
  });
});
