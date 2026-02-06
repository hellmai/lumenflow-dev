/**
 * Signal Read Receipts Tests (WU-1472)
 *
 * TDD: Tests written FIRST, implementation follows.
 * Validates append-only read receipts for concurrent-safe signal consumption.
 *
 * Acceptance Criteria:
 * 1. markSignalsAsRead appends receipts instead of rewriting signals.jsonl
 * 2. loadSignals derives effective read state from inline read:true and appended receipts
 * 3. signal cleanup remains correct and receipt-aware under mixed legacy/new data
 * 4. Concurrent read-marking tests demonstrate no lost updates
 */

/* eslint-disable sonarjs/no-duplicate-string -- Test files use descriptive repeated IDs */
/* eslint-disable sonarjs/no-nested-functions -- Test structure requires nested describe/it blocks */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  createSignal,
  loadSignals,
  markSignalsAsRead,
  SIGNAL_FILE_NAME,
  SIGNAL_RECEIPTS_FILE_NAME,
  type Signal,
} from '../src/mem-signal-core.js';
import { cleanupSignals } from '../src/signal-cleanup-core.js';

/**
 * Path constants to avoid duplicate string literals
 */
const MEMORY_DIR = '.lumenflow/memory';

/**
 * Helper to write raw signals to the JSONL file (bypasses createSignal for test setup)
 */
async function writeSignalsFile(testDir: string, signals: Signal[]): Promise<void> {
  const signalsPath = path.join(testDir, MEMORY_DIR, SIGNAL_FILE_NAME);
  const content =
    signals.map((s) => JSON.stringify(s)).join('\n') + (signals.length > 0 ? '\n' : '');
  await fs.writeFile(signalsPath, content, 'utf-8');
}

/**
 * Helper to read raw signals file content (no receipt merging)
 */
