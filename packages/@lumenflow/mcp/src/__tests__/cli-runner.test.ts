/**
 * @file cli-runner.test.ts
 * @description Tests for CLI runner utility that shells out to LumenFlow CLI commands
 *
 * WU-1412: MCP server uses CLI shell-out for write operations
 *
 * Note: These tests focus on the interface contract rather than mocking internal
 * implementation details. The cli-runner uses promisified execFile which is
 * challenging to mock reliably. Integration testing via tools.test.ts provides
 * better coverage of the actual behavior.
 */

import { describe, it, expect } from 'vitest';
import { parseJsonOutput, type CliRunnerResult } from '../cli-runner.js';

describe('cli-runner', () => {
  describe('parseJsonOutput', () => {
    it('should parse JSON from successful result', () => {
      const result: CliRunnerResult = {
        success: true,
        stdout: '{"id": "WU-1234", "status": "ready"}',
        stderr: '',
        exitCode: 0,
      };

      const parsed = parseJsonOutput<{ id: string; status: string }>(result);
      expect(parsed).toEqual({ id: 'WU-1234', status: 'ready' });
    });

    it('should return null for failed result', () => {
      const result: CliRunnerResult = {
        success: false,
        stdout: '',
        stderr: 'error',
        exitCode: 1,
      };

      const parsed = parseJsonOutput(result);
      expect(parsed).toBeNull();
    });

    it('should return null for invalid JSON', () => {
      const result: CliRunnerResult = {
        success: true,
        stdout: 'not json',
        stderr: '',
        exitCode: 0,
      };

      const parsed = parseJsonOutput(result);
      expect(parsed).toBeNull();
    });
  });
});
