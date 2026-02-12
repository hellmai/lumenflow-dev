/**
 * @file wu-cloud-lifecycle.test.ts
 * @description Tests for cloud lifecycle: create, claim, prep, done, cleanup in branch-pr mode
 *
 * WU-1590: Tests all 6 acceptance criteria for cloud agent lifecycle paths.
 *
 * AC1: wu:create --cloud writes and commits on current branch (no ensureOnMain/micro-worktree)
 * AC2: wu:claim --cloud persists claimed_branch, bypasses branch-exists checks
 * AC3: wu:done branch-pr preflight skips ensureOnMain, validates code_paths against HEAD
 * AC4: wu:prep branch-pr validates against claimed_branch via defaultBranchFrom() resolver
 * AC5: wu:cleanup resolves claimed_branch, verifies merged PR, skips worktree-only checks
 * AC6: Coverage for create/claim/prep/done/cleanup branch-pr paths
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { CLAIMED_MODES } from '@lumenflow/core/wu-constants';

afterEach(() => {
  vi.resetModules();
  vi.doUnmock('@lumenflow/core');
});

// --- AC1: wu:create --cloud path ---
describe('wu:create --cloud path (WU-1590 AC1)', () => {
  describe('buildCloudCreateContext', () => {
    it('should detect cloud mode from --cloud flag', async () => {
      const { buildCloudCreateContext } = await import('../wu-create-cloud.js');
      const ctx = buildCloudCreateContext({
        cloud: true,
        currentBranch: 'claude/feature-xyz',
      });

      expect(ctx.isCloud).toBe(true);
      expect(ctx.skipEnsureOnMain).toBe(true);
      expect(ctx.skipMicroWorktree).toBe(true);
      expect(ctx.targetBranch).toBe('claude/feature-xyz');
    });

    it('should not be cloud mode when --cloud is false', async () => {
      const { buildCloudCreateContext } = await import('../wu-create-cloud.js');
      const ctx = buildCloudCreateContext({
        cloud: false,
        currentBranch: 'main',
      });

      expect(ctx.isCloud).toBe(false);
      expect(ctx.skipEnsureOnMain).toBe(false);
      expect(ctx.skipMicroWorktree).toBe(false);
    });

    it('should set targetBranch to the current branch in cloud mode', async () => {
      const { buildCloudCreateContext } = await import('../wu-create-cloud.js');
      const ctx = buildCloudCreateContext({
        cloud: true,
        currentBranch: 'codex/wu-1590-cloud-lifecycle',
      });

      expect(ctx.targetBranch).toBe('codex/wu-1590-cloud-lifecycle');
    });
  });
});

// --- AC2: wu:claim --cloud persists claimed_branch ---
describe('wu:claim --cloud claimed_branch persistence (WU-1590 AC2)', () => {
  describe('buildCloudClaimMetadata', () => {
    it('should persist claimed_branch from current branch in cloud mode', async () => {
      const { buildCloudClaimMetadata } = await import('../wu-claim-cloud.js');
      const metadata = buildCloudClaimMetadata({
        currentBranch: 'claude/feature-xyz',
        wuId: 'WU-1590',
        lane: 'Framework: CLI WU Commands',
      });

      expect(metadata.claimed_branch).toBe('claude/feature-xyz');
      expect(metadata.claimed_mode).toBe(CLAIMED_MODES.BRANCH_PR);
    });

    it('should set claimed_mode to branch-pr', async () => {
      const { buildCloudClaimMetadata } = await import('../wu-claim-cloud.js');
      const metadata = buildCloudClaimMetadata({
        currentBranch: 'codex/some-branch',
        wuId: 'WU-100',
        lane: 'Framework: Core',
      });

      expect(metadata.claimed_mode).toBe(CLAIMED_MODES.BRANCH_PR);
    });

    it('should skip remote branch-exists check flag for cloud claims', async () => {
      const { shouldSkipBranchExistsCheck } = await import('../wu-claim-cloud.js');
      const result = shouldSkipBranchExistsCheck({
        isCloud: true,
        currentBranch: 'claude/feature-xyz',
        laneBranch: 'lane/framework-cli/wu-1590',
      });

      expect(result).toBe(true);
    });

    it('should NOT skip branch-exists check for non-cloud claims', async () => {
      const { shouldSkipBranchExistsCheck } = await import('../wu-claim-cloud.js');
      const result = shouldSkipBranchExistsCheck({
        isCloud: false,
        currentBranch: 'main',
        laneBranch: 'lane/framework-cli/wu-1590',
      });

      expect(result).toBe(false);
    });
  });
});

describe('wu:claim cloud canonical update strategy (WU-1598)', () => {
  it('should skip canonical claim updates on origin/main for cloud branch-pr claims', async () => {
    const { shouldApplyCanonicalClaimUpdate } = await import('../wu-claim.js');
    const shouldApply = shouldApplyCanonicalClaimUpdate({
      isCloud: true,
      claimedMode: CLAIMED_MODES.BRANCH_PR,
      noPush: false,
    });

    expect(shouldApply).toBe(false);
  });

  it('should keep canonical claim updates for non-cloud worktree claims', async () => {
    const { shouldApplyCanonicalClaimUpdate } = await import('../wu-claim.js');
    const shouldApply = shouldApplyCanonicalClaimUpdate({
      isCloud: false,
      claimedMode: CLAIMED_MODES.WORKTREE,
      noPush: false,
    });

    expect(shouldApply).toBe(true);
  });

  it('should write claim metadata on working branch for cloud branch-pr claims', async () => {
    const { shouldPersistClaimMetadataOnBranch } = await import('../wu-claim.js');
    const shouldPersist = shouldPersistClaimMetadataOnBranch({
      claimedMode: CLAIMED_MODES.BRANCH_PR,
      noPush: false,
    });

    expect(shouldPersist).toBe(true);
  });
});

// --- AC3: wu:done branch-pr preflight skips ensureOnMain ---
describe('wu:done branch-pr preflight (WU-1590 AC3)', () => {
  describe('shouldSkipEnsureOnMainForDone', () => {
    it('should skip ensureOnMain when claimed_mode is branch-pr', async () => {
      const { shouldSkipEnsureOnMainForDone } = await import('../wu-done-cloud.js');
      const result = shouldSkipEnsureOnMainForDone({
        claimed_mode: CLAIMED_MODES.BRANCH_PR,
      });

      expect(result).toBe(true);
    });

    it('should NOT skip ensureOnMain for worktree mode', async () => {
      const { shouldSkipEnsureOnMainForDone } = await import('../wu-done-cloud.js');
      const result = shouldSkipEnsureOnMainForDone({
        claimed_mode: CLAIMED_MODES.WORKTREE,
      });

      expect(result).toBe(false);
    });

    it('should NOT skip ensureOnMain for branch-only mode', async () => {
      const { shouldSkipEnsureOnMainForDone } = await import('../wu-done-cloud.js');
      const result = shouldSkipEnsureOnMainForDone({
        claimed_mode: CLAIMED_MODES.BRANCH_ONLY,
      });

      expect(result).toBe(false);
    });
  });

  describe('validateBranchPrCodePathsAgainstHead', () => {
    it('should validate code_paths exist on current HEAD', async () => {
      const { validateBranchPrCodePathsAgainstHead } = await import('../wu-done-cloud.js');
      const result = validateBranchPrCodePathsAgainstHead({
        codePaths: ['packages/@lumenflow/cli/src/wu-create.ts'],
        existingFiles: ['packages/@lumenflow/cli/src/wu-create.ts'],
      });

      expect(result.valid).toBe(true);
      expect(result.missingPaths).toEqual([]);
    });

    it('should report missing code_paths that do not exist on HEAD', async () => {
      const { validateBranchPrCodePathsAgainstHead } = await import('../wu-done-cloud.js');
      const result = validateBranchPrCodePathsAgainstHead({
        codePaths: [
          'packages/@lumenflow/cli/src/wu-create.ts',
          'packages/@lumenflow/cli/src/nonexistent.ts',
        ],
        existingFiles: ['packages/@lumenflow/cli/src/wu-create.ts'],
      });

      expect(result.valid).toBe(false);
      expect(result.missingPaths).toContain('packages/@lumenflow/cli/src/nonexistent.ts');
    });

    it('should pass when codePaths is empty', async () => {
      const { validateBranchPrCodePathsAgainstHead } = await import('../wu-done-cloud.js');
      const result = validateBranchPrCodePathsAgainstHead({
        codePaths: [],
        existingFiles: [],
      });

      expect(result.valid).toBe(true);
    });
  });
});

// --- AC4: wu:prep branch-pr validates against claimed_branch ---
describe('wu:prep branch-pr claimed_branch resolution (WU-1590 AC4)', () => {
  it('defaultBranchFrom should prefer claimed_branch over lane-derived', async () => {
    const { defaultBranchFrom } = await import('@lumenflow/core/wu-done-paths');
    const doc = {
      id: 'wu-1590',
      lane: 'Framework: CLI WU Commands',
      claimed_branch: 'claude/feature-xyz',
    };

    const branch = defaultBranchFrom(doc);
    expect(branch).toBe('claude/feature-xyz');
  });

  it('defaultBranchFrom should fall back to lane-derived when no claimed_branch', async () => {
    const { defaultBranchFrom } = await import('@lumenflow/core/wu-done-paths');
    const doc = {
      id: 'wu-1590',
      lane: 'Framework: CLI WU Commands',
    };

    const branch = defaultBranchFrom(doc);
    expect(branch).toBe('lane/framework-cli-wu-commands/wu-1590');
  });
});

// --- AC5: wu:cleanup resolves claimed_branch ---
describe('wu:cleanup branch-pr mode (WU-1590 AC5)', () => {
  describe('resolveCleanupBranch', () => {
    it('should use claimed_branch when present in WU YAML', async () => {
      const { resolveCleanupBranch } = await import('../wu-cleanup-cloud.js');
      const result = resolveCleanupBranch({
        claimed_branch: 'claude/feature-xyz',
        lane: 'Framework: CLI WU Commands',
        id: 'wu-1590',
      });

      expect(result).toBe('claude/feature-xyz');
    });

    it('should fall back to lane-derived branch when no claimed_branch', async () => {
      const { resolveCleanupBranch } = await import('../wu-cleanup-cloud.js');
      const result = resolveCleanupBranch({
        lane: 'Framework: CLI WU Commands',
        id: 'wu-1590',
      });

      expect(result).toBe('lane/framework-cli-wu-commands/wu-1590');
    });
  });

  describe('shouldSkipWorktreeChecks', () => {
    it('should skip worktree checks in branch-pr mode', async () => {
      const { shouldSkipWorktreeChecks } = await import('../wu-cleanup-cloud.js');
      const result = shouldSkipWorktreeChecks({
        claimed_mode: CLAIMED_MODES.BRANCH_PR,
      });

      expect(result).toBe(true);
    });

    it('should NOT skip worktree checks in worktree mode', async () => {
      const { shouldSkipWorktreeChecks } = await import('../wu-cleanup-cloud.js');
      const result = shouldSkipWorktreeChecks({
        claimed_mode: CLAIMED_MODES.WORKTREE,
      });

      expect(result).toBe(false);
    });
  });

  describe('isCloudManagedBranch', () => {
    it('should protect claude/codex via fallback prefixes without calling agent matcher', async () => {
      const isAgentBranch = vi.fn(async () => {
        throw new Error('isAgentBranch should not be called for fallback prefixes');
      });
      vi.doMock('@lumenflow/core', () => ({ isAgentBranch }));

      const { isCloudManagedBranch } = await import('../wu-cleanup-cloud.js');

      await expect(isCloudManagedBranch('claude/feature-xyz')).resolves.toBe(true);
      await expect(isCloudManagedBranch('codex/feature-branch')).resolves.toBe(true);
      expect(isAgentBranch).not.toHaveBeenCalled();
    });

    it('should protect centrally detected agent branches', async () => {
      const isAgentBranch = vi.fn(async (branch: string) => {
        return (
          branch.startsWith('copilot/') ||
          branch.startsWith('cursor/') ||
          branch.startsWith('agent/')
        );
      });
      vi.doMock('@lumenflow/core', () => ({ isAgentBranch }));

      const { isCloudManagedBranch } = await import('../wu-cleanup-cloud.js');

      await expect(isCloudManagedBranch('copilot/cloud-fix')).resolves.toBe(true);
      await expect(isCloudManagedBranch('cursor/cloud-fix')).resolves.toBe(true);
      await expect(isCloudManagedBranch('agent/cloud-fix')).resolves.toBe(true);
      expect(isAgentBranch).toHaveBeenCalledWith('copilot/cloud-fix');
      expect(isAgentBranch).toHaveBeenCalledWith('cursor/cloud-fix');
      expect(isAgentBranch).toHaveBeenCalledWith('agent/cloud-fix');
    });

    it('should not classify unknown branches as cloud-managed when matcher returns false', async () => {
      const isAgentBranch = vi.fn(async () => false);
      vi.doMock('@lumenflow/core', () => ({ isAgentBranch }));

      const { isCloudManagedBranch } = await import('../wu-cleanup-cloud.js');

      await expect(isCloudManagedBranch('feature/local-branch')).resolves.toBe(false);
    });

    it('should NOT flag lane-derived branches as cloud-managed', async () => {
      const isAgentBranch = vi.fn(async () => {
        throw new Error('isAgentBranch should not be called for lane/* branches');
      });
      vi.doMock('@lumenflow/core', () => ({ isAgentBranch }));

      const { isCloudManagedBranch } = await import('../wu-cleanup-cloud.js');

      await expect(isCloudManagedBranch('lane/framework-cli/wu-1590')).resolves.toBe(false);
      expect(isAgentBranch).not.toHaveBeenCalled();
    });
  });
});

// --- AC6: Coverage for all branch-pr paths ---
describe('branch-pr lifecycle coverage (WU-1590 AC6)', () => {
  it('all cloud helper modules should export required functions', async () => {
    // wu-create-cloud
    const createCloud = await import('../wu-create-cloud.js');
    expect(typeof createCloud.buildCloudCreateContext).toBe('function');

    // wu-claim-cloud
    const claimCloud = await import('../wu-claim-cloud.js');
    expect(typeof claimCloud.buildCloudClaimMetadata).toBe('function');
    expect(typeof claimCloud.shouldSkipBranchExistsCheck).toBe('function');

    // wu-done-cloud
    const doneCloud = await import('../wu-done-cloud.js');
    expect(typeof doneCloud.shouldSkipEnsureOnMainForDone).toBe('function');
    expect(typeof doneCloud.validateBranchPrCodePathsAgainstHead).toBe('function');

    // wu-cleanup-cloud
    const cleanupCloud = await import('../wu-cleanup-cloud.js');
    expect(typeof cleanupCloud.resolveCleanupBranch).toBe('function');
    expect(typeof cleanupCloud.shouldSkipWorktreeChecks).toBe('function');
    expect(typeof cleanupCloud.isCloudManagedBranch).toBe('function');
  });
});
