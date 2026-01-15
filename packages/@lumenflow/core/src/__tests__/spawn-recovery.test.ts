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

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

// Imports will fail until implementation exists (TDD RED phase)
import {
  recoverStuckSpawn,
  RecoveryAction,
  RECOVERY_DIR_NAME,
  NO_CHECKPOINT_THRESHOLD_MS,
} from '../spawn-recovery.mjs';
import { SpawnRegistryStore } from '../spawn-registry-store.mjs';
import { SpawnStatus } from '../spawn-registry-schema.mjs';

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
      assert.equal(RecoveryAction.NONE, 'none');
      assert.equal(RecoveryAction.RELEASED_ZOMBIE, 'released_zombie');
      assert.equal(RecoveryAction.RELEASED_STALE, 'released_stale');
      assert.equal(RecoveryAction.ESCALATED_STUCK, 'escalated_stuck');
    });
  });

  describe('RECOVERY_DIR_NAME constant', () => {
    it('should export recovery directory name', () => {
      assert.equal(RECOVERY_DIR_NAME, 'recovery');
    });
  });

  describe('NO_CHECKPOINT_THRESHOLD_MS constant', () => {
    it('should export 1 hour threshold in milliseconds', () => {
      const oneHourMs = 60 * 60 * 1000;
      assert.equal(NO_CHECKPOINT_THRESHOLD_MS, oneHourMs);
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

      assert.ok(typeof result === 'object', 'Should return object');
      assert.ok('recovered' in result, 'Should have recovered property');
      assert.ok('action' in result, 'Should have action property');
      assert.ok('reason' in result, 'Should have reason property');
    });

    it('should return recovered=false and action=none for healthy spawn', async () => {
      // Create a healthy spawn (active lock, recent checkpoint)
      const spawn = FIXTURES.spawnEvent();
      const lock = FIXTURES.lockMetadata({ pid: process.pid }); // Running PID
      const checkpoint = FIXTURES.checkpointNode({ created_at: new Date().toISOString() }); // Recent

      await createSpawnEvents(registryDir, [spawn]);
      await createLockFile(locksDir, 'operations-tooling', lock);
      await createMemoryNodes(memoryDir, [checkpoint]);

      const result = await recoverStuckSpawn('spawn-1234', { baseDir: testDir });

      assert.equal(result.recovered, false);
      assert.equal(result.action, RecoveryAction.NONE);
      assert.ok(result.reason.length > 0, 'Should have reason message');
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

      assert.equal(result.recovered, true);
      assert.equal(result.action, RecoveryAction.RELEASED_ZOMBIE);
      assert.ok(
        result.reason.includes('zombie') || result.reason.includes('PID'),
        'Reason should mention zombie/PID'
      );
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

      assert.equal(updated.status, SpawnStatus.CRASHED, 'Spawn should be marked crashed');
    });

    it('should remove zombie lock file', async () => {
      const spawn = FIXTURES.spawnEvent();
      const lock = FIXTURES.lockMetadata({ pid: 99999999 }); // Non-existent PID

      await createSpawnEvents(registryDir, [spawn]);
      await createLockFile(locksDir, 'operations-tooling', lock);

      await recoverStuckSpawn('spawn-1234', { baseDir: testDir });

      // Verify lock file removed
      const lockPath = path.join(locksDir, 'operations-tooling.lock');
      await assert.rejects(async () => fs.access(lockPath), 'Lock file should be removed');
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
      assert.ok(recoveryDirExists, 'Recovery directory should exist');

      // Verify audit log file exists
      const files = await fs.readdir(recoveryDir);
      assert.ok(files.length > 0, 'Should have audit log file');

      // Verify audit log content
      const auditPath = path.join(recoveryDir, files[0]);
      const content = await fs.readFile(auditPath, 'utf-8');
      const audit = JSON.parse(content);

      assert.ok(audit.timestamp, 'Audit should have timestamp');
      assert.equal(audit.spawnId, 'spawn-1234', 'Audit should have spawn ID');
      assert.equal(audit.action, RecoveryAction.RELEASED_ZOMBIE, 'Audit should have action');
      assert.ok(audit.context, 'Audit should have context');
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

      assert.equal(result.recovered, true);
      assert.equal(result.action, RecoveryAction.RELEASED_STALE);
      assert.ok(
        result.reason.includes('stale') || result.reason.includes('2h'),
        'Reason should mention stale'
      );
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

      assert.equal(updated.status, SpawnStatus.TIMEOUT, 'Spawn should be marked timeout');
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

      assert.equal(audit.action, RecoveryAction.RELEASED_STALE);
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
      assert.equal(result.action, RecoveryAction.RELEASED_ZOMBIE);
    });
  });

  describe('recoverStuckSpawn() - stuck detection (no checkpoint)', () => {
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

      assert.equal(result.recovered, false, 'Should not auto-recover (just escalate)');
      assert.equal(result.action, RecoveryAction.ESCALATED_STUCK);
      assert.ok(
        result.reason.includes('checkpoint') || result.reason.includes('stuck'),
        'Reason should mention checkpoint/stuck'
      );
    });

    it('should flag for escalation if no checkpoint at all', async () => {
      // Create spawn with active lock but NO checkpoints
      const spawn = FIXTURES.spawnEvent();
      const lock = FIXTURES.lockMetadata({ pid: process.pid }); // Running PID

      await createSpawnEvents(registryDir, [spawn]);
      await createLockFile(locksDir, 'operations-tooling', lock);
      // No checkpoints created

      const result = await recoverStuckSpawn('spawn-1234', { baseDir: testDir });

      assert.equal(result.recovered, false);
      assert.equal(result.action, RecoveryAction.ESCALATED_STUCK);
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

      assert.equal(audit.action, RecoveryAction.ESCALATED_STUCK);
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

      assert.equal(result.action, RecoveryAction.NONE);
      assert.ok(
        result.reason.includes('healthy') || result.reason.includes('recent'),
        'Reason should indicate healthy'
      );
    });
  });

  describe('recoverStuckSpawn() - error handling', () => {
    it('should handle spawn not found', async () => {
      // No spawn in registry
      const result = await recoverStuckSpawn('spawn-nonexistent', { baseDir: testDir });

      assert.equal(result.recovered, false);
      assert.equal(result.action, RecoveryAction.NONE);
      assert.ok(result.reason.includes('not found'), 'Reason should mention not found');
    });

    it('should handle spawn already completed', async () => {
      const spawn = FIXTURES.spawnEvent({
        status: 'completed',
        completedAt: new Date().toISOString(),
      });

      await createSpawnEvents(registryDir, [spawn]);

      const result = await recoverStuckSpawn('spawn-1234', { baseDir: testDir });

      assert.equal(result.recovered, false);
      assert.equal(result.action, RecoveryAction.NONE);
      assert.ok(
        result.reason.includes('already') || result.reason.includes('completed'),
        'Reason should mention already completed'
      );
    });

    it('should handle missing lock file', async () => {
      // Spawn exists but no lock file
      const spawn = FIXTURES.spawnEvent();
      await createSpawnEvents(registryDir, [spawn]);
      // No lock file created

      const result = await recoverStuckSpawn('spawn-1234', { baseDir: testDir });

      // Without a lock, spawn might be considered already released
      assert.equal(result.recovered, false);
      assert.equal(result.action, RecoveryAction.NONE);
      assert.ok(result.reason.includes('lock'), 'Reason should mention lock');
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
      assert.ok(audit.timestamp, 'Should have timestamp');
      assert.ok(audit.spawnId, 'Should have spawnId');
      assert.ok(audit.action, 'Should have action');
      assert.ok(audit.reason, 'Should have reason');
      assert.ok(audit.context, 'Should have context');

      // Context fields
      assert.ok(audit.context.targetWuId, 'Context should have targetWuId');
      assert.ok(audit.context.lane, 'Context should have lane');
      assert.ok('lockMetadata' in audit.context, 'Context should have lockMetadata');
    });

    it('should use spawn-{id}-{timestamp}.json naming for audit file', async () => {
      const spawn = FIXTURES.spawnEvent();
      const lock = FIXTURES.lockMetadata({ pid: 99999999 }); // Zombie

      await createSpawnEvents(registryDir, [spawn]);
      await createLockFile(locksDir, 'operations-tooling', lock);

      await recoverStuckSpawn('spawn-1234', { baseDir: testDir });

      const files = await fs.readdir(recoveryDir);
      assert.ok(files[0].startsWith('spawn-1234-'), 'File should start with spawn ID');
      assert.ok(files[0].endsWith('.json'), 'File should end with .json');
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
      assert.equal(result.action, RecoveryAction.NONE);
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

      assert.equal(result.recovered, true);
      assert.equal(result.action, RecoveryAction.RELEASED_ZOMBIE);
    });
  });
});
