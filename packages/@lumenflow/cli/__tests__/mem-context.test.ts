/**
 * Memory Context CLI Tests (WU-1234)
 *
 * Tests for the mem:context CLI command that outputs formatted
 * context injection blocks for wu:spawn prompts.
 *
 * @see {@link packages/@lumenflow/cli/src/mem-context.ts} - Implementation
 * @see {@link packages/@lumenflow/memory/src/mem-context-core.ts} - Core logic
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync, type ExecFileSyncOptions } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

/** Test fixture constant for memory node content */
const TEST_CONTENT = 'Test content';

/** WU-1292: Test fixture constants for lane and limit tests */
const LANE_CLI = 'Framework: CLI';
const LANE_CORE = 'Framework: Core';
const LIFECYCLE_PROJECT = 'project';
const LIFECYCLE_WU = 'wu';
const TYPE_CHECKPOINT = 'checkpoint';
const TYPE_SUMMARY = 'summary';
const FORMAT_JSON = 'json';
/** CLI option flags */
const OPT_MAX_RECENT_SUMMARIES = '--max-recent-summaries';
const OPT_MAX_PROJECT_NODES = '--max-project-nodes';

describe('mem:context CLI (WU-1234)', () => {
  let testDir: string;
  let memoryDir: string;

  beforeEach(async () => {
    // Create a temporary directory for tests
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mem-context-cli-test-'));
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
   * Helper to run the CLI command safely using execFileSync
   * Uses execFileSync to avoid shell injection vulnerabilities
   */
  function runCli(args: string[]): { stdout: string; stderr: string; exitCode: number } {
    const cliPath = path.resolve(__dirname, '..', 'dist', 'mem-context.js');
    const options: ExecFileSyncOptions = {
      cwd: testDir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    };

    try {
      // eslint-disable-next-line sonarjs/no-os-command-from-path -- Node path is from controlled test environment
      const stdout = execFileSync('node', [cliPath, ...args], options) as string;
      return { stdout, stderr: '', exitCode: 0 };
    } catch (error: unknown) {
      const execError = error as { stdout?: string; stderr?: string; status?: number };
      return {
        stdout: (execError.stdout as string) || '',
        stderr: (execError.stderr as string) || '',
        exitCode: execError.status || 1,
      };
    }
  }

  describe('argument parsing', () => {
    it('requires --wu flag', () => {
      // Act
      const result = runCli([]);

      // Assert
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain('--wu');
    });

    it('accepts --wu WU-XXXX format', async () => {
      // Arrange
      const node = {
        id: 'mem-test',
        type: 'checkpoint',
        lifecycle: 'wu',
        content: TEST_CONTENT,
        created_at: new Date().toISOString(),
        wu_id: 'WU-1234',
      };
      await writeMemoryNode(node);

      // Act
      const result = runCli(['--wu', 'WU-1234']);

      // Assert
      expect(result.exitCode).toBe(0);
    });

    it('accepts --max-size option', async () => {
      // Arrange
      const node = {
        id: 'mem-test',
        type: 'checkpoint',
        lifecycle: 'wu',
        content: TEST_CONTENT,
        created_at: new Date().toISOString(),
        wu_id: 'WU-1234',
      };
      await writeMemoryNode(node);

      // Act
      const result = runCli(['--wu', 'WU-1234', '--max-size', '1024']);

      // Assert
      expect(result.exitCode).toBe(0);
    });

    it('accepts --format json option', async () => {
      // Arrange
      const node = {
        id: 'mem-test',
        type: 'checkpoint',
        lifecycle: 'wu',
        content: TEST_CONTENT,
        created_at: new Date().toISOString(),
        wu_id: 'WU-1234',
      };
      await writeMemoryNode(node);

      // Act
      const result = runCli(['--wu', 'WU-1234', '--format', 'json']);

      // Assert
      expect(result.exitCode).toBe(0);
      // Should be valid JSON
      expect(() => JSON.parse(result.stdout)).not.toThrow();
    });

    it('accepts --quiet option', async () => {
      // Arrange
      const node = {
        id: 'mem-test',
        type: 'checkpoint',
        lifecycle: 'wu',
        content: TEST_CONTENT,
        created_at: new Date().toISOString(),
        wu_id: 'WU-1234',
      };
      await writeMemoryNode(node);

      // Act
      const result = runCli(['--wu', 'WU-1234', '--quiet']);

      // Assert
      expect(result.exitCode).toBe(0);
      // Should not contain log prefix
      expect(result.stdout).not.toContain('[mem:context]');
    });
  });

  describe('output formats', () => {
    it('outputs structured markdown by default', async () => {
      // Arrange
      const node = {
        id: 'mem-test',
        type: 'checkpoint',
        lifecycle: 'wu',
        content: 'Checkpoint content',
        created_at: new Date().toISOString(),
        wu_id: 'WU-1234',
      };
      await writeMemoryNode(node);

      // Act
      const result = runCli(['--wu', 'WU-1234']);

      // Assert
      expect(result.stdout).toContain('##'); // Markdown headers
      expect(result.stdout).toContain('Checkpoint content');
    });

    it('outputs JSON when --format json is used', async () => {
      // Arrange
      const node = {
        id: 'mem-test',
        type: 'checkpoint',
        lifecycle: 'wu',
        content: 'Test checkpoint',
        created_at: new Date().toISOString(),
        wu_id: 'WU-1234',
      };
      await writeMemoryNode(node);

      // Act
      const result = runCli(['--wu', 'WU-1234', '--format', 'json']);

      // Assert
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout);
      expect(json.wuId).toBe('WU-1234');
      expect(json.contextBlock).toBeDefined();
      expect(json.stats).toBeDefined();
    });
  });

  describe('graceful degradation', () => {
    it('returns empty block when no memories match', async () => {
      // Act - no memories exist
      const result = runCli(['--wu', 'WU-9999']);

      // Assert
      expect(result.exitCode).toBe(0);
      // Should indicate no memories found
      expect(result.stdout).toMatch(/no memories|empty/i);
    });

    it('handles missing memory directory', async () => {
      // Arrange - delete memory directory
      await fs.rm(memoryDir, { recursive: true, force: true });

      // Act
      const result = runCli(['--wu', 'WU-1234']);

      // Assert
      expect(result.exitCode).toBe(0);
    });
  });

  describe('error handling', () => {
    it('rejects invalid WU ID format', () => {
      // Act
      const result = runCli(['--wu', 'invalid-format']);

      // Assert
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain('WU');
    });

    it('rejects invalid --max-size value', () => {
      // Act
      const result = runCli(['--wu', 'WU-1234', '--max-size', 'abc']);

      // Assert
      expect(result.exitCode).not.toBe(0);
    });

    it('rejects invalid --format value', () => {
      // Act
      const result = runCli(['--wu', 'WU-1234', '--format', 'invalid']);

      // Assert
      expect(result.exitCode).not.toBe(0);
    });
  });

  describe('audit logging', () => {
    it('writes audit log entry on success', async () => {
      // Arrange
      const node = {
        id: 'mem-test',
        type: 'checkpoint',
        lifecycle: 'wu',
        content: TEST_CONTENT,
        created_at: new Date().toISOString(),
        wu_id: 'WU-1234',
      };
      await writeMemoryNode(node);

      // Act
      runCli(['--wu', 'WU-1234']);

      // Assert - check audit log exists
      const auditPath = path.join(testDir, '.lumenflow', 'telemetry', 'tools.ndjson');
      const auditExists = await fs.stat(auditPath).catch(() => null);
      expect(auditExists).not.toBeNull();
    });
  });

  /**
   * WU-1292: Tests for new CLI options: --lane, --max-recent-summaries, --max-project-nodes
   * Note: Memory IDs must match format mem-[a-z0-9]{4} (exactly 4 alphanumeric chars after 'mem-')
   */
  describe('lane and limit options (WU-1292)', () => {
    /**
     * Helper to create summary nodes for limit testing
     */
    function createSummaryNodes(count: number): Array<Record<string, unknown>> {
      return Array.from({ length: count }, (_, i) => ({
        id: `mem-sm0${i + 1}`,
        type: TYPE_SUMMARY,
        lifecycle: LIFECYCLE_WU,
        content: `Summary content ${i + 1}`,
        created_at: new Date(Date.now() - (i + 1) * 1000).toISOString(),
        wu_id: 'WU-1234',
      }));
    }

    /**
     * Helper to create project nodes for limit testing
     */
    function createProjectNodes(count: number): Array<Record<string, unknown>> {
      return Array.from({ length: count }, (_, i) => ({
        id: `mem-pn0${i + 1}`,
        type: TYPE_CHECKPOINT,
        lifecycle: LIFECYCLE_PROJECT,
        content: `Project node content ${i + 1}`,
        created_at: new Date(Date.now() - (i + 1) * 1000).toISOString(),
      }));
    }

    describe('--lane option', () => {
      it('accepts --lane option and filters context to that lane', async () => {
        // Arrange - create project nodes with different lanes
        // Use valid mem-xxxx format IDs (exactly 4 alphanumeric chars)
        const nodeWithLane = {
          id: 'mem-la01',
          type: TYPE_CHECKPOINT,
          lifecycle: LIFECYCLE_PROJECT,
          content: 'Project content for CLI lane',
          created_at: new Date().toISOString(),
          metadata: { lane: LANE_CLI },
        };
        const nodeOtherLane = {
          id: 'mem-la02',
          type: TYPE_CHECKPOINT,
          lifecycle: LIFECYCLE_PROJECT,
          content: 'Project content for Core lane',
          created_at: new Date().toISOString(),
          metadata: { lane: LANE_CORE },
        };
        const nodeNoLane = {
          id: 'mem-la03',
          type: TYPE_CHECKPOINT,
          lifecycle: LIFECYCLE_PROJECT,
          content: 'General project content no lane',
          created_at: new Date().toISOString(),
        };
        await writeMemoryNode(nodeWithLane);
        await writeMemoryNode(nodeOtherLane);
        await writeMemoryNode(nodeNoLane);

        // Act
        const result = runCli(['--wu', 'WU-1234', '--lane', LANE_CLI, '--format', FORMAT_JSON]);

        // Assert
        expect(result.exitCode).toBe(0);
        const json = JSON.parse(result.stdout);
        // Should include node with matching lane and node with no lane
        expect(json.contextBlock).toContain('CLI lane');
        expect(json.contextBlock).toContain('no lane');
        // Should NOT include node with different lane
        expect(json.contextBlock).not.toContain('Core lane');
      });

      it('rejects empty --lane value', () => {
        // Act
        const result = runCli(['--wu', 'WU-1234', '--lane', '']);

        // Assert
        expect(result.exitCode).not.toBe(0);
        expect(result.stderr).toContain('lane');
      });
    });

    describe('--max-recent-summaries option', () => {
      it('accepts --max-recent-summaries option', async () => {
        // Arrange - create multiple summary nodes with valid IDs
        const summaries = createSummaryNodes(5);
        for (const summary of summaries) {
          await writeMemoryNode(summary);
        }

        // Act - limit to 2 summaries
        const result = runCli([
          '--wu',
          'WU-1234',
          OPT_MAX_RECENT_SUMMARIES,
          '2',
          '--format',
          FORMAT_JSON,
        ]);

        // Assert
        expect(result.exitCode).toBe(0);
        const json = JSON.parse(result.stdout);
        // Should only include 2 most recent summaries
        const summaryMatches = json.contextBlock.match(/Summary content/g) || [];
        expect(summaryMatches.length).toBe(2);
      });

      it('rejects invalid --max-recent-summaries value', () => {
        // Act
        const result = runCli(['--wu', 'WU-1234', OPT_MAX_RECENT_SUMMARIES, 'abc']);

        // Assert
        expect(result.exitCode).not.toBe(0);
      });

      it('rejects negative --max-recent-summaries value', () => {
        // Act
        const result = runCli(['--wu', 'WU-1234', OPT_MAX_RECENT_SUMMARIES, '-1']);

        // Assert
        expect(result.exitCode).not.toBe(0);
      });
    });

    describe('--max-project-nodes option', () => {
      it('accepts --max-project-nodes option', async () => {
        // Arrange - create multiple project nodes with valid IDs
        const projectNodes = createProjectNodes(5);
        for (const node of projectNodes) {
          await writeMemoryNode(node);
        }

        // Act - limit to 2 project nodes
        const result = runCli([
          '--wu',
          'WU-1234',
          OPT_MAX_PROJECT_NODES,
          '2',
          '--format',
          FORMAT_JSON,
        ]);

        // Assert
        expect(result.exitCode).toBe(0);
        const json = JSON.parse(result.stdout);
        // Should only include 2 project nodes
        const nodeMatches = json.contextBlock.match(/Project node content/g) || [];
        expect(nodeMatches.length).toBe(2);
      });

      it('rejects invalid --max-project-nodes value', () => {
        // Act
        const result = runCli(['--wu', 'WU-1234', OPT_MAX_PROJECT_NODES, 'xyz']);

        // Assert
        expect(result.exitCode).not.toBe(0);
      });
    });

    describe('--delegation-context-max-size option', () => {
      it('accepts --delegation-context-max-size as alias for --max-size', async () => {
        // Arrange
        const node = {
          id: 'mem-test',
          type: 'checkpoint',
          lifecycle: 'wu',
          content: TEST_CONTENT,
          created_at: new Date().toISOString(),
          wu_id: 'WU-1234',
        };
        await writeMemoryNode(node);

        // Act - use delegation-context-max-size instead of max-size
        const result = runCli(['--wu', 'WU-1234', '--delegation-context-max-size', '8192']);

        // Assert
        expect(result.exitCode).toBe(0);
      });

      it('rejects deprecated --spawn-context-max-size with explicit guidance', () => {
        const result = runCli(['--wu', 'WU-1234', '--spawn-context-max-size', '8192']);

        expect(result.exitCode).not.toBe(0);
        expect(result.stderr).toMatch(/delegation-context-max-size/i);
      });
    });

    describe('combined options', () => {
      it('accepts all new options together', async () => {
        // Arrange
        const node = {
          id: 'mem-test',
          type: 'checkpoint',
          lifecycle: 'wu',
          content: TEST_CONTENT,
          created_at: new Date().toISOString(),
          wu_id: 'WU-1234',
        };
        await writeMemoryNode(node);

        // Act - use all new options together
        const result = runCli([
          '--wu',
          'WU-1234',
          '--lane',
          'Framework: CLI',
          '--max-recent-summaries',
          '3',
          '--max-project-nodes',
          '5',
          '--delegation-context-max-size',
          '4096',
        ]);

        // Assert
        expect(result.exitCode).toBe(0);
      });
    });
  });
});
