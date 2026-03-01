// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * @file wu-claim.test.ts
 * @description Tests for wu:claim cloud mode and branch-pr mode resolution
 *
 * WU-1491: Add wu:claim cloud mode and branch-pr mode resolution
 * WU-1495: Cloud auto-detection integration tests
 * WU-1521: Transaction safety - rollback YAML on partial failure
 *
 * Tests the mode resolution matrix:
 * - default (no flags) -> worktree
 * - --branch-only -> branch-only
 * - --pr-mode -> worktree-pr
 * - --cloud -> branch-pr
 * - --branch-only --pr-mode -> branch-pr
 * - --cloud --branch-only (conflict) -> error
 */

import { describe, it, expect, vi } from 'vitest';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { LumenFlowConfig } from '@lumenflow/core/lumenflow-config-schema';
import { resolveClaimMode } from '../wu-claim-mode.js';
import {
  validateManualTestsForClaim,
  buildRollbackYamlDoc,
  resolveClaimStatus,
  recordClaimPickupEvidence,
  shouldApplyCanonicalClaimUpdate,
  resolveClaimBaselineRef,
  hasClaimPickupEvidence,
  shouldPersistClaimMetadataOnBranch,
  resolveDefaultClaimSandboxCommand,
  resolveClaimSandboxCommand,
  maybeLaunchClaimSandboxSession,
  toRelativeWorktreePathForStorage,
  resolveWuClaimBriefPolicyMode,
  maybeRunAutoBriefForClaim,
} from '../wu-claim.js';
import { CLAIMED_MODES, WU_STATUS } from '@lumenflow/core/wu-constants';
import { DELEGATION_REGISTRY_FILE_NAME } from '@lumenflow/core/delegation-registry-store';
import { resolveBranchClaimExecution } from '../wu-claim-cloud.js';

describe('wu-claim mode resolution (WU-1491)', () => {
  describe('resolveClaimMode', () => {
    it('should resolve default (no flags) to worktree mode', () => {
      const result = resolveClaimMode({});
      expect(result.mode).toBe(CLAIMED_MODES.WORKTREE);
      expect(result.error).toBeUndefined();
    });

    it('should resolve --branch-only to branch-only mode', () => {
      const result = resolveClaimMode({ branchOnly: true });
      expect(result.mode).toBe(CLAIMED_MODES.BRANCH_ONLY);
      expect(result.error).toBeUndefined();
    });

    it('should resolve --pr-mode to worktree-pr mode', () => {
      const result = resolveClaimMode({ prMode: true });
      expect(result.mode).toBe(CLAIMED_MODES.WORKTREE_PR);
      expect(result.error).toBeUndefined();
    });

    it('should resolve --cloud to branch-pr mode', () => {
      const result = resolveClaimMode({ cloud: true });
      expect(result.mode).toBe(CLAIMED_MODES.BRANCH_PR);
      expect(result.error).toBeUndefined();
    });

    it('should resolve --branch-only --pr-mode to branch-pr mode', () => {
      const result = resolveClaimMode({ branchOnly: true, prMode: true });
      expect(result.mode).toBe(CLAIMED_MODES.BRANCH_PR);
      expect(result.error).toBeUndefined();
    });

    it('should return error for --cloud --branch-only (conflicting flags)', () => {
      const result = resolveClaimMode({ cloud: true, branchOnly: true });
      expect(result.mode).toBeUndefined();
      expect(result.error).toBeDefined();
      expect(result.error).toContain('cloud');
      expect(result.error).toContain('branch-only');
    });

    it('should resolve --cloud with --pr-mode (cloud takes precedence, pr-mode is redundant)', () => {
      const result = resolveClaimMode({ cloud: true, prMode: true });
      expect(result.mode).toBe(CLAIMED_MODES.BRANCH_PR);
      expect(result.error).toBeUndefined();
    });
  });

  describe('branch-pr path guards', () => {
    it('should mark branch-pr as requiring lane lock check', () => {
      const result = resolveClaimMode({ cloud: true });
      expect(result.mode).toBe(CLAIMED_MODES.BRANCH_PR);
      expect(result.skipBranchOnlySingletonGuard).toBe(true);
      expect(result.requireLaneLock).toBe(true);
      expect(result.requireLaneWipCheck).toBe(true);
    });

    it('should mark branch-only as requiring singleton guard', () => {
      const result = resolveClaimMode({ branchOnly: true });
      expect(result.mode).toBe(CLAIMED_MODES.BRANCH_ONLY);
      expect(result.skipBranchOnlySingletonGuard).toBe(false);
      expect(result.requireLaneLock).toBe(true);
      expect(result.requireLaneWipCheck).toBe(true);
    });

    it('should mark worktree as not requiring singleton guard', () => {
      const result = resolveClaimMode({});
      expect(result.mode).toBe(CLAIMED_MODES.WORKTREE);
      expect(result.skipBranchOnlySingletonGuard).toBe(true);
      expect(result.requireLaneLock).toBe(true);
      expect(result.requireLaneWipCheck).toBe(true);
    });
  });
});

