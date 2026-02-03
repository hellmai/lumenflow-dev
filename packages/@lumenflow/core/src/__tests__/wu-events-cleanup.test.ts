/**
 * WU Events Cleanup Tests (WU-1207)
 *
 * TDD tests for WU events archival functionality.
 * Tests cover:
 * - EventArchivalConfigSchema with archiveAfter (90d default), keepArchives (true default)
 * - archiveWuEvents() grouping events by WU ID
 * - Archive files created at .lumenflow/archive/wu-events-YYYY-MM.jsonl
 * - Active WU events (in_progress/blocked/waiting) are never archived
 * - Monthly rollup of archived events
 */

 
 

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  archiveWuEvents,
  shouldArchiveEvent,
  getArchiveFilePath,
  parseArchiveAfter,
  type EventArchivalConfig,
  DEFAULT_EVENT_ARCHIVAL_CONFIG,
} from '../wu-events-cleanup.js';
import type { WUEvent } from '../wu-state-schema.js';

/**
 * Test constants
 */
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const NINETY_DAYS_MS = 90 * ONE_DAY_MS;

/**
 * Path constants
 */
const STATE_DIR = '.lumenflow/state';
const ARCHIVE_DIR = '.lumenflow/archive';
const WU_EVENTS_FILE = 'wu-events.jsonl';

/**
 * Create a complete event sequence for a WU (claim -> complete)
 */
function createCompletedWuEvents(
  wuId: string,
  claimOffsetDays: number,
  completeOffsetDays: number,
): WUEvent[] {
  const now = Date.now();
  return [
    {
      type: 'claim',
      wuId,
      lane: 'Framework: Core',
      title: `Test WU ${wuId}`,
      timestamp: new Date(now - claimOffsetDays * ONE_DAY_MS).toISOString(),
    } as WUEvent,
    {
      type: 'complete',
      wuId,
      timestamp: new Date(now - completeOffsetDays * ONE_DAY_MS).toISOString(),
    } as WUEvent,
  ];
}

/**
 * Create an in_progress WU event sequence (only claim, no complete)
 */
function createInProgressWuEvents(wuId: string, claimOffsetDays: number): WUEvent[] {
  const now = Date.now();
  return [
    {
      type: 'claim',
      wuId,
      lane: 'Framework: Core',
      title: `Test WU ${wuId}`,
      timestamp: new Date(now - claimOffsetDays * ONE_DAY_MS).toISOString(),
    } as WUEvent,
  ];
}

/**
 * Create a blocked WU event sequence (claim -> block)
 */
function createBlockedWuEvents(
  wuId: string,
  claimOffsetDays: number,
  blockOffsetDays: number,
): WUEvent[] {
  const now = Date.now();
  return [
    {
      type: 'claim',
      wuId,
      lane: 'Framework: Core',
      title: `Test WU ${wuId}`,
      timestamp: new Date(now - claimOffsetDays * ONE_DAY_MS).toISOString(),
    } as WUEvent,
    {
      type: 'block',
      wuId,
      reason: 'Waiting for dependency',
      timestamp: new Date(now - blockOffsetDays * ONE_DAY_MS).toISOString(),
    } as WUEvent,
  ];
}

