/**
 * @file worktree-guard.test.mjs
 * @description Unit tests for worktree guard (WU-1396)
 *
 * Tests WU context validation and main branch protection:
 * - isInWorktree(): Detect if current directory is a worktree
 * - getWUContext(): Extract WU ID and lane from worktree path or git branch
 * - assertWorktreeRequired(): Throw if not in worktree (for write operations)
 * - isMainBranch(): Check if on main/master branch
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  isInWorktree,
  getWUContext,
  assertWorktreeRequired,
  isMainBranch,
} from '../worktree-guard.mjs';

describe('isMainBranch', () => {
  it('should return true when on main branch', async () => {
    const mockGit = {
      getCurrentBranch: async () => 'main',
    };

    const result = await isMainBranch({ git: mockGit });
    assert.equal(result, true);
  });

  it('should return true when on master branch', async () => {
    const mockGit = {
      getCurrentBranch: async () => 'master',
    };

    const result = await isMainBranch({ git: mockGit });
    assert.equal(result, true);
  });

  it('should return false when on lane branch', async () => {
    const mockGit = {
      getCurrentBranch: async () => 'lane/operations-tooling/wu-1396',
    };

    const result = await isMainBranch({ git: mockGit });
    assert.equal(result, false);
  });

  it('should return false when on feature branch', async () => {
    const mockGit = {
      getCurrentBranch: async () => 'feature/new-feature',
    };

    const result = await isMainBranch({ git: mockGit });
    assert.equal(result, false);
  });
});

describe('isInWorktree', () => {
  const originalCwd = process.cwd();

  afterEach(() => {
    process.chdir(originalCwd);
  });

  it('should return true when in worktree directory', () => {
    const worktreePath = '/home/user/project/worktrees/operations-tooling-wu-1396';
    const result = isInWorktree({ cwd: worktreePath });
    assert.equal(result, true);
  });

  it('should return true when in nested directory within worktree', () => {
    const nestedPath = '/home/user/project/worktrees/operations-tooling-wu-1396/tools/lib';
    const result = isInWorktree({ cwd: nestedPath });
    assert.equal(result, true);
  });

  it('should return false when in main checkout', () => {
    const mainPath = '/home/user/project';
    const result = isInWorktree({ cwd: mainPath });
    assert.equal(result, false);
  });

  it('should return false when in main checkout subdirectory', () => {
    const mainSubPath = '/home/user/project/tools/lib';
    const result = isInWorktree({ cwd: mainSubPath });
    assert.equal(result, false);
  });

  it('should return false when worktrees directory does not contain wu-id', () => {
    const invalidPath = '/home/user/project/worktrees/some-other-dir';
    const result = isInWorktree({ cwd: invalidPath });
    assert.equal(result, false);
  });

  it('should use process.cwd() when cwd parameter not provided', () => {
    // Default behavior should not throw
    const result = isInWorktree();
    // We can't assert the value since we don't know where the test is running
    assert.equal(typeof result, 'boolean');
  });
});

describe('getWUContext from worktree path', () => {
  it('should extract WU context from worktree path', async () => {
    const worktreePath = '/home/user/project/worktrees/operations-tooling-wu-1396';
    const result = await getWUContext({ cwd: worktreePath });

    assert.notEqual(result, null);
    assert.equal(result.wuId, 'WU-1396');
    assert.equal(result.lane, 'operations-tooling');
    assert.equal(result.worktreePath, 'worktrees/operations-tooling-wu-1396');
  });

  it('should extract WU context from nested directory in worktree', async () => {
    const nestedPath = '/home/user/project/worktrees/intelligence-prompts-wu-789/packages/prompts';
    const result = await getWUContext({ cwd: nestedPath });

    assert.notEqual(result, null);
    assert.equal(result.wuId, 'WU-789');
    assert.equal(result.lane, 'intelligence-prompts');
    assert.equal(result.worktreePath, 'worktrees/intelligence-prompts-wu-789');
  });

  it('should handle single-word lane names', async () => {
    const worktreePath = '/home/user/project/worktrees/operations-wu-123';
    const result = await getWUContext({ cwd: worktreePath });

    assert.notEqual(result, null);
    assert.equal(result.wuId, 'WU-123');
    assert.equal(result.lane, 'operations');
    assert.equal(result.worktreePath, 'worktrees/operations-wu-123');
  });

  it('should handle multi-word lane names with hyphens', async () => {
    const worktreePath = '/home/user/project/worktrees/core-systems-api-wu-456';
    const result = await getWUContext({ cwd: worktreePath });

    assert.notEqual(result, null);
    assert.equal(result.wuId, 'WU-456');
    assert.equal(result.lane, 'core-systems-api');
    assert.equal(result.worktreePath, 'worktrees/core-systems-api-wu-456');
  });

  it('should return null when not in worktree', async () => {
    const mainPath = '/home/user/project';
    // Provide mock git to avoid simple-git directory check
    const mockGit = {
      getCurrentBranch: async () => 'main',
    };
    const result = await getWUContext({ cwd: mainPath, git: mockGit });

    assert.equal(result, null);
  });

  it('should return null when in invalid worktree path', async () => {
    const invalidPath = '/home/user/project/worktrees/invalid-path';
    // Provide mock git to avoid simple-git directory check
    const mockGit = {
      getCurrentBranch: async () => 'main',
    };
    const result = await getWUContext({ cwd: invalidPath, git: mockGit });

    assert.equal(result, null);
  });
});

describe('getWUContext from git branch', () => {
  it('should extract WU context from lane branch name', async () => {
    const mockGit = {
      getCurrentBranch: async () => 'lane/operations-tooling/wu-1396',
    };

    const result = await getWUContext({
      cwd: '/home/user/project',
      git: mockGit,
    });

    assert.notEqual(result, null);
    assert.equal(result.wuId, 'WU-1396');
    assert.equal(result.lane, 'operations-tooling');
    assert.equal(result.worktreePath, null); // Not in worktree, on lane branch
  });

  it('should extract WU context from lane branch with single-word lane', async () => {
    const mockGit = {
      getCurrentBranch: async () => 'lane/operations/wu-123',
    };

    const result = await getWUContext({
      cwd: '/home/user/project',
      git: mockGit,
    });

    assert.notEqual(result, null);
    assert.equal(result.wuId, 'WU-123');
    assert.equal(result.lane, 'operations');
    assert.equal(result.worktreePath, null);
  });

  it('should prioritize worktree path over branch name when both available', async () => {
    const mockGit = {
      getCurrentBranch: async () => 'lane/operations-tooling/wu-1396',
    };

    const result = await getWUContext({
      cwd: '/home/user/project/worktrees/operations-tooling-wu-1396',
      git: mockGit,
    });

    // Should use worktree path detection
    assert.notEqual(result, null);
    assert.equal(result.wuId, 'WU-1396');
    assert.equal(result.lane, 'operations-tooling');
    assert.equal(result.worktreePath, 'worktrees/operations-tooling-wu-1396');
  });

  it('should return null when on main branch and not in worktree', async () => {
    const mockGit = {
      getCurrentBranch: async () => 'main',
    };

    const result = await getWUContext({
      cwd: '/home/user/project',
      git: mockGit,
    });

    assert.equal(result, null);
  });

  it('should return null when on non-lane feature branch', async () => {
    const mockGit = {
      getCurrentBranch: async () => 'feature/new-feature',
    };

    const result = await getWUContext({
      cwd: '/home/user/project',
      git: mockGit,
    });

    assert.equal(result, null);
  });
});

describe('assertWorktreeRequired', () => {
  it('should not throw when in worktree', async () => {
    const worktreePath = '/home/user/project/worktrees/operations-tooling-wu-1396';

    await assert.doesNotReject(async () => {
      await assertWorktreeRequired({
        cwd: worktreePath,
        operation: 'wu:claim',
      });
    });
  });

  it('should not throw when on lane branch (even if not in worktree)', async () => {
    const mockGit = {
      getCurrentBranch: async () => 'lane/operations-tooling/wu-1396',
    };

    await assert.doesNotReject(async () => {
      await assertWorktreeRequired({
        cwd: '/home/user/project',
        git: mockGit,
        operation: 'wu:claim',
      });
    });
  });

  it('should throw when on main branch in main checkout', async () => {
    const mockGit = {
      getCurrentBranch: async () => 'main',
    };

    await assert.rejects(
      async () => {
        await assertWorktreeRequired({
          cwd: '/home/user/project',
          git: mockGit,
          operation: 'wu:claim',
        });
      },
      {
        name: 'Error',
        message: /BLOCKED: Operation 'wu:claim' requires a worktree/,
      }
    );
  });

  it('should include helpful error message with operation name', async () => {
    const mockGit = {
      getCurrentBranch: async () => 'main',
    };

    await assert.rejects(
      async () => {
        await assertWorktreeRequired({
          cwd: '/home/user/project',
          git: mockGit,
          operation: 'file-write',
        });
      },
      {
        message: /file-write/,
      }
    );
  });

  it('should include help text in error message', async () => {
    const mockGit = {
      getCurrentBranch: async () => 'main',
    };

    await assert.rejects(
      async () => {
        await assertWorktreeRequired({
          cwd: '/home/user/project',
          git: mockGit,
          operation: 'wu:done',
        });
      },
      {
        message: /pnpm wu:claim/,
      }
    );
  });

  it('should use default operation name when not provided', async () => {
    const mockGit = {
      getCurrentBranch: async () => 'main',
    };

    await assert.rejects(
      async () => {
        await assertWorktreeRequired({
          cwd: '/home/user/project',
          git: mockGit,
        });
      },
      {
        message: /this operation/,
      }
    );
  });
});

describe('Edge cases', () => {
  it('should handle paths with trailing slashes', async () => {
    const worktreePath = '/home/user/project/worktrees/operations-tooling-wu-1396/';
    const result = await getWUContext({ cwd: worktreePath });

    assert.notEqual(result, null);
    assert.equal(result.wuId, 'WU-1396');
  });

  it('should handle Windows-style paths', async () => {
    const worktreePath = 'C:\\Users\\user\\project\\worktrees\\operations-tooling-wu-1396';
    const result = await getWUContext({ cwd: worktreePath });

    assert.notEqual(result, null);
    assert.equal(result.wuId, 'WU-1396');
    assert.equal(result.lane, 'operations-tooling');
  });

  it('should handle relative worktree paths in context extraction', async () => {
    const worktreePath = 'worktrees/operations-tooling-wu-1396';
    const result = await getWUContext({ cwd: worktreePath });

    assert.notEqual(result, null);
    assert.equal(result.wuId, 'WU-1396');
  });

  it('should handle WU IDs with different number lengths', async () => {
    const result1 = await getWUContext({ cwd: '/project/worktrees/operations-wu-1' });
    assert.notEqual(result1, null);
    assert.equal(result1.wuId, 'WU-1');

    const result2 = await getWUContext({ cwd: '/project/worktrees/operations-wu-99999' });
    assert.notEqual(result2, null);
    assert.equal(result2.wuId, 'WU-99999');
  });

  it('should not match worktree-like paths without proper wu-id format', async () => {
    // Provide mock git to avoid simple-git directory check
    const mockGit = {
      getCurrentBranch: async () => 'main',
    };

    const result1 = await getWUContext({ cwd: '/project/worktrees/operations-123', git: mockGit });
    assert.equal(result1, null);

    const result2 = await getWUContext({ cwd: '/project/worktrees/operations-wu', git: mockGit });
    assert.equal(result2, null);

    const result3 = await getWUContext({
      cwd: '/project/worktrees/operations-wu-abc',
      git: mockGit,
    });
    assert.equal(result3, null);
  });
});