describe('wu-claim cloud branch execution resolution (WU-1596)', () => {
  it('reuses current branch and skips branch creation for cloud branch-pr claims', () => {
    const result = resolveBranchClaimExecution({
      claimedMode: CLAIMED_MODES.BRANCH_PR,
      isCloud: true,
      currentBranch: 'claude/session-1596',
      requestedBranch: 'lane/framework-cli-wu-commands/wu-1596',
    });

    expect(result.executionBranch).toBe('claude/session-1596');
    expect(result.shouldCreateBranch).toBe(false);
  });

  it('keeps requested branch and creates it for non-cloud branch-only flow', () => {
    const result = resolveBranchClaimExecution({
      claimedMode: CLAIMED_MODES.BRANCH_ONLY,
      isCloud: false,
      currentBranch: 'main',
      requestedBranch: 'lane/framework-cli-wu-commands/wu-1596',
    });

    expect(result.executionBranch).toBe('lane/framework-cli-wu-commands/wu-1596');
    expect(result.shouldCreateBranch).toBe(true);
  });
});

describe('WU-2247: claim worktree_path storage normalization', () => {
  it('converts absolute worktree path to repo-relative path for YAML storage', () => {
    const value = toRelativeWorktreePathForStorage(
      '/home/USER/source/hellmai/lumenflow-dev/worktrees/framework-core-lifecycle-wu-2247',
      '/home/USER/source/hellmai/lumenflow-dev',
    );

    expect(value).toBe('worktrees/framework-core-lifecycle-wu-2247');
  });

  it('keeps already-relative paths unchanged (normalized separators)', () => {
    const value = toRelativeWorktreePathForStorage(
      'worktrees\\framework-core-lifecycle-wu-2247',
      '/home/USER/source/hellmai/lumenflow-dev',
    );

    expect(value).toBe('worktrees/framework-core-lifecycle-wu-2247');
  });
});

describe('wu-claim local-only remote fallback behavior (WU-1655)', () => {
  it('should skip canonical claim update when --no-push is enabled', () => {
    const shouldApply = shouldApplyCanonicalClaimUpdate({
      isCloud: false,
      claimedMode: CLAIMED_MODES.WORKTREE,
      noPush: true,
    });

    expect(shouldApply).toBe(false);
  });

  it('should skip canonical claim update for cloud branch-pr mode', () => {
    const shouldApply = shouldApplyCanonicalClaimUpdate({
      isCloud: true,
      claimedMode: CLAIMED_MODES.BRANCH_PR,
      noPush: false,
    });

    expect(shouldApply).toBe(false);
  });

  it('should apply canonical claim update for local worktree mode', () => {
    const shouldApply = shouldApplyCanonicalClaimUpdate({
      isCloud: false,
      claimedMode: CLAIMED_MODES.WORKTREE,
      noPush: false,
    });

    expect(shouldApply).toBe(true);
  });

  it('should persist metadata on working branch when remote operations are skipped', () => {
    const shouldPersist = shouldPersistClaimMetadataOnBranch({
      claimedMode: CLAIMED_MODES.BRANCH_ONLY,
      noPush: false,
      skipRemote: true,
    });

    expect(shouldPersist).toBe(true);
  });

  it('should resolve baseline ref to local main when remote operations are skipped', () => {
    const localRef = resolveClaimBaselineRef({ skipRemote: true });
    const remoteRef = resolveClaimBaselineRef({ skipRemote: false });

    expect(localRef).toBe('main');
    expect(remoteRef).toBe('origin/main');
  });
});

