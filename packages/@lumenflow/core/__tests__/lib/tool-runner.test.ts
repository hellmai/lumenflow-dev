/**
 * ToolRunner tests (WU-2537)
 */

import { describe, it, expect, vi } from 'vitest';
import { ToolRunner } from '../../src/lib/tool-runner.js';

describe('ToolRunner', () => {
  describe('run', () => {
    it('executes a command and returns result', async () => {
      const runner = new ToolRunner();
      const result = await runner.run('echo', ['hello']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe('hello');
    });

    it('captures stderr', async () => {
      const runner = new ToolRunner();
      // Using ls with invalid option to generate stderr
      const result = await runner.run('ls', ['--invalid-option-xyz']);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toBeTruthy();
    });

    it('respects cwd option', async () => {
      const runner = new ToolRunner({ cwd: '/tmp' });
      const result = await runner.run('pwd');
      expect(result.stdout.trim()).toBe('/tmp');
    });

    it('handles command errors gracefully', async () => {
      const runner = new ToolRunner();
      const result = await runner.run('nonexistent-command-xyz');
      expect(result.exitCode).toBe(1);
    });
  });

  describe('runOrThrow', () => {
    it('returns result on success', async () => {
      const runner = new ToolRunner();
      const result = await runner.runOrThrow('echo', ['test']);
      expect(result.exitCode).toBe(0);
    });

    it('throws on non-zero exit code', async () => {
      const runner = new ToolRunner();
      await expect(runner.runOrThrow('false')).rejects.toThrow('failed');
    });
  });

  describe('runWithRetry', () => {
    it('returns on first success', async () => {
      const runner = new ToolRunner();
      const result = await runner.runWithRetry('echo', ['success'], 3);
      expect(result.exitCode).toBe(0);
    });

    it('retries on failure', async () => {
      const runner = new ToolRunner();
      const result = await runner.runWithRetry('false', [], 2);
      expect(result.exitCode).not.toBe(0);
    });
  });
});