async function readRawSignals(testDir: string): Promise<Signal[]> {
  const signalsPath = path.join(testDir, MEMORY_DIR, SIGNAL_FILE_NAME);
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

/**
 * Helper to read receipt file content
 */
async function readReceipts(
  testDir: string,
): Promise<Array<{ signal_id: string; read_at: string }>> {
  const receiptsPath = path.join(testDir, MEMORY_DIR, SIGNAL_RECEIPTS_FILE_NAME);
  try {
    const content = await fs.readFile(receiptsPath, 'utf-8');
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
 * Helper to write receipt file content (for test setup)
 */
async function writeReceipts(
  testDir: string,
  receipts: Array<{ signal_id: string; read_at: string }>,
): Promise<void> {
  const receiptsPath = path.join(testDir, MEMORY_DIR, SIGNAL_RECEIPTS_FILE_NAME);
  const content =
    receipts.map((r) => JSON.stringify(r)).join('\n') + (receipts.length > 0 ? '\n' : '');
  await fs.writeFile(receiptsPath, content, 'utf-8');
}

/**
 * One day in milliseconds
 */
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Create a test signal with specified properties
 */
function createTestSignal(overrides: Partial<Signal> = {}): Signal {
  return {
    id: `sig-${Math.random().toString(16).slice(2, 10)}`,
    message: 'Test signal',
    created_at: new Date().toISOString(),
    read: false,
    ...overrides,
  };
}

describe('signal-receipts (WU-1472)', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'signal-receipts-test-'));
    await fs.mkdir(path.join(testDir, MEMORY_DIR), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe('AC1: markSignalsAsRead appends receipts instead of rewriting signals.jsonl', () => {
    it('should NOT modify signals.jsonl when marking signals as read', async () => {
      const sig1 = createTestSignal({ id: 'sig-aaaaaaaa' });
      const sig2 = createTestSignal({ id: 'sig-bbbbbbbb' });
      await writeSignalsFile(testDir, [sig1, sig2]);

      // Read original file content
      const originalContent = await fs.readFile(
        path.join(testDir, MEMORY_DIR, SIGNAL_FILE_NAME),
        'utf-8',
      );

      await markSignalsAsRead(testDir, ['sig-aaaaaaaa']);

      // signals.jsonl should be unchanged
      const afterContent = await fs.readFile(
        path.join(testDir, MEMORY_DIR, SIGNAL_FILE_NAME),
        'utf-8',
      );
      expect(afterContent).toBe(originalContent);
    });

    it('should append a receipt to signal-receipts.jsonl', async () => {
      const sig1 = createTestSignal({ id: 'sig-aaaaaaaa' });
      await writeSignalsFile(testDir, [sig1]);

      await markSignalsAsRead(testDir, ['sig-aaaaaaaa']);

      const receipts = await readReceipts(testDir);
      expect(receipts).toHaveLength(1);
      expect(receipts[0].signal_id).toBe('sig-aaaaaaaa');
      expect(receipts[0].read_at).toBeDefined();
    });

    it('should append multiple receipts for multiple signal IDs', async () => {
      const sig1 = createTestSignal({ id: 'sig-aaaaaaaa' });
      const sig2 = createTestSignal({ id: 'sig-bbbbbbbb' });
      const sig3 = createTestSignal({ id: 'sig-cccccccc' });
      await writeSignalsFile(testDir, [sig1, sig2, sig3]);

      await markSignalsAsRead(testDir, ['sig-aaaaaaaa', 'sig-cccccccc']);

      const receipts = await readReceipts(testDir);
      expect(receipts).toHaveLength(2);
      const receiptIds = receipts.map((r) => r.signal_id);
      expect(receiptIds).toContain('sig-aaaaaaaa');
      expect(receiptIds).toContain('sig-cccccccc');
    });

    it('should return the correct markedCount', async () => {
      const sig1 = createTestSignal({ id: 'sig-aaaaaaaa' });
      const sig2 = createTestSignal({ id: 'sig-bbbbbbbb' });
      await writeSignalsFile(testDir, [sig1, sig2]);

      const result = await markSignalsAsRead(testDir, ['sig-aaaaaaaa', 'sig-bbbbbbbb']);
      expect(result.markedCount).toBe(2);
    });

    it('should not count signals that are already read inline', async () => {
      const sig1 = createTestSignal({ id: 'sig-aaaaaaaa', read: true });
      const sig2 = createTestSignal({ id: 'sig-bbbbbbbb', read: false });
      await writeSignalsFile(testDir, [sig1, sig2]);

      const result = await markSignalsAsRead(testDir, ['sig-aaaaaaaa', 'sig-bbbbbbbb']);
      // sig-aaaaaaaa is already read inline, so only sig-bbbbbbbb counts
      expect(result.markedCount).toBe(1);
    });

    it('should not count signals that already have a receipt', async () => {
      const sig1 = createTestSignal({ id: 'sig-aaaaaaaa' });
      await writeSignalsFile(testDir, [sig1]);
      await writeReceipts(testDir, [
        { signal_id: 'sig-aaaaaaaa', read_at: new Date().toISOString() },
      ]);

      const result = await markSignalsAsRead(testDir, ['sig-aaaaaaaa']);
      expect(result.markedCount).toBe(0);
    });

    it('should handle missing signals file gracefully', async () => {
      const result = await markSignalsAsRead(testDir, ['sig-aaaaaaaa']);
      expect(result.markedCount).toBe(0);
    });

    it('should create receipts file if it does not exist', async () => {
      const sig1 = createTestSignal({ id: 'sig-aaaaaaaa' });
      await writeSignalsFile(testDir, [sig1]);

      await markSignalsAsRead(testDir, ['sig-aaaaaaaa']);

      const receiptsPath = path.join(testDir, MEMORY_DIR, SIGNAL_RECEIPTS_FILE_NAME);
      const exists = await fs
        .access(receiptsPath)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(true);
    });
  });

  describe('AC2: loadSignals derives effective read state from inline read:true and receipts', () => {
    it('should show signal as read when inline read:true is set (legacy data)', async () => {
      const sig1 = createTestSignal({ id: 'sig-aaaaaaaa', read: true });
      await writeSignalsFile(testDir, [sig1]);

      const signals = await loadSignals(testDir);
      expect(signals).toHaveLength(1);
      expect(signals[0].read).toBe(true);
    });

    it('should show signal as read when a receipt exists', async () => {
      const sig1 = createTestSignal({ id: 'sig-aaaaaaaa', read: false });
      await writeSignalsFile(testDir, [sig1]);
      await writeReceipts(testDir, [
        { signal_id: 'sig-aaaaaaaa', read_at: new Date().toISOString() },
      ]);

      const signals = await loadSignals(testDir);
      expect(signals).toHaveLength(1);
      expect(signals[0].read).toBe(true);
    });

    it('should show signal as unread when no receipt and inline read:false', async () => {
      const sig1 = createTestSignal({ id: 'sig-aaaaaaaa', read: false });
      await writeSignalsFile(testDir, [sig1]);

      const signals = await loadSignals(testDir);
      expect(signals).toHaveLength(1);
      expect(signals[0].read).toBe(false);
    });

    it('should correctly filter unreadOnly with receipt-based read state', async () => {
      const sig1 = createTestSignal({ id: 'sig-aaaaaaaa', read: false });
      const sig2 = createTestSignal({ id: 'sig-bbbbbbbb', read: false });
      await writeSignalsFile(testDir, [sig1, sig2]);
      // Mark sig-aaaaaaaa as read via receipt
      await writeReceipts(testDir, [
        { signal_id: 'sig-aaaaaaaa', read_at: new Date().toISOString() },
      ]);

      const unread = await loadSignals(testDir, { unreadOnly: true });
      expect(unread).toHaveLength(1);
      expect(unread[0].id).toBe('sig-bbbbbbbb');
    });

    it('should handle mixed legacy (inline read) and receipt-based read state', async () => {
      const sig1 = createTestSignal({ id: 'sig-aaaaaaaa', read: true }); // legacy inline
      const sig2 = createTestSignal({ id: 'sig-bbbbbbbb', read: false }); // receipt-based
      const sig3 = createTestSignal({ id: 'sig-cccccccc', read: false }); // unread
      await writeSignalsFile(testDir, [sig1, sig2, sig3]);
      await writeReceipts(testDir, [
        { signal_id: 'sig-bbbbbbbb', read_at: new Date().toISOString() },
      ]);

      const all = await loadSignals(testDir);
      expect(all).toHaveLength(3);
      expect(all.find((s) => s.id === 'sig-aaaaaaaa')?.read).toBe(true);
      expect(all.find((s) => s.id === 'sig-bbbbbbbb')?.read).toBe(true);
      expect(all.find((s) => s.id === 'sig-cccccccc')?.read).toBe(false);
    });

    it('should handle missing receipts file gracefully', async () => {
      const sig1 = createTestSignal({ id: 'sig-aaaaaaaa', read: false });
      await writeSignalsFile(testDir, [sig1]);
      // No receipts file exists

      const signals = await loadSignals(testDir);
      expect(signals).toHaveLength(1);
      expect(signals[0].read).toBe(false);
    });
  });

  describe('AC3: signal cleanup remains correct and receipt-aware under mixed data', () => {
    it('should treat receipt-read signals as read for TTL purposes', async () => {
      // Signal is inline read:false but has a receipt
      const sig1 = createTestSignal({
        id: 'sig-aaaaaaaa',
        read: false,
        created_at: new Date(Date.now() - 10 * ONE_DAY_MS).toISOString(),
      });
      await writeSignalsFile(testDir, [sig1]);
      await writeReceipts(testDir, [
        { signal_id: 'sig-aaaaaaaa', read_at: new Date().toISOString() },
      ]);

      // With default 7d TTL for read signals, this 10-day-old receipt-read signal should be removed
      const result = await cleanupSignals(testDir);
      expect(result.removedIds).toContain('sig-aaaaaaaa');
    });

    it('should clean up receipts for removed signals', async () => {
      const sig1 = createTestSignal({
        id: 'sig-aaaaaaaa',
        read: false,
        created_at: new Date(Date.now() - 10 * ONE_DAY_MS).toISOString(),
      });
      await writeSignalsFile(testDir, [sig1]);
      await writeReceipts(testDir, [
        { signal_id: 'sig-aaaaaaaa', read_at: new Date().toISOString() },
      ]);

      await cleanupSignals(testDir);

      // Receipt for removed signal should also be cleaned up
      const remainingReceipts = await readReceipts(testDir);
      const orphanedReceipts = remainingReceipts.filter((r) => r.signal_id === 'sig-aaaaaaaa');
      expect(orphanedReceipts).toHaveLength(0);
    });

    it('should retain receipts for retained signals', async () => {
      const sig1 = createTestSignal({
        id: 'sig-aaaaaaaa',
        read: false,
        created_at: new Date(Date.now() - 3 * ONE_DAY_MS).toISOString(),
      });
      await writeSignalsFile(testDir, [sig1]);
      await writeReceipts(testDir, [
        { signal_id: 'sig-aaaaaaaa', read_at: new Date().toISOString() },
      ]);

      // 3 day old signal with receipt, 7d read TTL => retained
      await cleanupSignals(testDir);

      const remainingReceipts = await readReceipts(testDir);
      expect(remainingReceipts).toHaveLength(1);
      expect(remainingReceipts[0].signal_id).toBe('sig-aaaaaaaa');
    });

    it('should handle cleanup with legacy inline read and new receipts mixed', async () => {
      const sig1 = createTestSignal({
        id: 'sig-aaaaaaaa',
        read: true, // legacy inline
        created_at: new Date(Date.now() - 10 * ONE_DAY_MS).toISOString(),
      });
      const sig2 = createTestSignal({
        id: 'sig-bbbbbbbb',
        read: false, // receipt-based read
        created_at: new Date(Date.now() - 10 * ONE_DAY_MS).toISOString(),
      });
      const sig3 = createTestSignal({
        id: 'sig-cccccccc',
        read: false, // truly unread
        created_at: new Date(Date.now() - 2 * ONE_DAY_MS).toISOString(),
      });
      await writeSignalsFile(testDir, [sig1, sig2, sig3]);
      await writeReceipts(testDir, [
        { signal_id: 'sig-bbbbbbbb', read_at: new Date().toISOString() },
      ]);

      const result = await cleanupSignals(testDir);

      // sig1: inline read, 10d old, 7d TTL => removed
      expect(result.removedIds).toContain('sig-aaaaaaaa');
      // sig2: receipt-read, 10d old, 7d read TTL => removed
      expect(result.removedIds).toContain('sig-bbbbbbbb');
      // sig3: unread, 2d old, 30d unread TTL => retained
      expect(result.retainedIds).toContain('sig-cccccccc');
    });
  });

  describe('AC4: Concurrent read-marking tests demonstrate no lost updates', () => {
    it('should preserve all receipts when two concurrent marks happen', async () => {
      const sig1 = createTestSignal({ id: 'sig-aaaaaaaa' });
      const sig2 = createTestSignal({ id: 'sig-bbbbbbbb' });
      const sig3 = createTestSignal({ id: 'sig-cccccccc' });
      const sig4 = createTestSignal({ id: 'sig-dddddddd' });
      await writeSignalsFile(testDir, [sig1, sig2, sig3, sig4]);

      // Simulate concurrent read-marking by two agents
      // Both append to the same receipts file
      await Promise.all([
        markSignalsAsRead(testDir, ['sig-aaaaaaaa', 'sig-bbbbbbbb']),
        markSignalsAsRead(testDir, ['sig-cccccccc', 'sig-dddddddd']),
      ]);

      // All 4 receipts should be present (no lost updates)
      const receipts = await readReceipts(testDir);
      const receiptIds = receipts.map((r) => r.signal_id);
      expect(receiptIds).toContain('sig-aaaaaaaa');
      expect(receiptIds).toContain('sig-bbbbbbbb');
      expect(receiptIds).toContain('sig-cccccccc');
      expect(receiptIds).toContain('sig-dddddddd');
    });

    it('should show all concurrently-marked signals as read via loadSignals', async () => {
      const sig1 = createTestSignal({ id: 'sig-aaaaaaaa' });
      const sig2 = createTestSignal({ id: 'sig-bbbbbbbb' });
      const sig3 = createTestSignal({ id: 'sig-cccccccc' });
      const sig4 = createTestSignal({ id: 'sig-dddddddd' });
      await writeSignalsFile(testDir, [sig1, sig2, sig3, sig4]);

      // Concurrent marking
      await Promise.all([
        markSignalsAsRead(testDir, ['sig-aaaaaaaa', 'sig-bbbbbbbb']),
        markSignalsAsRead(testDir, ['sig-cccccccc', 'sig-dddddddd']),
      ]);

      const signals = await loadSignals(testDir);
      // All should be marked read
      expect(signals.every((s) => s.read === true)).toBe(true);
    });

    it('should handle sequential marks correctly (idempotent)', async () => {
      const sig1 = createTestSignal({ id: 'sig-aaaaaaaa' });
      await writeSignalsFile(testDir, [sig1]);

      // Mark same signal twice
      const result1 = await markSignalsAsRead(testDir, ['sig-aaaaaaaa']);
      const result2 = await markSignalsAsRead(testDir, ['sig-aaaaaaaa']);

      // First mark should count, second should not (idempotent)
      expect(result1.markedCount).toBe(1);
      expect(result2.markedCount).toBe(0);

      // Signal should still be read
      const signals = await loadSignals(testDir);
      expect(signals[0].read).toBe(true);
    });

    it('should not lose updates under rapid sequential marks', async () => {
      const signals: Signal[] = [];
      for (let i = 0; i < 20; i++) {
        signals.push(createTestSignal({ id: `sig-${i.toString(16).padStart(8, '0')}` }));
      }
      await writeSignalsFile(testDir, signals);

      // Mark signals in batches rapidly
      await Promise.all([
        markSignalsAsRead(
          testDir,
          signals.slice(0, 5).map((s) => s.id),
        ),
        markSignalsAsRead(
          testDir,
          signals.slice(5, 10).map((s) => s.id),
        ),
        markSignalsAsRead(
          testDir,
          signals.slice(10, 15).map((s) => s.id),
        ),
        markSignalsAsRead(
          testDir,
          signals.slice(15, 20).map((s) => s.id),
        ),
      ]);

      const loaded = await loadSignals(testDir);
      // All 20 should be read
      const readCount = loaded.filter((s) => s.read).length;
      expect(readCount).toBe(20);
    });
  });

  describe('SIGNAL_RECEIPTS_FILE_NAME export', () => {
    it('should export the receipts file name constant', () => {
      expect(SIGNAL_RECEIPTS_FILE_NAME).toBe('signal-receipts.jsonl');
    });
  });
});
