/**
 * @fileoverview Tests for wu-checkpoint module
 *
 * WU-1102: INIT-003 Phase 2b - Migrate WU helpers to @lumenflow/core
 *
 * Tests cover:
 * - CHECKPOINT_SCHEMA_VERSION: Schema version export
 * - createPreGatesCheckpoint: Create checkpoint before gates
 * - markGatesPassed: Mark checkpoint as gates passed
 * - getCheckpoint: Get checkpoint for WU
 * - clearCheckpoint: Clear checkpoint for WU
 * - canSkipGates: Check if gates can be skipped
 *
 * @module __tests__/wu-checkpoint.test
 */

import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  CHECKPOINT_SCHEMA_VERSION,
  createPreGatesCheckpoint,
  markGatesPassed,
  getCheckpoint,
  clearCheckpoint,
  canSkipGates,
} from '../wu-checkpoint.js';

describe('wu-checkpoint', () => {
  let tempDir: string;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'wu-checkpoint-test-'));
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(async () => {
    consoleSpy.mockRestore();
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('CHECKPOINT_SCHEMA_VERSION', () => {
    it('should export schema version', () => {
      expect(CHECKPOINT_SCHEMA_VERSION).toBeDefined();
      expect(typeof CHECKPOINT_SCHEMA_VERSION).toBe('number');
    });

    it('should be version 1', () => {
      expect(CHECKPOINT_SCHEMA_VERSION).toBe(1);
    });
  });

  describe('createPreGatesCheckpoint', () => {
    it('should create checkpoint file with correct structure', async () => {
      const checkpoint = await createPreGatesCheckpoint(
        {
          wuId: 'WU-100',
          worktreePath: tempDir,
          branchName: 'lane/framework-core/wu-100',
        },
        { baseDir: tempDir },
      );

      expect(checkpoint.schemaVersion).toBe(CHECKPOINT_SCHEMA_VERSION);
      expect(checkpoint.wuId).toBe('WU-100');
      expect(checkpoint.worktreePath).toBe(tempDir);
      expect(checkpoint.branchName).toBe('lane/framework-core/wu-100');
      expect(checkpoint.checkpointId).toMatch(/^ckpt-[a-f0-9]{8}$/);
      expect(checkpoint.createdAt).toBeDefined();
      expect(checkpoint.gatesPassed).toBe(false);
      expect(checkpoint.gatesPassedAt).toBeNull();
    });

    it('should create checkpoints directory if not exists', async () => {
      const checkpointDir = path.join(tempDir, '.lumenflow', 'checkpoints');
      expect(existsSync(checkpointDir)).toBe(false);

      await createPreGatesCheckpoint(
        {
          wuId: 'WU-200',
          worktreePath: tempDir,
          branchName: 'lane/ops/wu-200',
        },
        { baseDir: tempDir },
      );

      expect(existsSync(checkpointDir)).toBe(true);
    });

    it('should write checkpoint file to disk', async () => {
      await createPreGatesCheckpoint(
        {
          wuId: 'WU-300',
          worktreePath: tempDir,
          branchName: 'lane/test/wu-300',
        },
        { baseDir: tempDir },
      );

      const checkpointPath = path.join(
        tempDir,
        '.lumenflow',
        'checkpoints',
        'WU-300.checkpoint.json',
      );
      expect(existsSync(checkpointPath)).toBe(true);

      const content = await readFile(checkpointPath, 'utf-8');
      const parsed = JSON.parse(content);
      expect(parsed.wuId).toBe('WU-300');
    });

    it('should set gatesPassed to true when option provided', async () => {
      const checkpoint = await createPreGatesCheckpoint(
        {
          wuId: 'WU-400',
          worktreePath: tempDir,
          branchName: 'lane/test/wu-400',
          gatesPassed: true,
        },
        { baseDir: tempDir },
      );

      expect(checkpoint.gatesPassed).toBe(true);
      expect(checkpoint.gatesPassedAt).toBeDefined();
    });

    it('should log success message', async () => {
      await createPreGatesCheckpoint(
        {
          wuId: 'WU-500',
          worktreePath: tempDir,
          branchName: 'lane/test/wu-500',
        },
        { baseDir: tempDir },
      );

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('WU-500'));
    });
  });

  describe('getCheckpoint', () => {
    it('should return null if checkpoint does not exist', () => {
      const result = getCheckpoint('WU-NONEXISTENT', { baseDir: tempDir });
      expect(result).toBeNull();
    });

    it('should return checkpoint data if exists', async () => {
      await createPreGatesCheckpoint(
        {
          wuId: 'WU-600',
          worktreePath: tempDir,
          branchName: 'lane/test/wu-600',
        },
        { baseDir: tempDir },
      );

      const result = getCheckpoint('WU-600', { baseDir: tempDir });

      expect(result).not.toBeNull();
      expect(result?.wuId).toBe('WU-600');
    });

    it('should return null if checkpoint file is corrupted', async () => {
      // Create directory and corrupted checkpoint file
      const checkpointDir = path.join(tempDir, '.lumenflow', 'checkpoints');
      await mkdir(checkpointDir, { recursive: true });
      const checkpointPath = path.join(checkpointDir, 'WU-CORRUPT.checkpoint.json');
      await writeFile(checkpointPath, 'not valid json {{{');

      const result = getCheckpoint('WU-CORRUPT', { baseDir: tempDir });
      expect(result).toBeNull();
    });
  });

  describe('markGatesPassed', () => {
    it('should return false if checkpoint does not exist', () => {
      const result = markGatesPassed('WU-NONEXISTENT', { baseDir: tempDir });
      expect(result).toBe(false);
    });

    it('should update checkpoint with gatesPassed true', async () => {
      await createPreGatesCheckpoint(
        {
          wuId: 'WU-700',
          worktreePath: tempDir,
          branchName: 'lane/test/wu-700',
        },
        { baseDir: tempDir },
      );

      const result = markGatesPassed('WU-700', { baseDir: tempDir });

      expect(result).toBe(true);

      const checkpoint = getCheckpoint('WU-700', { baseDir: tempDir });
      expect(checkpoint?.gatesPassed).toBe(true);
      expect(checkpoint?.gatesPassedAt).toBeDefined();
    });

    it('should log success message', async () => {
      await createPreGatesCheckpoint(
        {
          wuId: 'WU-750',
          worktreePath: tempDir,
          branchName: 'lane/test/wu-750',
        },
        { baseDir: tempDir },
      );

      consoleSpy.mockClear();
      markGatesPassed('WU-750', { baseDir: tempDir });

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('WU-750'));
    });
  });

  describe('clearCheckpoint', () => {
    it('should remove checkpoint file if exists', async () => {
      await createPreGatesCheckpoint(
        {
          wuId: 'WU-800',
          worktreePath: tempDir,
          branchName: 'lane/test/wu-800',
        },
        { baseDir: tempDir },
      );

      const checkpointPath = path.join(
        tempDir,
        '.lumenflow',
        'checkpoints',
        'WU-800.checkpoint.json',
      );
      expect(existsSync(checkpointPath)).toBe(true);

      clearCheckpoint('WU-800', { baseDir: tempDir });

      expect(existsSync(checkpointPath)).toBe(false);
    });

    it('should not throw if checkpoint does not exist', () => {
      expect(() => {
        clearCheckpoint('WU-NONEXISTENT', { baseDir: tempDir });
      }).not.toThrow();
    });

    it('should log success message when clearing existing checkpoint', async () => {
      await createPreGatesCheckpoint(
        {
          wuId: 'WU-850',
          worktreePath: tempDir,
          branchName: 'lane/test/wu-850',
        },
        { baseDir: tempDir },
      );

      consoleSpy.mockClear();
      clearCheckpoint('WU-850', { baseDir: tempDir });

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('WU-850'));
    });
  });

  describe('canSkipGates', () => {
    it('should return canSkip: false if no checkpoint exists', () => {
      const result = canSkipGates('WU-NONEXISTENT', { baseDir: tempDir });

      expect(result.canSkip).toBe(false);
      expect(result.reason).toContain('No checkpoint');
    });

    it('should return canSkip: false if gates did not pass', async () => {
      await createPreGatesCheckpoint(
        {
          wuId: 'WU-900',
          worktreePath: tempDir,
          branchName: 'lane/test/wu-900',
        },
        { baseDir: tempDir },
      );

      const result = canSkipGates('WU-900', { baseDir: tempDir });

      expect(result.canSkip).toBe(false);
      expect(result.reason).toContain('did not pass');
    });

    it('should return canSkip: false if schema version mismatch', async () => {
      // Create checkpoint with wrong schema version
      const checkpointDir = path.join(tempDir, '.lumenflow', 'checkpoints');
      await mkdir(checkpointDir, { recursive: true });
      const checkpointPath = path.join(checkpointDir, 'WU-SCHEMA.checkpoint.json');
      await writeFile(
        checkpointPath,
        JSON.stringify({
          schemaVersion: 999,
          wuId: 'WU-SCHEMA',
          gatesPassed: true,
          createdAt: new Date().toISOString(),
        }),
      );

      const result = canSkipGates('WU-SCHEMA', { baseDir: tempDir });

      expect(result.canSkip).toBe(false);
      expect(result.reason).toContain('schema version mismatch');
    });

    it('should return canSkip: false if checkpoint is stale (>24h)', async () => {
      // Create checkpoint with old timestamp
      const checkpointDir = path.join(tempDir, '.lumenflow', 'checkpoints');
      await mkdir(checkpointDir, { recursive: true });
      const checkpointPath = path.join(checkpointDir, 'WU-STALE.checkpoint.json');

      const staleDate = new Date();
      staleDate.setHours(staleDate.getHours() - 25); // 25 hours ago

      await writeFile(
        checkpointPath,
        JSON.stringify({
          schemaVersion: CHECKPOINT_SCHEMA_VERSION,
          wuId: 'WU-STALE',
          gatesPassed: true,
          gatesPassedAt: staleDate.toISOString(),
          createdAt: staleDate.toISOString(),
          worktreeHeadSha: 'abc123',
        }),
      );

      const result = canSkipGates('WU-STALE', { baseDir: tempDir });

      expect(result.canSkip).toBe(false);
      expect(result.reason).toContain('stale');
    });

    it('should return canSkip: false if SHA mismatch', async () => {
      await createPreGatesCheckpoint(
        {
          wuId: 'WU-SHA',
          worktreePath: tempDir,
          branchName: 'lane/test/wu-sha',
          gatesPassed: true,
        },
        { baseDir: tempDir },
      );

      const result = canSkipGates('WU-SHA', {
        baseDir: tempDir,
        currentHeadSha: 'completely-different-sha',
      });

      expect(result.canSkip).toBe(false);
      expect(result.reason).toContain('SHA mismatch');
    });

    it('should return canSkip: true if all conditions met', async () => {
      // Create checkpoint
      await createPreGatesCheckpoint(
        {
          wuId: 'WU-SKIP',
          worktreePath: tempDir,
          branchName: 'lane/test/wu-skip',
          gatesPassed: true,
        },
        { baseDir: tempDir },
      );

      // Get the checkpoint to know the SHA
      const checkpoint = getCheckpoint('WU-SKIP', { baseDir: tempDir });

      const result = canSkipGates('WU-SKIP', {
        baseDir: tempDir,
        currentHeadSha: checkpoint?.worktreeHeadSha,
      });

      expect(result.canSkip).toBe(true);
      expect(result.checkpoint).toBeDefined();
      expect(result.checkpoint?.wuId).toBe('WU-SKIP');
    });

    it('should return canSkip: true if no currentHeadSha provided (skip SHA check)', async () => {
      await createPreGatesCheckpoint(
        {
          wuId: 'WU-NOSHA',
          worktreePath: tempDir,
          branchName: 'lane/test/wu-nosha',
          gatesPassed: true,
        },
        { baseDir: tempDir },
      );

      const result = canSkipGates('WU-NOSHA', { baseDir: tempDir });

      expect(result.canSkip).toBe(true);
    });

    it('should log success message when gates can be skipped', async () => {
      await createPreGatesCheckpoint(
        {
          wuId: 'WU-LOG',
          worktreePath: tempDir,
          branchName: 'lane/test/wu-log',
          gatesPassed: true,
        },
        { baseDir: tempDir },
      );

      consoleSpy.mockClear();
      canSkipGates('WU-LOG', { baseDir: tempDir });

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('skipped'));
    });
  });
});