/**
 * WU-1495: Cloud auto-detection integration with wu:claim
 *
 * Tests that resolveClaimMode correctly handles cloud=true from UnsafeAny detection source.
 * AC5: wu:claim --cloud with LUMENFLOW_CLOUD=1 already set does not conflict or double-apply.
 *
 * Note: Full detectCloudMode integration tests are in core/cloud-detect.test.ts.
 * These tests verify that resolveClaimMode accepts the boolean output correctly.
 */
describe('wu-claim cloud auto-detection integration (WU-1495)', () => {
  describe('AC5: resolveClaimMode handles cloud detection output', () => {
    it('should resolve to branch-pr when cloud detection returns true (flag source)', () => {
      // Simulates: detectCloudMode returned isCloud=true from --cloud flag
      const mode = resolveClaimMode({ cloud: true });
      expect(mode.mode).toBe(CLAIMED_MODES.BRANCH_PR);
      expect(mode.error).toBeUndefined();
    });

    it('should resolve to branch-pr when cloud detection returns true (env var source)', () => {
      // Simulates: detectCloudMode returned isCloud=true from LUMENFLOW_CLOUD=1
      // resolveClaimMode receives cloud=true regardless of source
      const mode = resolveClaimMode({ cloud: true });
      expect(mode.mode).toBe(CLAIMED_MODES.BRANCH_PR);
      expect(mode.error).toBeUndefined();
    });

    it('should resolve to branch-pr when cloud detection returns true (env signal source)', () => {
      // Simulates: detectCloudMode returned isCloud=true from env_signal auto-detect
      // resolveClaimMode receives cloud=true regardless of source
      const mode = resolveClaimMode({ cloud: true });
      expect(mode.mode).toBe(CLAIMED_MODES.BRANCH_PR);
      expect(mode.error).toBeUndefined();
    });

    it('should resolve to default worktree when cloud detection returns false', () => {
      // Simulates: detectCloudMode returned isCloud=false
      const mode = resolveClaimMode({ cloud: false });
      expect(mode.mode).toBe(CLAIMED_MODES.WORKTREE);
      expect(mode.error).toBeUndefined();
    });

    it('should not conflict when cloud=true and branchOnly is not set', () => {
      // AC5: --cloud with LUMENFLOW_CLOUD=1 -> cloud=true, no branchOnly conflict
      const mode = resolveClaimMode({ cloud: true });
      expect(mode.mode).toBe(CLAIMED_MODES.BRANCH_PR);
      expect(mode.error).toBeUndefined();
      expect(mode.skipBranchOnlySingletonGuard).toBe(true);
    });
  });
});

describe('wu-claim manual test requirement policy (WU-1508)', () => {
  it('should allow documentation WUs without tests.manual', () => {
    const result = validateManualTestsForClaim(
      {
        id: 'WU-1508',
        type: 'documentation',
        tests: { unit: [], e2e: [] },
      },
      'WU-1508',
    );
    expect(result.valid).toBe(true);
  });

  it('should block non-doc WUs missing tests.manual even when unit tests exist', () => {
    const result = validateManualTestsForClaim(
      {
        id: 'WU-1508',
        type: 'feature',
        tests: { unit: ['packages/x.test.ts'], manual: [] },
      },
      'WU-1508',
    );
    expect(result.valid).toBe(false);
    expect(result.error).toContain('tests.manual');
  });

  it('should allow non-doc WUs when tests.manual is present', () => {
    const result = validateManualTestsForClaim(
      {
        id: 'WU-1508',
        type: 'feature',
        tests: { manual: ['Navigate to /settings and verify'] },
      },
      'WU-1508',
    );
    expect(result.valid).toBe(true);
  });
});

/**
 * WU-1521: Transaction safety - rollback YAML on partial failure
 *
 * Tests that buildRollbackYamlDoc correctly strips claim metadata from a
 * WU YAML doc and resets status to 'ready', enabling clean retry after
 * a failed wu:claim.
 */