describe('wu-events-cleanup', () => {
  let testDir: string;

  beforeEach(async () => {
    // Create temp directory for tests
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wu-events-cleanup-test-'));
    // Create .lumenflow/state directory
    await fs.mkdir(path.join(testDir, STATE_DIR), { recursive: true });
  });

  afterEach(async () => {
    // Clean up temp directory
    await fs.rm(testDir, { recursive: true, force: true });
  });

  /**
   * Write events to wu-events.jsonl in test directory
   */
  async function writeEvents(events: WUEvent[]): Promise<void> {
    const eventsPath = path.join(testDir, STATE_DIR, WU_EVENTS_FILE);
    const content =
      events.map((e) => JSON.stringify(e)).join('\n') + (events.length > 0 ? '\n' : '');
    await fs.writeFile(eventsPath, content, 'utf-8');
  }

  /**
   * Read events from wu-events.jsonl in test directory
   */
  async function readEvents(): Promise<WUEvent[]> {
    const eventsPath = path.join(testDir, STATE_DIR, WU_EVENTS_FILE);
    try {
      const content = await fs.readFile(eventsPath, 'utf-8');
      const lines = content.split('\n').filter((line) => line.trim());
      return lines.map((line) => JSON.parse(line));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw err;
    }
  }

  /**
   * Read archive file
   */
  async function readArchive(archivePath: string): Promise<WUEvent[]> {
    const fullPath = path.join(testDir, archivePath);
    try {
      const content = await fs.readFile(fullPath, 'utf-8');
      const lines = content.split('\n').filter((line) => line.trim());
      return lines.map((line) => JSON.parse(line));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw err;
    }
  }

  describe('DEFAULT_EVENT_ARCHIVAL_CONFIG', () => {
    it('should have default archiveAfter of 90 days', () => {
      expect(DEFAULT_EVENT_ARCHIVAL_CONFIG.archiveAfter).toBe(NINETY_DAYS_MS);
    });

    it('should have default keepArchives of true', () => {
      expect(DEFAULT_EVENT_ARCHIVAL_CONFIG.keepArchives).toBe(true);
    });
  });

  describe('parseArchiveAfter', () => {
    it('should parse 90d to 90 days in milliseconds', () => {
      expect(parseArchiveAfter('90d')).toBe(NINETY_DAYS_MS);
    });

    it('should parse 30d to 30 days in milliseconds', () => {
      expect(parseArchiveAfter('30d')).toBe(30 * ONE_DAY_MS);
    });

    it('should throw for invalid format', () => {
      expect(() => parseArchiveAfter('')).toThrow('Invalid');
      expect(() => parseArchiveAfter('invalid')).toThrow('Invalid');
    });
  });

  describe('getArchiveFilePath', () => {
    it('should return path in format .lumenflow/archive/wu-events-YYYY-MM.jsonl', () => {
      const timestamp = '2026-01-15T10:30:00.000Z';
      const result = getArchiveFilePath(timestamp);
      expect(result).toBe('.lumenflow/archive/wu-events-2026-01.jsonl');
    });

    it('should group events from same month into same archive file', () => {
      const early = '2026-03-01T00:00:00.000Z';
      const late = '2026-03-31T23:59:59.000Z';
      expect(getArchiveFilePath(early)).toBe(getArchiveFilePath(late));
    });

    it('should put events from different months into different archive files', () => {
      const jan = '2026-01-15T10:30:00.000Z';
      const feb = '2026-02-15T10:30:00.000Z';
      expect(getArchiveFilePath(jan)).not.toBe(getArchiveFilePath(feb));
    });
  });

  describe('shouldArchiveEvent', () => {
    const config: EventArchivalConfig = {
      archiveAfter: NINETY_DAYS_MS,
      keepArchives: true,
    };
    const now = Date.now();

    describe('Active WU protection', () => {
      it('should not archive events for in_progress WUs', () => {
        const events = createInProgressWuEvents('WU-1234', 120); // 120 days old
        const activeWuIds = new Set(['WU-1234']);
        const result = shouldArchiveEvent(events[0], config, { now, activeWuIds });
        expect(result.archive).toBe(false);
        expect(result.reason).toBe('active-wu-protected');
      });

      it('should not archive events for blocked WUs', () => {
        const events = createBlockedWuEvents('WU-5678', 120, 100);
        const activeWuIds = new Set(['WU-5678']);
        const result = shouldArchiveEvent(events[0], config, { now, activeWuIds });
        expect(result.archive).toBe(false);
        expect(result.reason).toBe('active-wu-protected');
      });

      it('should archive events for completed WUs older than threshold', () => {
        const events = createCompletedWuEvents('WU-9999', 120, 100);
        const activeWuIds = new Set<string>(); // WU-9999 is not active
        const result = shouldArchiveEvent(events[0], config, { now, activeWuIds });
        expect(result.archive).toBe(true);
        expect(result.reason).toBe('completed-older-than-threshold');
      });
    });

    describe('Age-based archival', () => {
      it('should archive completed WU events older than 90 days', () => {
        const events = createCompletedWuEvents('WU-1000', 120, 100);
        const activeWuIds = new Set<string>();
        const result = shouldArchiveEvent(events[0], config, { now, activeWuIds });
        expect(result.archive).toBe(true);
      });

      it('should not archive completed WU events younger than 90 days', () => {
        const events = createCompletedWuEvents('WU-2000', 60, 50);
        const activeWuIds = new Set<string>();
        const result = shouldArchiveEvent(events[0], config, { now, activeWuIds });
        expect(result.archive).toBe(false);
        expect(result.reason).toBe('within-retention-period');
      });
    });
  });

  describe('archiveWuEvents', () => {
    describe('Basic archival', () => {
      it('should archive completed WU events older than 90 days', async () => {
        const completedOld = createCompletedWuEvents('WU-1000', 120, 100);
        const completedNew = createCompletedWuEvents('WU-2000', 60, 50);
        await writeEvents([...completedOld, ...completedNew]);

        const result = await archiveWuEvents(testDir);

        expect(result.success).toBe(true);
        expect(result.archivedWuIds).toContain('WU-1000');
        expect(result.retainedWuIds).toContain('WU-2000');

        // Check events file only has new WU events
        const remaining = await readEvents();
        expect(remaining).toHaveLength(2); // claim + complete for WU-2000
        expect(remaining.every((e) => e.wuId === 'WU-2000')).toBe(true);
      });

      it('should create archive files grouped by month', async () => {
        // Create events from different months
        const now = Date.now();
        const jan2026Events: WUEvent[] = [
          {
            type: 'claim',
            wuId: 'WU-1001',
            lane: 'Framework: Core',
            title: 'Jan WU',
            timestamp: '2025-10-15T10:00:00.000Z', // ~100 days ago
          } as WUEvent,
          {
            type: 'complete',
            wuId: 'WU-1001',
            timestamp: '2025-10-16T10:00:00.000Z',
          } as WUEvent,
        ];

        await writeEvents(jan2026Events);

        await archiveWuEvents(testDir, { now });

        // Check archive file exists with correct name
        const archiveContent = await readArchive(`${ARCHIVE_DIR}/wu-events-2025-10.jsonl`);
        expect(archiveContent).toHaveLength(2);
        expect(archiveContent[0].wuId).toBe('WU-1001');
      });
    });

    describe('Active WU protection', () => {
      it('should never archive events for in_progress WUs', async () => {
        const inProgressEvents = createInProgressWuEvents('WU-8001', 120);
        const completedEvents = createCompletedWuEvents('WU-8002', 120, 100);
        await writeEvents([...inProgressEvents, ...completedEvents]);

        const result = await archiveWuEvents(testDir);

        expect(result.archivedWuIds).not.toContain('WU-8001');
        expect(result.retainedWuIds).toContain('WU-8001');
        expect(result.archivedWuIds).toContain('WU-8002');
      });

      it('should never archive events for blocked WUs', async () => {
        const blockedEvents = createBlockedWuEvents('WU-8003', 120, 100);
        const completedEvents = createCompletedWuEvents('WU-8004', 120, 100);
        await writeEvents([...blockedEvents, ...completedEvents]);

        const result = await archiveWuEvents(testDir);

        expect(result.archivedWuIds).not.toContain('WU-8003');
        expect(result.retainedWuIds).toContain('WU-8003');
      });
    });

    describe('WU grouping', () => {
      it('should archive all events for a WU together (by WU ID)', async () => {
        // WU with claim, checkpoint, and complete
        const now = Date.now();
        const events: WUEvent[] = [
          {
            type: 'claim',
            wuId: 'WU-1234',
            lane: 'Framework: Core',
            title: 'Multi-event WU',
            timestamp: new Date(now - 120 * ONE_DAY_MS).toISOString(),
          } as WUEvent,
          {
            type: 'checkpoint',
            wuId: 'WU-1234',
            note: 'Progress checkpoint',
            timestamp: new Date(now - 115 * ONE_DAY_MS).toISOString(),
          } as WUEvent,
          {
            type: 'complete',
            wuId: 'WU-1234',
            timestamp: new Date(now - 100 * ONE_DAY_MS).toISOString(),
          } as WUEvent,
        ];
        await writeEvents(events);

        const result = await archiveWuEvents(testDir);

        expect(result.archivedEventCount).toBe(3);
        expect(result.archivedWuIds).toContain('WU-1234');
      });

      it('should not split events for the same WU across archive and main file', async () => {
        // WU with events spanning the threshold - should keep all or archive all
        const now = Date.now();
        const events: WUEvent[] = [
          {
            type: 'claim',
            wuId: 'WU-5555',
            lane: 'Framework: Core',
            title: 'Spanning WU',
            timestamp: new Date(now - 100 * ONE_DAY_MS).toISOString(), // Old
          } as WUEvent,
          {
            type: 'complete',
            wuId: 'WU-5555',
            timestamp: new Date(now - 50 * ONE_DAY_MS).toISOString(), // Recent
          } as WUEvent,
        ];
        await writeEvents(events);

        const result = await archiveWuEvents(testDir);

        // Since complete is recent, WU should be retained
        expect(result.retainedWuIds).toContain('WU-5555');

        const remaining = await readEvents();
        const wuEvents = remaining.filter((e) => e.wuId === 'WU-5555');
        expect(wuEvents).toHaveLength(2); // Both events kept together
      });
    });

    describe('Dry-run mode', () => {
      it('should preview archival without making changes', async () => {
        const completedEvents = createCompletedWuEvents('WU-1000', 120, 100);
        await writeEvents(completedEvents);

        const result = await archiveWuEvents(testDir, { dryRun: true });

        expect(result.success).toBe(true);
        expect(result.dryRun).toBe(true);
        expect(result.archivedWuIds).toContain('WU-1000');

        // File should not be modified
        const remaining = await readEvents();
        expect(remaining).toHaveLength(2);
      });
    });

    describe('Edge cases', () => {
      it('should handle empty events file gracefully', async () => {
        await writeEvents([]);

        const result = await archiveWuEvents(testDir);

        expect(result.success).toBe(true);
        expect(result.archivedWuIds).toHaveLength(0);
        expect(result.retainedWuIds).toHaveLength(0);
      });

      it('should handle missing events file gracefully', async () => {
        // Don't write any events file

        const result = await archiveWuEvents(testDir);

        expect(result.success).toBe(true);
        expect(result.archivedWuIds).toHaveLength(0);
      });

      it('should create archive directory if it does not exist', async () => {
        const completedEvents = createCompletedWuEvents('WU-1000', 120, 100);
        await writeEvents(completedEvents);

        await archiveWuEvents(testDir);

        // Archive directory should be created
        const archiveDir = path.join(testDir, ARCHIVE_DIR);
        const stat = await fs.stat(archiveDir);
        expect(stat.isDirectory()).toBe(true);
      });

      it('should return breakdown statistics', async () => {
        const completedOld = createCompletedWuEvents('WU-1000', 120, 100);
        const inProgress = createInProgressWuEvents('WU-2000', 120);
        const completedNew = createCompletedWuEvents('WU-3000', 30, 20);
        await writeEvents([...completedOld, ...inProgress, ...completedNew]);

        const result = await archiveWuEvents(testDir);

        expect(result.breakdown.archivedOlderThanThreshold).toBe(1); // WU-1000
        expect(result.breakdown.retainedActiveWu).toBe(1); // WU-2000
        expect(result.breakdown.retainedWithinThreshold).toBe(1); // WU-3000
      });
    });

    describe('Monthly rollup', () => {
      it('should append to existing archive file for same month', async () => {
        // First batch of events
        const now = Date.now();
        const batch1: WUEvent[] = [
          {
            type: 'claim',
            wuId: 'WU-1001',
            lane: 'Framework: Core',
            title: 'First WU',
            timestamp: '2025-10-10T10:00:00.000Z',
          } as WUEvent,
          {
            type: 'complete',
            wuId: 'WU-1001',
            timestamp: '2025-10-11T10:00:00.000Z',
          } as WUEvent,
        ];
        await writeEvents(batch1);
        await archiveWuEvents(testDir, { now });

        // Second batch of events for same month
        const batch2: WUEvent[] = [
          {
            type: 'claim',
            wuId: 'WU-1002',
            lane: 'Framework: Core',
            title: 'Second WU',
            timestamp: '2025-10-20T10:00:00.000Z',
          } as WUEvent,
          {
            type: 'complete',
            wuId: 'WU-1002',
            timestamp: '2025-10-21T10:00:00.000Z',
          } as WUEvent,
        ];
        await writeEvents(batch2);
        await archiveWuEvents(testDir, { now });

        // Check archive file has all events
        const archiveContent = await readArchive(`${ARCHIVE_DIR}/wu-events-2025-10.jsonl`);
        expect(archiveContent).toHaveLength(4); // 2 events from each WU
        const wuIds = [...new Set(archiveContent.map((e) => e.wuId))];
        expect(wuIds).toContain('WU-1001');
        expect(wuIds).toContain('WU-1002');
      });
    });
  });
});
