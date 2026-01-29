/**
 * Signal Cleanup Core Tests (WU-1204)
 *
 * TDD tests for signal TTL cleanup functionality.
 * Tests cover:
 * - TTL expiration (read signals: 7d default, unread: 30d default)
 * - Count limits (maxEntries: 500 default)
 * - Active WU protection (in_progress/blocked signals always retained)
 * - Dry-run mode
 */

/* eslint-disable sonarjs/no-duplicate-string -- Test files use descriptive repeated IDs */
/* eslint-disable sonarjs/no-nested-functions -- Test structure requires nested describe/it blocks */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  cleanupSignals,
  shouldRemoveSignal,
  parseSignalTtl,
  type SignalCleanupConfig,
  DEFAULT_SIGNAL_CLEANUP_CONFIG,
} from '../src/signal-cleanup-core.js';
import type { Signal } from '../src/mem-signal-core.js';

/**
 * Test constants
 */
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * ONE_DAY_MS;
const THIRTY_DAYS_MS = 30 * ONE_DAY_MS;

/**
 * Path constants to avoid duplicate string literals
 */
const MEMORY_DIR = '.lumenflow/memory';
const SIGNALS_FILENAME = 'signals.jsonl';

/**
 * Incrementing counter for deterministic test signal IDs
 */
let signalIdCounter = 0;

/**
 * Create a test signal with specified properties
 */
function createSignal(
  overrides: Partial<Signal> & { created_at_offset_days?: number } = {},
): Signal {
  const { created_at_offset_days, ...rest } = overrides;
  const now = Date.now();
  const offsetMs = (created_at_offset_days ?? 0) * ONE_DAY_MS;
  const createdAt = new Date(now - offsetMs).toISOString();

  signalIdCounter++;
  return {
    id: `sig-${signalIdCounter.toString().padStart(8, '0')}`,
    message: 'Test signal',
    created_at: createdAt,
    read: false,
    ...rest,
  };
}

/**
 * Helper to get active WU IDs for test
 */
function createGetActiveWuIds(activeIds: string[]): () => Promise<Set<string>> {
  return async (): Promise<Set<string>> => new Set(activeIds);
}

