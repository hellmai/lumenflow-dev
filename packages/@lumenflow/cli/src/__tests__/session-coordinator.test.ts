#!/usr/bin/env node
/**
 * Tests for session-coordinator CLI command
 *
 * WU-1112: INIT-003 Phase 6 - Migrate remaining Tier 1 tools
 *
 * Session coordinator manages agent sessions - starting, stopping,
 * and coordinating handoffs between sessions.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Import functions under test
import {
  parseSessionArgs,
  SessionCommand,
  SessionArgs,
  validateSessionCommand,
} from '../session-coordinator.js';

describe('session-coordinator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('parseSessionArgs', () => {
    it('should parse start subcommand', () => {
      const args = parseSessionArgs(['node', 'session-coordinator.js', 'start']);
      expect(args.command).toBe('start');
    });

    it('should parse stop subcommand', () => {
      const args = parseSessionArgs(['node', 'session-coordinator.js', 'stop']);
      expect(args.command).toBe('stop');
    });

    it('should parse status subcommand', () => {
      const args = parseSessionArgs(['node', 'session-coordinator.js', 'status']);
      expect(args.command).toBe('status');
    });

    it('should parse handoff subcommand', () => {
      const args = parseSessionArgs(['node', 'session-coordinator.js', 'handoff']);
      expect(args.command).toBe('handoff');
    });

    it('should parse --wu option', () => {
      const args = parseSessionArgs(['node', 'session-coordinator.js', 'start', '--wu', 'WU-1112']);
      expect(args.wuId).toBe('WU-1112');
    });

    it('should parse --agent option', () => {
      const args = parseSessionArgs([
        'node',
        'session-coordinator.js',
        'start',
        '--agent',
        'claude-code',
      ]);
      expect(args.agent).toBe('claude-code');
    });

    it('should parse --reason option for stop', () => {
      const args = parseSessionArgs([
        'node',
        'session-coordinator.js',
        'stop',
        '--reason',
        'Completed work',
      ]);
      expect(args.reason).toBe('Completed work');
    });

    it('should parse --help flag', () => {
      const args = parseSessionArgs(['node', 'session-coordinator.js', '--help']);
      expect(args.help).toBe(true);
    });

    it('should default to status when no subcommand given', () => {
      const args = parseSessionArgs(['node', 'session-coordinator.js']);
      expect(args.command).toBe('status');
    });
  });

  describe('validateSessionCommand', () => {
    it('should accept valid start command with wu', () => {
      const args: SessionArgs = { command: 'start', wuId: 'WU-1112' };
      const result = validateSessionCommand(args);
      expect(result.valid).toBe(true);
    });

    it('should reject start without wu', () => {
      const args: SessionArgs = { command: 'start' };
      const result = validateSessionCommand(args);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('--wu');
    });

    it('should accept stop command without reason', () => {
      const args: SessionArgs = { command: 'stop' };
      const result = validateSessionCommand(args);
      expect(result.valid).toBe(true);
    });

    it('should accept status command', () => {
      const args: SessionArgs = { command: 'status' };
      const result = validateSessionCommand(args);
      expect(result.valid).toBe(true);
    });

    it('should accept handoff command with wu', () => {
      const args: SessionArgs = { command: 'handoff', wuId: 'WU-1112' };
      const result = validateSessionCommand(args);
      expect(result.valid).toBe(true);
    });

    it('should reject handoff without wu', () => {
      const args: SessionArgs = { command: 'handoff' };
      const result = validateSessionCommand(args);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('--wu');
    });
  });

  describe('SessionCommand enum', () => {
    it('should have all expected commands', () => {
      expect(SessionCommand.START).toBe('start');
      expect(SessionCommand.STOP).toBe('stop');
      expect(SessionCommand.STATUS).toBe('status');
      expect(SessionCommand.HANDOFF).toBe('handoff');
    });
  });
});
