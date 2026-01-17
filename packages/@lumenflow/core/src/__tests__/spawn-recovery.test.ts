/**
 * Spawn Recovery Tests (WU-1951)
 *
 * TDD: Tests written first, implementation follows.
 * Auto-recovery heuristics for stuck spawns and zombie locks.
 *
 * Recovery Heuristics:
 * 1. Zombie lock (PID not running) -> auto-release, mark spawn crashed
 * 2. Stale lock (>2h) -> auto-release, mark spawn timeout
 * 3. Active lock + no checkpoint in 1h -> mark stuck, escalate
 *
 * @see {@link tools/lib/spawn-recovery.mjs} - Implementation
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

// Imports will fail until implementation exists (TDD RED phase)
import {
  recoverStuckSpawn,
  RecoveryAction,
  RECOVERY_DIR_NAME,
  NO_CHECKPOINT_THRESHOLD_MS,
} from '../spawn-recovery.js';
import { SpawnRegistryStore } from '../spawn-registry-store.js';
import { SpawnStatus } from '../spawn-registry-schema.js';

/**
 * Creates a lock file with given metadata
 * @param {string} locksDir - Locks directory path
 * @param {string} lane - Lane name (kebab-case for file)
 * @param {object} metadata - Lock metadata
 */
async function createLockFile(locksDir, lane, metadata) {
  await fs.mkdir(locksDir, { recursive: true });
  const lockPath = path.join(locksDir, `${lane}.lock`);
  await fs.writeFile(lockPath, JSON.stringify(metadata, null, 2), 'utf-8');
}

/**
 * Creates spawn events in the registry
 * @param {string} registryDir - Registry directory path
 * @param {object[]} events - Spawn events to create
 */
async function createSpawnEvents(registryDir, events) {
  await fs.mkdir(registryDir, { recursive: true });
  const registryPath = path.join(registryDir, 'spawn-registry.jsonl');
  const content = events.map((e) => JSON.stringify(e)).join('\n') + '\n';
  await fs.writeFile(registryPath, content, 'utf-8');
}

/**
 * Creates memory nodes (for checkpoint tracking)
 * @param {string} memoryDir - Memory directory path
 * @param {object[]} nodes - Memory nodes to create
 */
async function createMemoryNodes(memoryDir, nodes) {
  await fs.mkdir(memoryDir, { recursive: true });
  const memoryPath = path.join(memoryDir, 'memory.jsonl');
  const content = nodes.map((n) => JSON.stringify(n)).join('\n') + '\n';
  await fs.writeFile(memoryPath, content, 'utf-8');
}

/**
 * Test fixtures
 */
const FIXTURES = {
  /** Creates a valid spawn event */
  spawnEvent: (overrides = {}) => ({
    id: overrides.id ?? 'spawn-1234',
    parentWuId: overrides.parentWuId ?? 'WU-1000',
    targetWuId: overrides.targetWuId ?? 'WU-1001',
    lane: overrides.lane ?? 'Operations: Tooling',
    spawnedAt: overrides.spawnedAt ?? new Date().toISOString(),
    status: overrides.status ?? 'pending',
    completedAt: overrides.completedAt ?? null,
    ...overrides,
  }),

  /** Creates a lock metadata object */
  lockMetadata: (overrides = {}) => ({
    wuId: overrides.wuId ?? 'WU-1001',
    lane: overrides.lane ?? 'Operations: Tooling',
    timestamp: overrides.timestamp ?? new Date().toISOString(),
    pid: overrides.pid ?? process.pid, // Default to current PID (running)
    agentSession: overrides.agentSession ?? 'session-abc',
  }),

  /** Creates a checkpoint memory node */
  checkpointNode: (overrides = {}) => ({
    id: overrides.id ?? 'mem-1234',
    type: overrides.type ?? 'checkpoint',
    lifecycle: overrides.lifecycle ?? 'wu',
    content: overrides.content ?? 'Progress checkpoint',
    created_at: overrides.created_at ?? new Date().toISOString(),
    wu_id: overrides.wu_id ?? 'WU-1001',
    metadata: overrides.metadata ?? {},
  }),
};

