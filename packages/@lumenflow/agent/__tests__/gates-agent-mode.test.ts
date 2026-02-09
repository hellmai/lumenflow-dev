/**
 * Tests for gates-agent-mode.mjs
 *
 * WU-1827: Gates verbosity fix - reduce output from 50K+ to <500 chars in agent mode
 *
 * Tests for agent mode detection using TTY check instead of CLAUDE_PROJECT_DIR
 */

import { describe, it, expect } from 'vitest';

// Import from @lumenflow/core where the source lives
import {
  shouldUseGatesAgentMode,
  getGatesLogDir,
  buildGatesLogPath,
} from '@lumenflow/core/gates-agent-mode';

describe('shouldUseGatesAgentMode', () => {
  describe('TTY detection (primary mechanism)', () => {
    it('returns true when stdout is NOT a TTY and NOT in CI (agent mode)', () => {
      // This is the primary detection: non-TTY + non-CI = likely agent
      const result = shouldUseGatesAgentMode({
        argv: [],
        env: {},
        stdout: { isTTY: false },
      });
      expect(result).toBe(true);
    });

    it('returns false when stdout IS a TTY (interactive terminal)', () => {
      // Human users in interactive terminals should get full output
      const result = shouldUseGatesAgentMode({
        argv: [],
        env: {},
        stdout: { isTTY: true },
      });
      expect(result).toBe(false);
    });

    it('returns false when in CI environment', () => {
      // CI should get full output for debugging
      const result = shouldUseGatesAgentMode({
        argv: [],
        env: { CI: 'true' },
        stdout: { isTTY: false },
      });
      expect(result).toBe(false);
    });

    it('returns false when CI is set to any truthy value', () => {
      const result = shouldUseGatesAgentMode({
        argv: [],
        env: { CI: '1' },
        stdout: { isTTY: false },
      });
      expect(result).toBe(false);
    });
  });

  describe('--verbose flag override', () => {
    it('returns false when --verbose flag is present (forces full output)', () => {
      const result = shouldUseGatesAgentMode({
        argv: ['--verbose'],
        env: {},
        stdout: { isTTY: false },
      });
      expect(result).toBe(false);
    });

    it('respects --verbose even when CLAUDE_PROJECT_DIR is set', () => {
      const result = shouldUseGatesAgentMode({
        argv: ['--verbose'],
        env: { CLAUDE_PROJECT_DIR: '/some/path' },
        stdout: { isTTY: false },
      });
      expect(result).toBe(false);
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
      expect(result).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('handles missing argv gracefully', () => {
      const result = shouldUseGatesAgentMode({
        argv: undefined,
        env: {},
        stdout: { isTTY: false },
      });
      expect(result).toBe(true);
    });

    it('handles null argv gracefully', () => {
      const result = shouldUseGatesAgentMode({
        argv: null as any,
        env: {},
        stdout: { isTTY: false },
      });
      expect(result).toBe(true);
    });

    it('handles missing env gracefully', () => {
      const result = shouldUseGatesAgentMode({
        argv: [],
        env: undefined,
        stdout: { isTTY: false },
      });
      expect(result).toBe(true);
    });

    it('handles missing stdout gracefully (defaults to non-TTY)', () => {
      const result = shouldUseGatesAgentMode({
        argv: [],
        env: {},
        stdout: undefined,
      });
      // When stdout is undefined, we cannot determine TTY status
      // Should default to agent mode (safer, avoids flooding context)
      expect(result).toBe(true);
    });

    it('handles stdout without isTTY property', () => {
      const result = shouldUseGatesAgentMode({
        argv: [],
        env: {},
        stdout: {},
      });
      // Missing isTTY property means non-TTY (or unknown) - assume agent mode
      expect(result).toBe(true);
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
      expect(result).toBe(false);
    });
  });
});

describe('getGatesLogDir', () => {
  it('uses LUMENFLOW_LOG_DIR env var when set', () => {
    const result = getGatesLogDir({
      cwd: '/project',
      env: { LUMENFLOW_LOG_DIR: 'custom-logs' },
    });
    expect(result).toBe('/project/custom-logs');
  });

  it('defaults to .logs when LUMENFLOW_LOG_DIR not set', () => {
    const result = getGatesLogDir({
      cwd: '/project',
      env: {},
    });
    expect(result).toBe('/project/.logs');
  });

  it('handles undefined env', () => {
    const result = getGatesLogDir({
      cwd: '/project',
      env: undefined,
    });
    expect(result).toBe('/project/.logs');
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

    expect(result).toContain('.logs');
    expect(result).toContain('gates-');
    expect(result).toContain('operations-tooling');
    expect(result).toContain('wu-1827');
    expect(result).toContain('.log');
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
    expect(result).not.toContain(':');
    expect(result).not.toContain('&');
    expect(result).not.toContain(' ');
  });

  it('handles missing lane and wu gracefully', () => {
    const result = buildGatesLogPath({
      cwd: '/project',
      env: {},
      wuId: undefined,
      lane: undefined,
      now: new Date('2025-12-18T10:30:00.000Z'),
    });

    expect(result).toContain('unknown');
    expect(result).toContain('.log');
  });
});
