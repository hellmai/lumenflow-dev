/**
 * Agent Package Tests
 *
 * Tests for session and logging modules.
 *
 * @module @lumenflow/agent/__tests__/agent
 */

import { describe, it, expect } from 'vitest';
import {
  validateAgentSession,
  createSessionId,
  SESSION_STATES,
  SESSION_PATTERNS,
} from '../src/session.js';
import {
  validateLogEntry,
  createLogEntry,
  LOG_LEVELS,
  LOG_FILES,
} from '../src/logging.js';

describe('Agent Session', () => {
  describe('SESSION_PATTERNS', () => {
    it('validates session ID format (UUID)', () => {
      expect(SESSION_PATTERNS.SESSION_ID.test('f47ac10b-58cc-4372-a567-0e02b2c3d479')).toBe(true);
      expect(SESSION_PATTERNS.SESSION_ID.test('invalid')).toBe(false);
    });

    it('validates WU ID format', () => {
      expect(SESSION_PATTERNS.WU_ID.test('WU-123')).toBe(true);
      expect(SESSION_PATTERNS.WU_ID.test('wu-123')).toBe(false);
    });
  });

  describe('validateAgentSession', () => {
    const validSession = {
      id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
      wuId: 'WU-2541',
      state: 'active',
      pid: 12345,
      startedAt: '2026-01-15T10:00:00.000Z',
      updatedAt: '2026-01-15T10:05:00.000Z',
      lane: 'Operations: Scripts',
    };

    it('accepts valid session', () => {
      const result = validateAgentSession(validSession);
      expect(result.success).toBe(true);
    });

    it('accepts session with optional fields', () => {
      const sessionWithOptionals = {
        ...validSession,
        worktreePath: '/worktrees/operations-wu-2541',
        baselineSha: 'abc123',
        metadata: { agent: 'test' },
      };
      const result = validateAgentSession(sessionWithOptionals);
      expect(result.success).toBe(true);
    });

    it('rejects invalid session ID', () => {
      const result = validateAgentSession({ ...validSession, id: 'invalid' });
      expect(result.success).toBe(false);
    });

    it('rejects invalid state', () => {
      const result = validateAgentSession({ ...validSession, state: 'invalid' });
      expect(result.success).toBe(false);
    });

    it('rejects negative PID', () => {
      const result = validateAgentSession({ ...validSession, pid: -1 });
      expect(result.success).toBe(false);
    });
  });

  describe('createSessionId', () => {
    it('creates valid UUID format', () => {
      const id = createSessionId();
      expect(SESSION_PATTERNS.SESSION_ID.test(id)).toBe(true);
    });

    it('creates unique IDs', () => {
      const id1 = createSessionId();
      const id2 = createSessionId();
      expect(id1).not.toBe(id2);
    });
  });

  describe('constants', () => {
    it('exports all session states', () => {
      expect(SESSION_STATES).toContain('starting');
      expect(SESSION_STATES).toContain('active');
      expect(SESSION_STATES).toContain('paused');
      expect(SESSION_STATES).toContain('completed');
      expect(SESSION_STATES).toContain('failed');
      expect(SESSION_STATES).toHaveLength(5);
    });
  });
});

describe('Agent Logging', () => {
  describe('validateLogEntry', () => {
    const validEntry = {
      timestamp: '2026-01-15T10:00:00.000Z',
      level: 'info',
      message: 'Test message',
    };

    it('accepts valid log entry', () => {
      const result = validateLogEntry(validEntry);
      expect(result.success).toBe(true);
    });

    it('accepts entry with optional fields', () => {
      const entryWithOptionals = {
        ...validEntry,
        sessionId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
        wuId: 'WU-2541',
        metadata: { action: 'test' },
      };
      const result = validateLogEntry(entryWithOptionals);
      expect(result.success).toBe(true);
    });

    it('rejects invalid level', () => {
      const result = validateLogEntry({ ...validEntry, level: 'invalid' });
      expect(result.success).toBe(false);
    });

    it('rejects empty message', () => {
      const result = validateLogEntry({ ...validEntry, message: '' });
      expect(result.success).toBe(false);
    });
  });

  describe('createLogEntry', () => {
    it('creates valid log entry', () => {
      const entry = createLogEntry('info', 'Test message');
      expect(entry.level).toBe('info');
      expect(entry.message).toBe('Test message');
      expect(entry.timestamp).toBeDefined();
    });

    it('includes optional fields', () => {
      const entry = createLogEntry('warn', 'Warning', {
        sessionId: 'test-session',
        wuId: 'WU-123',
        metadata: { key: 'value' },
      });
      expect(entry.sessionId).toBe('test-session');
      expect(entry.wuId).toBe('WU-123');
      expect(entry.metadata).toEqual({ key: 'value' });
    });
  });

  describe('constants', () => {
    it('exports all log levels', () => {
      expect(LOG_LEVELS).toContain('debug');
      expect(LOG_LEVELS).toContain('info');
      expect(LOG_LEVELS).toContain('warn');
      expect(LOG_LEVELS).toContain('error');
      expect(LOG_LEVELS).toHaveLength(4);
    });

    it('exports all log files', () => {
      expect(LOG_FILES.WEB).toBe('web.log');
      expect(LOG_FILES.COMMANDS).toBe('commands.log');
      expect(LOG_FILES.FLOW).toBe('flow.log');
      expect(LOG_FILES.TOOL_AUDIT).toBe('tool-audit.ndjson');
    });
  });
});
