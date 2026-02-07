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

import { describe, it, expect } from 'vitest';
import { resolveClaimMode } from '../wu-claim-mode.js';
import { validateManualTestsForClaim, buildRollbackYamlDoc } from '../wu-claim.js';
import { CLAIMED_MODES, WU_STATUS } from '@lumenflow/core/dist/wu-constants.js';

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

/**
 * WU-1495: Cloud auto-detection integration with wu:claim
 *
 * Tests that resolveClaimMode correctly handles cloud=true from any detection source.
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