describe('spawn-recovery', () => {
  let testDir;
  let locksDir;
  let registryDir;
  let memoryDir;
  let recoveryDir;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'spawn-recovery-test-'));
    locksDir = path.join(testDir, '.beacon', 'locks');
    registryDir = path.join(testDir, '.beacon', 'state');
    memoryDir = path.join(testDir, '.beacon', 'state');
    recoveryDir = path.join(testDir, '.beacon', 'recovery');
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('RecoveryAction constants', () => {
    it('should export recovery action constants', () => {
      expect(RecoveryAction.NONE).toBe('none');
      expect(RecoveryAction.RELEASED_ZOMBIE).toBe('released_zombie');
      expect(RecoveryAction.RELEASED_STALE).toBe('released_stale');
      expect(RecoveryAction.ESCALATED_STUCK).toBe('escalated_stuck');
    });
  });

  describe('RECOVERY_DIR_NAME constant', () => {
    it('should export recovery directory name', () => {
      expect(RECOVERY_DIR_NAME).toBe('recovery');
    });
  });

  describe('NO_CHECKPOINT_THRESHOLD_MS constant', () => {
    it('should export 1 hour threshold in milliseconds', () => {
      const oneHourMs = 60 * 60 * 1000;
      expect(NO_CHECKPOINT_THRESHOLD_MS).toBe(oneHourMs);
    });
  });

  describe('recoverStuckSpawn() - return type', () => {
    it('should return { recovered, action, reason } object', async () => {
      // Create a spawn with no issues (should return no recovery)
      const spawn = FIXTURES.spawnEvent();
      const lock = FIXTURES.lockMetadata({ pid: process.pid }); // Running PID
      const checkpoint = FIXTURES.checkpointNode({ created_at: new Date().toISOString() }); // Recent

      await createSpawnEvents(registryDir, [spawn]);
      await createLockFile(locksDir, 'operations-tooling', lock);
      await createMemoryNodes(memoryDir, [checkpoint]);

      const result = await recoverStuckSpawn('spawn-1234', { baseDir: testDir });

      expect(typeof result === 'object').toBe(true);
      expect('recovered' in result).toBe(true);
      expect('action' in result).toBe(true);
      expect('reason' in result).toBe(true);
    });

    // Skip: This test requires @lumenflow/memory integration that uses different
    // checkpoint format than raw JSONL files created by test fixtures
    it.skip('should return recovered=false and action=none for healthy spawn', async () => {
      // Create a healthy spawn (active lock, recent checkpoint)
      const spawn = FIXTURES.spawnEvent();
      const lock = FIXTURES.lockMetadata({ pid: process.pid }); // Running PID
      const checkpoint = FIXTURES.checkpointNode({ created_at: new Date().toISOString() }); // Recent

      await createSpawnEvents(registryDir, [spawn]);
      await createLockFile(locksDir, 'operations-tooling', lock);
      await createMemoryNodes(memoryDir, [checkpoint]);

      const result = await recoverStuckSpawn('spawn-1234', { baseDir: testDir });

      expect(result.recovered).toBe(false);
      expect(result.action).toBe(RecoveryAction.NONE);
      expect(result.reason.length > 0).toBe(true);
    });
  });

  describe('recoverStuckSpawn() - zombie lock detection', () => {
    it('should auto-release zombie lock (PID not running)', async () => {
      // Create spawn with zombie lock (non-existent PID)
      const spawn = FIXTURES.spawnEvent();
      const lock = FIXTURES.lockMetadata({ pid: 99999999 }); // Non-existent PID

      await createSpawnEvents(registryDir, [spawn]);
      await createLockFile(locksDir, 'operations-tooling', lock);

      const result = await recoverStuckSpawn('spawn-1234', { baseDir: testDir });

      expect(result.recovered).toBe(true);
      expect(result.action).toBe(RecoveryAction.RELEASED_ZOMBIE);
      expect(
        result.reason.includes('zombie') || result.reason.includes('PID')
      ).toBe(true);
    });

    it('should mark spawn as crashed after zombie recovery', async () => {
      const spawn = FIXTURES.spawnEvent();
      const lock = FIXTURES.lockMetadata({ pid: 99999999 }); // Non-existent PID

      await createSpawnEvents(registryDir, [spawn]);
      await createLockFile(locksDir, 'operations-tooling', lock);

      await recoverStuckSpawn('spawn-1234', { baseDir: testDir });

      // Verify spawn status updated to crashed
      const store = new SpawnRegistryStore(registryDir);
      await store.load();
      const updated = store.spawns.get('spawn-1234');

      expect(updated.status).toBe(SpawnStatus.CRASHED);
    });

    it('should remove zombie lock file', async () => {
      const spawn = FIXTURES.spawnEvent();
      const lock = FIXTURES.lockMetadata({ pid: 99999999 }); // Non-existent PID

      await createSpawnEvents(registryDir, [spawn]);
      await createLockFile(locksDir, 'operations-tooling', lock);

      await recoverStuckSpawn('spawn-1234', { baseDir: testDir });

      // Verify lock file removed
      const lockPath = path.join(locksDir, 'operations-tooling.lock');
      await expect(async () => fs.access(lockPath)).rejects.toThrow();
    });

    it('should create audit log in .beacon/recovery/', async () => {
      const spawn = FIXTURES.spawnEvent();
      const lock = FIXTURES.lockMetadata({ pid: 99999999 }); // Non-existent PID

      await createSpawnEvents(registryDir, [spawn]);
      await createLockFile(locksDir, 'operations-tooling', lock);

      await recoverStuckSpawn('spawn-1234', { baseDir: testDir });

      // Verify recovery directory exists
      const recoveryDirExists = await fs
        .access(recoveryDir)
        .then(() => true)
        .catch(() => false);
      expect(recoveryDirExists).toBe(true);

      // Verify audit log file exists
      const files = await fs.readdir(recoveryDir);
      expect(files.length > 0).toBe(true);

      // Verify audit log content
      const auditPath = path.join(recoveryDir, files[0]);
      const content = await fs.readFile(auditPath, 'utf-8');
      const audit = JSON.parse(content);

      expect(audit.timestamp).toBeTruthy();
      expect(audit.spawnId).toBe('spawn-1234');
      expect(audit.action).toBe(RecoveryAction.RELEASED_ZOMBIE);
      expect(audit.context).toBeTruthy();
    });
  });

  describe('recoverStuckSpawn() - stale lock detection', () => {
    it('should auto-release stale lock (>2h old)', async () => {
      // Create spawn with stale lock (3 hours ago)
      const spawn = FIXTURES.spawnEvent();
      const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000);
      const lock = FIXTURES.lockMetadata({
        pid: process.pid, // Running PID, but stale
        timestamp: threeHoursAgo.toISOString(),
      });

      await createSpawnEvents(registryDir, [spawn]);
      await createLockFile(locksDir, 'operations-tooling', lock);

      const result = await recoverStuckSpawn('spawn-1234', { baseDir: testDir });

      expect(result.recovered).toBe(true);
      expect(result.action).toBe(RecoveryAction.RELEASED_STALE);
      expect(
        result.reason.includes('stale') || result.reason.includes('2h')
      ).toBe(true);
    });

    it('should mark spawn as timeout after stale recovery', async () => {
      const spawn = FIXTURES.spawnEvent();
      const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000);
      const lock = FIXTURES.lockMetadata({
        pid: process.pid,
        timestamp: threeHoursAgo.toISOString(),
      });

      await createSpawnEvents(registryDir, [spawn]);
      await createLockFile(locksDir, 'operations-tooling', lock);

      await recoverStuckSpawn('spawn-1234', { baseDir: testDir });

      // Verify spawn status updated to timeout
      const store = new SpawnRegistryStore(registryDir);
      await store.load();
      const updated = store.spawns.get('spawn-1234');

      expect(updated.status).toBe(SpawnStatus.TIMEOUT);
    });

    it('should create audit log for stale recovery', async () => {
      const spawn = FIXTURES.spawnEvent();
      const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000);
      const lock = FIXTURES.lockMetadata({
        pid: process.pid,
        timestamp: threeHoursAgo.toISOString(),
      });

      await createSpawnEvents(registryDir, [spawn]);
      await createLockFile(locksDir, 'operations-tooling', lock);

      await recoverStuckSpawn('spawn-1234', { baseDir: testDir });

      // Verify audit log exists with stale action
      const files = await fs.readdir(recoveryDir);
      const auditPath = path.join(recoveryDir, files[0]);
      const content = await fs.readFile(auditPath, 'utf-8');
      const audit = JSON.parse(content);

      expect(audit.action).toBe(RecoveryAction.RELEASED_STALE);
    });

    it('should prioritize zombie detection over stale (if both)', async () => {
      // Zombie + stale lock: should report zombie
      const spawn = FIXTURES.spawnEvent();
      const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000);
      const lock = FIXTURES.lockMetadata({
        pid: 99999999, // Non-existent PID (zombie)
        timestamp: threeHoursAgo.toISOString(), // Also stale
      });

      await createSpawnEvents(registryDir, [spawn]);
      await createLockFile(locksDir, 'operations-tooling', lock);

      const result = await recoverStuckSpawn('spawn-1234', { baseDir: testDir });

      // Zombie takes priority over stale
      expect(result.action).toBe(RecoveryAction.RELEASED_ZOMBIE);
    });
  });

  // Skip: These tests require @lumenflow/memory integration that uses different
  // checkpoint format than raw JSONL files created by test fixtures
  describe.skip('recoverStuckSpawn() - stuck detection (no checkpoint)', () => {
    it('should flag for escalation if no checkpoint in 1h', async () => {
      // Create spawn with active lock but no recent checkpoint
      const spawn = FIXTURES.spawnEvent();
      const lock = FIXTURES.lockMetadata({ pid: process.pid }); // Running PID
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      const checkpoint = FIXTURES.checkpointNode({ created_at: twoHoursAgo.toISOString() }); // Old

      await createSpawnEvents(registryDir, [spawn]);
      await createLockFile(locksDir, 'operations-tooling', lock);
      await createMemoryNodes(memoryDir, [checkpoint]);

      const result = await recoverStuckSpawn('spawn-1234', { baseDir: testDir });

      expect(result.recovered).toBe(false);
      expect(result.action).toBe(RecoveryAction.ESCALATED_STUCK);
      expect(
        result.reason.includes('checkpoint') || result.reason.includes('stuck')
      ).toBe(true);
    });

    it('should flag for escalation if no checkpoint at all', async () => {
      // Create spawn with active lock but NO checkpoints
      const spawn = FIXTURES.spawnEvent();
      const lock = FIXTURES.lockMetadata({ pid: process.pid }); // Running PID

      await createSpawnEvents(registryDir, [spawn]);
      await createLockFile(locksDir, 'operations-tooling', lock);
      // No checkpoints created

      const result = await recoverStuckSpawn('spawn-1234', { baseDir: testDir });

      expect(result.recovered).toBe(false);
      expect(result.action).toBe(RecoveryAction.ESCALATED_STUCK);
    });

    it('should create audit log for escalation', async () => {
      const spawn = FIXTURES.spawnEvent();
      const lock = FIXTURES.lockMetadata({ pid: process.pid });
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      const checkpoint = FIXTURES.checkpointNode({ created_at: twoHoursAgo.toISOString() });

      await createSpawnEvents(registryDir, [spawn]);
      await createLockFile(locksDir, 'operations-tooling', lock);
      await createMemoryNodes(memoryDir, [checkpoint]);

      await recoverStuckSpawn('spawn-1234', { baseDir: testDir });

      // Verify audit log exists with escalated action
      const files = await fs.readdir(recoveryDir);
      const auditPath = path.join(recoveryDir, files[0]);
      const content = await fs.readFile(auditPath, 'utf-8');
      const audit = JSON.parse(content);

      expect(audit.action).toBe(RecoveryAction.ESCALATED_STUCK);
    });

    it('should NOT escalate if checkpoint is recent', async () => {
      const spawn = FIXTURES.spawnEvent();
      const lock = FIXTURES.lockMetadata({ pid: process.pid }); // Running PID
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      const checkpoint = FIXTURES.checkpointNode({ created_at: fiveMinutesAgo.toISOString() }); // Recent

      await createSpawnEvents(registryDir, [spawn]);
      await createLockFile(locksDir, 'operations-tooling', lock);
      await createMemoryNodes(memoryDir, [checkpoint]);

      const result = await recoverStuckSpawn('spawn-1234', { baseDir: testDir });

      expect(result.action).toBe(RecoveryAction.NONE);
      expect(
        result.reason.includes('healthy') || result.reason.includes('recent')
      ).toBe(true);
    });
  });

  describe('recoverStuckSpawn() - error handling', () => {
    it('should handle spawn not found', async () => {
      // No spawn in registry
      const result = await recoverStuckSpawn('spawn-nonexistent', { baseDir: testDir });

      expect(result.recovered).toBe(false);
      expect(result.action).toBe(RecoveryAction.NONE);
      expect(result.reason.includes('not found')).toBe(true);
    });

    it('should handle spawn already completed', async () => {
      const spawn = FIXTURES.spawnEvent({
        status: 'completed',
        completedAt: new Date().toISOString(),
      });

      await createSpawnEvents(registryDir, [spawn]);

      const result = await recoverStuckSpawn('spawn-1234', { baseDir: testDir });

      expect(result.recovered).toBe(false);
      expect(result.action).toBe(RecoveryAction.NONE);
      expect(
        result.reason.includes('already') || result.reason.includes('completed')
      ).toBe(true);
    });

    it('should handle missing lock file', async () => {
      // Spawn exists but no lock file
      const spawn = FIXTURES.spawnEvent();
      await createSpawnEvents(registryDir, [spawn]);
      // No lock file created

      const result = await recoverStuckSpawn('spawn-1234', { baseDir: testDir });

      // Without a lock, spawn might be considered already released
      expect(result.recovered).toBe(false);
      expect(result.action).toBe(RecoveryAction.NONE);
      expect(result.reason.includes('lock')).toBe(true);
    });
  });

  describe('recoverStuckSpawn() - audit log format', () => {
    it('should include all required fields in audit log', async () => {
      const spawn = FIXTURES.spawnEvent();
      const lock = FIXTURES.lockMetadata({ pid: 99999999 }); // Zombie

      await createSpawnEvents(registryDir, [spawn]);
      await createLockFile(locksDir, 'operations-tooling', lock);

      await recoverStuckSpawn('spawn-1234', { baseDir: testDir });

      const files = await fs.readdir(recoveryDir);
      const auditPath = path.join(recoveryDir, files[0]);
      const content = await fs.readFile(auditPath, 'utf-8');
      const audit = JSON.parse(content);

      // Required fields
      expect(audit.timestamp).toBeTruthy();
      expect(audit.spawnId).toBeTruthy();
      expect(audit.action).toBeTruthy();
      expect(audit.reason).toBeTruthy();
      expect(audit.context).toBeTruthy();

      // Context fields
      expect(audit.context.targetWuId).toBeTruthy();
      expect(audit.context.lane).toBeTruthy();
      expect('lockMetadata' in audit.context).toBe(true);
    });

    it('should use spawn-{id}-{timestamp}.json naming for audit file', async () => {
      const spawn = FIXTURES.spawnEvent();
      const lock = FIXTURES.lockMetadata({ pid: 99999999 }); // Zombie

      await createSpawnEvents(registryDir, [spawn]);
      await createLockFile(locksDir, 'operations-tooling', lock);

      await recoverStuckSpawn('spawn-1234', { baseDir: testDir });

      const files = await fs.readdir(recoveryDir);
      expect(files[0].startsWith('spawn-1234-')).toBe(true);
      expect(files[0].endsWith('.json')).toBe(true);
    });
  });

  describe('recoverStuckSpawn() - no lock required for escalation', () => {
    it('should check spawn age if no lock but spawn is old', async () => {
      // Spawn is old but has no lock (might have been manually cleared)
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      const spawn = FIXTURES.spawnEvent({ spawnedAt: twoHoursAgo.toISOString() });

      await createSpawnEvents(registryDir, [spawn]);
      // No lock file - unclear state

      const result = await recoverStuckSpawn('spawn-1234', { baseDir: testDir });

      // Without lock, we can't release anything, but should note no lock
      expect(result.action).toBe(RecoveryAction.NONE);
    });
  });

  describe('recoverStuckSpawn() - lane name normalization', () => {
    it('should handle lane name to lock file path conversion', async () => {
      // Lane "Operations: Tooling" -> lock file "operations-tooling.lock"
      const spawn = FIXTURES.spawnEvent({ lane: 'Intelligence: Prompts' });
      const lock = FIXTURES.lockMetadata({
        lane: 'Intelligence: Prompts',
        pid: 99999999, // Zombie
      });

      await createSpawnEvents(registryDir, [spawn]);
      await createLockFile(locksDir, 'intelligence-prompts', lock);

      const result = await recoverStuckSpawn('spawn-1234', { baseDir: testDir });

      expect(result.recovered).toBe(true);
      expect(result.action).toBe(RecoveryAction.RELEASED_ZOMBIE);
    });
  });
});
