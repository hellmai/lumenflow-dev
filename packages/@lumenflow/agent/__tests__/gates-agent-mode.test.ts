#!/usr/bin/env node
/**
 * Tests for gates-agent-mode.mjs
 *
 * WU-1827: Gates verbosity fix - reduce output from 50K+ to <500 chars in agent mode
 *
 * Tests for agent mode detection using TTY check instead of CLAUDE_PROJECT_DIR
 *
 * Run: node --test tools/lib/__tests__/gates-agent-mode.test.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { join } from 'node:path';

// Import from @lumenflow/core where the source lives
import {
  shouldUseGatesAgentMode,
  getGatesLogDir,
  buildGatesLogPath,
} from '@lumenflow/core/dist/gates-agent-mode.js';

describe('shouldUseGatesAgentMode', () => {
  describe('TTY detection (primary mechanism)', () => {
    it('returns true when stdout is NOT a TTY and NOT in CI (agent mode)', () => {
      // This is the primary detection: non-TTY + non-CI = likely agent
      const result = shouldUseGatesAgentMode({
        argv: [],
        env: {},
        stdout: { isTTY: false },
      });
      assert.strictEqual(result, true);
    });

    it('returns false when stdout IS a TTY (interactive terminal)', () => {
      // Human users in interactive terminals should get full output
      const result = shouldUseGatesAgentMode({
        argv: [],
        env: {},
        stdout: { isTTY: true },
      });
      assert.strictEqual(result, false);
    });

    it('returns false when in CI environment', () => {
      // CI should get full output for debugging
      const result = shouldUseGatesAgentMode({
        argv: [],
        env: { CI: 'true' },
        stdout: { isTTY: false },
      });
      assert.strictEqual(result, false);
    });

    it('returns false when CI is set to any truthy value', () => {
      const result = shouldUseGatesAgentMode({
        argv: [],
        env: { CI: '1' },
        stdout: { isTTY: false },
      });
      assert.strictEqual(result, false);
    });
  });

  describe('--verbose flag override', () => {
    it('returns false when --verbose flag is present (forces full output)', () => {
      const result = shouldUseGatesAgentMode({
        argv: ['--verbose'],
        env: {},
        stdout: { isTTY: false },
      });
      assert.strictEqual(result, false);
    });

    it('respects --verbose even when CLAUDE_PROJECT_DIR is set', () => {
      const result = shouldUseGatesAgentMode({
        argv: ['--verbose'],
        env: { CLAUDE_PROJECT_DIR: '/some/path' },
        stdout: { isTTY: false },
      });
      assert.strictEqual(result, false);
    });
  });

  describe('CLAUDE_PROJECT_DIR (fallback/hint)', () => {
    it('returns true when CLAUDE_PROJECT_DIR is set and not verbose', () => {
      // CLAUDE_PROJECT_DIR can still be used as a hint when available
      const result = shouldUseGatesAgentMode({
        argv: [],
        env: { CLAUDE_PROJECT_DIR: '/some/path' },
        stdout: { isTTY: true }, // Even with TTY, CLAUDE_PROJECT_DIR takes precedence
      });
      assert.strictEqual(result, true);
    });
  });

  describe('edge cases', () => {
    it('handles missing argv gracefully', () => {
      const result = shouldUseGatesAgentMode({
        argv: undefined,
        env: {},
        stdout: { isTTY: false },
      });
      assert.strictEqual(result, true);
    });

    it('handles null argv gracefully', () => {
      const result = shouldUseGatesAgentMode({
        argv: null as any,
        env: {},
        stdout: { isTTY: false },
      });
      assert.strictEqual(result, true);
    });

    it('handles missing env gracefully', () => {
      const result = shouldUseGatesAgentMode({
        argv: [],
        env: undefined,
        stdout: { isTTY: false },
      });
      assert.strictEqual(result, true);
    });

    it('handles missing stdout gracefully (defaults to non-TTY)', () => {
      const result = shouldUseGatesAgentMode({
        argv: [],
        env: {},
        stdout: undefined,
      });
      // When stdout is undefined, we cannot determine TTY status
      // Should default to agent mode (safer, avoids flooding context)
      assert.strictEqual(result, true);
    });

    it('handles stdout without isTTY property', () => {
      const result = shouldUseGatesAgentMode({
        argv: [],
        env: {},
        stdout: {},
      });
      // Missing isTTY property means non-TTY (or unknown) - assume agent mode
      assert.strictEqual(result, true);
    });
  });

  describe('backward compatibility', () => {
    it('still works when only env and argv provided (uses process.stdout)', () => {
      // For backward compatibility with existing callers
      // The function should use process.stdout if stdout not provided
      const result = shouldUseGatesAgentMode({
        argv: ['--verbose'],
        env: {},
      });
      // --verbose should always return false regardless of TTY
      assert.strictEqual(result, false);
    });
  });
});

describe('getGatesLogDir', () => {
  it('uses LUMENFLOW_LOG_DIR env var when set', () => {
    const result = getGatesLogDir({
      cwd: '/project',
      env: { LUMENFLOW_LOG_DIR: 'custom-logs' },
    });
    assert.strictEqual(result, '/project/custom-logs');
  });

  it('defaults to .logs when LUMENFLOW_LOG_DIR not set', () => {
    const result = getGatesLogDir({
      cwd: '/project',
      env: {},
    });
    assert.strictEqual(result, '/project/.logs');
  });

  it('handles undefined env', () => {
    const result = getGatesLogDir({
      cwd: '/project',
      env: undefined,
    });
    assert.strictEqual(result, '/project/.logs');
  });
});

describe('buildGatesLogPath', () => {
  it('builds log path with lane and wu info', () => {
    const now = new Date('2025-12-18T10:30:45.123Z');
    const result = buildGatesLogPath({
      cwd: '/project',
      env: {},
      wuId: 'WU-1827',
      lane: 'Operations: Tooling',
      now,
    });

    assert.ok(result.includes('.logs'));
    assert.ok(result.includes('gates-'));
    assert.ok(result.includes('operations-tooling'));
    assert.ok(result.includes('wu-1827'));
    assert.ok(result.includes('.log'));
  });

  it('sanitizes lane name for file path', () => {
    const result = buildGatesLogPath({
      cwd: '/project',
      env: {},
      wuId: 'WU-123',
      lane: 'Operations: Tooling & Testing',
      now: new Date('2025-12-18T10:30:00.000Z'),
    });

    // Should not contain special characters
    assert.ok(!result.includes(':'));
    assert.ok(!result.includes('&'));
    assert.ok(!result.includes(' '));
  });

  it('handles missing lane and wu gracefully', () => {
    const result = buildGatesLogPath({
      cwd: '/project',
      env: {},
      wuId: undefined,
      lane: undefined,
      now: new Date('2025-12-18T10:30:00.000Z'),
    });

    assert.ok(result.includes('unknown'));
    assert.ok(result.includes('.log'));
  });
});
