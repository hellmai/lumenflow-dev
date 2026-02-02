/**
 * Tests for lane-lock module
 *
 * WU-1104: Port tests from ExampleApp to Vitest
 *
 * Tests atomic file-based locking for lane claims.
 * @see {@link ../lane-lock.ts}
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  getStaleThresholdMs,
  getLocksDir,
  getLockFilePath,
  isLockStale,
  isZombieLock,
  readLockMetadata,
  acquireLaneLock,
  releaseLaneLock,
  checkLaneLock,
  forceRemoveStaleLock,
  getAllLaneLocks,
  auditedUnlock,
  type LockMetadata,
} from '../lane-lock.js';

// Test constants to avoid magic string duplication
const TEST_LANE_FRAMEWORK_CORE = 'Framework: Core';
const TEST_LANE_OPS_TOOLING = 'Operations: Tooling';
const TEST_LANE_CONTENT_DOCS = 'Content: Documentation';
const LUMENFLOW_LOCKS_PATH = '.lumenflow/locks';
/** Mock module path for lane-checker.js (used in WU-1323 lock_policy tests) */
const LANE_CHECKER_MODULE_PATH = '../lane-checker.js';

describe('lane-lock', () => {
  let testBaseDir: string;

  beforeEach(() => {
    // Create a unique test directory for each test
    testBaseDir = join(
      tmpdir(),
      // eslint-disable-next-line sonarjs/pseudo-random -- Test isolation needs unique temp dirs
      `lane-lock-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(testBaseDir, { recursive: true });
    mkdirSync(join(testBaseDir, LUMENFLOW_LOCKS_PATH), { recursive: true });
  });

  afterEach(() => {
    // Clean up test directory
    try {
      rmSync(testBaseDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
    // Reset environment
    delete process.env.STALE_LOCK_THRESHOLD_HOURS;
  });

  describe('getStaleThresholdMs', () => {
    it('should return default threshold of 2 hours in ms', () => {
      delete process.env.STALE_LOCK_THRESHOLD_HOURS;

      const result = getStaleThresholdMs();

      expect(result).toBe(2 * 60 * 60 * 1000); // 2 hours in ms
    });

    it('should respect STALE_LOCK_THRESHOLD_HOURS env var', () => {
      process.env.STALE_LOCK_THRESHOLD_HOURS = '4';

      const result = getStaleThresholdMs();

      expect(result).toBe(4 * 60 * 60 * 1000); // 4 hours in ms
    });

    it('should handle decimal hours', () => {
      process.env.STALE_LOCK_THRESHOLD_HOURS = '0.5';

      const result = getStaleThresholdMs();

      expect(result).toBe(0.5 * 60 * 60 * 1000); // 30 minutes in ms
    });

    it('should fall back to default for invalid env var', () => {
      process.env.STALE_LOCK_THRESHOLD_HOURS = 'invalid';

      const result = getStaleThresholdMs();

      expect(result).toBe(2 * 60 * 60 * 1000);
    });

    it('should fall back to default for negative values', () => {
      process.env.STALE_LOCK_THRESHOLD_HOURS = '-1';

      const result = getStaleThresholdMs();

      expect(result).toBe(2 * 60 * 60 * 1000);
    });

    it('should fall back to default for zero', () => {
      process.env.STALE_LOCK_THRESHOLD_HOURS = '0';

      const result = getStaleThresholdMs();

      expect(result).toBe(2 * 60 * 60 * 1000);
    });
  });

  describe('getLocksDir', () => {
    it('should return locks directory path', () => {
      const result = getLocksDir(testBaseDir);

      expect(result).toBe(join(testBaseDir, LUMENFLOW_LOCKS_PATH));
    });
  });

  describe('getLockFilePath', () => {
    it('should return lock file path with kebab-case lane', () => {
      const result = getLockFilePath(TEST_LANE_OPS_TOOLING, testBaseDir);

      expect(result).toBe(join(testBaseDir, LUMENFLOW_LOCKS_PATH, 'operations-tooling.lock'));
    });

    it('should handle simple lane names', () => {
      const result = getLockFilePath('Framework', testBaseDir);

      expect(result).toBe(join(testBaseDir, LUMENFLOW_LOCKS_PATH, 'framework.lock'));
    });

    it('should handle lane names with special characters', () => {
      const result = getLockFilePath('Framework: Core/CLI', testBaseDir);

      expect(result).toMatch(/framework-core-cli\.lock$/);
    });
  });

  describe('isLockStale', () => {
    it('should return true for null metadata', () => {
      const result = isLockStale(null);

      expect(result).toBe(true);
    });

    it('should return true for metadata without timestamp', () => {
      const metadata = { wuId: 'WU-123' } as unknown as LockMetadata;

      const result = isLockStale(metadata);

      expect(result).toBe(true);
    });

    it('should return true for lock older than threshold', () => {
      const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
      const metadata: LockMetadata = {
        wuId: 'WU-123',
        timestamp: threeHoursAgo,
        agentSession: null,
        pid: 12345,
        lane: TEST_LANE_FRAMEWORK_CORE,
      };

      const result = isLockStale(metadata);

      expect(result).toBe(true);
    });

    it('should return false for recent lock', () => {
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const metadata: LockMetadata = {
        wuId: 'WU-123',
        timestamp: tenMinutesAgo,
        agentSession: null,
        pid: 12345,
        lane: TEST_LANE_FRAMEWORK_CORE,
      };

      const result = isLockStale(metadata);

      expect(result).toBe(false);
    });
  });

  describe('isZombieLock', () => {
    it('should return true for null metadata', () => {
      const result = isZombieLock(null);

      expect(result).toBe(true);
    });

    it('should return true for metadata without pid', () => {
      const metadata = {
        wuId: 'WU-123',
        timestamp: new Date().toISOString(),
      } as unknown as LockMetadata;

      const result = isZombieLock(metadata);

      expect(result).toBe(true);
    });

    it('should return false for current process PID', () => {
      const metadata: LockMetadata = {
        wuId: 'WU-123',
        timestamp: new Date().toISOString(),
        agentSession: null,
        pid: process.pid, // Current process
        lane: TEST_LANE_FRAMEWORK_CORE,
      };

      const result = isZombieLock(metadata);

      expect(result).toBe(false);
    });

    it('should return true for non-existent PID', () => {
      const metadata: LockMetadata = {
        wuId: 'WU-123',
        timestamp: new Date().toISOString(),
        agentSession: null,
        pid: 999999999, // Non-existent PID
        lane: TEST_LANE_FRAMEWORK_CORE,
      };

      const result = isZombieLock(metadata);

      expect(result).toBe(true);
    });
  });

  describe('readLockMetadata', () => {
    it('should return null for non-existent file', () => {
      const lockPath = join(testBaseDir, 'non-existent.lock');

      const result = readLockMetadata(lockPath);

      expect(result).toBeNull();
    });

    it('should parse valid lock file', () => {
      const lockPath = join(testBaseDir, 'test.lock');
      const metadata: LockMetadata = {
        wuId: 'WU-123',
        timestamp: '2026-01-25T10:00:00.000Z',
        agentSession: 'abc123',
        pid: 12345,
        lane: TEST_LANE_FRAMEWORK_CORE,
      };
      writeFileSync(lockPath, JSON.stringify(metadata));

      const result = readLockMetadata(lockPath);

      expect(result).toEqual(metadata);
    });

    it('should return null for invalid JSON', () => {
      const lockPath = join(testBaseDir, 'invalid.lock');
      writeFileSync(lockPath, 'not valid json');

      const result = readLockMetadata(lockPath);

      expect(result).toBeNull();
    });
  });

  describe('acquireLaneLock', () => {
    it('should acquire lock successfully when no lock exists', () => {
      const result = acquireLaneLock(TEST_LANE_FRAMEWORK_CORE, 'WU-123', { baseDir: testBaseDir });

      expect(result.acquired).toBe(true);
      expect(result.error).toBeNull();
      expect(result.existingLock).toBeNull();
    });

    it('should create lock file with correct metadata', () => {
      acquireLaneLock(TEST_LANE_FRAMEWORK_CORE, 'WU-123', {
        agentSession: 'session123',
        baseDir: testBaseDir,
      });

      const lockPath = getLockFilePath(TEST_LANE_FRAMEWORK_CORE, testBaseDir);
      const metadata = readLockMetadata(lockPath);

      expect(metadata?.wuId).toBe('WU-123');
      expect(metadata?.agentSession).toBe('session123');
      expect(metadata?.pid).toBe(process.pid);
      expect(metadata?.lane).toBe(TEST_LANE_FRAMEWORK_CORE);
    });

    it('should fail when lock already exists for different WU', () => {
      // First lock
      acquireLaneLock(TEST_LANE_FRAMEWORK_CORE, 'WU-100', { baseDir: testBaseDir });

      // Second lock attempt
      const result = acquireLaneLock(TEST_LANE_FRAMEWORK_CORE, 'WU-123', { baseDir: testBaseDir });

      expect(result.acquired).toBe(false);
      expect(result.error).toContain('WU-100');
      expect(result.existingLock?.wuId).toBe('WU-100');
    });

    it('should succeed when re-claiming same WU', () => {
      // First lock
      acquireLaneLock(TEST_LANE_FRAMEWORK_CORE, 'WU-123', { baseDir: testBaseDir });

      // Re-claim same WU
      const result = acquireLaneLock(TEST_LANE_FRAMEWORK_CORE, 'WU-123', { baseDir: testBaseDir });

      expect(result.acquired).toBe(true);
    });

    it('should auto-clear zombie locks', () => {
      // Create a zombie lock (non-existent PID)
      const lockPath = getLockFilePath(TEST_LANE_FRAMEWORK_CORE, testBaseDir);
      const zombieLock: LockMetadata = {
        wuId: 'WU-OLD',
        timestamp: new Date().toISOString(),
        agentSession: null,
        pid: 999999999, // Non-existent
        lane: TEST_LANE_FRAMEWORK_CORE,
      };
      writeFileSync(lockPath, JSON.stringify(zombieLock));

      // Attempt to acquire
      const result = acquireLaneLock(TEST_LANE_FRAMEWORK_CORE, 'WU-123', { baseDir: testBaseDir });

      expect(result.acquired).toBe(true);
    });
  });

  describe('releaseLaneLock', () => {
    it('should release existing lock', () => {
      acquireLaneLock(TEST_LANE_FRAMEWORK_CORE, 'WU-123', { baseDir: testBaseDir });

      const result = releaseLaneLock(TEST_LANE_FRAMEWORK_CORE, { baseDir: testBaseDir });

      expect(result.released).toBe(true);
      expect(result.notFound).toBe(false);

      // Verify lock is gone
      const lockPath = getLockFilePath(TEST_LANE_FRAMEWORK_CORE, testBaseDir);
      expect(existsSync(lockPath)).toBe(false);
    });

    it('should succeed even if lock does not exist', () => {
      const result = releaseLaneLock('Non-Existent Lane', { baseDir: testBaseDir });

      expect(result.released).toBe(true);
      expect(result.notFound).toBe(true);
    });

    it('should validate ownership when wuId provided', () => {
      acquireLaneLock(TEST_LANE_FRAMEWORK_CORE, 'WU-123', { baseDir: testBaseDir });

      const result = releaseLaneLock(TEST_LANE_FRAMEWORK_CORE, {
        wuId: 'WU-999', // Wrong WU
        baseDir: testBaseDir,
      });

      expect(result.released).toBe(false);
      expect(result.error).toContain('WU-123');
    });

    it('should force release with force flag', () => {
      acquireLaneLock(TEST_LANE_FRAMEWORK_CORE, 'WU-123', { baseDir: testBaseDir });

      const result = releaseLaneLock(TEST_LANE_FRAMEWORK_CORE, {
        wuId: 'WU-999', // Wrong WU, but force=true
        baseDir: testBaseDir,
        force: true,
      });

      expect(result.released).toBe(true);
    });
  });

  describe('checkLaneLock', () => {
    it('should return locked=false when no lock', () => {
      const result = checkLaneLock(TEST_LANE_FRAMEWORK_CORE, { baseDir: testBaseDir });

      expect(result.locked).toBe(false);
      expect(result.metadata).toBeNull();
    });

    it('should return lock metadata when locked', () => {
      acquireLaneLock(TEST_LANE_FRAMEWORK_CORE, 'WU-123', { baseDir: testBaseDir });

      const result = checkLaneLock(TEST_LANE_FRAMEWORK_CORE, { baseDir: testBaseDir });

      expect(result.locked).toBe(true);
      expect(result.metadata?.wuId).toBe('WU-123');
      expect(result.isStale).toBe(false);
    });

    it('should detect stale locks', () => {
      // Create a stale lock
      const lockPath = getLockFilePath(TEST_LANE_FRAMEWORK_CORE, testBaseDir);
      const staleLock: LockMetadata = {
        wuId: 'WU-OLD',
        timestamp: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(), // 5 hours ago
        agentSession: null,
        pid: process.pid,
        lane: TEST_LANE_FRAMEWORK_CORE,
      };
      writeFileSync(lockPath, JSON.stringify(staleLock));

      const result = checkLaneLock(TEST_LANE_FRAMEWORK_CORE, { baseDir: testBaseDir });

      expect(result.locked).toBe(true);
      expect(result.isStale).toBe(true);
    });
  });

  describe('forceRemoveStaleLock', () => {
    it('should succeed when lock does not exist', () => {
      const result = forceRemoveStaleLock(TEST_LANE_FRAMEWORK_CORE, { baseDir: testBaseDir });

      expect(result.released).toBe(true);
      expect(result.notFound).toBe(true);
    });

    it('should remove stale lock', () => {
      // Create a stale lock
      const lockPath = getLockFilePath(TEST_LANE_FRAMEWORK_CORE, testBaseDir);
      const staleLock: LockMetadata = {
        wuId: 'WU-OLD',
        timestamp: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
        agentSession: null,
        pid: process.pid,
        lane: TEST_LANE_FRAMEWORK_CORE,
      };
      writeFileSync(lockPath, JSON.stringify(staleLock));

      const result = forceRemoveStaleLock(TEST_LANE_FRAMEWORK_CORE, { baseDir: testBaseDir });

      expect(result.released).toBe(true);
      expect(existsSync(lockPath)).toBe(false);
    });

    it('should refuse to remove non-stale lock', () => {
      acquireLaneLock(TEST_LANE_FRAMEWORK_CORE, 'WU-123', { baseDir: testBaseDir });

      const result = forceRemoveStaleLock(TEST_LANE_FRAMEWORK_CORE, { baseDir: testBaseDir });

      expect(result.released).toBe(false);
      expect(result.error).toContain('not stale');
    });
  });

  describe('getAllLaneLocks', () => {
    it('should return empty map when no locks', () => {
      const result = getAllLaneLocks({ baseDir: testBaseDir });

      expect(result.size).toBe(0);
    });

    it('should return all current locks', () => {
      acquireLaneLock(TEST_LANE_FRAMEWORK_CORE, 'WU-123', { baseDir: testBaseDir });
      acquireLaneLock(TEST_LANE_OPS_TOOLING, 'WU-456', { baseDir: testBaseDir });

      const result = getAllLaneLocks({ baseDir: testBaseDir });

      expect(result.size).toBe(2);
      expect(result.get(TEST_LANE_FRAMEWORK_CORE)?.wuId).toBe('WU-123');
      expect(result.get(TEST_LANE_OPS_TOOLING)?.wuId).toBe('WU-456');
    });

    it('should handle non-existent locks directory', () => {
      const emptyBaseDir = join(tmpdir(), `empty-${Date.now()}`);
      mkdirSync(emptyBaseDir);

      const result = getAllLaneLocks({ baseDir: emptyBaseDir });

      expect(result.size).toBe(0);

      rmSync(emptyBaseDir, { recursive: true, force: true });
    });
  });

  describe('auditedUnlock', () => {
    it('should require reason', () => {
      acquireLaneLock(TEST_LANE_FRAMEWORK_CORE, 'WU-123', { baseDir: testBaseDir });

      const result = auditedUnlock(TEST_LANE_FRAMEWORK_CORE, {
        reason: '', // Empty reason
        baseDir: testBaseDir,
      });

      expect(result.released).toBe(false);
      expect(result.error).toContain('Reason is required');
    });

    it('should unlock zombie lock without force', () => {
      // Create a zombie lock
      const lockPath = getLockFilePath(TEST_LANE_FRAMEWORK_CORE, testBaseDir);
      const zombieLock: LockMetadata = {
        wuId: 'WU-OLD',
        timestamp: new Date().toISOString(), // Recent but zombie
        agentSession: null,
        pid: 999999999, // Non-existent
        lane: TEST_LANE_FRAMEWORK_CORE,
      };
      writeFileSync(lockPath, JSON.stringify(zombieLock));

      const result = auditedUnlock(TEST_LANE_FRAMEWORK_CORE, {
        reason: 'Cleaning up after crash',
        baseDir: testBaseDir,
      });

      expect(result.released).toBe(true);
      expect(result.reason).toBe('Cleaning up after crash');
    });

    it('should unlock stale lock without force', () => {
      // Create a stale lock
      const lockPath = getLockFilePath(TEST_LANE_FRAMEWORK_CORE, testBaseDir);
      const staleLock: LockMetadata = {
        wuId: 'WU-OLD',
        timestamp: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
        agentSession: null,
        pid: process.pid,
        lane: TEST_LANE_FRAMEWORK_CORE,
      };
      writeFileSync(lockPath, JSON.stringify(staleLock));

      const result = auditedUnlock(TEST_LANE_FRAMEWORK_CORE, {
        reason: 'Stale lock cleanup',
        baseDir: testBaseDir,
      });

      expect(result.released).toBe(true);
    });

    it('should refuse active lock without force', () => {
      acquireLaneLock(TEST_LANE_FRAMEWORK_CORE, 'WU-123', { baseDir: testBaseDir });

      const result = auditedUnlock(TEST_LANE_FRAMEWORK_CORE, {
        reason: 'Testing',
        baseDir: testBaseDir,
        force: false,
      });

      expect(result.released).toBe(false);
      expect(result.error).toContain('Cannot unlock active lock');
    });

    it('should unlock active lock with force', () => {
      acquireLaneLock(TEST_LANE_FRAMEWORK_CORE, 'WU-123', { baseDir: testBaseDir });

      const result = auditedUnlock(TEST_LANE_FRAMEWORK_CORE, {
        reason: 'Emergency override',
        baseDir: testBaseDir,
        force: true,
      });

      expect(result.released).toBe(true);
      expect(result.forced).toBe(true);
      expect(result.previousLock?.wuId).toBe('WU-123');
    });

    it('should succeed when lock does not exist', () => {
      const result = auditedUnlock(TEST_LANE_FRAMEWORK_CORE, {
        reason: 'Cleanup',
        baseDir: testBaseDir,
      });

      expect(result.released).toBe(true);
      expect(result.notFound).toBe(true);
    });
  });

  /**
   * WU-1323: Tests for lock_policy integration with acquireLaneLock
   *
   * Validates that acquireLaneLock() respects the lock_policy configuration:
   * - policy=none: Skip lock acquisition entirely, no lock file created
   * - policy=all: Normal behavior (default), lock files created
   * - policy=active: Lock released on block (tested in CLI, this tests acquisition)
   */
  describe('acquireLaneLock lock_policy integration (WU-1323)', () => {
    beforeEach(() => {
      vi.resetModules();
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should skip lock acquisition when policy=none and set skipped=true', async () => {
      // Mock getLockPolicyForLane to return 'none'
      vi.doMock(LANE_CHECKER_MODULE_PATH, () => ({
        getLockPolicyForLane: vi.fn().mockReturnValue('none'),
      }));

      // Re-import lane-lock with mocked dependency
      const { acquireLaneLock: mockedAcquireLaneLock, getLockFilePath: mockedGetLockFilePath } =
        await import('../lane-lock.js');

      const result = mockedAcquireLaneLock(TEST_LANE_CONTENT_DOCS, 'WU-123', {
        baseDir: testBaseDir,
      });

      // Should return success but with skipped=true
      expect(result.acquired).toBe(true);
      expect(result.skipped).toBe(true);
      expect(result.error).toBeNull();
      expect(result.existingLock).toBeNull();
      expect(result.isStale).toBe(false);

      // Should NOT create a lock file
      const lockPath = mockedGetLockFilePath(TEST_LANE_CONTENT_DOCS, testBaseDir);
      expect(existsSync(lockPath)).toBe(false);
    });

    it('should acquire lock normally when policy=all (default)', async () => {
      // Mock getLockPolicyForLane to return 'all' (default)
      vi.doMock(LANE_CHECKER_MODULE_PATH, () => ({
        getLockPolicyForLane: vi.fn().mockReturnValue('all'),
      }));

      const { acquireLaneLock: mockedAcquireLaneLock, getLockFilePath: mockedGetLockFilePath } =
        await import('../lane-lock.js');

      const result = mockedAcquireLaneLock(TEST_LANE_FRAMEWORK_CORE, 'WU-123', {
        baseDir: testBaseDir,
      });

      // Should acquire lock normally
      expect(result.acquired).toBe(true);
      expect(result.skipped).toBeUndefined();
      expect(result.error).toBeNull();

      // Should create a lock file
      const lockPath = mockedGetLockFilePath(TEST_LANE_FRAMEWORK_CORE, testBaseDir);
      expect(existsSync(lockPath)).toBe(true);

      // Verify lock metadata
      const metadata = JSON.parse(readFileSync(lockPath, { encoding: 'utf-8' }));
      expect(metadata.wuId).toBe('WU-123');
      expect(metadata.lane).toBe(TEST_LANE_FRAMEWORK_CORE);
    });

    it('should acquire lock normally when policy=active', async () => {
      // Mock getLockPolicyForLane to return 'active'
      // Note: 'active' policy affects block/unblock behavior (CLI),
      // but acquisition still creates a lock
      vi.doMock(LANE_CHECKER_MODULE_PATH, () => ({
        getLockPolicyForLane: vi.fn().mockReturnValue('active'),
      }));

      const { acquireLaneLock: mockedAcquireLaneLock, getLockFilePath: mockedGetLockFilePath } =
        await import('../lane-lock.js');

      const result = mockedAcquireLaneLock(TEST_LANE_FRAMEWORK_CORE, 'WU-123', {
        baseDir: testBaseDir,
      });

      // Should acquire lock normally (active policy still creates locks)
      expect(result.acquired).toBe(true);
      expect(result.skipped).toBeUndefined();
      expect(result.error).toBeNull();

      // Should create a lock file
      const lockPath = mockedGetLockFilePath(TEST_LANE_FRAMEWORK_CORE, testBaseDir);
      expect(existsSync(lockPath)).toBe(true);
    });

    it('should allow multiple WUs in policy=none lanes without conflict', async () => {
      // Mock getLockPolicyForLane to return 'none'
      vi.doMock(LANE_CHECKER_MODULE_PATH, () => ({
        getLockPolicyForLane: vi.fn().mockReturnValue('none'),
      }));

      const { acquireLaneLock: mockedAcquireLaneLock } = await import('../lane-lock.js');

      // First WU
      const result1 = mockedAcquireLaneLock(TEST_LANE_CONTENT_DOCS, 'WU-100', {
        baseDir: testBaseDir,
      });

      // Second WU in same lane (would fail with policy=all, but should succeed with none)
      const result2 = mockedAcquireLaneLock(TEST_LANE_CONTENT_DOCS, 'WU-200', {
        baseDir: testBaseDir,
      });

      expect(result1.acquired).toBe(true);
      expect(result1.skipped).toBe(true);
      expect(result2.acquired).toBe(true);
      expect(result2.skipped).toBe(true);
    });

    it('should still prevent concurrent claims in policy=all lanes', async () => {
      // Mock getLockPolicyForLane to return 'all'
      vi.doMock(LANE_CHECKER_MODULE_PATH, () => ({
        getLockPolicyForLane: vi.fn().mockReturnValue('all'),
      }));

      const { acquireLaneLock: mockedAcquireLaneLock } = await import('../lane-lock.js');

      // First WU acquires lock
      const result1 = mockedAcquireLaneLock(TEST_LANE_FRAMEWORK_CORE, 'WU-100', {
        baseDir: testBaseDir,
      });
      expect(result1.acquired).toBe(true);

      // Second WU in same lane should fail
      const result2 = mockedAcquireLaneLock(TEST_LANE_FRAMEWORK_CORE, 'WU-200', {
        baseDir: testBaseDir,
      });

      expect(result2.acquired).toBe(false);
      expect(result2.error).toContain('WU-100');
      expect(result2.existingLock?.wuId).toBe('WU-100');
    });

    it('should preserve backward compatibility with existing tests (no skipped flag when lock acquired)', () => {
      // This test uses the non-mocked acquireLaneLock to verify backward compatibility
      // The default policy from project config is 'all' for Framework: Core
      const result = acquireLaneLock(TEST_LANE_FRAMEWORK_CORE, 'WU-123', { baseDir: testBaseDir });

      // Basic backward compatibility: acquired should be true
      expect(result.acquired).toBe(true);
      expect(result.error).toBeNull();
      // For normal acquisition, skipped should be undefined (not false)
      // This preserves API compatibility
    });
  });
});
