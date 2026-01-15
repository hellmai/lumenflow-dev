/**
 * Orchestrate CLI tests (WU-2537)
 */

import { describe, it, expect } from 'vitest';
import {
  parseOrchestrateCommand,
  ORCHESTRATION_COMMANDS,
} from '../../src/orchestration/orchestrate-cli.js';

describe('parseOrchestrateCommand', () => {
  describe('valid commands', () => {
    it('parses status command with --initiative', () => {
      const result = parseOrchestrateCommand(['status', '--initiative', 'INIT-051']);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.command.name).toBe('status');
        expect(result.command.options.initiative).toBe('INIT-051');
      }
    });

    it('parses status command with --wu', () => {
      const result = parseOrchestrateCommand(['status', '--wu', 'WU-2537']);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.command.name).toBe('status');
        expect(result.command.options.wu).toBe('WU-2537');
      }
    });

    it('parses plan command with --initiative', () => {
      const result = parseOrchestrateCommand(['plan', '--initiative', 'INIT-051']);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.command.name).toBe('plan');
        expect(result.command.options.initiative).toBe('INIT-051');
      }
    });

    it('parses execute command with --wu', () => {
      const result = parseOrchestrateCommand(['execute', '--wu', 'WU-123']);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.command.name).toBe('execute');
        expect(result.command.options.wu).toBe('WU-123');
      }
    });

    it('parses spawn command', () => {
      const result = parseOrchestrateCommand(['spawn', '--wu', 'WU-456']);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.command.name).toBe('spawn');
      }
    });

    it('parses monitor command', () => {
      const result = parseOrchestrateCommand(['monitor', '--initiative', 'INIT-051']);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.command.name).toBe('monitor');
      }
    });

    it('parses --dry-run flag', () => {
      const result = parseOrchestrateCommand(['plan', '--initiative', 'INIT-051', '--dry-run']);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.command.options.dryRun).toBe(true);
      }
    });

    it('parses --lane option', () => {
      const result = parseOrchestrateCommand([
        'execute',
        '--wu',
        'WU-123',
        '--lane',
        'Operations',
      ]);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.command.options.lane).toBe('Operations');
      }
    });
  });

  describe('error cases', () => {
    it('fails with no command', () => {
      const result = parseOrchestrateCommand([]);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe('No command specified');
      }
    });

    it('fails with unknown command', () => {
      const result = parseOrchestrateCommand(['invalid']);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('Unknown command');
      }
    });

    it('fails status without --initiative or --wu', () => {
      const result = parseOrchestrateCommand(['status']);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('status command requires');
      }
    });

    it('fails plan without --initiative', () => {
      const result = parseOrchestrateCommand(['plan']);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('plan command requires --initiative');
      }
    });

    it('fails execute without --wu or --initiative', () => {
      const result = parseOrchestrateCommand(['execute']);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('execute command requires');
      }
    });
  });

  describe('ORCHESTRATION_COMMANDS constant', () => {
    it('includes all expected commands', () => {
      expect(ORCHESTRATION_COMMANDS).toContain('status');
      expect(ORCHESTRATION_COMMANDS).toContain('plan');
      expect(ORCHESTRATION_COMMANDS).toContain('execute');
      expect(ORCHESTRATION_COMMANDS).toContain('spawn');
      expect(ORCHESTRATION_COMMANDS).toContain('monitor');
    });
  });
});
