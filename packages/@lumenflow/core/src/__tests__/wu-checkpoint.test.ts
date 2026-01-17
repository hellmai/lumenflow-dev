/**
 * WU-1747: WU Checkpoint tests
 * Tests for checkpoint-based gate resumption
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';

import {
  createPreGatesCheckpoint,
  getCheckpoint,
  clearCheckpoint,
  canSkipGates,
  CHECKPOINT_SCHEMA_VERSION,
} from '../wu-checkpoint.js';

describe('wu-checkpoint', () => {
  let testDir;

  beforeEach(() => {
    // Create a temp directory for each test
    testDir = path.join(tmpdir(), `wu-checkpoint-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
    mkdirSync(path.join(testDir, '.beacon', 'checkpoints'), { recursive: true });
    mkdirSync(path.join(testDir, 'docs', '04-operations', 'tasks', 'wu'), { recursive: true });
  });

  afterEach(() => {
    // Clean up test directory
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('CHECKPOINT_SCHEMA_VERSION', () => {
    it('should be a number', () => {
      expect(typeof CHECKPOINT_SCHEMA_VERSION).toBe('number');
      assert.ok(CHECKPOINT_SCHEMA_VERSION >= 1, 'version should be >= 1');
    });
  });

  describe('createPreGatesCheckpoint()', () => {
    it('should create checkpoint file with required fields', async () => {
      const checkpoint = await createPreGatesCheckpoint(
        {
          wuId: 'WU-100',
          worktreePath: '/path/to/worktree',
          branchName: 'lane/operations/wu-100',
        },
        { baseDir: testDir }
      );

      assert.ok(checkpoint.checkpointId, 'should have checkpointId');
      expect(checkpoint.wuId).toBe('WU-100');
      assert.ok(checkpoint.createdAt, 'should have createdAt');
      assert.ok(checkpoint.worktreeHeadSha, 'should have worktreeHeadSha (or placeholder)');
    });

    it('should persist checkpoint to .beacon/checkpoints/', async () => {
      await createPreGatesCheckpoint(
        {
          wuId: 'WU-100',
          worktreePath: '/path/to/worktree',
          branchName: 'lane/operations/wu-100',
        },
        { baseDir: testDir }
      );

      const checkpointPath = path.join(testDir, '.beacon', 'checkpoints', 'WU-100.checkpoint.json');
      assert.ok(existsSync(checkpointPath), 'checkpoint file should exist');
    });

    it('should include schema version', async () => {
      await createPreGatesCheckpoint(
        {
          wuId: 'WU-200',
          worktreePath: '/path/to/worktree',
          branchName: 'lane/operations/wu-200',
        },
        { baseDir: testDir }
      );

      const checkpointPath = path.join(testDir, '.beacon', 'checkpoints', 'WU-200.checkpoint.json');
      const data = JSON.parse(readFileSync(checkpointPath, 'utf8'));
      expect(data.schemaVersion).toBe(CHECKPOINT_SCHEMA_VERSION);
    });
  });

  describe('getCheckpoint()', () => {
    it('should return null when no checkpoint exists', () => {
      const checkpoint = getCheckpoint('WU-999', { baseDir: testDir });
      expect(checkpoint).toBe(null);
    });

    it('should return checkpoint data when exists', async () => {
      await createPreGatesCheckpoint(
        {
          wuId: 'WU-100',
          worktreePath: '/path/to/worktree',
          branchName: 'lane/operations/wu-100',
        },
        { baseDir: testDir }
      );

      const checkpoint = getCheckpoint('WU-100', { baseDir: testDir });

      expect(checkpoint).toBeTruthy();
      expect(checkpoint.wuId).toBe('WU-100');
    });

    it('should return null for corrupted checkpoint file', async () => {
      const checkpointPath = path.join(testDir, '.beacon', 'checkpoints', 'WU-100.checkpoint.json');
      writeFileSync(checkpointPath, 'not valid json {{{');

      const checkpoint = getCheckpoint('WU-100', { baseDir: testDir });
      expect(checkpoint).toBe(null);
    });
  });

  describe('clearCheckpoint()', () => {
    it('should remove checkpoint file', async () => {
      await createPreGatesCheckpoint(
        {
          wuId: 'WU-100',
          worktreePath: '/path/to/worktree',
          branchName: 'lane/operations/wu-100',
        },
        { baseDir: testDir }
      );

      const checkpointPath = path.join(testDir, '.beacon', 'checkpoints', 'WU-100.checkpoint.json');
      assert.ok(existsSync(checkpointPath), 'checkpoint should exist before clear');

      clearCheckpoint('WU-100', { baseDir: testDir });

      assert.ok(!existsSync(checkpointPath), 'checkpoint should not exist after clear');
    });

    it('should not throw when checkpoint does not exist', () => {
      assert.doesNotThrow(() => {
        clearCheckpoint('WU-999', { baseDir: testDir });
      });
    });
  });

  describe('canSkipGates()', () => {
    it('should return false when no checkpoint exists', () => {
      const result = canSkipGates('WU-100', { baseDir: testDir });
      expect(result.canSkip).toBe(false);
    });

    it('should return false when checkpoint has different schema version', async () => {
      const checkpointPath = path.join(testDir, '.beacon', 'checkpoints', 'WU-100.checkpoint.json');
      const oldCheckpoint = {
        schemaVersion: 0, // Old version
        wuId: 'WU-100',
        gatesPassed: true,
        createdAt: new Date().toISOString(),
      };
      writeFileSync(checkpointPath, JSON.stringify(oldCheckpoint, null, 2));

      const result = canSkipGates('WU-100', { baseDir: testDir });
      expect(result.canSkip).toBe(false);
      assert.ok(result.reason.includes('version'), 'reason should mention version');
    });

    it('should return true when gates passed and SHA matches', async () => {
      await createPreGatesCheckpoint(
        {
          wuId: 'WU-100',
          worktreePath: testDir,
          branchName: 'lane/operations/wu-100',
          gatesPassed: true, // Simulate gates already passed
        },
        { baseDir: testDir }
      );

      // Read back and manually update to mark gates passed
      const checkpointPath = path.join(testDir, '.beacon', 'checkpoints', 'WU-100.checkpoint.json');
      const data = JSON.parse(readFileSync(checkpointPath, 'utf8'));
      data.gatesPassed = true;
      data.gatesPassedAt = new Date().toISOString();
      writeFileSync(checkpointPath, JSON.stringify(data, null, 2));

      // Check with same SHA
      const result = canSkipGates('WU-100', {
        baseDir: testDir,
        currentHeadSha: data.worktreeHeadSha,
      });

      expect(result.canSkip).toBe(true);
    });

    it('should return false when SHA has changed', async () => {
      await createPreGatesCheckpoint(
        {
          wuId: 'WU-100',
          worktreePath: testDir,
          branchName: 'lane/operations/wu-100',
        },
        { baseDir: testDir }
      );

      // Manually update to mark gates passed
      const checkpointPath = path.join(testDir, '.beacon', 'checkpoints', 'WU-100.checkpoint.json');
      const data = JSON.parse(readFileSync(checkpointPath, 'utf8'));
      data.gatesPassed = true;
      data.gatesPassedAt = new Date().toISOString();
      writeFileSync(checkpointPath, JSON.stringify(data, null, 2));

      // Check with different SHA
      const result = canSkipGates('WU-100', {
        baseDir: testDir,
        currentHeadSha: 'different-sha-abc123',
      });

      expect(result.canSkip).toBe(false);
      assert.ok(result.reason.includes('changed'), 'reason should mention changes');
    });

    it('should return false when gates did not pass', async () => {
      await createPreGatesCheckpoint(
        {
          wuId: 'WU-100',
          worktreePath: testDir,
          branchName: 'lane/operations/wu-100',
        },
        { baseDir: testDir }
      );

      // Checkpoint exists but gates not passed yet
      const checkpoint = getCheckpoint('WU-100', { baseDir: testDir });
      const result = canSkipGates('WU-100', {
        baseDir: testDir,
        currentHeadSha: checkpoint.worktreeHeadSha,
      });

      expect(result.canSkip).toBe(false);
      assert.ok(result.reason.includes('not pass'), 'reason should mention gates not passed');
    });
  });
});
