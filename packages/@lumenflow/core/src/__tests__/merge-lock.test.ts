/**
 * WU-1747: Merge lock tests
 * Tests for atomic merge locking mechanism to prevent race conditions
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { existsSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';

import {
  acquireMergeLock,
  releaseMergeLock,
  withMergeLock,
  isMergeLocked,
  getMergeLockInfo,
  MERGE_LOCK_TIMEOUT_MS,
  MERGE_LOCK_STALE_MS,
} from '../merge-lock.mjs';

describe('merge-lock', () => {
  let testDir;

  beforeEach(() => {
    // Create a temp directory for each test
    testDir = path.join(tmpdir(), `merge-lock-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
    mkdirSync(path.join(testDir, '.beacon'), { recursive: true });
  });

  afterEach(() => {
    // Clean up test directory
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('MERGE_LOCK_TIMEOUT_MS', () => {
    it('should have a reasonable timeout value', () => {
      assert.ok(MERGE_LOCK_TIMEOUT_MS > 0, 'should be positive');
      assert.ok(MERGE_LOCK_TIMEOUT_MS <= 60000, 'should be <= 60 seconds');
    });
  });

  describe('MERGE_LOCK_STALE_MS', () => {
    it('should be greater than timeout', () => {
      assert.ok(MERGE_LOCK_STALE_MS >= MERGE_LOCK_TIMEOUT_MS, 'stale time should be >= timeout');
    });
  });

  describe('acquireMergeLock()', () => {
    it('should acquire lock when none exists', async () => {
      const result = await acquireMergeLock('WU-100', { baseDir: testDir });

      assert.equal(result.acquired, true);
      assert.ok(result.lockId, 'should have lockId');
    });

    it('should fail to acquire when lock exists for different WU', async () => {
      // First lock
      await acquireMergeLock('WU-100', { baseDir: testDir });

      // Second lock should fail
      const result = await acquireMergeLock('WU-200', { baseDir: testDir, waitMs: 0 });

      assert.equal(result.acquired, false);
      assert.ok(result.heldBy, 'should indicate who holds lock');
    });

    it('should allow same WU to re-acquire its own lock', async () => {
      // First lock
      const first = await acquireMergeLock('WU-100', { baseDir: testDir });

      // Same WU can re-acquire (idempotent)
      const second = await acquireMergeLock('WU-100', { baseDir: testDir });

      assert.equal(second.acquired, true);
      assert.equal(second.lockId, first.lockId);
    });

    it('should include WU ID in lock info', async () => {
      await acquireMergeLock('WU-999', { baseDir: testDir });

      const info = getMergeLockInfo({ baseDir: testDir });

      assert.equal(info.wuId, 'WU-999');
      assert.ok(info.createdAt, 'should have createdAt');
      assert.ok(info.pid, 'should have pid');
    });
  });

  describe('releaseMergeLock()', () => {
    it('should release existing lock', async () => {
      const lock = await acquireMergeLock('WU-100', { baseDir: testDir });

      const released = releaseMergeLock(lock.lockId, { baseDir: testDir });

      assert.equal(released, true);
      assert.equal(isMergeLocked({ baseDir: testDir }), false);
    });

    it('should not release lock with wrong lockId', async () => {
      await acquireMergeLock('WU-100', { baseDir: testDir });

      const released = releaseMergeLock('wrong-lock-id', { baseDir: testDir });

      assert.equal(released, false);
      assert.equal(isMergeLocked({ baseDir: testDir }), true);
    });

    it('should return false when no lock exists', () => {
      const released = releaseMergeLock('any-id', { baseDir: testDir });

      assert.equal(released, false);
    });
  });

  describe('isMergeLocked()', () => {
    it('should return false when no lock exists', () => {
      assert.equal(isMergeLocked({ baseDir: testDir }), false);
    });

    it('should return true when lock exists', async () => {
      await acquireMergeLock('WU-100', { baseDir: testDir });

      assert.equal(isMergeLocked({ baseDir: testDir }), true);
    });

    it('should return false for stale locks', async () => {
      await acquireMergeLock('WU-100', { baseDir: testDir });

      // Manually age the lock file
      const lockPath = path.join(testDir, '.beacon', 'merge.lock');
      const lockData = JSON.parse(readFileSync(lockPath, 'utf8'));
      lockData.createdAt = new Date(Date.now() - MERGE_LOCK_STALE_MS - 1000).toISOString();
      const { writeFileSync } = await import('node:fs');
      writeFileSync(lockPath, JSON.stringify(lockData, null, 2));

      // Stale lock should be treated as unlocked
      assert.equal(isMergeLocked({ baseDir: testDir }), false);
    });
  });

  describe('getMergeLockInfo()', () => {
    it('should return null when no lock exists', () => {
      const info = getMergeLockInfo({ baseDir: testDir });
      assert.equal(info, null);
    });

    it('should return lock info when lock exists', async () => {
      await acquireMergeLock('WU-123', { baseDir: testDir });

      const info = getMergeLockInfo({ baseDir: testDir });

      assert.ok(info);
      assert.equal(info.wuId, 'WU-123');
      assert.ok(info.lockId);
      assert.ok(info.createdAt);
      assert.ok(info.pid);
    });
  });

  describe('withMergeLock()', () => {
    it('should execute function with lock and release after', async () => {
      let lockHeldDuring = false;

      const result = await withMergeLock('WU-100', async () => {
        lockHeldDuring = isMergeLocked({ baseDir: testDir });
        return 'done';
      }, { baseDir: testDir });

      assert.equal(lockHeldDuring, true, 'lock should be held during execution');
      assert.equal(result, 'done', 'should return function result');
      assert.equal(isMergeLocked({ baseDir: testDir }), false, 'lock should be released after');
    });

    it('should release lock even if function throws', async () => {
      try {
        await withMergeLock('WU-100', async () => {
          throw new Error('Intentional error');
        }, { baseDir: testDir });
        assert.fail('should have thrown');
      } catch (err) {
        assert.ok(err.message.includes('Intentional error'));
      }

      assert.equal(isMergeLocked({ baseDir: testDir }), false, 'lock should be released after error');
    });

    it('should throw if lock cannot be acquired', async () => {
      // First lock
      await acquireMergeLock('WU-100', { baseDir: testDir });

      // withMergeLock for different WU should fail
      try {
        await withMergeLock('WU-200', async () => 'done', { baseDir: testDir, waitMs: 100 });
        assert.fail('should have thrown');
      } catch (err) {
        assert.ok(err.message.includes('acquire') || err.message.includes('lock'), 'should mention lock');
      }
    });
  });
});
