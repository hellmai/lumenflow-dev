/**
 * @file wu-claim.test.ts
 * @description Tests for wu:claim cloud mode and branch-pr mode resolution
 *
 * WU-1491: Add wu:claim cloud mode and branch-pr mode resolution
 * WU-1495: Cloud auto-detection integration tests
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
import { validateManualTestsForClaim } from '../wu-claim.js';
import { CLAIMED_MODES } from '@lumenflow/core/dist/wu-constants.js';

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
