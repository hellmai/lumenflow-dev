/**
 * Spawn Escalation Tests (WU-1952, WU-1967)
 *
 * WU-1967: Updated tests for memory bus signalling (replaces Bug WU creation).
 *
 * Escalation Flow:
 * 1. recoverStuckSpawn() returns { recovered: false, action: ESCALATED_STUCK }
 * 2. escalateStuckSpawn() signals orchestrator via memory bus
 * 3. Spawn status updated to ESCALATED (prevents duplicate signals)
 *
 * @see {@link tools/lib/spawn-escalation.mjs} - Implementation
 * @see {@link tools/lib/spawn-recovery.mjs} - Recovery logic
 * @see {@link tools/lib/mem-signal-core.mjs} - Signal creation
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import {
  escalateStuckSpawn,
  SPAWN_FAILURE_SIGNAL_TYPE,
  SignalSeverity,
  SuggestedAction,
} from '../spawn-escalation.mjs';
import { SpawnStatus } from '../spawn-registry-schema.mjs';

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
 * Creates a recovery audit log entry
 * @param {string} recoveryDir - Recovery directory path
 * @param {object} entry - Audit log entry
 */
async function createRecoveryAuditLog(recoveryDir, entry) {
  await fs.mkdir(recoveryDir, { recursive: true });
  const timestamp = entry.timestamp.replace(/[:.]/g, '-');
  const fileName = `${entry.spawnId}-${timestamp}.json`;
  const filePath = path.join(recoveryDir, fileName);
  await fs.writeFile(filePath, JSON.stringify(entry, null, 2), 'utf-8');
}

/**
 * Reads signals from the signals file
 * @param {string} baseDir - Base directory
 * @returns {Promise<object[]>} Array of signals
 */
async function readSignals(baseDir) {
  const signalsPath = path.join(baseDir, '.beacon', 'memory', 'signals.jsonl');
  try {
    const content = await fs.readFile(signalsPath, 'utf-8');
    return content
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line));
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

/**
 * Reads spawn registry and returns latest spawn by ID
 * (registry is append-only, so we need the last matching event)
 * @param {string} registryDir - Registry directory path
 * @param {string} spawnId - Spawn ID to find
 * @returns {Promise<object|null>} Most recent spawn event or null
 */
async function readSpawnStatus(registryDir, spawnId) {
  const registryPath = path.join(registryDir, 'spawn-registry.jsonl');
  const content = await fs.readFile(registryPath, 'utf-8');
  const events = content
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
  // Find the last matching event (append-only registry)
  const matching = events.filter((e) => e.id === spawnId);
  return matching.length > 0 ? matching[matching.length - 1] : null;
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

  /** Creates a recovery audit log entry */
  recoveryAuditLog: (overrides = {}) => ({
    timestamp: overrides.timestamp ?? new Date().toISOString(),
    spawnId: overrides.spawnId ?? 'spawn-1234',
    action: overrides.action ?? 'escalated_stuck',
    reason: overrides.reason ?? 'No checkpoint in last hour',
    context: {
      targetWuId: overrides.targetWuId ?? 'WU-1001',
      parentWuId: overrides.parentWuId ?? 'WU-1000',
      lane: overrides.lane ?? 'Operations: Tooling',
      spawnedAt: overrides.spawnedAt ?? new Date().toISOString(),
      lockMetadata: overrides.lockMetadata ?? null,
      lastCheckpoint: overrides.lastCheckpoint ?? null,
      ...overrides.context,
    },
  }),
};

