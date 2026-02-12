import { describe, it, expect } from 'vitest';

import {
  BRANCH_PR_EDIT_MODE,
  BLOCKED_EDIT_MODE,
  resolveInProgressEditMode,
  shouldUseBranchPrStatePath,
  shouldUseBranchPrDeletePath,
} from '../wu-state-cloud.js';
import { shouldUseBranchPrBlockPath } from '../wu-block.js';
import { shouldUseBranchPrUnblockPath } from '../wu-unblock.js';
import { shouldUseBranchPrReleasePath } from '../wu-release.js';

describe('WU-1591: branch-pr state command path selection', () => {
  it('resolves branch-pr in-progress WUs to branch-pr edit mode', () => {
    expect(resolveInProgressEditMode('branch-pr')).toBe(BRANCH_PR_EDIT_MODE);
  });

  it('keeps branch-only as blocked mode for wu:edit', () => {
    expect(resolveInProgressEditMode('branch-only')).toBe(BLOCKED_EDIT_MODE);
  });

  it('selects branch-pr path for state commands from claimed_mode', () => {
    expect(shouldUseBranchPrStatePath({ claimed_mode: 'branch-pr' })).toBe(true);
    expect(shouldUseBranchPrStatePath({ claimed_mode: 'worktree' })).toBe(false);
  });

  it('wu:block, wu:unblock, and wu:release all switch to branch-pr path', () => {
    expect(shouldUseBranchPrBlockPath({ claimed_mode: 'branch-pr' })).toBe(true);
    expect(shouldUseBranchPrUnblockPath({ claimed_mode: 'branch-pr' })).toBe(true);
    expect(shouldUseBranchPrReleasePath({ claimed_mode: 'branch-pr' })).toBe(true);

    expect(shouldUseBranchPrBlockPath({ claimed_mode: 'worktree' })).toBe(false);
    expect(shouldUseBranchPrUnblockPath({ claimed_mode: 'worktree' })).toBe(false);
    expect(shouldUseBranchPrReleasePath({ claimed_mode: 'worktree' })).toBe(false);
  });

  it('selects branch-pr delete path when any target WU is branch-pr', () => {
    expect(shouldUseBranchPrDeletePath([{ claimed_mode: 'branch-pr' }])).toBe(true);
    expect(shouldUseBranchPrDeletePath([{ claimed_mode: 'worktree' }])).toBe(false);
    expect(shouldUseBranchPrDeletePath([{ status: 'ready' }, { claimed_mode: 'branch-pr' }])).toBe(
      true,
    );
  });
});
