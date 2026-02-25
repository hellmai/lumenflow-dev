/**
 * Memory Recovery Core Tests (WU-1390)
 *
 * Tests for the mem:recover command core logic that generates post-compaction
 * recovery context for agents that have lost LumenFlow instructions.
 *
 * Tests cover:
 * - WU ID validation (required, non-empty, valid format)
 * - Checkpoint loading from memory layer
 * - Constraints loading from .lumenflow/constraints.md
 * - Size-limited output with truncation strategy
 * - Optional sections (constraints, CLI ref)
 *
 * @see {@link packages/@lumenflow/memory/src/mem-recover-core.ts} - Implementation
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { generateRecoveryContext } from '../src/mem-recover-core.js';

/**
 * Test constants
 */
const TEST_WU_ID = 'WU-1390';
const TEST_TIMESTAMP = '2026-02-03T10:00:00.000Z';
const TEST_CHECKPOINT_CONTENT = 'Implemented mem-recover-core with TDD';

describe('mem-recover-core (WU-1390)', () => {
  let testDir: string;
  let memoryDir: string;
  let lumenflowDir: string;

  beforeEach(async () => {
    // Create temporary directory structure
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mem-recover-test-'));
    memoryDir = path.join(testDir, '.lumenflow', 'memory');
    lumenflowDir = path.join(testDir, '.lumenflow');
    await fs.mkdir(memoryDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  /**
   * Helper to write a memory node to memory.jsonl
   */
  async function writeMemoryNode(node: Record<string, unknown>): Promise<void> {
    const filePath = path.join(memoryDir, 'memory.jsonl');
    const line = JSON.stringify(node) + '\n';
    await fs.appendFile(filePath, line, 'utf-8');
  }

  /**
   * Helper to create a checkpoint node
   */
  function createCheckpointNode(
    overrides: Partial<Record<string, unknown>> = {},
  ): Record<string, unknown> {
    return {
      // eslint-disable-next-line sonarjs/pseudo-random -- Test fixture IDs
      id: `mem-${Math.random().toString(36).substring(2, 6)}`,
      type: 'checkpoint',
      lifecycle: 'wu',
      content: TEST_CHECKPOINT_CONTENT,
      created_at: TEST_TIMESTAMP,
      wu_id: TEST_WU_ID,
      ...overrides,
    };
  }

  /**
   * Helper to create constraints.md content
   */
  async function writeConstraintsFile(content: string): Promise<void> {
    const constraintsPath = path.join(lumenflowDir, 'constraints.md');
    await fs.writeFile(constraintsPath, content, 'utf-8');
  }

  describe('WU ID validation', () => {
    it('throws error when wuId is empty', async () => {
      await expect(generateRecoveryContext({ wuId: '', baseDir: testDir })).rejects.toThrow(
        /empty/i,
      );
    });

    it('throws error when wuId has invalid format', async () => {
      await expect(
        generateRecoveryContext({ wuId: 'invalid-id', baseDir: testDir }),
      ).rejects.toThrow(/Invalid WU ID/i);
    });

    it('throws error when wuId is missing WU- prefix', async () => {
      await expect(generateRecoveryContext({ wuId: '1390', baseDir: testDir })).rejects.toThrow(
        /Invalid WU ID/i,
      );
    });

    it('accepts valid WU ID format', async () => {
      const result = await generateRecoveryContext({
        wuId: TEST_WU_ID,
        baseDir: testDir,
      });
      expect(result.success).toBe(true);
    });
  });

  describe('checkpoint loading', () => {
    it('shows "No checkpoint found" when memory is empty', async () => {
      const result = await generateRecoveryContext({
        wuId: TEST_WU_ID,
        baseDir: testDir,
      });

      expect(result.context).toContain('No checkpoint found');
    });

    it('includes checkpoint content when checkpoint exists', async () => {
      await writeMemoryNode(createCheckpointNode());

      const result = await generateRecoveryContext({
        wuId: TEST_WU_ID,
        baseDir: testDir,
      });

      expect(result.context).toContain(TEST_CHECKPOINT_CONTENT);
      expect(result.context).toContain(TEST_TIMESTAMP);
    });

    it('uses most recent checkpoint when multiple exist', async () => {
      // Write older checkpoint
      await writeMemoryNode(
        createCheckpointNode({
          id: 'mem-old1', // Must be exactly 4 chars after 'mem-'
          content: 'Old checkpoint',
          created_at: '2026-02-01T10:00:00.000Z',
        }),
      );

      // Write newer checkpoint
      await writeMemoryNode(
        createCheckpointNode({
          id: 'mem-new1', // Must be exactly 4 chars after 'mem-'
          content: 'Newer checkpoint',
          created_at: '2026-02-03T15:00:00.000Z',
        }),
      );

      const result = await generateRecoveryContext({
        wuId: TEST_WU_ID,
        baseDir: testDir,
      });

      expect(result.context).toContain('Newer checkpoint');
      expect(result.context).not.toContain('Old checkpoint');
    });

    it('ignores checkpoints for other WUs', async () => {
      // Checkpoint for different WU
      await writeMemoryNode(
        createCheckpointNode({
          wu_id: 'WU-9999',
          content: 'Other WU checkpoint',
        }),
      );

      const result = await generateRecoveryContext({
        wuId: TEST_WU_ID,
        baseDir: testDir,
      });

      expect(result.context).toContain('No checkpoint found');
      expect(result.context).not.toContain('Other WU checkpoint');
    });

    it('handles missing memory directory gracefully', async () => {
      // Remove memory directory
      await fs.rm(memoryDir, { recursive: true, force: true });

      const result = await generateRecoveryContext({
        wuId: TEST_WU_ID,
        baseDir: testDir,
      });

      expect(result.success).toBe(true);
      expect(result.context).toContain('No checkpoint found');
    });
  });

  describe('constraints loading', () => {
    it('uses fallback constraints when constraints.md missing', async () => {
      const result = await generateRecoveryContext({
        wuId: TEST_WU_ID,
        baseDir: testDir,
      });

      // Fallback includes "Worktree Discipline" as first rule
      expect(result.context).toContain('Worktree Discipline');
      expect(result.context).toContain('Gates Required');
    });

    it('parses constraints from constraints.md when available', async () => {
      const constraintsContent = `# LumenFlow Constraints

### 1. Custom Rule

**Rule:** Always follow TDD workflow

### 2. Another Rule

**Rule:** Use library-first approach
`;
      await writeConstraintsFile(constraintsContent);

      const result = await generateRecoveryContext({
        wuId: TEST_WU_ID,
        baseDir: testDir,
      });

      expect(result.context).toContain('Custom Rule');
      expect(result.context).toContain('Always follow TDD workflow');
    });

    it('can disable constraints section', async () => {
      const result = await generateRecoveryContext({
        wuId: TEST_WU_ID,
        baseDir: testDir,
        includeConstraints: false,
      });

      // Should not have the constraints section header
      expect(result.context).not.toContain('Critical Rules');
    });
  });

  describe('CLI reference', () => {
    it('includes essential CLI commands by default', async () => {
      const result = await generateRecoveryContext({
        wuId: TEST_WU_ID,
        baseDir: testDir,
      });

      expect(result.context).toContain('wu:status');
      expect(result.context).toContain('wu:brief');
      expect(result.context).toContain('gates');
      expect(result.context).toContain('mem:checkpoint');
    });

    it('can disable CLI reference section', async () => {
      const result = await generateRecoveryContext({
        wuId: TEST_WU_ID,
        baseDir: testDir,
        includeCLIRef: false,
      });

      expect(result.context).not.toContain('| Command |');
    });
  });

  describe('output format', () => {
    it('includes recovery header with WU ID', async () => {
      const result = await generateRecoveryContext({
        wuId: TEST_WU_ID,
        baseDir: testDir,
      });

      expect(result.context).toContain('POST-COMPACTION RECOVERY');
      expect(result.context).toContain(TEST_WU_ID);
    });

    it('includes next action with wu:brief command', async () => {
      const result = await generateRecoveryContext({
        wuId: TEST_WU_ID,
        baseDir: testDir,
      });

      expect(result.context).toContain('Next Action');
      expect(result.context).toContain(`pnpm wu:brief --id ${TEST_WU_ID}`);
    });

    it('returns size in bytes', async () => {
      const result = await generateRecoveryContext({
        wuId: TEST_WU_ID,
        baseDir: testDir,
      });

      expect(result.size).toBeGreaterThan(0);
      expect(result.size).toBe(Buffer.byteLength(result.context, 'utf-8'));
    });
  });

  describe('size limiting', () => {
    it('respects default maxSize of 8KB', async () => {
      // Create a large checkpoint that exceeds 8KB
      await writeMemoryNode(
        createCheckpointNode({
          content: 'x'.repeat(9000), // 9KB checkpoint
        }),
      );

      const result = await generateRecoveryContext({
        wuId: TEST_WU_ID,
        baseDir: testDir,
      });

      const DEFAULT_MAX_SIZE = 8192;
      expect(result.size).toBeLessThanOrEqual(DEFAULT_MAX_SIZE);
      expect(result.truncated).toBe(true);
    });

    it('respects custom maxSize option', async () => {
      await writeMemoryNode(createCheckpointNode());

      const result = await generateRecoveryContext({
        wuId: TEST_WU_ID,
        baseDir: testDir,
        maxSize: 1024, // 1KB limit
      });

      expect(result.size).toBeLessThanOrEqual(1024);
    });

    it('truncates checkpoint content, not constraints', async () => {
      // Large checkpoint
      await writeMemoryNode(
        createCheckpointNode({
          content: 'Important: ' + 'x'.repeat(2000),
        }),
      );

      const result = await generateRecoveryContext({
        wuId: TEST_WU_ID,
        baseDir: testDir,
        maxSize: 1500,
      });

      // Constraints should still be present (they're critical)
      expect(result.context).toContain('Worktree Discipline');
      // Checkpoint should be truncated
      expect(result.truncated).toBe(true);
    });

    it('returns minimal recovery when fixed content exceeds budget', async () => {
      const result = await generateRecoveryContext({
        wuId: TEST_WU_ID,
        baseDir: testDir,
        maxSize: 50, // Impossibly small
      });

      // Should have minimal content with WU ID and brief command
      expect(result.context).toContain(TEST_WU_ID);
      expect(result.context).toContain('wu:brief');
      expect(result.truncated).toBe(true);
    });

    it('does not truncate when content fits within budget', async () => {
      await writeMemoryNode(
        createCheckpointNode({
          content: 'Short checkpoint',
        }),
      );

      const result = await generateRecoveryContext({
        wuId: TEST_WU_ID,
        baseDir: testDir,
        maxSize: 4096, // Generous budget
      });

      expect(result.truncated).toBe(false);
      expect(result.context).toContain('Short checkpoint');
    });
  });

  describe('edge cases', () => {
    it('handles checkpoint with nextSteps metadata', async () => {
      await writeMemoryNode(
        createCheckpointNode({
          metadata: {
            nextSteps: 'Run tests and verify',
          },
        }),
      );

      const result = await generateRecoveryContext({
        wuId: TEST_WU_ID,
        baseDir: testDir,
      });

      expect(result.context).toContain('Run tests and verify');
    });

    it('handles malformed memory.jsonl gracefully', async () => {
      // Write invalid JSON to memory file
      const filePath = path.join(memoryDir, 'memory.jsonl');
      await fs.writeFile(filePath, 'invalid json\n', 'utf-8');

      const result = await generateRecoveryContext({
        wuId: TEST_WU_ID,
        baseDir: testDir,
      });

      // Should still succeed with "no checkpoint" message
      expect(result.success).toBe(true);
      expect(result.context).toContain('No checkpoint found');
    });

    it('handles empty constraints.md file', async () => {
      await writeConstraintsFile('');

      const result = await generateRecoveryContext({
        wuId: TEST_WU_ID,
        baseDir: testDir,
      });

      // Should use fallback constraints
      expect(result.context).toContain('Worktree Discipline');
    });
  });

  describe('enriched recovery (WU-2157)', () => {
    /**
     * Helper to write a WU YAML spec file
     */
    async function writeWuYaml(wuId: string, content: string): Promise<void> {
      const wuDir = path.join(testDir, 'docs', '04-operations', 'tasks', 'wu');
      await fs.mkdir(wuDir, { recursive: true });
      await fs.writeFile(path.join(wuDir, `${wuId}.yaml`), content, 'utf-8');
    }

    describe('increased default budget', () => {
      it('uses 8KB default budget instead of 2KB', async () => {
        // Create a checkpoint larger than 2KB but under 8KB
        await writeMemoryNode(
          createCheckpointNode({
            content: 'x'.repeat(3000),
          }),
        );

        const result = await generateRecoveryContext({
          wuId: TEST_WU_ID,
          baseDir: testDir,
        });

        // With old 2KB limit this would truncate; with 8KB it should not
        expect(result.truncated).toBe(false);
        expect(result.size).toBeGreaterThan(2048);
      });

      it('still respects explicit maxSize override', async () => {
        await writeMemoryNode(
          createCheckpointNode({
            content: 'x'.repeat(3000),
          }),
        );

        const result = await generateRecoveryContext({
          wuId: TEST_WU_ID,
          baseDir: testDir,
          maxSize: 2048, // Explicit override
        });

        expect(result.size).toBeLessThanOrEqual(2048);
        expect(result.truncated).toBe(true);
      });
    });

    describe('WU metadata inclusion', () => {
      it('includes acceptance criteria from WU YAML', async () => {
        await writeWuYaml(
          TEST_WU_ID,
          `id: ${TEST_WU_ID}
title: Test WU
status: in_progress
acceptance:
  - All tests pass
  - Code coverage above 90%
code_paths:
  - packages/@lumenflow/memory/src/mem-recover-core.ts
`,
        );

        const result = await generateRecoveryContext({
          wuId: TEST_WU_ID,
          baseDir: testDir,
          includeWuMetadata: true,
        });

        expect(result.context).toContain('Acceptance Criteria');
        expect(result.context).toContain('All tests pass');
        expect(result.context).toContain('Code coverage above 90%');
      });

      it('includes code_paths from WU YAML', async () => {
        await writeWuYaml(
          TEST_WU_ID,
          `id: ${TEST_WU_ID}
title: Test WU
status: in_progress
acceptance:
  - Tests pass
code_paths:
  - packages/@lumenflow/memory/src/mem-recover-core.ts
  - packages/@lumenflow/cli/src/mem-recover.ts
`,
        );

        const result = await generateRecoveryContext({
          wuId: TEST_WU_ID,
          baseDir: testDir,
          includeWuMetadata: true,
        });

        expect(result.context).toContain('Code Paths');
        expect(result.context).toContain('mem-recover-core.ts');
        expect(result.context).toContain('mem-recover.ts');
      });

      it('handles missing WU YAML gracefully', async () => {
        // No WU YAML written — should not crash
        const result = await generateRecoveryContext({
          wuId: TEST_WU_ID,
          baseDir: testDir,
          includeWuMetadata: true,
        });

        expect(result.success).toBe(true);
        // Should not include WU metadata sections
        expect(result.context).not.toContain('Acceptance Criteria');
      });

      it('defaults includeWuMetadata to true', async () => {
        await writeWuYaml(
          TEST_WU_ID,
          `id: ${TEST_WU_ID}
title: Test WU
status: in_progress
acceptance:
  - Tests pass
code_paths:
  - src/foo.ts
`,
        );

        // No explicit includeWuMetadata — should default to true
        const result = await generateRecoveryContext({
          wuId: TEST_WU_ID,
          baseDir: testDir,
        });

        expect(result.context).toContain('Acceptance Criteria');
        expect(result.context).toContain('Tests pass');
      });

      it('can disable WU metadata with includeWuMetadata: false', async () => {
        await writeWuYaml(
          TEST_WU_ID,
          `id: ${TEST_WU_ID}
title: Test WU
status: in_progress
acceptance:
  - Tests pass
code_paths:
  - src/foo.ts
`,
        );

        const result = await generateRecoveryContext({
          wuId: TEST_WU_ID,
          baseDir: testDir,
          includeWuMetadata: false,
        });

        expect(result.context).not.toContain('Acceptance Criteria');
        expect(result.context).not.toContain('Code Paths');
      });
    });

    describe('git diff stat inclusion', () => {
      it('includes gitDiffStat when provided in checkpoint metadata', async () => {
        await writeMemoryNode(
          createCheckpointNode({
            metadata: {
              progress: 'Implementation done',
              nextSteps: 'Run gates',
              gitDiffStat:
                ' src/foo.ts | 10 +++++++---\n src/bar.ts | 5 +++++\n 2 files changed, 12 insertions(+), 3 deletions(-)',
            },
          }),
        );

        const result = await generateRecoveryContext({
          wuId: TEST_WU_ID,
          baseDir: testDir,
        });

        expect(result.context).toContain('Files Changed');
        expect(result.context).toContain('src/foo.ts');
        expect(result.context).toContain('src/bar.ts');
        expect(result.context).toContain('2 files changed');
      });

      it('does not show Files Changed section when no gitDiffStat in metadata', async () => {
        await writeMemoryNode(
          createCheckpointNode({
            metadata: {
              progress: 'Working on it',
            },
          }),
        );

        const result = await generateRecoveryContext({
          wuId: TEST_WU_ID,
          baseDir: testDir,
        });

        expect(result.context).not.toContain('Files Changed');
      });
    });

    describe('section ordering', () => {
      it('places WU metadata before constraints', async () => {
        await writeWuYaml(
          TEST_WU_ID,
          `id: ${TEST_WU_ID}
title: Test WU
status: in_progress
acceptance:
  - Tests pass
code_paths:
  - src/foo.ts
`,
        );

        const result = await generateRecoveryContext({
          wuId: TEST_WU_ID,
          baseDir: testDir,
          includeWuMetadata: true,
        });

        const acceptanceIdx = result.context.indexOf('Acceptance Criteria');
        const constraintsIdx = result.context.indexOf('Critical Rules');

        expect(acceptanceIdx).toBeGreaterThan(-1);
        expect(constraintsIdx).toBeGreaterThan(-1);
        expect(acceptanceIdx).toBeLessThan(constraintsIdx);
      });
    });
  });
});
