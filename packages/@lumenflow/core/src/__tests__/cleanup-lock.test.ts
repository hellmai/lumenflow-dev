/**
 * WU-2241: Tests for cleanup-lock.mjs
 *
 * Tests atomic file-based locking for cleanup operations.
 */

import { describe, it, beforeEach, afterEach, expect } from 'vitest';

import { mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import {
  acquireCleanupLock,
  releaseCleanupLock,
  isCleanupLocked,
  getCleanupLockInfo,
  isCleanupLockStale,
  isCleanupLockZombie,
  withCleanupLock,
  CLEANUP_LOCK_STALE_MS,
} from '../cleanup-lock.mjs';

describe('cleanup-lock', () => {
  let testDir;

  beforeEach(() => {
    const timestamp = Date.now();
    const random = crypto.randomUUID().slice(0, 8);
    testDir = path.join(os.tmpdir(), 'cleanup-lock-test-' + timestamp + '-' + random);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (testDir && existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('acquireCleanupLock', () => {
    it('acquires lock successfully when no existing lock', async () => {
      const result = await acquireCleanupLock('WU-123', { baseDir: testDir });

      expect(result.acquired).toBe(true);
      expect(result.lockId).toBeTruthy();

      // Verify lock file was created
      const lockPath = path.join(testDir, '.beacon', 'cleanup.lock');
      expect(existsSync(lockPath)).toBe(true);
    });

    it('fails when lock already exists for different WU', async () => {
      // First lock
      await acquireCleanupLock('WU-100', { baseDir: testDir });

      // Second attempt by different WU (with short timeout)
      const result = await acquireCleanupLock('WU-200', { baseDir: testDir, waitMs: 100 });

      expect(result.acquired).toBe(false);
      expect(result.heldBy).toBe('WU-100');
    });

    it('allows re-acquisition by same WU', async () => {
      // First lock
      const first = await acquireCleanupLock('WU-100', { baseDir: testDir });

      // Re-acquisition by same WU
      const second = await acquireCleanupLock('WU-100', { baseDir: testDir });

      expect(first.acquired).toBe(true);
      expect(second.acquired).toBe(true);
      expect(first.lockId).toBe(second.lockId);
    });

    it('includes worktreePath in lock metadata', async () => {
      const worktreePath = '/path/to/worktree';
      await acquireCleanupLock('WU-123', {
        baseDir: testDir,
        worktreePath,
      });

      const lockInfo = getCleanupLockInfo({ baseDir: testDir });
      expect(lockInfo.worktreePath).toBe(worktreePath);
    });
  });

  describe('releaseCleanupLock', () => {
    it('releases existing lock', async () => {
      const { lockId } = await acquireCleanupLock('WU-100', { baseDir: testDir });
      const lockPath = path.join(testDir, '.beacon', 'cleanup.lock');

      expect(existsSync(lockPath)).toBe(true);

      const result = releaseCleanupLock(lockId, { baseDir: testDir });

      expect(result).toBe(true);
      expect(!existsSync(lockPath)).toBe(true);
    });

    it('returns false when lockId does not match', async () => {
      await acquireCleanupLock('WU-100', { baseDir: testDir });

      const result = releaseCleanupLock('wrong-lock-id', { baseDir: testDir });

      expect(result).toBe(false);
    });
  });

  describe('isCleanupLocked', () => {
    it('returns false when no lock exists', () => {
      const result = isCleanupLocked({ baseDir: testDir });
      expect(result).toBe(false);
    });

    it('returns true when lock exists', async () => {
      await acquireCleanupLock('WU-100', { baseDir: testDir });
      const result = isCleanupLocked({ baseDir: testDir });
      expect(result).toBe(true);
    });
  });

  describe('isCleanupLockStale', () => {
    it('returns false for recent lock', () => {
      const metadata = {
        wuId: 'WU-100',
        createdAt: new Date().toISOString(),
        pid: process.pid,
      };
      expect(isCleanupLockStale(metadata)).toBe(false);
    });

    it('returns true for lock older than threshold', () => {
      const oldDate = new Date(Date.now() - CLEANUP_LOCK_STALE_MS - 1000);
      const metadata = {
        wuId: 'WU-100',
        createdAt: oldDate.toISOString(),
        pid: process.pid,
      };
      expect(isCleanupLockStale(metadata)).toBe(true);
    });

    it('returns true for invalid metadata', () => {
      expect(isCleanupLockStale(null)).toBe(true);
      expect(isCleanupLockStale({})).toBe(true);
    });
  });

  describe('isCleanupLockZombie', () => {
    it('returns false for lock held by current process', () => {
      const metadata = {
        wuId: 'WU-100',
        createdAt: new Date().toISOString(),
        pid: process.pid,
      };
      expect(isCleanupLockZombie(metadata)).toBe(false);
    });

    it('returns true for lock held by non-existent process', () => {
      const metadata = {
        wuId: 'WU-100',
        createdAt: new Date().toISOString(),
        pid: 99999999, // Unlikely to exist
      };
      expect(isCleanupLockZombie(metadata)).toBe(true);
    });
  });

  describe('withCleanupLock', () => {
    it('acquires lock, runs function, then releases lock', async () => {
      const executionLog = [];

      await withCleanupLock(
        'WU-TEST',
        async () => {
          executionLog.push('function-executed');
          // Verify lock is held during execution
          expect(isCleanupLocked({ baseDir: testDir })).toBe(true);
        },
        { baseDir: testDir }
      );

      // Verify lock is released after
      expect(isCleanupLocked({ baseDir: testDir })).toBe(false);
      expect(executionLog).toEqual(['function-executed']);
    });

    it('releases lock even if function throws', async () => {
      let errorCaught = false;

      try {
        await withCleanupLock(
          'WU-ERROR',
          async () => {
            throw new Error('test error');
          },
          { baseDir: testDir }
        );
      } catch {
        errorCaught = true;
      }

      expect(errorCaught).toBe(true);
      expect(isCleanupLocked({ baseDir: testDir })).toBe(false);
    });
  });

  describe('stale lock auto-cleanup', () => {
    it('acquires lock after auto-clearing stale lock', async () => {
      // Create stale lock manually
      const lockDir = path.join(testDir, '.beacon');
      mkdirSync(lockDir, { recursive: true });
      const lockPath = path.join(lockDir, 'cleanup.lock');

      const staleLock = {
        wuId: 'WU-STALE',
        lockId: 'stale-lock-id',
        createdAt: new Date(Date.now() - CLEANUP_LOCK_STALE_MS - 60000).toISOString(),
        pid: process.pid,
      };
      writeFileSync(lockPath, JSON.stringify(staleLock));

      // Acquire should clear stale lock and succeed
      const result = await acquireCleanupLock('WU-NEW', { baseDir: testDir });

      expect(result.acquired).toBe(true);
      const lockInfo = getCleanupLockInfo({ baseDir: testDir });
      expect(lockInfo.wuId).toBe('WU-NEW');
    });
  });

  describe('zombie lock auto-cleanup', () => {
    it('acquires lock after auto-clearing zombie lock', async () => {
      // Create zombie lock manually (with non-existent PID)
      const lockDir = path.join(testDir, '.beacon');
      mkdirSync(lockDir, { recursive: true });
      const lockPath = path.join(lockDir, 'cleanup.lock');

      const zombieLock = {
        wuId: 'WU-ZOMBIE',
        lockId: 'zombie-lock-id',
        createdAt: new Date().toISOString(), // Recent but zombie
        pid: 99999999, // Non-existent PID
      };
      writeFileSync(lockPath, JSON.stringify(zombieLock));

      // Acquire should clear zombie lock and succeed
      const result = await acquireCleanupLock('WU-NEW', { baseDir: testDir });

      expect(result.acquired).toBe(true);
      const lockInfo = getCleanupLockInfo({ baseDir: testDir });
      expect(lockInfo.wuId).toBe('WU-NEW');
    });
  });
});
