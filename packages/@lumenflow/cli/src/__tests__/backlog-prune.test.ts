/**
 * @file backlog-prune.test.ts
 * @description Tests for backlog-prune CLI command (WU-1106)
 *
 * backlog-prune maintains backlog hygiene by:
 * - Auto-tagging stale WUs (in_progress/ready too long without activity)
 * - Archiving old completed WUs (done for > N days)
 *
 * TDD: RED phase - these tests define expected behavior before implementation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  calculateStaleDays,
  isWuStale,
  isWuArchivable,
  categorizeWus,
  parseBacklogPruneArgs,
  BACKLOG_PRUNE_DEFAULTS,
  loadAllWus,
  tagStaleWu,
  printHelp,
  type BacklogPruneArgs,
  type WuPruneInfo,
  type PruneCategorization,
} from '../backlog-prune.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

describe('backlog-prune CLI', () => {
  describe('source file existence', () => {
    it('should have the CLI source file', () => {
      const srcPath = join(__dirname, '../backlog-prune.ts');
      expect(existsSync(srcPath)).toBe(true);
    });

    it('should be buildable (dist file exists after build)', () => {
      // This test verifies that tsc compiled the file successfully
      const distPath = join(__dirname, '../../dist/backlog-prune.js');
      expect(existsSync(distPath)).toBe(true);
    });
  });

  describe('BACKLOG_PRUNE_DEFAULTS', () => {
    it('should have default stale days for in_progress WUs', () => {
      expect(BACKLOG_PRUNE_DEFAULTS.staleDaysInProgress).toBeTypeOf('number');
      expect(BACKLOG_PRUNE_DEFAULTS.staleDaysInProgress).toBeGreaterThan(0);
    });

    it('should have default stale days for ready WUs', () => {
      expect(BACKLOG_PRUNE_DEFAULTS.staleDaysReady).toBeTypeOf('number');
      expect(BACKLOG_PRUNE_DEFAULTS.staleDaysReady).toBeGreaterThan(0);
    });

    it('should have default archive days for done WUs', () => {
      expect(BACKLOG_PRUNE_DEFAULTS.archiveDaysDone).toBeTypeOf('number');
      expect(BACKLOG_PRUNE_DEFAULTS.archiveDaysDone).toBeGreaterThan(0);
    });
  });

  describe('parseBacklogPruneArgs', () => {
    it('should parse --dry-run flag (default)', () => {
      const args = parseBacklogPruneArgs(['node', 'backlog-prune']);
      expect(args.dryRun).toBe(true);
    });

    it('should parse --execute flag', () => {
      const args = parseBacklogPruneArgs(['node', 'backlog-prune', '--execute']);
      expect(args.dryRun).toBe(false);
    });

    it('should parse --stale-days-in-progress option', () => {
      const args = parseBacklogPruneArgs([
        'node',
        'backlog-prune',
        '--stale-days-in-progress',
        '5',
      ]);
      expect(args.staleDaysInProgress).toBe(5);
    });

    it('should parse --stale-days-ready option', () => {
      const args = parseBacklogPruneArgs(['node', 'backlog-prune', '--stale-days-ready', '14']);
      expect(args.staleDaysReady).toBe(14);
    });

    it('should parse --archive-days option', () => {
      const args = parseBacklogPruneArgs(['node', 'backlog-prune', '--archive-days', '60']);
      expect(args.archiveDaysDone).toBe(60);
    });

    it('should use defaults when options not provided', () => {
      const args = parseBacklogPruneArgs(['node', 'backlog-prune']);
      expect(args.staleDaysInProgress).toBe(BACKLOG_PRUNE_DEFAULTS.staleDaysInProgress);
      expect(args.staleDaysReady).toBe(BACKLOG_PRUNE_DEFAULTS.staleDaysReady);
      expect(args.archiveDaysDone).toBe(BACKLOG_PRUNE_DEFAULTS.archiveDaysDone);
    });

    it('should parse --help flag', () => {
      const args = parseBacklogPruneArgs(['node', 'backlog-prune', '--help']);
      expect(args.help).toBe(true);
    });
  });

  describe('calculateStaleDays', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      // Set current time to 2026-01-25
      vi.setSystemTime(new Date('2026-01-25T12:00:00Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should return days since date string', () => {
      const result = calculateStaleDays('2026-01-20');
      expect(result).toBe(5);
    });

    it('should return days since ISO date string', () => {
      const result = calculateStaleDays('2026-01-23T10:00:00Z');
      expect(result).toBe(2);
    });

    it('should return 0 for same day', () => {
      const result = calculateStaleDays('2026-01-25');
      expect(result).toBe(0);
    });

    it('should return null for invalid date', () => {
      const result = calculateStaleDays('not-a-date');
      expect(result).toBeNull();
    });

    it('should return null for undefined', () => {
      const result = calculateStaleDays(undefined);
      expect(result).toBeNull();
    });

    it('should return null for null', () => {
      const result = calculateStaleDays(null);
      expect(result).toBeNull();
    });
  });

  describe('isWuStale', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-01-25T12:00:00Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should return true for in_progress WU older than threshold', () => {
      const wu: WuPruneInfo = {
        id: 'WU-100',
        status: 'in_progress',
        created: '2026-01-10',
        updated: '2026-01-15', // 10 days old
      };
      expect(isWuStale(wu, { staleDaysInProgress: 7 })).toBe(true);
    });

    it('should return false for in_progress WU within threshold', () => {
      const wu: WuPruneInfo = {
        id: 'WU-100',
        status: 'in_progress',
        created: '2026-01-20',
        updated: '2026-01-24', // 1 day old
      };
      expect(isWuStale(wu, { staleDaysInProgress: 7 })).toBe(false);
    });

    it('should return true for ready WU older than threshold', () => {
      const wu: WuPruneInfo = {
        id: 'WU-100',
        status: 'ready',
        created: '2025-12-20', // 36 days old
      };
      expect(isWuStale(wu, { staleDaysReady: 30 })).toBe(true);
    });

    it('should return false for ready WU within threshold', () => {
      const wu: WuPruneInfo = {
        id: 'WU-100',
        status: 'ready',
        created: '2026-01-10', // 15 days old
      };
      expect(isWuStale(wu, { staleDaysReady: 30 })).toBe(false);
    });

    it('should return false for done WU (done WUs are not stale, they may be archivable)', () => {
      const wu: WuPruneInfo = {
        id: 'WU-100',
        status: 'done',
        created: '2025-01-01',
        completed: '2025-01-10',
      };
      expect(isWuStale(wu, { staleDaysInProgress: 7, staleDaysReady: 30 })).toBe(false);
    });

    it('should use updated date if available for staleness check', () => {
      const wu: WuPruneInfo = {
        id: 'WU-100',
        status: 'in_progress',
        created: '2025-01-01', // Very old
        updated: '2026-01-24', // Recently updated (1 day ago)
      };
      expect(isWuStale(wu, { staleDaysInProgress: 7 })).toBe(false);
    });

    it('should fall back to created date if updated not available', () => {
      const wu: WuPruneInfo = {
        id: 'WU-100',
        status: 'in_progress',
        created: '2026-01-10', // 15 days old
      };
      expect(isWuStale(wu, { staleDaysInProgress: 7 })).toBe(true);
    });
  });

  describe('isWuArchivable', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-01-25T12:00:00Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should return true for done WU completed older than threshold', () => {
      const wu: WuPruneInfo = {
        id: 'WU-100',
        status: 'done',
        created: '2025-01-01',
        completed: '2025-11-25', // 61 days ago
      };
      expect(isWuArchivable(wu, { archiveDaysDone: 60 })).toBe(true);
    });

    it('should return false for done WU completed within threshold', () => {
      const wu: WuPruneInfo = {
        id: 'WU-100',
        status: 'done',
        created: '2025-12-01',
        completed: '2026-01-10', // 15 days ago
      };
      expect(isWuArchivable(wu, { archiveDaysDone: 60 })).toBe(false);
    });

    it('should return false for non-done WU', () => {
      const wu: WuPruneInfo = {
        id: 'WU-100',
        status: 'in_progress',
        created: '2025-01-01',
      };
      expect(isWuArchivable(wu, { archiveDaysDone: 60 })).toBe(false);
    });

    it('should return false for done WU without completed date', () => {
      const wu: WuPruneInfo = {
        id: 'WU-100',
        status: 'done',
        created: '2025-01-01',
      };
      expect(isWuArchivable(wu, { archiveDaysDone: 60 })).toBe(false);
    });
  });

  describe('categorizeWus', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-01-25T12:00:00Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should categorize stale, archivable, and healthy WUs', () => {
      const wus: WuPruneInfo[] = [
        // Stale in_progress (updated 10 days ago)
        { id: 'WU-101', status: 'in_progress', created: '2026-01-01', updated: '2026-01-15' },
        // Healthy in_progress (updated 2 days ago)
        { id: 'WU-102', status: 'in_progress', created: '2026-01-01', updated: '2026-01-23' },
        // Stale ready (created 40 days ago)
        { id: 'WU-103', status: 'ready', created: '2025-12-16' },
        // Healthy ready (created 10 days ago)
        { id: 'WU-104', status: 'ready', created: '2026-01-15' },
        // Archivable done (completed 70 days ago)
        { id: 'WU-105', status: 'done', created: '2025-10-01', completed: '2025-11-16' },
        // Healthy done (completed 30 days ago)
        { id: 'WU-106', status: 'done', created: '2025-12-01', completed: '2025-12-26' },
        // Blocked WU (not considered stale/archivable)
        { id: 'WU-107', status: 'blocked', created: '2025-01-01' },
      ];

      const result = categorizeWus(wus, {
        staleDaysInProgress: 7,
        staleDaysReady: 30,
        archiveDaysDone: 60,
      });

      expect(result.stale).toHaveLength(2);
      expect(result.stale.map((w) => w.id)).toContain('WU-101');
      expect(result.stale.map((w) => w.id)).toContain('WU-103');

      expect(result.archivable).toHaveLength(1);
      expect(result.archivable[0].id).toBe('WU-105');

      expect(result.healthy).toHaveLength(4);
      expect(result.healthy.map((w) => w.id)).toContain('WU-102');
      expect(result.healthy.map((w) => w.id)).toContain('WU-104');
      expect(result.healthy.map((w) => w.id)).toContain('WU-106');
      expect(result.healthy.map((w) => w.id)).toContain('WU-107');
    });

    it('should return empty arrays when no WUs provided', () => {
      const result = categorizeWus([], {
        staleDaysInProgress: 7,
        staleDaysReady: 30,
        archiveDaysDone: 60,
      });

      expect(result.stale).toHaveLength(0);
      expect(result.archivable).toHaveLength(0);
      expect(result.healthy).toHaveLength(0);
    });
  });

  describe('isWuStale - additional edge cases', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-01-25T12:00:00Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should return false for blocked WU regardless of age', () => {
      const wu: WuPruneInfo = {
        id: 'WU-100',
        status: 'blocked',
        created: '2025-01-01', // Very old
      };
      expect(isWuStale(wu, { staleDaysInProgress: 7, staleDaysReady: 30 })).toBe(false);
    });

    it('should return false for completed WU (legacy status)', () => {
      const wu: WuPruneInfo = {
        id: 'WU-100',
        status: 'completed',
        created: '2025-01-01',
        completed: '2025-01-10',
      };
      expect(isWuStale(wu, { staleDaysInProgress: 7, staleDaysReady: 30 })).toBe(false);
    });

    it('should handle backlog status (legacy ready)', () => {
      const wu: WuPruneInfo = {
        id: 'WU-100',
        status: 'backlog',
        created: '2025-12-20', // 36 days old
      };
      expect(isWuStale(wu, { staleDaysReady: 30 })).toBe(true);
    });

    it('should handle todo status (legacy ready)', () => {
      const wu: WuPruneInfo = {
        id: 'WU-100',
        status: 'todo',
        created: '2025-12-20', // 36 days old
      };
      expect(isWuStale(wu, { staleDaysReady: 30 })).toBe(true);
    });

    it('should return false when no date is available', () => {
      const wu: WuPruneInfo = {
        id: 'WU-100',
        status: 'in_progress',
      };
      expect(isWuStale(wu, { staleDaysInProgress: 7 })).toBe(false);
    });

    it('should return false for unknown status', () => {
      const wu: WuPruneInfo = {
        id: 'WU-100',
        status: 'unknown',
        created: '2025-01-01', // Very old
      };
      expect(isWuStale(wu, { staleDaysInProgress: 7, staleDaysReady: 30 })).toBe(false);
    });

    it('should use default threshold when not specified', () => {
      const wu: WuPruneInfo = {
        id: 'WU-100',
        status: 'in_progress',
        created: '2026-01-10', // 15 days old
      };
      // Default is 7 days, so 15 days is stale
      expect(isWuStale(wu, {})).toBe(true);
    });
  });

  describe('isWuArchivable - additional edge cases', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-01-25T12:00:00Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should return true for completed WU (legacy done status)', () => {
      const wu: WuPruneInfo = {
        id: 'WU-100',
        status: 'completed',
        created: '2025-01-01',
        completed: '2025-11-20', // 66 days ago
      };
      expect(isWuArchivable(wu, { archiveDaysDone: 60 })).toBe(true);
    });

    it('should use default threshold when not specified', () => {
      const wu: WuPruneInfo = {
        id: 'WU-100',
        status: 'done',
        created: '2025-01-01',
        completed: '2025-10-20', // 97 days ago
      };
      // Default is 90 days, so 97 days is archivable
      expect(isWuArchivable(wu, {})).toBe(true);
    });

    it('should return false when completed date is invalid', () => {
      const wu: WuPruneInfo = {
        id: 'WU-100',
        status: 'done',
        created: '2025-01-01',
        completed: 'invalid-date',
      };
      expect(isWuArchivable(wu, { archiveDaysDone: 60 })).toBe(false);
    });
  });

  describe('parseBacklogPruneArgs - additional edge cases', () => {
    it('should handle -h flag as help', () => {
      const args = parseBacklogPruneArgs(['node', 'backlog-prune', '-h']);
      expect(args.help).toBe(true);
    });

    it('should handle missing value for --stale-days-in-progress', () => {
      const args = parseBacklogPruneArgs(['node', 'backlog-prune', '--stale-days-in-progress']);
      // Should use default when no value follows
      expect(args.staleDaysInProgress).toBe(BACKLOG_PRUNE_DEFAULTS.staleDaysInProgress);
    });

    it('should handle missing value for --stale-days-ready', () => {
      const args = parseBacklogPruneArgs(['node', 'backlog-prune', '--stale-days-ready']);
      expect(args.staleDaysReady).toBe(BACKLOG_PRUNE_DEFAULTS.staleDaysReady);
    });

    it('should handle missing value for --archive-days', () => {
      const args = parseBacklogPruneArgs(['node', 'backlog-prune', '--archive-days']);
      expect(args.archiveDaysDone).toBe(BACKLOG_PRUNE_DEFAULTS.archiveDaysDone);
    });

    it('should handle multiple flags combined', () => {
      const args = parseBacklogPruneArgs([
        'node',
        'backlog-prune',
        '--execute',
        '--stale-days-in-progress',
        '10',
        '--stale-days-ready',
        '20',
        '--archive-days',
        '45',
      ]);
      expect(args.dryRun).toBe(false);
      expect(args.staleDaysInProgress).toBe(10);
      expect(args.staleDaysReady).toBe(20);
      expect(args.archiveDaysDone).toBe(45);
    });

    it('should override with --dry-run after --execute', () => {
      const args = parseBacklogPruneArgs(['node', 'backlog-prune', '--execute', '--dry-run']);
      expect(args.dryRun).toBe(true);
    });
  });

  describe('loadAllWus', () => {
    it('should be a function', () => {
      expect(typeof loadAllWus).toBe('function');
    });

    it('should return an array', () => {
      // This will load from the actual WU directory in the test environment
      const result = loadAllWus();
      expect(Array.isArray(result)).toBe(true);
    });

    it('should return WuPruneInfo objects with required fields', () => {
      const result = loadAllWus();
      // All returned items should have at least id and status
      for (const wu of result) {
        expect(wu).toHaveProperty('id');
        expect(wu).toHaveProperty('status');
      }
    });
  });

  describe('tagStaleWu', () => {
    it('should be a function', () => {
      expect(typeof tagStaleWu).toBe('function');
    });

    it('should log in dry-run mode without modifying files', () => {
      const wu: WuPruneInfo = {
        id: 'WU-TEST-999',
        status: 'in_progress',
        created: '2026-01-01',
      };

      // In dry-run mode, it should just log
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      tagStaleWu(wu, true);
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('printHelp', () => {
    it('should be a function', () => {
      expect(typeof printHelp).toBe('function');
    });

    it('should print help text to console', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      printHelp();
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should include usage information', () => {
      let output = '';
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation((msg) => {
        output += msg;
      });
      printHelp();
      expect(output).toContain('backlog:prune');
      expect(output).toContain('--execute');
      expect(output).toContain('--dry-run');
      consoleSpy.mockRestore();
    });
  });
});
