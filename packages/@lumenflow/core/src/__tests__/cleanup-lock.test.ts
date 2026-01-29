/**
 * Tests for cleanup-lock module
 *
 * WU-1174: Lock files should be created in temp directory, not main checkout
 *
 * Tests atomic file-based locking for wu:done cleanup operations.
 * @see {@link ../cleanup-lock.ts}
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import crypto from 'node:crypto';
import {
  acquireCleanupLock,
  releaseCleanupLock,
  isCleanupLocked,
  getCleanupLockInfo,
  withCleanupLock,
  CLEANUP_LOCK_TIMEOUT_MS,
  CLEANUP_LOCK_STALE_MS,
} from '../cleanup-lock.js';
import { LUMENFLOW_PATHS } from '../wu-constants.js';

describe('cleanup-lock', () => {
  let testBaseDir: string;

  beforeEach(() => {
    // Create isolated test directory for each test
    // Use crypto.randomUUID() instead of Math.random() for security
    const uniqueId = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    testBaseDir = join(tmpdir(), `cleanup-lock-test-${uniqueId}`);
    mkdirSync(testBaseDir, { recursive: true });
  });

  afterEach(() => {
    // Clean up test directory
    try {
      rmSync(testBaseDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  /**
   * WU-1174: Verify lock files are created in temp directory, not main checkout
   */
  describe('WU-1174: Lock file location', () => {
    it('should NOT create lock files in main checkout .lumenflow/ directory', async () => {
      const mainCheckout = join(testBaseDir, 'main-checkout');
      mkdirSync(join(mainCheckout, '.lumenflow'), { recursive: true });

      // Acquire lock using baseDir (simulates running from main checkout)
      const result = await acquireCleanupLock('WU-1174', { baseDir: mainCheckout });

      // Verify no lock file in main checkout's .lumenflow/ directory
      const mainLockPath = join(mainCheckout, '.lumenflow', 'cleanup.lock');
      expect(existsSync(mainLockPath)).toBe(false);

      // The lock should still be acquired (in test isolation directory)
      expect(result.acquired).toBe(true);

      // When using baseDir, lock goes to baseDir/.lumenflow-locks/ (test isolation)
      const testLockDir = join(mainCheckout, '.lumenflow-locks');
      expect(existsSync(testLockDir)).toBe(true);

      // Cleanup
      if (result.lockId) {
        releaseCleanupLock(result.lockId, { baseDir: mainCheckout });
      }
    });

    it('should create lock files in temp directory based on LUMENFLOW_PATHS.LOCK_DIR', () => {
      // LOCK_DIR should be something like /tmp/lumenflow-locks/
      expect(LUMENFLOW_PATHS.LOCK_DIR).toBeDefined();
      expect(LUMENFLOW_PATHS.LOCK_DIR).toContain(tmpdir());
    });

    it('should use LUMENFLOW_PATHS.LOCK_DIR when no baseDir provided', async () => {
      // When no baseDir is provided, locks should use LUMENFLOW_PATHS.LOCK_DIR
      const result = await acquireCleanupLock('WU-1174-cleanup-test');

      expect(result.acquired).toBe(true);

      // The lock file should be in LUMENFLOW_PATHS.LOCK_DIR
      const lockPath = join(LUMENFLOW_PATHS.LOCK_DIR, 'cleanup.lock');
      expect(existsSync(lockPath)).toBe(true);

      // Cleanup
      if (result.lockId) {
        releaseCleanupLock(result.lockId);
      }
    });
  });

  describe('lock acquisition', () => {
    it('should acquire lock successfully when no lock exists', async () => {
      const result = await acquireCleanupLock('WU-1174', { baseDir: testBaseDir });

      expect(result.acquired).toBe(true);
      expect(result.lockId).toBeDefined();

      // Cleanup
      if (result.lockId) {
        releaseCleanupLock(result.lockId, { baseDir: testBaseDir });
      }
    });

    it('should allow same WU to re-acquire lock (idempotent)', async () => {
      const result1 = await acquireCleanupLock('WU-1174', { baseDir: testBaseDir });
      expect(result1.acquired).toBe(true);

      const result2 = await acquireCleanupLock('WU-1174', { baseDir: testBaseDir });
      expect(result2.acquired).toBe(true);
      expect(result2.lockId).toBe(result1.lockId);

      // Cleanup
      if (result1.lockId) {
        releaseCleanupLock(result1.lockId, { baseDir: testBaseDir });
      }
    });

    it('should fail when different WU tries to acquire', async () => {
      const result1 = await acquireCleanupLock('WU-1174', { baseDir: testBaseDir });
      expect(result1.acquired).toBe(true);

      const result2 = await acquireCleanupLock('WU-9999', { baseDir: testBaseDir, waitMs: 100 });
      expect(result2.acquired).toBe(false);
      expect(result2.heldBy).toBe('WU-1174');

      // Cleanup
      if (result1.lockId) {
        releaseCleanupLock(result1.lockId, { baseDir: testBaseDir });
      }
    });
  });

  describe('lock release', () => {
    it('should release lock successfully', async () => {
      const result = await acquireCleanupLock('WU-1174', { baseDir: testBaseDir });
      expect(result.acquired).toBe(true);
      expect(result.lockId).toBeDefined();

      const released = releaseCleanupLock(result.lockId ?? '', { baseDir: testBaseDir });
      expect(released).toBe(true);

      // Verify lock is released
      expect(isCleanupLocked({ baseDir: testBaseDir })).toBe(false);
    });

    it('should fail to release with wrong lockId', async () => {
      const result = await acquireCleanupLock('WU-1174', { baseDir: testBaseDir });
      expect(result.acquired).toBe(true);
      expect(result.lockId).toBeDefined();

      const released = releaseCleanupLock('wrong-lock-id', { baseDir: testBaseDir });
      expect(released).toBe(false);

      // Lock should still be held
      expect(isCleanupLocked({ baseDir: testBaseDir })).toBe(true);

      // Cleanup with correct ID
      releaseCleanupLock(result.lockId ?? '', { baseDir: testBaseDir });
    });
  });

  describe('lock status', () => {
    it('should report unlocked when no lock exists', () => {
      expect(isCleanupLocked({ baseDir: testBaseDir })).toBe(false);
      expect(getCleanupLockInfo({ baseDir: testBaseDir })).toBeNull();
    });

    it('should report locked when lock is held', async () => {
      const result = await acquireCleanupLock('WU-1174', { baseDir: testBaseDir });

      expect(isCleanupLocked({ baseDir: testBaseDir })).toBe(true);
      const info = getCleanupLockInfo({ baseDir: testBaseDir });
      expect(info).not.toBeNull();
      expect(info?.wuId).toBe('WU-1174');

      // Cleanup
      if (result.lockId) {
        releaseCleanupLock(result.lockId, { baseDir: testBaseDir });
      }
    });
  });

  describe('withCleanupLock wrapper', () => {
    it('should execute function while holding lock', async () => {
      let executed = false;

      await withCleanupLock(
        'WU-1174',
        async () => {
          executed = true;
          expect(isCleanupLocked({ baseDir: testBaseDir })).toBe(true);
        },
        { baseDir: testBaseDir },
      );

      expect(executed).toBe(true);
      expect(isCleanupLocked({ baseDir: testBaseDir })).toBe(false);
    });

    it('should release lock even if function throws', async () => {
      try {
        await withCleanupLock(
          'WU-1174',
          async () => {
            throw new Error('Test error');
          },
          { baseDir: testBaseDir },
        );
      } catch {
        // Expected
      }

      expect(isCleanupLocked({ baseDir: testBaseDir })).toBe(false);
    });

    it('should throw if lock cannot be acquired', async () => {
      // First lock
      const result = await acquireCleanupLock('WU-1174', { baseDir: testBaseDir });

      // Second lock attempt should fail
      await expect(
        withCleanupLock('WU-9999', async () => {}, { baseDir: testBaseDir, waitMs: 100 }),
      ).rejects.toThrow();

      // Cleanup
      if (result.lockId) {
        releaseCleanupLock(result.lockId, { baseDir: testBaseDir });
      }
    });
  });

  describe('stale lock handling', () => {
    it('should export stale threshold constant', () => {
      expect(CLEANUP_LOCK_STALE_MS).toBe(5 * 60 * 1000); // 5 minutes
    });

    it('should export timeout constant', () => {
      expect(CLEANUP_LOCK_TIMEOUT_MS).toBe(30000); // 30 seconds
    });
  });
});