describe('signal-cleanup-core', () => {
  let testDir: string;

  beforeEach(async () => {
    // Create temp directory for tests
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'signal-cleanup-test-'));
    // Create .lumenflow/memory directory
    await fs.mkdir(path.join(testDir, MEMORY_DIR), { recursive: true });
    // Reset signal ID counter for each test
    signalIdCounter = 0;
  });

  afterEach(async () => {
    // Clean up temp directory
    await fs.rm(testDir, { recursive: true, force: true });
  });

  /**
   * Write signals to test directory
   */
  async function writeSignals(signals: Signal[]): Promise<void> {
    const signalsPath = path.join(testDir, MEMORY_DIR, SIGNALS_FILENAME);
    const content =
      signals.map((s) => JSON.stringify(s)).join('\n') + (signals.length > 0 ? '\n' : '');
    await fs.writeFile(signalsPath, content, 'utf-8');
  }

  /**
   * Read signals from test directory
   */
  async function readSignals(): Promise<Signal[]> {
    const signalsPath = path.join(testDir, MEMORY_DIR, SIGNALS_FILENAME);
    try {
      const content = await fs.readFile(signalsPath, 'utf-8');
      const lines = content.split('\n').filter((line) => line.trim());
      return lines.map((line) => JSON.parse(line));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw err;
    }
  }

  describe('DEFAULT_SIGNAL_CLEANUP_CONFIG', () => {
    it('should have default TTL of 7 days for read signals', () => {
      expect(DEFAULT_SIGNAL_CLEANUP_CONFIG.ttl).toBe(SEVEN_DAYS_MS);
    });

    it('should have default unread TTL of 30 days', () => {
      expect(DEFAULT_SIGNAL_CLEANUP_CONFIG.unreadTtl).toBe(THIRTY_DAYS_MS);
    });

    it('should have default maxEntries of 500', () => {
      expect(DEFAULT_SIGNAL_CLEANUP_CONFIG.maxEntries).toBe(500);
    });
  });

  describe('parseSignalTtl', () => {
    it('should parse 7d to 7 days in milliseconds', () => {
      expect(parseSignalTtl('7d')).toBe(SEVEN_DAYS_MS);
    });

    it('should parse 30d to 30 days in milliseconds', () => {
      expect(parseSignalTtl('30d')).toBe(THIRTY_DAYS_MS);
    });

    it('should parse 24h to 24 hours in milliseconds', () => {
      expect(parseSignalTtl('24h')).toBe(ONE_DAY_MS);
    });

    it('should throw for invalid TTL format', () => {
      expect(() => parseSignalTtl('')).toThrow('Invalid TTL format');
      expect(() => parseSignalTtl('invalid')).toThrow('Invalid TTL format');
    });
  });

  describe('shouldRemoveSignal', () => {
    const config: SignalCleanupConfig = {
      ttl: SEVEN_DAYS_MS,
      unreadTtl: THIRTY_DAYS_MS,
      maxEntries: 500,
    };
    const now = Date.now();

    describe('TTL-based removal', () => {
      it('should remove read signal older than TTL (7d)', () => {
        const signal = createSignal({ read: true, created_at_offset_days: 8 });
        const result = shouldRemoveSignal(signal, config, { now, activeWuIds: new Set() });
        expect(result.remove).toBe(true);
        expect(result.reason).toBe('ttl-expired');
      });

      it('should retain read signal younger than TTL (7d)', () => {
        const signal = createSignal({ read: true, created_at_offset_days: 5 });
        const result = shouldRemoveSignal(signal, config, { now, activeWuIds: new Set() });
        expect(result.remove).toBe(false);
        expect(result.reason).toBe('within-ttl');
      });

      it('should remove unread signal older than unread TTL (30d)', () => {
        const signal = createSignal({ read: false, created_at_offset_days: 35 });
        const result = shouldRemoveSignal(signal, config, { now, activeWuIds: new Set() });
        expect(result.remove).toBe(true);
        expect(result.reason).toBe('unread-ttl-expired');
      });

      it('should retain unread signal younger than unread TTL (30d)', () => {
        const signal = createSignal({ read: false, created_at_offset_days: 25 });
        const result = shouldRemoveSignal(signal, config, { now, activeWuIds: new Set() });
        expect(result.remove).toBe(false);
        expect(result.reason).toBe('within-ttl');
      });
    });

    describe('Active WU protection', () => {
      it('should retain signal linked to in_progress WU even if expired', () => {
        const signal = createSignal({
          wu_id: 'WU-1234',
          read: true,
          created_at_offset_days: 60, // Way past TTL
        });
        const activeWuIds = new Set(['WU-1234']);
        const result = shouldRemoveSignal(signal, config, { now, activeWuIds });
        expect(result.remove).toBe(false);
        expect(result.reason).toBe('active-wu-protected');
      });

      it('should retain signal linked to blocked WU even if expired', () => {
        const signal = createSignal({
          wu_id: 'WU-5678',
          read: false,
          created_at_offset_days: 60,
        });
        const activeWuIds = new Set(['WU-5678']);
        const result = shouldRemoveSignal(signal, config, { now, activeWuIds });
        expect(result.remove).toBe(false);
        expect(result.reason).toBe('active-wu-protected');
      });

      it('should remove signal linked to done WU if expired', () => {
        const signal = createSignal({
          wu_id: 'WU-9999',
          read: true,
          created_at_offset_days: 10,
        });
        const activeWuIds = new Set<string>(); // WU-9999 is not active
        const result = shouldRemoveSignal(signal, config, { now, activeWuIds });
        expect(result.remove).toBe(true);
        expect(result.reason).toBe('ttl-expired');
      });
    });
  });

  describe('cleanupSignals', () => {
    describe('TTL-based cleanup', () => {
      it('should remove read signals older than 7 days by default', async () => {
        const signals = [
          createSignal({ id: 'sig-old-read', read: true, created_at_offset_days: 10 }),
          createSignal({ id: 'sig-new-read', read: true, created_at_offset_days: 3 }),
        ];
        await writeSignals(signals);

        const result = await cleanupSignals(testDir);

        expect(result.success).toBe(true);
        expect(result.removedIds).toContain('sig-old-read');
        expect(result.retainedIds).toContain('sig-new-read');

        const remaining = await readSignals();
        expect(remaining).toHaveLength(1);
        expect(remaining[0].id).toBe('sig-new-read');
      });

      it('should remove unread signals older than 30 days by default', async () => {
        const signals = [
          createSignal({ id: 'sig-old-unread', read: false, created_at_offset_days: 35 }),
          createSignal({ id: 'sig-new-unread', read: false, created_at_offset_days: 20 }),
        ];
        await writeSignals(signals);

        const result = await cleanupSignals(testDir);

        expect(result.success).toBe(true);
        expect(result.removedIds).toContain('sig-old-unread');
        expect(result.retainedIds).toContain('sig-new-unread');
      });

      it('should respect custom TTL option', async () => {
        const signals = [
          createSignal({ id: 'sig-1', read: true, created_at_offset_days: 5 }),
          createSignal({ id: 'sig-2', read: true, created_at_offset_days: 2 }),
        ];
        await writeSignals(signals);

        // Use 3 day TTL instead of default 7 days
        const result = await cleanupSignals(testDir, { ttl: '3d' });

        expect(result.removedIds).toContain('sig-1');
        expect(result.retainedIds).toContain('sig-2');
      });
    });

    describe('Count-based cleanup (maxEntries)', () => {
      it('should retain only maxEntries signals when exceeded, keeping newest', async () => {
        const signals: Signal[] = [];
        // Create 10 signals, oldest first
        for (let i = 0; i < 10; i++) {
          signals.push(
            createSignal({
              id: `sig-${i}`,
              read: false,
              created_at_offset_days: 10 - i, // sig-0 is oldest, sig-9 is newest
            }),
          );
        }
        await writeSignals(signals);

        // Limit to 5 entries
        const result = await cleanupSignals(testDir, { maxEntries: 5 });

        expect(result.success).toBe(true);
        expect(result.removedIds).toHaveLength(5);
        expect(result.retainedIds).toHaveLength(5);

        // Newest 5 should be retained (sig-5 through sig-9)
        const remaining = await readSignals();
        expect(remaining).toHaveLength(5);
        const remainingIds = remaining.map((s) => s.id);
        expect(remainingIds).toContain('sig-5');
        expect(remainingIds).toContain('sig-9');
        expect(remainingIds).not.toContain('sig-0');
      });

      it('should not remove signals if under maxEntries', async () => {
        const signals = [
          createSignal({ id: 'sig-1', read: false, created_at_offset_days: 1 }),
          createSignal({ id: 'sig-2', read: false, created_at_offset_days: 1 }),
        ];
        await writeSignals(signals);

        const result = await cleanupSignals(testDir, { maxEntries: 500 });

        expect(result.removedIds).toHaveLength(0);
        expect(result.retainedIds).toHaveLength(2);
      });
    });

    describe('Active WU protection', () => {
      it('should protect signals linked to in_progress WUs', async () => {
        const signals = [
          createSignal({
            id: 'sig-active',
            wu_id: 'WU-1234',
            read: true,
            created_at_offset_days: 60,
          }),
          createSignal({
            id: 'sig-done',
            wu_id: 'WU-5678',
            read: true,
            created_at_offset_days: 60,
          }),
        ];
        await writeSignals(signals);

        // Mock getActiveWuIds to return WU-1234 as in_progress
        const result = await cleanupSignals(testDir, {
          getActiveWuIds: createGetActiveWuIds(['WU-1234']),
        });

        expect(result.removedIds).toContain('sig-done');
        expect(result.retainedIds).toContain('sig-active');
        expect(result.breakdown.activeWuProtected).toBe(1);
      });

      it('should protect signals linked to blocked WUs', async () => {
        const signals = [
          createSignal({
            id: 'sig-blocked',
            wu_id: 'WU-BLOCKED',
            read: true,
            created_at_offset_days: 60,
          }),
        ];
        await writeSignals(signals);

        const result = await cleanupSignals(testDir, {
          getActiveWuIds: createGetActiveWuIds(['WU-BLOCKED']),
        });

        expect(result.retainedIds).toContain('sig-blocked');
      });
    });

    describe('Dry-run mode', () => {
      it('should preview cleanup without making changes', async () => {
        const signals = [
          createSignal({ id: 'sig-old', read: true, created_at_offset_days: 10 }),
          createSignal({ id: 'sig-new', read: true, created_at_offset_days: 3 }),
        ];
        await writeSignals(signals);

        const result = await cleanupSignals(testDir, { dryRun: true });

        expect(result.success).toBe(true);
        expect(result.dryRun).toBe(true);
        expect(result.removedIds).toContain('sig-old');

        // File should not be modified
        const remaining = await readSignals();
        expect(remaining).toHaveLength(2);
      });
    });

    describe('Edge cases', () => {
      it('should handle empty signals file gracefully', async () => {
        await writeSignals([]);

        const result = await cleanupSignals(testDir);

        expect(result.success).toBe(true);
        expect(result.removedIds).toHaveLength(0);
        expect(result.retainedIds).toHaveLength(0);
      });

      it('should handle missing signals file gracefully', async () => {
        // Don't write any signals file

        const result = await cleanupSignals(testDir);

        expect(result.success).toBe(true);
        expect(result.removedIds).toHaveLength(0);
        expect(result.retainedIds).toHaveLength(0);
      });

      it('should return breakdown statistics', async () => {
        const signals = [
          createSignal({ id: 'sig-ttl-expired', read: true, created_at_offset_days: 10 }),
          createSignal({ id: 'sig-unread-expired', read: false, created_at_offset_days: 35 }),
          createSignal({
            id: 'sig-active',
            wu_id: 'WU-ACTIVE',
            read: true,
            created_at_offset_days: 60,
          }),
          createSignal({ id: 'sig-retained', read: false, created_at_offset_days: 1 }),
        ];
        await writeSignals(signals);

        const result = await cleanupSignals(testDir, {
          getActiveWuIds: createGetActiveWuIds(['WU-ACTIVE']),
        });

        expect(result.breakdown.ttlExpired).toBe(1);
        expect(result.breakdown.unreadTtlExpired).toBe(1);
        expect(result.breakdown.activeWuProtected).toBe(1);
      });
    });
  });
});
