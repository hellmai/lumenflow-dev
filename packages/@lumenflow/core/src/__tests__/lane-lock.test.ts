/**
 * Tests for lane-lock module
 *
 * WU-1104: Port tests from ExampleApp to Vitest
 *
 * Tests atomic file-based locking for lane claims.
 * @see {@link ../lane-lock.ts}
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync, unlinkSync } from 'node:fs';
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

describe('lane-lock', () => {
  let testBaseDir: string;

  beforeEach(() => {
    // Create a unique test directory for each test
    testBaseDir = join(
      tmpdir(),
      `lane-lock-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(testBaseDir, { recursive: true });
    mkdirSync(join(testBaseDir, '.lumenflow', 'locks'), { recursive: true });
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

      expect(result).toBe(join(testBaseDir, '.lumenflow', 'locks'));
    });
  });

  describe('getLockFilePath', () => {
    it('should return lock file path with kebab-case lane', () => {
      const result = getLockFilePath('Operations: Tooling', testBaseDir);

      expect(result).toBe(join(testBaseDir, '.lumenflow', 'locks', 'operations-tooling.lock'));
    });

    it('should handle simple lane names', () => {
      const result = getLockFilePath('Framework', testBaseDir);

      expect(result).toBe(join(testBaseDir, '.lumenflow', 'locks', 'framework.lock'));
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
        lane: 'Framework: Core',
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
        lane: 'Framework: Core',
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
        lane: 'Framework: Core',
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
        lane: 'Framework: Core',
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
        lane: 'Framework: Core',
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
      const result = acquireLaneLock('Framework: Core', 'WU-123', { baseDir: testBaseDir });

      expect(result.acquired).toBe(true);
      expect(result.error).toBeNull();
      expect(result.existingLock).toBeNull();
    });

    it('should create lock file with correct metadata', () => {
      acquireLaneLock('Framework: Core', 'WU-123', {
        agentSession: 'session123',
        baseDir: testBaseDir,
      });

      const lockPath = getLockFilePath('Framework: Core', testBaseDir);
      const metadata = readLockMetadata(lockPath);

      expect(metadata?.wuId).toBe('WU-123');
      expect(metadata?.agentSession).toBe('session123');
      expect(metadata?.pid).toBe(process.pid);
      expect(metadata?.lane).toBe('Framework: Core');
    });

    it('should fail when lock already exists for different WU', () => {
      // First lock
      acquireLaneLock('Framework: Core', 'WU-100', { baseDir: testBaseDir });

      // Second lock attempt
      const result = acquireLaneLock('Framework: Core', 'WU-123', { baseDir: testBaseDir });

      expect(result.acquired).toBe(false);
      expect(result.error).toContain('WU-100');
      expect(result.existingLock?.wuId).toBe('WU-100');
    });

    it('should succeed when re-claiming same WU', () => {
      // First lock
      acquireLaneLock('Framework: Core', 'WU-123', { baseDir: testBaseDir });

      // Re-claim same WU
      const result = acquireLaneLock('Framework: Core', 'WU-123', { baseDir: testBaseDir });

      expect(result.acquired).toBe(true);
    });

    it('should auto-clear zombie locks', () => {
      // Create a zombie lock (non-existent PID)
      const lockPath = getLockFilePath('Framework: Core', testBaseDir);
      const zombieLock: LockMetadata = {
        wuId: 'WU-OLD',
        timestamp: new Date().toISOString(),
        agentSession: null,
        pid: 999999999, // Non-existent
        lane: 'Framework: Core',
      };
      writeFileSync(lockPath, JSON.stringify(zombieLock));

      // Attempt to acquire
      const result = acquireLaneLock('Framework: Core', 'WU-123', { baseDir: testBaseDir });

      expect(result.acquired).toBe(true);
    });
  });

  describe('releaseLaneLock', () => {
    it('should release existing lock', () => {
      acquireLaneLock('Framework: Core', 'WU-123', { baseDir: testBaseDir });

      const result = releaseLaneLock('Framework: Core', { baseDir: testBaseDir });

      expect(result.released).toBe(true);
      expect(result.notFound).toBe(false);

      // Verify lock is gone
      const lockPath = getLockFilePath('Framework: Core', testBaseDir);
      expect(existsSync(lockPath)).toBe(false);
    });

    it('should succeed even if lock does not exist', () => {
      const result = releaseLaneLock('Non-Existent Lane', { baseDir: testBaseDir });

      expect(result.released).toBe(true);
      expect(result.notFound).toBe(true);
    });

    it('should validate ownership when wuId provided', () => {
      acquireLaneLock('Framework: Core', 'WU-123', { baseDir: testBaseDir });

      const result = releaseLaneLock('Framework: Core', {
        wuId: 'WU-999', // Wrong WU
        baseDir: testBaseDir,
      });

      expect(result.released).toBe(false);
      expect(result.error).toContain('WU-123');
    });

    it('should force release with force flag', () => {
      acquireLaneLock('Framework: Core', 'WU-123', { baseDir: testBaseDir });

      const result = releaseLaneLock('Framework: Core', {
        wuId: 'WU-999', // Wrong WU, but force=true
        baseDir: testBaseDir,
        force: true,
      });

      expect(result.released).toBe(true);
    });
  });

  describe('checkLaneLock', () => {
    it('should return locked=false when no lock', () => {
      const result = checkLaneLock('Framework: Core', { baseDir: testBaseDir });

      expect(result.locked).toBe(false);
      expect(result.metadata).toBeNull();
    });

    it('should return lock metadata when locked', () => {
      acquireLaneLock('Framework: Core', 'WU-123', { baseDir: testBaseDir });

      const result = checkLaneLock('Framework: Core', { baseDir: testBaseDir });

      expect(result.locked).toBe(true);
      expect(result.metadata?.wuId).toBe('WU-123');
      expect(result.isStale).toBe(false);
    });

    it('should detect stale locks', () => {
      // Create a stale lock
      const lockPath = getLockFilePath('Framework: Core', testBaseDir);
      const staleLock: LockMetadata = {
        wuId: 'WU-OLD',
        timestamp: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(), // 5 hours ago
        agentSession: null,
        pid: process.pid,
        lane: 'Framework: Core',
      };
      writeFileSync(lockPath, JSON.stringify(staleLock));

      const result = checkLaneLock('Framework: Core', { baseDir: testBaseDir });

      expect(result.locked).toBe(true);
      expect(result.isStale).toBe(true);
    });
  });

  describe('forceRemoveStaleLock', () => {
    it('should succeed when lock does not exist', () => {
      const result = forceRemoveStaleLock('Framework: Core', { baseDir: testBaseDir });

      expect(result.released).toBe(true);
      expect(result.notFound).toBe(true);
    });

    it('should remove stale lock', () => {
      // Create a stale lock
      const lockPath = getLockFilePath('Framework: Core', testBaseDir);
      const staleLock: LockMetadata = {
        wuId: 'WU-OLD',
        timestamp: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
        agentSession: null,
        pid: process.pid,
        lane: 'Framework: Core',
      };
      writeFileSync(lockPath, JSON.stringify(staleLock));

      const result = forceRemoveStaleLock('Framework: Core', { baseDir: testBaseDir });

      expect(result.released).toBe(true);
      expect(existsSync(lockPath)).toBe(false);
    });

    it('should refuse to remove non-stale lock', () => {
      acquireLaneLock('Framework: Core', 'WU-123', { baseDir: testBaseDir });

      const result = forceRemoveStaleLock('Framework: Core', { baseDir: testBaseDir });

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
      acquireLaneLock('Framework: Core', 'WU-123', { baseDir: testBaseDir });
      acquireLaneLock('Operations: Tooling', 'WU-456', { baseDir: testBaseDir });

      const result = getAllLaneLocks({ baseDir: testBaseDir });

      expect(result.size).toBe(2);
      expect(result.get('Framework: Core')?.wuId).toBe('WU-123');
      expect(result.get('Operations: Tooling')?.wuId).toBe('WU-456');
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
      acquireLaneLock('Framework: Core', 'WU-123', { baseDir: testBaseDir });

      const result = auditedUnlock('Framework: Core', {
        reason: '', // Empty reason
        baseDir: testBaseDir,
      });

      expect(result.released).toBe(false);
      expect(result.error).toContain('Reason is required');
    });

    it('should unlock zombie lock without force', () => {
      // Create a zombie lock
      const lockPath = getLockFilePath('Framework: Core', testBaseDir);
      const zombieLock: LockMetadata = {
        wuId: 'WU-OLD',
        timestamp: new Date().toISOString(), // Recent but zombie
        agentSession: null,
        pid: 999999999, // Non-existent
        lane: 'Framework: Core',
      };
      writeFileSync(lockPath, JSON.stringify(zombieLock));

      const result = auditedUnlock('Framework: Core', {
        reason: 'Cleaning up after crash',
        baseDir: testBaseDir,
      });

      expect(result.released).toBe(true);
      expect(result.reason).toBe('Cleaning up after crash');
    });

    it('should unlock stale lock without force', () => {
      // Create a stale lock
      const lockPath = getLockFilePath('Framework: Core', testBaseDir);
      const staleLock: LockMetadata = {
        wuId: 'WU-OLD',
        timestamp: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
        agentSession: null,
        pid: process.pid,
        lane: 'Framework: Core',
      };
      writeFileSync(lockPath, JSON.stringify(staleLock));

      const result = auditedUnlock('Framework: Core', {
        reason: 'Stale lock cleanup',
        baseDir: testBaseDir,
      });

      expect(result.released).toBe(true);
    });

    it('should refuse active lock without force', () => {
      acquireLaneLock('Framework: Core', 'WU-123', { baseDir: testBaseDir });

      const result = auditedUnlock('Framework: Core', {
        reason: 'Testing',
        baseDir: testBaseDir,
        force: false,
      });

      expect(result.released).toBe(false);
      expect(result.error).toContain('Cannot unlock active lock');
    });

    it('should unlock active lock with force', () => {
      acquireLaneLock('Framework: Core', 'WU-123', { baseDir: testBaseDir });

      const result = auditedUnlock('Framework: Core', {
        reason: 'Emergency override',
        baseDir: testBaseDir,
        force: true,
      });

      expect(result.released).toBe(true);
      expect(result.forced).toBe(true);
      expect(result.previousLock?.wuId).toBe('WU-123');
    });

    it('should succeed when lock does not exist', () => {
      const result = auditedUnlock('Framework: Core', {
        reason: 'Cleanup',
        baseDir: testBaseDir,
      });

      expect(result.released).toBe(true);
      expect(result.notFound).toBe(true);
    });
  });
});
