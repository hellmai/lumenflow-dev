/**
 * Integration tests for CLI subprocess execution
 *
 * Tests that CLI commands properly:
 * - Exit with non-zero code on errors
 * - Output error messages to stderr
 * - Don't silently fail
 *
 * These tests run CLI commands as subprocesses to verify
 * the entry point error handling works end-to-end.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const CLI_DIR = resolve(__dirname, '../../dist');

/**
 * Helper to run a CLI command as subprocess
 */
function runCLI(
  command: string,
  args: string[] = [],
): { code: number; stdout: string; stderr: string } {
  const result = spawnSync('node', [resolve(CLI_DIR, `${command}.js`), ...args], {
    encoding: 'utf-8',
    timeout: 10000,
  });

  return {
    code: result.status ?? -1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

describe('CLI subprocess error handling', () => {
  describe('wu-claim', () => {
    it('should exit with non-zero code when required options are missing', () => {
      const result = runCLI('wu-claim', ['--id', 'WU-TEST']);

      // Should NOT exit 0 (silent failure)
      expect(result.code).not.toBe(0);

      // Should have some error output
      expect(result.stderr.length + result.stdout.length).toBeGreaterThan(0);
    });

    it('should output help when --help is passed', () => {
      const result = runCLI('wu-claim', ['--help']);

      // Help should work
      expect(result.code).toBe(0);
      expect(result.stdout).toContain('Usage');
    });
  });

  describe('wu-done', () => {
    it('should exit with non-zero code for non-existent WU', () => {
      const result = runCLI('wu-done', ['--id', 'WU-NONEXISTENT-99999']);

      // Should NOT exit 0 (silent failure)
      expect(result.code).not.toBe(0);

      // Should have some error output
      expect(result.stderr.length + result.stdout.length).toBeGreaterThan(0);
    });
  });

  describe('wu-create', () => {
    it('should exit with non-zero code when validation fails', () => {
      const result = runCLI('wu-create', ['--id', 'WU-TEST', '--lane', 'Invalid Lane']);

      // Should NOT exit 0 (silent failure)
      expect(result.code).not.toBe(0);

      // Should have some error output
      expect(result.stderr.length + result.stdout.length).toBeGreaterThan(0);
    });
  });

  describe('wu-preflight (WU-1180)', () => {
    it('should show proper Commander help when --help is passed', () => {
      const result = runCLI('wu-preflight', ['--help']);

      // Help should work
      expect(result.code).toBe(0);
      expect(result.stdout).toContain('Usage');
      expect(result.stdout).toContain('Options');
      // Should have the standard Commander format with -h, --help
      expect(result.stdout).toMatch(/-h,\s*--help/);
    });

    it('should show proper Commander help format with option descriptions', () => {
      const result = runCLI('wu-preflight', ['--help']);

      expect(result.code).toBe(0);
      // Should include option descriptions in Commander format
      expect(result.stdout).toContain('--id');
      expect(result.stdout).toContain('--worktree');
    });

    it('should exit with non-zero code when required --id option is missing', () => {
      const result = runCLI('wu-preflight', []);

      // Should NOT exit 0 (silent failure)
      expect(result.code).not.toBe(0);

      // Should have some error output
      expect(result.stderr.length + result.stdout.length).toBeGreaterThan(0);
      expect(`${result.stderr}\n${result.stdout}`).toMatch(/--help/i);
    });
  });
});