describe('spawn-escalation (WU-1967)', () => {
  let testDir;
  let registryDir;
  let recoveryDir;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'spawn-escalation-test-'));
    registryDir = path.join(testDir, '.beacon', 'state');
    recoveryDir = path.join(testDir, '.beacon', 'recovery');
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('exported constants', () => {
    it('should export SPAWN_FAILURE_SIGNAL_TYPE', () => {
      assert.equal(SPAWN_FAILURE_SIGNAL_TYPE, 'spawn_failure');
    });

    it('should export SignalSeverity with correct values', () => {
      assert.equal(SignalSeverity.WARNING, 'warning');
      assert.equal(SignalSeverity.ERROR, 'error');
      assert.equal(SignalSeverity.CRITICAL, 'critical');
    });

    it('should export SuggestedAction with correct values', () => {
      assert.equal(SuggestedAction.RETRY, 'retry');
      assert.equal(SuggestedAction.BLOCK, 'block');
      assert.equal(SuggestedAction.HUMAN_ESCALATE, 'human_escalate');
    });
  });

  describe('escalateStuckSpawn() - signal creation', () => {
    it('should return signalId when escalation succeeds', async () => {
      const spawn = FIXTURES.spawnEvent();
      const auditLog = FIXTURES.recoveryAuditLog();

      await createSpawnEvents(registryDir, [spawn]);
      await createRecoveryAuditLog(recoveryDir, auditLog);

      const result = await escalateStuckSpawn('spawn-1234', {
        baseDir: testDir,
        dryRun: true,
      });

      assert.ok(result, 'Should return result');
      assert.ok(result.signalId, 'Should have signalId');
      assert.match(result.signalId, /^sig-/, 'Signal ID should start with sig-');
    });

    it('should return signal payload with spawn failure type', async () => {
      const spawn = FIXTURES.spawnEvent();
      const auditLog = FIXTURES.recoveryAuditLog();

      await createSpawnEvents(registryDir, [spawn]);
      await createRecoveryAuditLog(recoveryDir, auditLog);

      const result = await escalateStuckSpawn('spawn-1234', {
        baseDir: testDir,
        dryRun: true,
      });

      assert.ok(result.signal, 'Should have signal payload');
      assert.equal(result.signal.type, SPAWN_FAILURE_SIGNAL_TYPE);
    });

    it('should include spawn details in signal payload', async () => {
      const spawn = FIXTURES.spawnEvent({
        parentWuId: 'WU-2000',
        targetWuId: 'WU-2001',
        lane: 'Intelligence: Prompts',
      });
      const auditLog = FIXTURES.recoveryAuditLog({
        parentWuId: 'WU-2000',
        targetWuId: 'WU-2001',
        lane: 'Intelligence: Prompts',
      });

      await createSpawnEvents(registryDir, [spawn]);
      await createRecoveryAuditLog(recoveryDir, auditLog);

      const result = await escalateStuckSpawn('spawn-1234', {
        baseDir: testDir,
        dryRun: true,
      });

      assert.equal(result.signal.spawn_id, 'spawn-1234');
      assert.equal(result.signal.target_wu_id, 'WU-2001');
      assert.equal(result.signal.parent_wu_id, 'WU-2000');
      assert.equal(result.signal.lane, 'Intelligence: Prompts');
    });
  });

  describe('escalateStuckSpawn() - escalation levels', () => {
    it('should set severity=warning and suggested_action=retry on first attempt', async () => {
      const spawn = FIXTURES.spawnEvent();
      const auditLog = FIXTURES.recoveryAuditLog();

      await createSpawnEvents(registryDir, [spawn]);
      await createRecoveryAuditLog(recoveryDir, auditLog);

      const result = await escalateStuckSpawn('spawn-1234', {
        baseDir: testDir,
        dryRun: true,
      });

      assert.equal(result.signal.severity, SignalSeverity.WARNING);
      assert.equal(result.signal.suggested_action, SuggestedAction.RETRY);
    });

    it('should set severity=error and suggested_action=block on second attempt', async () => {
      const spawn = FIXTURES.spawnEvent();
      const auditLog1 = FIXTURES.recoveryAuditLog({ timestamp: '2024-01-01T10:00:00Z' });
      const auditLog2 = FIXTURES.recoveryAuditLog({ timestamp: '2024-01-01T11:00:00Z' });

      await createSpawnEvents(registryDir, [spawn]);
      await createRecoveryAuditLog(recoveryDir, auditLog1);
      await createRecoveryAuditLog(recoveryDir, auditLog2);

      const result = await escalateStuckSpawn('spawn-1234', {
        baseDir: testDir,
        dryRun: true,
      });

      assert.equal(result.signal.severity, SignalSeverity.ERROR);
      assert.equal(result.signal.suggested_action, SuggestedAction.BLOCK);
    });

    it('should set severity=critical and suggested_action=human_escalate on third+ attempt', async () => {
      const spawn = FIXTURES.spawnEvent();
      const auditLog1 = FIXTURES.recoveryAuditLog({ timestamp: '2024-01-01T10:00:00Z' });
      const auditLog2 = FIXTURES.recoveryAuditLog({ timestamp: '2024-01-01T11:00:00Z' });
      const auditLog3 = FIXTURES.recoveryAuditLog({ timestamp: '2024-01-01T12:00:00Z' });

      await createSpawnEvents(registryDir, [spawn]);
      await createRecoveryAuditLog(recoveryDir, auditLog1);
      await createRecoveryAuditLog(recoveryDir, auditLog2);
      await createRecoveryAuditLog(recoveryDir, auditLog3);

      const result = await escalateStuckSpawn('spawn-1234', {
        baseDir: testDir,
        dryRun: true,
      });

      assert.equal(result.signal.severity, SignalSeverity.CRITICAL);
      assert.equal(result.signal.suggested_action, SuggestedAction.HUMAN_ESCALATE);
    });
  });

  describe('escalateStuckSpawn() - signal broadcast', () => {
    it('should create signal in signals.jsonl when not in dry-run mode', async () => {
      const spawn = FIXTURES.spawnEvent();
      const auditLog = FIXTURES.recoveryAuditLog();

      await createSpawnEvents(registryDir, [spawn]);
      await createRecoveryAuditLog(recoveryDir, auditLog);

      await escalateStuckSpawn('spawn-1234', {
        baseDir: testDir,
        dryRun: false,
      });

      const signals = await readSignals(testDir);
      assert.equal(signals.length, 1, 'Should have created one signal');

      // Parse the message (it's a JSON payload)
      const payload = JSON.parse(signals[0].message);
      assert.equal(payload.type, SPAWN_FAILURE_SIGNAL_TYPE);
      assert.equal(payload.spawn_id, 'spawn-1234');
    });

    it('should target signal to parent WU (orchestrator)', async () => {
      const spawn = FIXTURES.spawnEvent({ parentWuId: 'WU-3000' });
      const auditLog = FIXTURES.recoveryAuditLog({ parentWuId: 'WU-3000' });

      await createSpawnEvents(registryDir, [spawn]);
      await createRecoveryAuditLog(recoveryDir, auditLog);

      await escalateStuckSpawn('spawn-1234', {
        baseDir: testDir,
        dryRun: false,
      });

      const signals = await readSignals(testDir);
      assert.equal(signals[0].wu_id, 'WU-3000', 'Signal should target parent WU');
    });

    it('should not create signal in dry-run mode', async () => {
      const spawn = FIXTURES.spawnEvent();
      const auditLog = FIXTURES.recoveryAuditLog();

      await createSpawnEvents(registryDir, [spawn]);
      await createRecoveryAuditLog(recoveryDir, auditLog);

      await escalateStuckSpawn('spawn-1234', {
        baseDir: testDir,
        dryRun: true,
      });

      const signals = await readSignals(testDir);
      assert.equal(signals.length, 0, 'Should not create signal in dry-run mode');
    });
  });

  describe('escalateStuckSpawn() - spawn status update', () => {
    it('should update spawn status to ESCALATED', async () => {
      const spawn = FIXTURES.spawnEvent();
      const auditLog = FIXTURES.recoveryAuditLog();

      await createSpawnEvents(registryDir, [spawn]);
      await createRecoveryAuditLog(recoveryDir, auditLog);

      const result = await escalateStuckSpawn('spawn-1234', {
        baseDir: testDir,
        dryRun: false,
      });

      assert.equal(result.spawnStatus, SpawnStatus.ESCALATED);

      // Verify spawn registry was updated
      const updatedSpawn = await readSpawnStatus(registryDir, 'spawn-1234');
      assert.equal(updatedSpawn.status, SpawnStatus.ESCALATED);
    });

    it('should return ESCALATED status in dry-run mode (but not update registry)', async () => {
      const spawn = FIXTURES.spawnEvent();
      const auditLog = FIXTURES.recoveryAuditLog();

      await createSpawnEvents(registryDir, [spawn]);
      await createRecoveryAuditLog(recoveryDir, auditLog);

      const result = await escalateStuckSpawn('spawn-1234', {
        baseDir: testDir,
        dryRun: true,
      });

      assert.equal(result.spawnStatus, SpawnStatus.ESCALATED);

      // Registry should NOT be updated in dry-run
      const unchangedSpawn = await readSpawnStatus(registryDir, 'spawn-1234');
      assert.equal(unchangedSpawn.status, 'pending', 'Status should remain pending in dry-run');
    });
  });

  describe('escalateStuckSpawn() - duplicate prevention', () => {
    it('should throw if spawn already escalated', async () => {
      const spawn = FIXTURES.spawnEvent({ status: SpawnStatus.ESCALATED });
      const auditLog = FIXTURES.recoveryAuditLog();

      await createSpawnEvents(registryDir, [spawn]);
      await createRecoveryAuditLog(recoveryDir, auditLog);

      await assert.rejects(
        async () =>
          escalateStuckSpawn('spawn-1234', {
            baseDir: testDir,
            dryRun: false,
          }),
        {
          message: /already escalated/i,
        }
      );
    });
  });

  describe('escalateStuckSpawn() - error handling', () => {
    it('should throw if spawn not found', async () => {
      // No spawn in registry

      await assert.rejects(
        async () =>
          escalateStuckSpawn('spawn-nonexistent', {
            baseDir: testDir,
            dryRun: true,
          }),
        {
          message: /not found/i,
        }
      );
    });

    it('should throw if no escalation audit log exists', async () => {
      const spawn = FIXTURES.spawnEvent();
      await createSpawnEvents(registryDir, [spawn]);
      // No audit log created

      await assert.rejects(
        async () =>
          escalateStuckSpawn('spawn-1234', {
            baseDir: testDir,
            dryRun: true,
          }),
        {
          message: /audit|escalation/i,
        }
      );
    });
  });

  describe('escalateStuckSpawn() - signal message content', () => {
    it('should include human-readable message', async () => {
      const spawn = FIXTURES.spawnEvent({ targetWuId: 'WU-5555' });
      const auditLog = FIXTURES.recoveryAuditLog({
        targetWuId: 'WU-5555',
        reason: 'No checkpoint in last hour',
      });

      await createSpawnEvents(registryDir, [spawn]);
      await createRecoveryAuditLog(recoveryDir, auditLog);

      const result = await escalateStuckSpawn('spawn-1234', {
        baseDir: testDir,
        dryRun: true,
      });

      assert.ok(result.signal.message, 'Should have message');
      assert.ok(result.signal.message.includes('spawn-1234'), 'Message should include spawn ID');
      assert.ok(result.signal.message.includes('WU-5555'), 'Message should include target WU');
    });

    it('should include last checkpoint if available', async () => {
      const lastCheckpoint = '2024-12-01T10:00:00Z';
      const spawn = FIXTURES.spawnEvent();
      const auditLog = FIXTURES.recoveryAuditLog({ lastCheckpoint });

      await createSpawnEvents(registryDir, [spawn]);
      await createRecoveryAuditLog(recoveryDir, auditLog);

      const result = await escalateStuckSpawn('spawn-1234', {
        baseDir: testDir,
        dryRun: true,
      });

      assert.equal(result.signal.last_checkpoint, lastCheckpoint);
    });

    it('should set last_checkpoint to null if not available', async () => {
      const spawn = FIXTURES.spawnEvent();
      const auditLog = FIXTURES.recoveryAuditLog({ lastCheckpoint: null });

      await createSpawnEvents(registryDir, [spawn]);
      await createRecoveryAuditLog(recoveryDir, auditLog);

      const result = await escalateStuckSpawn('spawn-1234', {
        baseDir: testDir,
        dryRun: true,
      });

      assert.equal(result.signal.last_checkpoint, null);
    });

    it('should include recovery_action from audit log', async () => {
      const spawn = FIXTURES.spawnEvent();
      const auditLog = FIXTURES.recoveryAuditLog({ action: 'escalated_stuck' });

      await createSpawnEvents(registryDir, [spawn]);
      await createRecoveryAuditLog(recoveryDir, auditLog);

      const result = await escalateStuckSpawn('spawn-1234', {
        baseDir: testDir,
        dryRun: true,
      });

      assert.equal(result.signal.recovery_action, 'escalated_stuck');
    });
  });
});
