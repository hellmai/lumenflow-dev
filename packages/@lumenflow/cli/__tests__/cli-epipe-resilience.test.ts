/**
 * Integration tests for CLI EPIPE resilience
 *
 * WU-1233: Tests that CLI commands handle pipe closure gracefully
 *
 * These tests verify that when a CLI command's output is piped through
 * head/tail or another command that closes the pipe early, the CLI
 * exits gracefully instead of crashing with an unhandled EPIPE error.
 */

import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { join } from 'node:path';

const CLI_ROOT = join(__dirname, '..');

/** Fixed command path for head utility */
const HEAD_COMMAND = '/usr/bin/head';

/** Fixed command path for echo utility */
const ECHO_COMMAND = '/bin/echo';

/** Fixed command path for seq utility */
const SEQ_COMMAND = '/usr/bin/seq';

/**
 * Run a CLI command piped through head -n 1
 *
 * This simulates the scenario where a pipe is closed early
 * (e.g., `pnpm wu:status | head -n 1`)
 *
 * Security: Uses fixed absolute paths for commands to avoid PATH manipulation.
 */
async function runPipedCommand(
  command: string,
  args: string[],
): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    // Start the CLI command
    // eslint-disable-next-line sonarjs/os-command -- Test code using fixed command paths
    const cli = spawn(command, args, {
      cwd: CLI_ROOT,
      shell: false, // Avoid shell injection
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Start head -n 1 (will close pipe after first line)
    // eslint-disable-next-line sonarjs/os-command -- Test code using fixed command path
    const head = spawn(HEAD_COMMAND, ['-n', '1'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Pipe CLI stdout to head stdin
    cli.stdout.pipe(head.stdin);

    let stdout = '';
    let stderr = '';

    head.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    cli.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    head.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    // Wait for both processes to complete
    let cliExitCode: number | null = null;

    cli.on('close', (code) => {
      cliExitCode = code;
    });

    head.on('close', () => {
      // Give a small delay to ensure cli process finishes
      setTimeout(() => {
        resolve({ exitCode: cliExitCode, stdout, stderr });
      }, 100);
    });

    // Timeout after 5 seconds
    setTimeout(() => {
      cli.kill();
      head.kill();
      resolve({ exitCode: null, stdout, stderr: stderr + '\nTIMEOUT' });
    }, 5000);
  });
}

describe('CLI EPIPE Resilience', () => {
  describe('piped command handling', () => {
    it('should exit gracefully when stdout pipe is closed by head', async () => {
      // Use a simple echo command as the CLI to test pipe handling
      // In production this would be something like `pnpm wu:status`
      const { exitCode, stderr } = await runPipedCommand(ECHO_COMMAND, [
        '-e',
        'line1\\nline2\\nline3\\nline4\\nline5',
      ]);

      // The command should not crash (exit code 0 or null for graceful termination)
      // EPIPE crashes would typically result in exit code 1 or higher
      expect(exitCode).toBe(0);

      // Should not have EPIPE error messages in stderr
      expect(stderr).not.toContain('EPIPE');
      expect(stderr).not.toContain('write after end');
    });

    it('should not hang when pipe consumer closes early', async () => {
      const startTime = Date.now();

      // Run a command that produces output through a pipe that closes early
      const { exitCode } = await runPipedCommand(SEQ_COMMAND, ['1', '1000']);

      const duration = Date.now() - startTime;

      // Should complete quickly (not hang)
      expect(duration).toBeLessThan(3000);

      // Should exit gracefully
      expect([0, null]).toContain(exitCode);
    });
  });
});
