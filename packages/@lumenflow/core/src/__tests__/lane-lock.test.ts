import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  acquireLaneLock,
  releaseLaneLock,
  checkLaneLock,
  isLockStale,
  isZombieLock,
  getLockFilePath,
  getLocksDir,
  forceRemoveStaleLock,
  readLockMetadata,
  auditedUnlock,
  getStaleThresholdMs,
} from '../lane-lock.js';

/**
 * Unit tests for lane-lock.mjs
 *
 * Tests atomic file-based locking to prevent TOCTOU race conditions
 * in wu:claim when parallel agents attempt to claim the same lane.
 *
 * @see WU-1603
 */

describe('lane-lock', () => {
  /** @type {string} */
  let testDir;

  beforeEach(() => {
    // Create unique temp directory for each test
    testDir = path.join(
      os.tmpdir(),
      `lane-lock-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    // Clean up temp directory
    if (testDir && existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('getLocksDir', () => {
    it('returns correct locks directory path', () => {
      const locksDir = getLocksDir(testDir);
      expect(locksDir.endsWith('.beacon/locks')).toBeTruthy();
      expect(locksDir.startsWith(testDir)).toBeTruthy();
    });
  });

  describe('getLockFilePath', () => {
    it('converts lane name to kebab-case lock file', () => {
      const lockPath = getLockFilePath('Operations: Tooling', testDir);
      expect(lockPath.endsWith('operations-tooling.lock')).toBeTruthy();
    });

    it('handles parent-only lane names', () => {
      const lockPath = getLockFilePath('Intelligence', testDir);
      expect(lockPath.endsWith('intelligence.lock')).toBeTruthy();
    });

    it('handles multi-word parent with sub-lane', () => {
      const lockPath = getLockFilePath('Core Systems: API', testDir);
      expect(lockPath.endsWith('core-systems-api.lock')).toBeTruthy();
    });
  });

  describe('acquireLaneLock', () => {
    it('acquires lock successfully when no existing lock', () => {
      const result = acquireLaneLock('Operations: Tooling', 'WU-123', { baseDir: testDir });

      expect(result.acquired).toBe(true);
      expect(result.error).toBe(null);
      expect(result.existingLock).toBe(null);
      expect(result.isStale).toBe(false);

      // Verify lock file was created
      const lockPath = getLockFilePath('Operations: Tooling', testDir);
      assert.ok(existsSync(lockPath), 'Lock file should exist');
    });

    it('writes correct metadata to lock file', () => {
      acquireLaneLock('Operations: Tooling', 'WU-456', {
        baseDir: testDir,
        agentSession: 'session-abc',
      });

      const lockPath = getLockFilePath('Operations: Tooling', testDir);
      const content = JSON.parse(readFileSync(lockPath, 'utf8'));

      expect(content.wuId).toBe('WU-456');
      expect(content.agentSession).toBe('session-abc');
      expect(content.lane).toBe('Operations: Tooling');
      assert.ok(content.timestamp, 'Should have timestamp');
      assert.ok(content.pid, 'Should have pid');
    });

    it('fails when lock already exists for different WU', () => {
      // First lock
      acquireLaneLock('Operations: Tooling', 'WU-100', { baseDir: testDir });

      // Second attempt by different WU
      const result = acquireLaneLock('Operations: Tooling', 'WU-200', { baseDir: testDir });

      expect(result.acquired).toBe(false);
      expect(result.error.includes('WU-100')).toBe(true);
      expect(result.existingLock).toBeTruthy();
      expect(result.existingLock.wuId).toBe('WU-100');
    });

    it('allows re-acquisition by same WU', () => {
      // First lock
      acquireLaneLock('Operations: Tooling', 'WU-100', { baseDir: testDir });

      // Re-acquisition by same WU
      const result = acquireLaneLock('Operations: Tooling', 'WU-100', { baseDir: testDir });

      expect(result.acquired).toBe(true, 'Should allow same WU to re-acquire');
      expect(result.error).toBe(null);
    });

    it('allows different lanes to be locked independently', () => {
      const result1 = acquireLaneLock('Operations: Tooling', 'WU-100', { baseDir: testDir });
      const result2 = acquireLaneLock('Intelligence: Prompts', 'WU-200', { baseDir: testDir });

      expect(result1.acquired).toBe(true);
      expect(result2.acquired).toBe(true);
    });

    it('creates locks directory if it does not exist', () => {
      const locksDir = getLocksDir(testDir);
      assert.ok(!existsSync(locksDir), 'Locks dir should not exist initially');

      acquireLaneLock('Discovery', 'WU-999', { baseDir: testDir });

      assert.ok(existsSync(locksDir), 'Locks dir should be created');
    });
  });

  describe('releaseLaneLock', () => {
    it('releases existing lock', () => {
      acquireLaneLock('Operations: Tooling', 'WU-100', { baseDir: testDir });
      const lockPath = getLockFilePath('Operations: Tooling', testDir);
      assert.ok(existsSync(lockPath), 'Lock should exist before release');

      const result = releaseLaneLock('Operations: Tooling', { baseDir: testDir });

      expect(result.released).toBe(true);
      expect(result.error).toBe(null);
      expect(result.notFound).toBe(false);
      assert.ok(!existsSync(lockPath), 'Lock should be removed after release');
    });

    it('returns notFound=true when lock does not exist', () => {
      const result = releaseLaneLock('NonExistent: Lane', { baseDir: testDir });

      expect(result.released).toBe(true);
      expect(result.notFound).toBe(true);
    });

    it('validates ownership when wuId provided', () => {
      acquireLaneLock('Operations: Tooling', 'WU-100', { baseDir: testDir });

      // Try to release with wrong WU
      const result = releaseLaneLock('Operations: Tooling', {
        baseDir: testDir,
        wuId: 'WU-999',
      });

      expect(result.released).toBe(false);
      expect(result.error.includes('WU-100')).toBe(true);
    });

    it('allows release with correct wuId', () => {
      acquireLaneLock('Operations: Tooling', 'WU-100', { baseDir: testDir });

      const result = releaseLaneLock('Operations: Tooling', {
        baseDir: testDir,
        wuId: 'WU-100',
      });

      expect(result.released).toBe(true);
    });

    it('force=true bypasses ownership check', () => {
      acquireLaneLock('Operations: Tooling', 'WU-100', { baseDir: testDir });

      const result = releaseLaneLock('Operations: Tooling', {
        baseDir: testDir,
        wuId: 'WU-999',
        force: true,
      });

      expect(result.released).toBe(true);
    });
  });

  describe('checkLaneLock', () => {
    it('returns locked=false when no lock exists', () => {
      const result = checkLaneLock('Operations: Tooling', { baseDir: testDir });

      expect(result.locked).toBe(false);
      expect(result.metadata).toBe(null);
      expect(result.isStale).toBe(false);
    });

    it('returns locked=true with metadata when lock exists', () => {
      acquireLaneLock('Operations: Tooling', 'WU-100', { baseDir: testDir });

      const result = checkLaneLock('Operations: Tooling', { baseDir: testDir });

      expect(result.locked).toBe(true);
      expect(result.metadata).toBeTruthy();
      expect(result.metadata.wuId).toBe('WU-100');
      expect(result.isStale).toBe(false);
    });
  });

  describe('isLockStale', () => {
    it('returns false for recent lock', () => {
      const metadata = {
        wuId: 'WU-100',
        timestamp: new Date().toISOString(),
        pid: process.pid,
        lane: 'Test',
      };

      expect(isLockStale(metadata)).toBe(false);
    });

    it('returns false for lock just under 2 hours old', () => {
      // 1h 59m ago - should NOT be stale
      const recentDate = new Date(Date.now() - 119 * 60 * 1000);
      const metadata = {
        wuId: 'WU-100',
        timestamp: recentDate.toISOString(),
        pid: process.pid,
        lane: 'Test',
      };

      expect(isLockStale(metadata)).toBe(false, 'Lock under 2h should not be stale');
    });

    it('returns true for lock older than 2 hours (WU-1949)', () => {
      // 2h 1m ago - should be stale with new 2h threshold
      const oldDate = new Date(Date.now() - 121 * 60 * 1000);
      const metadata = {
        wuId: 'WU-100',
        timestamp: oldDate.toISOString(),
        pid: process.pid,
        lane: 'Test',
      };

      expect(isLockStale(metadata)).toBe(true, 'Lock over 2h should be stale');
    });

    it('returns true for lock older than 24 hours', () => {
      const oldDate = new Date(Date.now() - 25 * 60 * 60 * 1000); // 25 hours ago
      const metadata = {
        wuId: 'WU-100',
        timestamp: oldDate.toISOString(),
        pid: process.pid,
        lane: 'Test',
      };

      expect(isLockStale(metadata)).toBe(true);
    });

    it('returns true for invalid metadata', () => {
      expect(isLockStale(null)).toBe(true);
      expect(isLockStale({})).toBe(true);
      expect(isLockStale({ wuId: 'WU-100' })).toBe(true);
    });
  });

  describe('getStaleThresholdMs (WU-1949)', () => {
    const originalEnv = process.env.STALE_LOCK_THRESHOLD_HOURS;

    afterEach(() => {
      // Restore original env var
      if (originalEnv === undefined) {
        delete process.env.STALE_LOCK_THRESHOLD_HOURS;
      } else {
        process.env.STALE_LOCK_THRESHOLD_HOURS = originalEnv;
      }
    });

    it('returns 2h (7,200,000 ms) by default', () => {
      delete process.env.STALE_LOCK_THRESHOLD_HOURS;
      const threshold = getStaleThresholdMs();
      assert.equal(threshold, 2 * 60 * 60 * 1000, 'Default should be 2 hours (7,200,000 ms)');
    });

    it('respects STALE_LOCK_THRESHOLD_HOURS env var override', () => {
      process.env.STALE_LOCK_THRESHOLD_HOURS = '6';
      const threshold = getStaleThresholdMs();
      expect(threshold).toBe(6 * 60 * 60 * 1000, 'Should respect env var override');
    });

    it('falls back to default for invalid env var value', () => {
      process.env.STALE_LOCK_THRESHOLD_HOURS = 'not-a-number';
      const threshold = getStaleThresholdMs();
      expect(threshold).toBe(2 * 60 * 60 * 1000, 'Should fall back to default for invalid value');
    });

    it('falls back to default for zero value', () => {
      process.env.STALE_LOCK_THRESHOLD_HOURS = '0';
      const threshold = getStaleThresholdMs();
      expect(threshold).toBe(2 * 60 * 60 * 1000, 'Should fall back to default for zero');
    });

    it('falls back to default for negative value', () => {
      process.env.STALE_LOCK_THRESHOLD_HOURS = '-5';
      const threshold = getStaleThresholdMs();
      expect(threshold).toBe(2 * 60 * 60 * 1000, 'Should fall back to default for negative');
    });
  });

  describe('forceRemoveStaleLock', () => {
    it('removes stale lock', () => {
      // Create lock with old timestamp (>2h per WU-1949)
      const locksDir = getLocksDir(testDir);
      mkdirSync(locksDir, { recursive: true });
      const lockPath = getLockFilePath('Operations: Tooling', testDir);

      // 3 hours ago - stale with 2h threshold
      const oldDate = new Date(Date.now() - 3 * 60 * 60 * 1000);
      const staleMetadata = {
        wuId: 'WU-OLD',
        timestamp: oldDate.toISOString(),
        pid: 12345,
        lane: 'Operations: Tooling',
      };
      writeFileSync(lockPath, JSON.stringify(staleMetadata));

      const result = forceRemoveStaleLock('Operations: Tooling', { baseDir: testDir });

      expect(result.released).toBe(true);
      assert.ok(!existsSync(lockPath), 'Stale lock should be removed');
    });

    it('refuses to remove non-stale lock', () => {
      acquireLaneLock('Operations: Tooling', 'WU-100', { baseDir: testDir });

      const result = forceRemoveStaleLock('Operations: Tooling', { baseDir: testDir });

      expect(result.released).toBe(false);
      expect(result.error.includes('not stale')).toBe(true);

      // Lock should still exist
      const lockPath = getLockFilePath('Operations: Tooling', testDir);
      assert.ok(existsSync(lockPath), 'Non-stale lock should not be removed');
    });

    it('returns notFound=true when no lock exists', () => {
      const result = forceRemoveStaleLock('NonExistent: Lane', { baseDir: testDir });

      expect(result.released).toBe(true);
      expect(result.notFound).toBe(true);
    });
  });

  describe('readLockMetadata', () => {
    it('returns null for non-existent file', () => {
      const result = readLockMetadata('/nonexistent/path/file.lock');
      expect(result).toBe(null);
    });

    it('returns null for invalid JSON', () => {
      const locksDir = getLocksDir(testDir);
      mkdirSync(locksDir, { recursive: true });
      const lockPath = path.join(locksDir, 'invalid.lock');
      writeFileSync(lockPath, 'not valid json');

      const result = readLockMetadata(lockPath);
      expect(result).toBe(null);
    });

    it('returns parsed metadata for valid lock file', () => {
      const locksDir = getLocksDir(testDir);
      mkdirSync(locksDir, { recursive: true });
      const lockPath = path.join(locksDir, 'valid.lock');
      const metadata = { wuId: 'WU-100', timestamp: new Date().toISOString() };
      writeFileSync(lockPath, JSON.stringify(metadata));

      const result = readLockMetadata(lockPath);
      expect(result.wuId).toBe('WU-100');
    });
  });

  describe('race condition prevention', () => {
    it('second lock attempt fails when first succeeds', () => {
      // Simulate race: both agents call acquireLaneLock
      // Only one should succeed due to atomic 'wx' flag

      const result1 = acquireLaneLock('Operations: Tooling', 'WU-AGENT-1', { baseDir: testDir });
      const result2 = acquireLaneLock('Operations: Tooling', 'WU-AGENT-2', { baseDir: testDir });

      // Exactly one should succeed
      const successCount = [result1.acquired, result2.acquired].filter(Boolean).length;
      expect(successCount).toBe(1, 'Exactly one agent should acquire the lock');

      // The one that failed should report the winner
      const failed = result1.acquired ? result2 : result1;
      const winner = result1.acquired ? result1 : result2;

      expect(failed.acquired).toBe(false);
      expect(failed.existingLock).toBeTruthy();
      expect(failed.existingLock.wuId).toBe(winner.acquired ? 'WU-AGENT-1' : 'WU-AGENT-2');
    });
  });

  describe('lock file cleanup integration', () => {
    it('lock survives across multiple check operations', () => {
      acquireLaneLock('Operations: Tooling', 'WU-100', { baseDir: testDir });

      // Multiple checks should not affect the lock
      checkLaneLock('Operations: Tooling', { baseDir: testDir });
      checkLaneLock('Operations: Tooling', { baseDir: testDir });
      checkLaneLock('Operations: Tooling', { baseDir: testDir });

      const lockPath = getLockFilePath('Operations: Tooling', testDir);
      assert.ok(existsSync(lockPath), 'Lock should survive multiple checks');
    });

    it('released lock allows new acquisition', () => {
      acquireLaneLock('Operations: Tooling', 'WU-100', { baseDir: testDir });
      releaseLaneLock('Operations: Tooling', { baseDir: testDir });

      const result = acquireLaneLock('Operations: Tooling', 'WU-200', { baseDir: testDir });

      expect(result.acquired).toBe(true);
      expect(result.error).toBe(null);
    });
  });

  /**
   * WU-1603: Integration tests for wu-claim, wu-done, wu-block lane lock behavior
   *
   * These tests verify the expected integration points without requiring
   * full end-to-end execution of the CLI tools.
   */
  describe('WU lifecycle integration contracts (WU-1603)', () => {
    describe('wu-claim contract: acquires lock on claim', () => {
      it('should acquire lock with correct metadata format', () => {
        // Contract: wu-claim calls acquireLaneLock(lane, wuId)
        const result = acquireLaneLock('Operations: Tooling', 'WU-CLAIM-TEST', {
          baseDir: testDir,
          agentSession: null, // wu-claim passes null initially
        });

        expect(result.acquired).toBe(true);

        // Verify lock file contains expected metadata structure
        const lockPath = getLockFilePath('Operations: Tooling', testDir);
        const metadata = readLockMetadata(lockPath);

        expect(metadata.wuId).toBe('WU-CLAIM-TEST');
        expect(metadata.lane).toBe('Operations: Tooling');
        assert.ok(metadata.timestamp, 'Should have timestamp');
        assert.ok(metadata.pid, 'Should have pid');
      });

      it('should block second claim attempt on same lane', () => {
        // First claim succeeds
        acquireLaneLock('Operations: Tooling', 'WU-FIRST', { baseDir: testDir });

        // Second claim on same lane fails
        const result = acquireLaneLock('Operations: Tooling', 'WU-SECOND', { baseDir: testDir });

        expect(result.acquired).toBe(false);
        expect(result.error.includes('WU-FIRST')).toBe(true);
        expect(result.existingLock.wuId).toBe('WU-FIRST');
      });
    });

    describe('wu-done contract: releases lock on completion', () => {
      it('should release lock with wuId validation', () => {
        // Setup: simulate wu-claim acquired lock
        acquireLaneLock('Operations: Tooling', 'WU-DONE-TEST', { baseDir: testDir });

        // Contract: wu-done calls releaseLaneLock(lane, { wuId })
        const result = releaseLaneLock('Operations: Tooling', {
          baseDir: testDir,
          wuId: 'WU-DONE-TEST',
        });

        expect(result.released).toBe(true);
        expect(result.notFound).toBe(false);

        // Lock should be gone
        const lockPath = getLockFilePath('Operations: Tooling', testDir);
        assert.ok(!existsSync(lockPath), 'Lock should be removed after wu:done');
      });

      it('should handle missing lock gracefully (older WUs)', () => {
        // Contract: wu-done on older WU without lock should not fail
        const result = releaseLaneLock('Operations: Legacy Lane', {
          baseDir: testDir,
          wuId: 'WU-OLD',
        });

        expect(result.released).toBe(true);
        expect(result.notFound).toBe(true);
      });
    });

    describe('wu-block contract: releases lock when blocking', () => {
      it('should release lock with wuId validation', () => {
        // Setup: simulate wu-claim acquired lock
        acquireLaneLock('Intelligence: Prompts', 'WU-BLOCK-TEST', { baseDir: testDir });

        // Contract: wu-block calls releaseLaneLock(lane, { wuId })
        const result = releaseLaneLock('Intelligence: Prompts', {
          baseDir: testDir,
          wuId: 'WU-BLOCK-TEST',
        });

        expect(result.released).toBe(true);
        expect(result.notFound).toBe(false);

        // Lock should be gone - lane now free for another WU
        const lockPath = getLockFilePath('Intelligence: Prompts', testDir);
        assert.ok(!existsSync(lockPath), 'Lock should be removed after wu:block');
      });

      it('should allow new claim after block releases lock', () => {
        // Simulate full cycle: claim -> block -> new claim
        acquireLaneLock('Core Systems: API', 'WU-ORIGINAL', { baseDir: testDir });
        releaseLaneLock('Core Systems: API', { baseDir: testDir, wuId: 'WU-ORIGINAL' });

        // New WU can claim the lane
        const result = acquireLaneLock('Core Systems: API', 'WU-NEW', { baseDir: testDir });

        expect(result.acquired).toBe(true);
      });
    });

    describe('stale lock handling contract', () => {
      it('wu-claim should detect and remove stale locks (>2h per WU-1949)', () => {
        // Create stale lock (>2h old per WU-1949)
        const locksDir = getLocksDir(testDir);
        mkdirSync(locksDir, { recursive: true });
        const lockPath = getLockFilePath('Operations: Tooling', testDir);

        // 3 hours ago - stale with 2h threshold
        const oldDate = new Date(Date.now() - 3 * 60 * 60 * 1000);
        const staleMetadata = {
          wuId: 'WU-STALE',
          timestamp: oldDate.toISOString(),
          pid: 12345,
          lane: 'Operations: Tooling',
        };
        writeFileSync(lockPath, JSON.stringify(staleMetadata));

        // Contract: wu-claim checks isStale and calls forceRemoveStaleLock
        const lockStatus = checkLaneLock('Operations: Tooling', { baseDir: testDir });
        expect(lockStatus.locked).toBe(true);
        expect(lockStatus.isStale).toBe(true);

        // Force remove stale lock
        const removeResult = forceRemoveStaleLock('Operations: Tooling', { baseDir: testDir });
        expect(removeResult.released).toBe(true);

        // Now new claim should succeed
        const claimResult = acquireLaneLock('Operations: Tooling', 'WU-NEW-CLAIM', {
          baseDir: testDir,
        });
        expect(claimResult.acquired).toBe(true);
      });
    });
  });

  /**
   * WU-1808: Zombie lock detection and claim-failure lock release
   *
   * Tests for:
   * 1. isZombieLock - detects if PID in lock file is no longer running
   * 2. acquireLaneLock - auto-clears zombie locks even if recent
   * 3. auditedUnlock - dedicated command for operators to clear locks safely
   */
  describe('WU-1808: Zombie lock detection', () => {
    describe('isZombieLock', () => {
      it('returns false for lock held by current process', () => {
        const metadata = {
          wuId: 'WU-100',
          timestamp: new Date().toISOString(),
          pid: process.pid, // Current process - definitely running
          lane: 'Test',
        };

        expect(isZombieLock(metadata)).toBe(false);
      });

      it('returns true for lock held by non-existent process', () => {
        // PID 99999999 is extremely unlikely to exist
        const metadata = {
          wuId: 'WU-100',
          timestamp: new Date().toISOString(),
          pid: 99999999,
          lane: 'Test',
        };

        expect(isZombieLock(metadata)).toBe(true);
      });

      it('returns true for invalid metadata (missing pid)', () => {
        expect(isZombieLock(null)).toBe(true);
        expect(isZombieLock({})).toBe(true);
        expect(isZombieLock({ wuId: 'WU-100' })).toBe(true);
      });

      it('returns true for non-numeric pid', () => {
        const metadata = {
          wuId: 'WU-100',
          timestamp: new Date().toISOString(),
          pid: 'not-a-number',
          lane: 'Test',
        };

        expect(isZombieLock(metadata)).toBe(true);
      });
    });

    describe('acquireLaneLock auto-clears zombie locks', () => {
      it('acquires lock after auto-clearing zombie lock (recent)', () => {
        // Create a recent lock with non-existent PID (zombie)
        const locksDir = getLocksDir(testDir);
        mkdirSync(locksDir, { recursive: true });
        const lockPath = getLockFilePath('Operations: Tooling', testDir);

        const recentZombie = {
          wuId: 'WU-ZOMBIE',
          timestamp: new Date().toISOString(), // Recent (not stale)
          pid: 99999999, // Non-existent PID
          lane: 'Operations: Tooling',
        };
        writeFileSync(lockPath, JSON.stringify(recentZombie));

        // acquireLaneLock should detect zombie and auto-clear
        const result = acquireLaneLock('Operations: Tooling', 'WU-NEW', { baseDir: testDir });

        expect(result.acquired).toBe(true);
        expect(result.error).toBe(null);

        // Verify new lock metadata
        const newMetadata = readLockMetadata(lockPath);
        expect(newMetadata.wuId).toBe('WU-NEW');
        expect(newMetadata.pid).toBe(process.pid);
      });

      it('does not auto-clear lock held by running process', () => {
        // Create lock with current process PID (still running)
        acquireLaneLock('Operations: Tooling', 'WU-ACTIVE', { baseDir: testDir });

        // Attempt to acquire by different WU should fail
        const result = acquireLaneLock('Operations: Tooling', 'WU-NEW', { baseDir: testDir });

        expect(result.acquired).toBe(false);
        expect(result.error.includes('WU-ACTIVE')).toBe(true);
      });
    });
  });

  describe('WU-1808: auditedUnlock command', () => {
    it('unlocks zombie lock without --force', () => {
      // Create zombie lock
      const locksDir = getLocksDir(testDir);
      mkdirSync(locksDir, { recursive: true });
      const lockPath = getLockFilePath('Operations: Tooling', testDir);

      const zombieLock = {
        wuId: 'WU-ZOMBIE',
        timestamp: new Date().toISOString(),
        pid: 99999999, // Non-existent
        lane: 'Operations: Tooling',
      };
      writeFileSync(lockPath, JSON.stringify(zombieLock));

      const result = auditedUnlock('Operations: Tooling', {
        baseDir: testDir,
        reason: 'Process crashed',
      });

      expect(result.released).toBe(true);
      expect(result.reason).toBe('Process crashed');
      expect(!existsSync(lockPath)).toBeTruthy();
    });

    it('unlocks stale lock without --force', () => {
      // Create stale lock (>2h old per WU-1949)
      const locksDir = getLocksDir(testDir);
      mkdirSync(locksDir, { recursive: true });
      const lockPath = getLockFilePath('Operations: Tooling', testDir);

      // 3 hours ago - stale with 2h threshold
      const oldDate = new Date(Date.now() - 3 * 60 * 60 * 1000);
      const staleLock = {
        wuId: 'WU-STALE',
        timestamp: oldDate.toISOString(),
        pid: process.pid, // Even our own PID, but stale
        lane: 'Operations: Tooling',
      };
      writeFileSync(lockPath, JSON.stringify(staleLock));

      const result = auditedUnlock('Operations: Tooling', {
        baseDir: testDir,
        reason: 'Agent abandoned',
      });

      expect(result.released).toBe(true);
      expect(!existsSync(lockPath)).toBeTruthy();
    });

    it('refuses to unlock active lock without --force', () => {
      // Create lock with current process PID (active)
      acquireLaneLock('Operations: Tooling', 'WU-ACTIVE', { baseDir: testDir });

      const result = auditedUnlock('Operations: Tooling', {
        baseDir: testDir,
        reason: 'Testing',
      });

      expect(result.released).toBe(false);
      expect(result.error.includes('active')).toBe(true);
      expect(result.error.includes('--force')).toBe(true);

      // Lock should still exist
      const lockPath = getLockFilePath('Operations: Tooling', testDir);
      expect(existsSync(lockPath)).toBeTruthy();
    });

    it('unlocks active lock with --force', () => {
      // Create lock with current process PID (active)
      acquireLaneLock('Operations: Tooling', 'WU-ACTIVE', { baseDir: testDir });

      const result = auditedUnlock('Operations: Tooling', {
        baseDir: testDir,
        reason: 'Emergency override',
        force: true,
      });

      expect(result.released).toBe(true);
      expect(result.forced).toBe(true);
      expect(result.reason).toBe('Emergency override');

      // Lock should be gone
      const lockPath = getLockFilePath('Operations: Tooling', testDir);
      expect(!existsSync(lockPath)).toBeTruthy();
    });

    it('requires reason parameter', () => {
      // Create zombie lock
      const locksDir = getLocksDir(testDir);
      mkdirSync(locksDir, { recursive: true });
      const lockPath = getLockFilePath('Operations: Tooling', testDir);

      const zombieLock = {
        wuId: 'WU-ZOMBIE',
        timestamp: new Date().toISOString(),
        pid: 99999999,
        lane: 'Operations: Tooling',
      };
      writeFileSync(lockPath, JSON.stringify(zombieLock));

      const result = auditedUnlock('Operations: Tooling', {
        baseDir: testDir,
        // No reason provided
      });

      expect(result.released).toBe(false);
      expect(result.error.includes('reason')).toBe(true);
    });

    it('handles non-existent lock gracefully', () => {
      const result = auditedUnlock('NonExistent: Lane', {
        baseDir: testDir,
        reason: 'Cleanup attempt',
      });

      expect(result.released).toBe(true);
      expect(result.notFound).toBe(true);
    });
  });
});
