/**
 * Memory Promote CLI Tests (WU-1237)
 *
 * Tests for the mem:promote CLI command that promotes session/WU
 * learnings into project-level knowledge nodes.
 *
 * @see {@link packages/@lumenflow/cli/src/mem-promote.ts} - Implementation
 * @see {@link packages/@lumenflow/memory/src/mem-promote-core.ts} - Core logic
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync, type ExecFileSyncOptions } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

/**
 * Test fixture constants
 */
const TEST_CONTENT = 'Test content';

describe('mem:promote CLI (WU-1237)', () => {
  let testDir: string;
  let memoryDir: string;

  beforeEach(async () => {
    // Create a temporary directory for tests
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mem-promote-cli-test-'));
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
   */
  function runCli(args: string[]): { stdout: string; stderr: string; exitCode: number } {
    const cliPath = path.resolve(__dirname, '..', 'dist', 'mem-promote.js');
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
    it('requires --node or --wu flag', () => {
      // Act
      const result = runCli([]);

      // Assert
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toMatch(/--node.*--wu|Either/i);
    });

    it('rejects using both --node and --wu', async () => {
      // Arrange
      const node = {
        id: 'mem-test',
        type: 'note',
        lifecycle: 'wu',
        content: TEST_CONTENT,
        created_at: new Date().toISOString(),
        wu_id: 'WU-1234',
      };
      await writeMemoryNode(node);

      // Act
      const result = runCli(['--node', 'mem-test', '--wu', 'WU-1234', '--tag', 'pattern']);

      // Assert
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain('Cannot use both');
    });

    it('requires --tag flag', async () => {
      // Arrange
      const node = {
        id: 'mem-test',
        type: 'note',
        lifecycle: 'wu',
        content: TEST_CONTENT,
        created_at: new Date().toISOString(),
      };
      await writeMemoryNode(node);

      // Act
      const result = runCli(['--node', 'mem-test']);

      // Assert
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain('--tag');
    });

    it('rejects invalid tags', async () => {
      // Arrange
      const node = {
        id: 'mem-test',
        type: 'note',
        lifecycle: 'wu',
        content: TEST_CONTENT,
        created_at: new Date().toISOString(),
      };
      await writeMemoryNode(node);

      // Act
      const result = runCli(['--node', 'mem-test', '--tag', 'invalid-tag']);

      // Assert
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toMatch(/tag/i);
    });
  });

  describe('node promotion', () => {
    it('promotes a node with valid tag', async () => {
      // Arrange
      const node = {
        id: 'mem-prm1',
        type: 'note',
        lifecycle: 'wu',
        content: 'Content to promote',
        created_at: new Date().toISOString(),
      };
      await writeMemoryNode(node);

      // Act
      const result = runCli(['--node', 'mem-prm1', '--tag', 'pattern']);

      // Assert
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Promoted');
    });

    it('accepts --dry-run flag', async () => {
      // Arrange
      const node = {
        id: 'mem-dry1',
        type: 'note',
        lifecycle: 'wu',
        content: 'Dry run content',
        created_at: new Date().toISOString(),
      };
      await writeMemoryNode(node);

      // Act
      const result = runCli(['--node', 'mem-dry1', '--tag', 'decision', '--dry-run']);

      // Assert
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Dry-run');
    });

    it('accepts --json flag', async () => {
      // Arrange
      const node = {
        id: 'mem-json',
        type: 'note',
        lifecycle: 'wu',
        content: 'JSON output test',
        created_at: new Date().toISOString(),
      };
      await writeMemoryNode(node);

      // Act
      const result = runCli(['--node', 'mem-json', '--tag', 'convention', '--json']);

      // Assert
      expect(result.exitCode).toBe(0);
      expect(() => JSON.parse(result.stdout)).not.toThrow();
      const json = JSON.parse(result.stdout);
      expect(json.success).toBe(true);
      expect(json.promotedNode).toBeDefined();
    });

    it('errors when node not found', () => {
      // Act
      const result = runCli(['--node', 'mem-miss', '--tag', 'pattern']);

      // Assert
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain('not found');
    });
  });

  describe('WU promotion', () => {
    it('promotes all summaries from WU', async () => {
      // Arrange
      const summary1 = {
        id: 'mem-sum1',
        type: 'summary',
        lifecycle: 'wu',
        content: 'Summary 1',
        created_at: new Date().toISOString(),
        wu_id: 'WU-1234',
      };
      const summary2 = {
        id: 'mem-sum2',
        type: 'summary',
        lifecycle: 'wu',
        content: 'Summary 2',
        created_at: new Date().toISOString(),
        wu_id: 'WU-1234',
      };
      await writeMemoryNode(summary1);
      await writeMemoryNode(summary2);

      // Act
      const result = runCli(['--wu', 'WU-1234', '--tag', 'pattern']);

      // Assert
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Promoted');
      expect(result.stdout).toContain('2'); // 2 summaries
    });

    it('returns message when no summaries found', async () => {
      // Arrange - only notes, no summaries
      const note = {
        id: 'mem-note',
        type: 'note',
        lifecycle: 'wu',
        content: 'Not a summary',
        created_at: new Date().toISOString(),
        wu_id: 'WU-5678',
      };
      await writeMemoryNode(note);

      // Act
      const result = runCli(['--wu', 'WU-5678', '--tag', 'decision']);

      // Assert
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('No summaries');
    });

    it('rejects invalid WU ID format', () => {
      // Act
      const result = runCli(['--wu', 'invalid-wu', '--tag', 'pattern']);

      // Assert
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain('WU ID');
    });
  });

  describe('quiet mode', () => {
    it('suppresses output with --quiet', async () => {
      // Arrange
      const node = {
        id: 'mem-quie',
        type: 'note',
        lifecycle: 'wu',
        content: 'Quiet test',
        created_at: new Date().toISOString(),
      };
      await writeMemoryNode(node);

      // Act
      const result = runCli(['--node', 'mem-quie', '--tag', 'pattern', '--quiet']);

      // Assert
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('');
    });
  });
});
