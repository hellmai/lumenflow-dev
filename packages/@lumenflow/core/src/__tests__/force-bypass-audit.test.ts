/**
 * WU-1070: Force Bypass Audit Tests
 *
 * Tests for the LUMENFLOW_FORCE bypass audit logging functionality.
 * Ensures all bypasses are logged with proper format and fail-open behavior.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as child_process from 'node:child_process';
import {
  logForceBypass,
  shouldBypass,
  getAuditLogPath,
  parseAuditLogLine,
  type AuditLogEntry,
} from '../force-bypass-audit.js';

// Mock fs module
vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof fs>('node:fs');
  return {
    ...actual,
    appendFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    existsSync: vi.fn().mockReturnValue(true),
  };
});

// Mock child_process for git commands
vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof child_process>('node:child_process');
  return {
    ...actual,
    execSync: vi.fn((cmd: string) => {
      if (cmd.includes('git config user.name')) {
        return 'Test User';
      }
      if (cmd.includes('git rev-parse --abbrev-ref HEAD')) {
        return 'lane/operations/wu-1070';
      }
      return '';
    }),
  };
});

describe('force-bypass-audit', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetAllMocks();
    process.env = { ...originalEnv };
    vi.mocked(fs.existsSync).mockReturnValue(true);
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('shouldBypass', () => {
    it('returns true when LUMENFLOW_FORCE=1', () => {
      process.env.LUMENFLOW_FORCE = '1';
      expect(shouldBypass()).toBe(true);
    });

    it('returns false when LUMENFLOW_FORCE is not set', () => {
      delete process.env.LUMENFLOW_FORCE;
      expect(shouldBypass()).toBe(false);
    });

    it('returns false when LUMENFLOW_FORCE is not "1"', () => {
      process.env.LUMENFLOW_FORCE = 'yes';
      expect(shouldBypass()).toBe(false);
    });
  });

  describe('getAuditLogPath', () => {
    it('returns path relative to project root', () => {
      const logPath = getAuditLogPath('/project/root');
      expect(logPath).toBe('/project/root/.lumenflow/force-bypasses.log');
    });
  });

  describe('logForceBypass', () => {
    it('logs bypass with correct format when reason is provided', () => {
      process.env.LUMENFLOW_FORCE = '1';
      process.env.LUMENFLOW_FORCE_REASON = 'Emergency hotfix for production';
      vi.mocked(fs.existsSync).mockReturnValue(true);

      logForceBypass('pre-commit', '/project/root');

      expect(fs.appendFileSync).toHaveBeenCalledOnce();
      const [logPath, content] = vi.mocked(fs.appendFileSync).mock.calls[0];

      expect(logPath).toBe('/project/root/.lumenflow/force-bypasses.log');
      expect(content).toContain('pre-commit');
      expect(content).toContain('Test User');
      expect(content).toContain('lane/operations/wu-1070');
      expect(content).toContain('Emergency hotfix for production');
      expect(content).toContain('/project/root');
    });

    it('logs bypass with warning when reason is missing', () => {
      process.env.LUMENFLOW_FORCE = '1';
      delete process.env.LUMENFLOW_FORCE_REASON;
      vi.mocked(fs.existsSync).mockReturnValue(true);

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      logForceBypass('pre-push', '/project/root');

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('LUMENFLOW_FORCE_REASON'));
      expect(fs.appendFileSync).toHaveBeenCalledOnce();
      const content = vi.mocked(fs.appendFileSync).mock.calls[0][1] as string;
      expect(content).toContain('(no reason provided)');

      consoleSpy.mockRestore();
    });

    it('creates .lumenflow directory if it does not exist', () => {
      process.env.LUMENFLOW_FORCE = '1';
      process.env.LUMENFLOW_FORCE_REASON = 'Test reason';
      vi.mocked(fs.existsSync).mockReturnValue(false);

      logForceBypass('commit-msg', '/project/root');

      expect(fs.mkdirSync).toHaveBeenCalledWith('/project/root/.lumenflow', { recursive: true });
    });

    it('is fail-open: does not throw when logging fails', () => {
      process.env.LUMENFLOW_FORCE = '1';
      process.env.LUMENFLOW_FORCE_REASON = 'Test';
      vi.mocked(fs.appendFileSync).mockImplementation(() => {
        throw new Error('Disk full');
      });

      // Should not throw
      expect(() => logForceBypass('pre-commit', '/project/root')).not.toThrow();
    });

    it('logs to stderr when logging fails', () => {
      process.env.LUMENFLOW_FORCE = '1';
      process.env.LUMENFLOW_FORCE_REASON = 'Test';
      vi.mocked(fs.appendFileSync).mockImplementation(() => {
        throw new Error('Disk full');
      });

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      logForceBypass('pre-commit', '/project/root');

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('audit log'));

      consoleSpy.mockRestore();
    });

    it('does nothing when LUMENFLOW_FORCE is not set', () => {
      delete process.env.LUMENFLOW_FORCE;

      logForceBypass('pre-commit', '/project/root');

      expect(fs.appendFileSync).not.toHaveBeenCalled();
    });
  });

  describe('parseAuditLogLine', () => {
    it('parses a valid log line', () => {
      const line =
        '2026-01-23T10:30:00.000Z | pre-commit | Test User | lane/ops/wu-1070 | Emergency fix | /project/root';

      const entry = parseAuditLogLine(line);

      expect(entry).toEqual({
        timestamp: '2026-01-23T10:30:00.000Z',
        hook: 'pre-commit',
        user: 'Test User',
        branch: 'lane/ops/wu-1070',
        reason: 'Emergency fix',
        cwd: '/project/root',
      });
    });

    it('returns null for invalid lines', () => {
      expect(parseAuditLogLine('')).toBeNull();
      expect(parseAuditLogLine('not a valid line')).toBeNull();
      expect(parseAuditLogLine('only | two | parts')).toBeNull();
    });
  });

  describe('log format', () => {
    it('uses ISO timestamp format', () => {
      process.env.LUMENFLOW_FORCE = '1';
      process.env.LUMENFLOW_FORCE_REASON = 'Test';

      logForceBypass('pre-commit', '/project/root');

      const content = vi.mocked(fs.appendFileSync).mock.calls[0][1] as string;
      // ISO format: 2026-01-23T10:30:00.000Z
      expect(content).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/);
    });

    it('uses pipe delimiter between fields', () => {
      process.env.LUMENFLOW_FORCE = '1';
      process.env.LUMENFLOW_FORCE_REASON = 'Test';

      logForceBypass('pre-commit', '/project/root');

      const content = vi.mocked(fs.appendFileSync).mock.calls[0][1] as string;
      const parts = content.trim().split(' | ');
      expect(parts).toHaveLength(6);
    });
  });
});