describe('wu-claim transaction safety (WU-1521)', () => {
  describe('buildRollbackYamlDoc', () => {
    it('should reset status from in_progress back to ready', () => {
      const claimedDoc = {
        id: 'WU-1521',
        title: 'Test WU',
        lane: 'Framework: CLI',
        status: WU_STATUS.IN_PROGRESS,
        type: 'feature',
        assigned_to: 'agent@test.com',
        claimed_mode: 'worktree',
        claimed_at: '2026-01-01T00:00:00Z',
        worktree_path: '/tmp/worktree',
        baseline_main_sha: 'abc123',
        session_id: 'sess-123',
        approved_by: 'agent@test.com',
        approved_at: '2026-01-01T00:00:00Z',
      };

      const rolledBack = buildRollbackYamlDoc(claimedDoc);
      expect(rolledBack.status).toBe(WU_STATUS.READY);
    });

    it('should remove claim-specific metadata fields', () => {
      const claimedDoc = {
        id: 'WU-1521',
        title: 'Test WU',
        lane: 'Framework: CLI',
        status: WU_STATUS.IN_PROGRESS,
        type: 'feature',
        assigned_to: 'agent@test.com',
        claimed_mode: 'worktree',
        claimed_at: '2026-01-01T00:00:00Z',
        worktree_path: '/tmp/worktree',
        baseline_main_sha: 'abc123',
        session_id: 'sess-123',
        approved_by: 'agent@test.com',
        approved_at: '2026-01-01T00:00:00Z',
      };

      const rolledBack = buildRollbackYamlDoc(claimedDoc);

      // These claim-specific fields should be removed
      expect(rolledBack.claimed_mode).toBeUndefined();
      expect(rolledBack.claimed_at).toBeUndefined();
      expect(rolledBack.worktree_path).toBeUndefined();
      expect(rolledBack.baseline_main_sha).toBeUndefined();
      expect(rolledBack.session_id).toBeUndefined();
    });

    it('should preserve non-claim fields like id, title, lane, type', () => {
      const claimedDoc = {
        id: 'WU-1521',
        title: 'Test WU',
        lane: 'Framework: CLI',
        status: WU_STATUS.IN_PROGRESS,
        type: 'feature',
        priority: 'P2',
        description: 'Test description',
        acceptance: ['Criterion 1'],
        code_paths: ['src/file.ts'],
        assigned_to: 'agent@test.com',
        claimed_mode: 'worktree',
        claimed_at: '2026-01-01T00:00:00Z',
      };

      const rolledBack = buildRollbackYamlDoc(claimedDoc);

      expect(rolledBack.id).toBe('WU-1521');
      expect(rolledBack.title).toBe('Test WU');
      expect(rolledBack.lane).toBe('Framework: CLI');
      expect(rolledBack.type).toBe('feature');
      expect(rolledBack.priority).toBe('P2');
      expect(rolledBack.description).toBe('Test description');
      expect(rolledBack.acceptance).toEqual(['Criterion 1']);
      expect(rolledBack.code_paths).toEqual(['src/file.ts']);
    });

    it('should clear assigned_to so claim is retryable', () => {
      const claimedDoc = {
        id: 'WU-1521',
        title: 'Test WU',
        status: WU_STATUS.IN_PROGRESS,
        assigned_to: 'agent@test.com',
        claimed_mode: 'worktree',
        claimed_at: '2026-01-01T00:00:00Z',
      };

      const rolledBack = buildRollbackYamlDoc(claimedDoc);

      // assigned_to should be cleared so re-claim works
      expect(rolledBack.assigned_to).toBeUndefined();
    });

    // WU-1589: AC4 - buildRollbackYamlDoc should also clear claimed_branch
    it('should clear claimed_branch when rolling back (WU-1589)', () => {
      const claimedDoc = {
        id: 'WU-1589',
        title: 'Cloud Foundation WU',
        lane: 'Framework: Core Lifecycle',
        status: WU_STATUS.IN_PROGRESS,
        type: 'feature',
        assigned_to: 'agent@test.com',
        claimed_mode: 'branch-pr',
        claimed_branch: 'codex/feature-cloud-branch',
        claimed_at: '2026-02-12T00:00:00Z',
        worktree_path: null,
        baseline_main_sha: 'def456',
        session_id: 'sess-456',
      };

      const rolledBack = buildRollbackYamlDoc(claimedDoc);

      expect(rolledBack.status).toBe(WU_STATUS.READY);
      expect(rolledBack.claimed_mode).toBeUndefined();
      expect(rolledBack.claimed_branch).toBeUndefined();
      expect(rolledBack.claimed_at).toBeUndefined();
      expect(rolledBack.assigned_to).toBeUndefined();
    });

    it('should handle doc that is already in ready status (no-op)', () => {
      const readyDoc = {
        id: 'WU-1521',
        title: 'Test WU',
        status: WU_STATUS.READY,
        type: 'feature',
      };

      const rolledBack = buildRollbackYamlDoc(readyDoc);

      expect(rolledBack.status).toBe(WU_STATUS.READY);
      expect(rolledBack.id).toBe('WU-1521');
    });

    it('should not mutate the original document', () => {
      const claimedDoc = {
        id: 'WU-1521',
        title: 'Test WU',
        status: WU_STATUS.IN_PROGRESS,
        assigned_to: 'agent@test.com',
        claimed_mode: 'worktree',
        claimed_at: '2026-01-01T00:00:00Z',
      };

      const originalStatus = claimedDoc.status;
      buildRollbackYamlDoc(claimedDoc);

      // Original doc should not be mutated
      expect(claimedDoc.status).toBe(originalStatus);
      expect(claimedDoc.assigned_to).toBe('agent@test.com');
      expect(claimedDoc.claimed_mode).toBe('worktree');
    });
  });
});

