/**
 * Memory Index CLI Tests (WU-1235)
 *
 * Tests for the mem:index CLI command that scans project conventions
 * and creates project-lifecycle summary nodes.
 *
 * @see {@link packages/@lumenflow/cli/src/mem-index.ts} - Implementation
 * @see {@link packages/@lumenflow/memory/src/mem-index-core.ts} - Core logic
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync, type ExecFileSyncOptions } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

describe('mem:index CLI (WU-1235)', () => {
  let testDir: string;
  let memoryDir: string;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mem-index-cli-test-'));
    memoryDir = path.join(testDir, '.lumenflow', 'memory');
    await fs.mkdir(memoryDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  /**
   * Helper to write a file in the test directory
   */
  async function writeFile(relativePath: string, content: string): Promise<void> {
    const filePath = path.join(testDir, relativePath);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, 'utf-8');
  }

  /**
   * Helper to run the CLI command safely using execFileSync
   */
  function runCli(args: string[]): { stdout: string; stderr: string; exitCode: number } {
    const cliPath = path.resolve(__dirname, '..', 'dist', 'mem-index.js');
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

  describe('basic execution', () => {
    it('runs successfully with default options', async () => {
      // Arrange
      await writeFile('README.md', '# Test Project\n\nDescription.');

      // Act
      const result = runCli([]);

      // Assert
      expect(result.exitCode).toBe(0);
    });

    it('returns exit code 0 even with no files to scan', () => {
      // Act - empty directory
      const result = runCli([]);

      // Assert
      expect(result.exitCode).toBe(0);
    });
  });

  describe('output display', () => {
    it('shows count of nodes created/updated', async () => {
      // Arrange
      await writeFile('README.md', '# Test Project\n\nDescription.');
      await writeFile('LUMENFLOW.md', '# Workflow\n\nGuide.');

      // Act
      const result = runCli([]);

      // Assert
      expect(result.stdout).toMatch(/created.*\d+|Created.*\d+/i);
    });

    it('lists sources scanned', async () => {
      // Arrange
      await writeFile('README.md', '# Test');

      // Act
      const result = runCli([]);

      // Assert
      expect(result.stdout).toContain('README.md');
    });
  });

  describe('--dry-run flag', () => {
    it('shows what would be indexed without writing', async () => {
      // Arrange
      await writeFile('README.md', '# Test');

      // Act
      const result = runCli(['--dry-run']);

      // Assert
      expect(result.exitCode).toBe(0);
      expect(result.stdout.toLowerCase()).toContain('dry-run');

      // Memory file should not exist
      const memoryFilePath = path.join(memoryDir, 'memory.jsonl');
      const fileExists = await fs
        .stat(memoryFilePath)
        .then(() => true)
        .catch(() => false);
      expect(fileExists).toBe(false);
    });
  });

  describe('--quiet flag', () => {
    it('suppresses output except summary', async () => {
      // Arrange
      await writeFile('README.md', '# Test');

      // Act
      const result = runCli(['--quiet']);

      // Assert
      expect(result.exitCode).toBe(0);
      // Should have minimal output
      expect(result.stdout.split('\n').filter((l) => l.trim()).length).toBeLessThanOrEqual(3);
    });
  });

  describe('--json flag', () => {
    it('outputs result as JSON', async () => {
      // Arrange
      await writeFile('README.md', '# Test');

      // Act
      const result = runCli(['--json']);

      // Assert
      expect(result.exitCode).toBe(0);
      expect(() => JSON.parse(result.stdout)).not.toThrow();
      const json = JSON.parse(result.stdout);
      expect(json.success).toBe(true);
    });
  });

  describe('--base-dir option', () => {
    it('accepts custom base directory', async () => {
      // Arrange
      await writeFile('README.md', '# Test');

      // Act - use absolute path
      const result = runCli(['--base-dir', testDir]);

      // Assert
      expect(result.exitCode).toBe(0);
    });
  });

  describe('error handling', () => {
    it('handles non-existent directory gracefully', () => {
      // Act
      const result = runCli(['--base-dir', '/nonexistent/path/that/does/not/exist']);

      // Assert
      expect(result.exitCode).not.toBe(0);
    });
  });

  describe('audit logging', () => {
    it('writes audit log entry', async () => {
      // Arrange
      await writeFile('README.md', '# Test');

      // Act
      runCli([]);

      // Assert
      const auditPath = path.join(testDir, '.lumenflow', 'telemetry', 'tools.ndjson');
      const auditExists = await fs
        .stat(auditPath)
        .then(() => true)
        .catch(() => false);
      expect(auditExists).toBe(true);
    });
  });
});