describe('WU-1574: strict claim status helpers', () => {
  it('resolveClaimStatus returns canonical status when valid', () => {
    expect(resolveClaimStatus(WU_STATUS.BLOCKED)).toBe(WU_STATUS.BLOCKED);
  });

  it('resolveClaimStatus falls back to ready for unknown values', () => {
    expect(resolveClaimStatus(undefined)).toBe(WU_STATUS.READY);
    expect(resolveClaimStatus('invalid-status')).toBe(WU_STATUS.READY);
  });
});

describe('WU-1605: claim-time pickup evidence handshake', () => {
  it('detects when pickup evidence fields are present and non-empty', () => {
    expect(
      hasClaimPickupEvidence({
        pickedUpAt: '2026-02-12T00:05:00.000Z',
        pickedUpBy: 'agent@test.com',
      }),
    ).toBe(true);
  });

  it('returns false when pickup evidence is missing or blank', () => {
    expect(hasClaimPickupEvidence({ pickedUpAt: '', pickedUpBy: 'agent@test.com' })).toBe(false);
    expect(hasClaimPickupEvidence({ pickedUpAt: '2026-02-12T00:05:00.000Z', pickedUpBy: '' })).toBe(
      false,
    );
    expect(hasClaimPickupEvidence({})).toBe(false);
  });

  function createTempStateDir() {
    const baseDir = join(
      tmpdir(),
      `wu-1605-claim-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(join(baseDir, '.lumenflow', 'state'), { recursive: true });
    return baseDir;
  }

  it('records pickup evidence when delegation intent exists for target WU', async () => {
    const baseDir = createTempStateDir();
    const registryPath = join(baseDir, '.lumenflow', 'state', DELEGATION_REGISTRY_FILE_NAME);
    writeFileSync(
      registryPath,
      JSON.stringify({
        id: 'dlg-a1b2',
        parentWuId: 'WU-1000',
        targetWuId: 'WU-1605',
        lane: 'Framework: CLI WU Commands',
        intent: 'delegation',
        delegatedAt: '2026-02-12T00:00:00.000Z',
        status: 'pending',
        completedAt: null,
      }) + '\n',
      'utf-8',
    );

    try {
      const result = await recordClaimPickupEvidence('WU-1605', {
        baseDir,
        claimedBy: 'agent@test.com',
      });

      expect(result.matchedSpawn).toBe(true);
      expect(result.recorded).toBe(true);
      expect(result.alreadyRecorded).toBe(false);

      const lines = readFileSync(registryPath, 'utf-8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      const last = lines[lines.length - 1];
      expect(last.id).toBe('dlg-a1b2');
      expect(last.targetWuId).toBe('WU-1605');
      expect(last.pickedUpBy).toBe('agent@test.com');
      expect(typeof last.pickedUpAt).toBe('string');
      expect(last.pickedUpAt.length).toBeGreaterThan(0);
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });

  it('returns no-op when no spawn intent exists for the target WU', async () => {
    const baseDir = createTempStateDir();

    try {
      const result = await recordClaimPickupEvidence('WU-1605', {
        baseDir,
        claimedBy: 'agent@test.com',
      });

      expect(result.matchedSpawn).toBe(false);
      expect(result.recorded).toBe(false);
      expect(result.alreadyRecorded).toBe(false);
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });

  it('does not append duplicate pickup evidence when already recorded', async () => {
    const baseDir = createTempStateDir();
    const registryPath = join(baseDir, '.lumenflow', 'state', DELEGATION_REGISTRY_FILE_NAME);
    writeFileSync(
      registryPath,
      JSON.stringify({
        id: 'dlg-a1b2',
        parentWuId: 'WU-1000',
        targetWuId: 'WU-1605',
        lane: 'Framework: CLI WU Commands',
        intent: 'delegation',
        delegatedAt: '2026-02-12T00:00:00.000Z',
        pickedUpAt: '2026-02-12T00:05:00.000Z',
        pickedUpBy: 'agent@test.com',
        status: 'pending',
        completedAt: null,
      }) + '\n',
      'utf-8',
    );

    try {
      const result = await recordClaimPickupEvidence('WU-1605', {
        baseDir,
        claimedBy: 'agent@test.com',
      });

      expect(result.matchedSpawn).toBe(true);
      expect(result.recorded).toBe(false);
      expect(result.alreadyRecorded).toBe(true);

      const lines = readFileSync(registryPath, 'utf-8').trim().split('\n');
      expect(lines).toHaveLength(1);
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });
});

describe('WU-2287: wu:brief policy automation on wu:claim', () => {
  it('defaults policy mode to auto when config omits wu.brief.policyMode', () => {
    const mode = resolveWuClaimBriefPolicyMode({
      wu: {},
    } as LumenFlowConfig);

    expect(mode).toBe('auto');
  });

  it('returns configured policy mode when valid', () => {
    const mode = resolveWuClaimBriefPolicyMode({
      wu: {
        brief: {
          policyMode: 'manual',
        },
      },
    } as LumenFlowConfig);

    expect(mode).toBe('manual');
  });

  it('skips auto-brief for off/manual policies', async () => {
    const recordEvidence = vi.fn(async () => undefined);
    const logger = {
      log: vi.fn(),
      warn: vi.fn(),
    };

    const offResult = await maybeRunAutoBriefForClaim(
      {
        wuId: 'WU-2287',
        workspaceRoot: '/tmp/wu-2287',
        policyMode: 'off',
      },
      { recordEvidence, logger },
    );
    const manualResult = await maybeRunAutoBriefForClaim(
      {
        wuId: 'WU-2287',
        workspaceRoot: '/tmp/wu-2287',
        policyMode: 'manual',
      },
      { recordEvidence, logger },
    );

    expect(offResult.attempted).toBe(false);
    expect(manualResult.attempted).toBe(false);
    expect(recordEvidence).not.toHaveBeenCalled();
    expect(logger.log).toHaveBeenCalledWith('[wu-claim] wu:brief auto-run skipped (policy=off).');
    expect(logger.log).toHaveBeenCalledWith(
      '[wu-claim] wu:brief auto-run skipped (policy=manual).',
    );
  });

  it('runs evidence recorder for auto policy and logs success', async () => {
    const recordEvidence = vi.fn(async () => undefined);
    const logger = {
      log: vi.fn(),
      warn: vi.fn(),
    };

    const result = await maybeRunAutoBriefForClaim(
      {
        wuId: 'WU-2287',
        workspaceRoot: '/tmp/wu-2287',
        policyMode: 'auto',
        claimedMode: 'worktree',
      },
      { recordEvidence, logger },
    );

    expect(result.attempted).toBe(true);
    expect(recordEvidence).toHaveBeenCalledWith({
      wuId: 'WU-2287',
      workspaceRoot: '/tmp/wu-2287',
      clientName: 'wu:claim:auto',
      claimedMode: 'worktree',
      claimedBranch: undefined,
    });
    expect(logger.log).toHaveBeenCalledWith(
      '[wu-claim] ✅ wu:brief auto-run completed (policy=auto).',
    );
  });

  it('treats auto policy failures as non-blocking and logs warning', async () => {
    const recordEvidence = vi.fn(async () => {
      throw new Error('disk is read-only');
    });
    const logger = {
      log: vi.fn(),
      warn: vi.fn(),
    };

    await expect(
      maybeRunAutoBriefForClaim(
        {
          wuId: 'WU-2287',
          workspaceRoot: '/tmp/wu-2287',
          policyMode: 'auto',
        },
        { recordEvidence, logger },
      ),
    ).resolves.toEqual({ attempted: true, mode: 'auto' });
    expect(logger.warn).toHaveBeenCalledWith(
      '[wu-claim] Warning: wu:brief auto-run failed (policy=auto): disk is read-only',
    );
  });

  it('fails claim when required policy cannot record wu:brief evidence', async () => {
    const recordEvidence = vi.fn(async () => {
      throw new Error('state store unavailable');
    });
    const logger = {
      log: vi.fn(),
      warn: vi.fn(),
    };

    await expect(
      maybeRunAutoBriefForClaim(
        {
          wuId: 'WU-2287',
          workspaceRoot: '/tmp/wu-2287',
          policyMode: 'required',
        },
        { recordEvidence, logger },
      ),
    ).rejects.toThrow('wu:brief auto-run failed (policy=required): state store unavailable');
  });
});

describe('WU-1687: claim sandbox launch helpers', () => {
  it('uses explicit sandbox command from argv when provided', () => {
    const command = resolveClaimSandboxCommand([
      'node',
      'wu-claim',
      '--id',
      'WU-1687',
      '--lane',
      'Framework: CLI Enforcement',
      '--sandbox',
      '--',
      'node',
      '-v',
    ]);

    expect(command).toEqual(['node', '-v']);
  });

  it('falls back to SHELL when no explicit sandbox command is provided', () => {
    const command = resolveClaimSandboxCommand(
      ['node', 'wu-claim', '--id', 'WU-1687', '--lane', 'Framework: CLI Enforcement', '--sandbox'],
      { SHELL: '/bin/zsh' },
      'linux',
    );

    expect(command).toEqual(['/bin/zsh']);
  });

  it('defaults to powershell on win32 when shell is not configured', () => {
    const command = resolveDefaultClaimSandboxCommand({}, 'win32');

    expect(command).toEqual(['powershell.exe', '-NoLogo']);
  });

  it('launches sandbox runner with resolved command and worktree path', async () => {
    const launchSandbox = vi.fn(async () => 0);

    const exitCode = await maybeLaunchClaimSandboxSession(
      {
        enabled: true,
        id: 'WU-1687',
        worktreePath: '/tmp/wu-1687',
        argv: [
          'node',
          'wu-claim',
          '--id',
          'WU-1687',
          '--lane',
          'Framework: CLI Enforcement',
          '--sandbox',
          '--',
          'node',
          '-e',
          'process.exit(0)',
        ],
      },
      { launchSandbox },
    );

    expect(exitCode).toBe(0);
    expect(launchSandbox).toHaveBeenCalledWith({
      id: 'WU-1687',
      worktree: '/tmp/wu-1687',
      command: ['node', '-e', 'process.exit(0)'],
    });
  });

  it('returns null when sandbox launch is disabled', async () => {
    const launchSandbox = vi.fn(async () => 0);

    const exitCode = await maybeLaunchClaimSandboxSession(
      {
        enabled: false,
        id: 'WU-1687',
        worktreePath: '/tmp/wu-1687',
      },
      { launchSandbox },
    );

    expect(exitCode).toBeNull();
    expect(launchSandbox).not.toHaveBeenCalled();
  });
});
